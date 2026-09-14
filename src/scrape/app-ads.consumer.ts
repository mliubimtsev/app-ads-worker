import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { loadConfig } from '../config/app-config';
import { APP_ADS_SCRAPE_QUEUE } from '../contracts/job.contract';
import { DomainPipelineService } from './domain-pipeline.service';
import { isAppAdsScrapeJob } from './validate-job';
import { type BatchSummary } from './interfaces/scrape.interface';

// concurrency обязан быть статичным в декораторе - читаем из окружения напрямую.
const CONCURRENCY = loadConfig().scrape.queueConcurrency;

/**
 * Потребитель очереди `app-ads-scrape`. Один job = батч доменов. Батч не падает
 * из-за отдельного домена - только из-за системной ошибки (её поднимает pipeline)
 */
@Processor(APP_ADS_SCRAPE_QUEUE, { concurrency: CONCURRENCY })
export class AppAdsConsumer extends WorkerHost {
  private readonly logger = new Logger(AppAdsConsumer.name);

  constructor(private readonly pipeline: DomainPipelineService) {
    super();
  }

  async process(job: Job): Promise<BatchSummary> {
    if (!isAppAdsScrapeJob(job.data)) {
      this.logger.warn({ jobId: job.id, data: job.data }, 'невалидный payload задачи');
      throw new UnrecoverableError('Невалидный payload задачи app-ads-scrape');
    }
    return this.pipeline.runBatch(job.data, (job.attemptsMade ?? 0) + 1);
  }
}
