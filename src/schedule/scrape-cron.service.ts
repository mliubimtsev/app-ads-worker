import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig, loadConfig } from '../config/app-config';
import {
  APP_ADS_SCRAPE_JOB,
  APP_ADS_SCRAPE_QUEUE,
  type AppAdsScrapeItem,
  scrapeJobOptions,
} from '../contracts/job.contract';
import { SEED_DOMAINS } from './seed-domains';

// @Interval требует статичный интервал - читаем из окружения на этапе загрузки.
const TICK_MS = loadConfig().dev.schedulerIntervalMs;

interface PickedRow {
  id: number;
  domain_name: string;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
}

/**
 * Cron-планировщик очереди app-ads-scrape: подбирает домены, которым пора
 * пересканироваться, и ставит батчи в очередь
 */
@Injectable()
export class ScrapeCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScrapeCronService.name);
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly dataSource: DataSource,
    @InjectQueue(APP_ADS_SCRAPE_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.cfg.dev.seed) {
      await this.seed().catch((err) => this.logger.error({ err }, 'seed failed'));
    }
    if (this.cfg.dev.enableScheduler) {
      this.logger.log(`scrape-cron включён (тик каждые ${TICK_MS} мс)`);
      await this.tick();
    }
  }

  @Interval('scrape-cron', TICK_MS)
  async scheduledTick(): Promise<void> {
    if (!this.cfg.dev.enableScheduler) return;
    await this.tick();
  }

  /** Сид реальных доменов, если реестр пуст */
  private async seed(): Promise<void> {
    const values = SEED_DOMAINS.map((_, i) => `($${i + 1}, 'pending', now())`).join(',');
    const inserted: unknown[] = await this.dataSource.query(
      `INSERT INTO domain (domain_name, status,  next_scrape_at)
       VALUES ${values}
       ON CONFLICT (domain_name) DO NOTHING
       RETURNING id`,
      SEED_DOMAINS,
    );
    this.logger.log(`seed: добавлено доменов ${inserted.length} (из ${SEED_DOMAINS.length})`);
  }

  /** Один тик: выбрать «созревшие» домены, нарезать на батчи, поставить в очередь */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = (
        await this.dataSource.query(
          `
        WITH picked AS (
          SELECT id FROM domain
          WHERE status IN ('pending','failed','no_file','queued')
          ORDER BY next_scrape_at NULLS FIRST
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE domain d
        SET status = 'queued', locked_at = now(), updated_at = now()
        FROM picked
        WHERE d.id = picked.id
        RETURNING d.id, d.domain_name, d.etag, d.last_modified,
                  encode(d.content_hash, 'hex') AS content_hash
        `,
          [this.cfg.dev.schedulerBudget],
        )
      )[0] as PickedRow[];

      if (rows.length === 0) return;

      const size = this.cfg.dev.batchSize;
      let batches = 0;
      for (let i = 0; i < rows.length; i += size) {
        const slice = rows.slice(i, i + size);

        const items: AppAdsScrapeItem[] = slice.map((r) => ({
          domainId: r.id,
          url: `https://${r.domain_name}/app-ads.txt`,
          etag: r.etag,
          lastModified: r.last_modified,
          contentHash: r.content_hash,
        }));

        const batchId = randomUUID();
        await this.queue.add(APP_ADS_SCRAPE_JOB, { batchId, items }, scrapeJobOptions());
        batches += 1;
      }
      this.logger.log(`tick: доменов ${rows.length} → батчей ${batches}`);
    } finally {
      this.running = false;
    }
  }
}
