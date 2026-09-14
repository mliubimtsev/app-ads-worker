import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DomainStatus, ScrapeOutcome } from '../contracts/enums';
import { Semaphore } from '../common/concurrency';
import { copyIntoStage, type CopyCapableClient } from './copy-into-stage';
import { computeNextScrape } from './next-scrape';
import { APPLY_MERGE_SQL } from './sql/merge.sql';
import type { FailureInput, NoFileInput, UnchangedInput, UpdateInput } from './persist.types';
import { DomainSQL } from './sql/domain.sql';
import { DomainContentVersionSQL } from './sql/domain-content-version.sql';
import { StageEntriesSQL } from './sql/stage-entries.sql';

/**
 * Вся запись в PostgreSQL по одному домену
 * Каждый публичный метод - это одна транзакция. Параллелизм записи ограничен семафором
 */
@Injectable()
export class PersistService {
  private readonly logger = new Logger(PersistService.name);
  private readonly dbGate: Semaphore;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    this.dbGate = new Semaphore(cfg.scrape.dbWriteConcurrency);
  }

  /** 304 Not Modified или совпал хэш содержимого */
  recordUnchanged(input: UnchangedInput): Promise<void> {
    return this.dbGate.run(() =>
      this.tx(async (qr) => {
        const nextScrapeDay = computeNextScrape();

        await qr.query(DomainSQL.markUnchanged, [
          input.item.domainId,
          input.responseEtag,
          input.responseLastModified,
          input.httpStatus,
          nextScrapeDay,
        ]);

        if (input.outcome === ScrapeOutcome.UnchangedHash) {
          await qr.query(DomainContentVersionSQL.markUnchanged, [input.item.domainId]);
        }
      }),
    );
  }

  /** 404 / у домена нет app-ads.txt: строки НЕ помечаем removed */
  recordNoFile(input: NoFileInput): Promise<void> {
    return this.dbGate.run(() =>
      this.tx(async (qr) => {
        const nextScrapeDay = computeNextScrape();
        await qr.query(DomainSQL.markNoFile, [
          input.item.domainId,
          input.httpStatus,
          nextScrapeDay,
        ]);
      }),
    );
  }

  /** Сетевая / HTTP / parse ошибка */
  recordFailure(input: FailureInput): Promise<void> {
    return this.dbGate.run(() =>
      this.tx(async (qr) => {
        const nextScrapeDay = computeNextScrape();

        await qr.query(DomainSQL.markFailure, [
          input.item.domainId,
          input.httpStatus,
          DomainStatus.Failed,
          nextScrapeDay,
        ]);
      }),
    );
  }

  /** Новый контент: S3 уже залит - сливаем дифф в одной транзакции */
  applyUpdate(input: UpdateInput): Promise<void> {
    return this.dbGate.run(() =>
      this.tx(async (qr) => {
        const runId = await this.nextRunId(qr);
        const rawClient = this.rawClient(qr);

        await copyIntoStage(rawClient, runId, input.parsed.lines);

        await qr.query(DomainContentVersionSQL.markReset, [input.item.domainId]);

        const versionRows: Array<{ id: string }> = await qr.query(
          DomainContentVersionSQL.markUpdate,
          [input.item.domainId, input.contentHash, input.s3.bucket, input.s3.key],
        );
        const versionId = versionRows[0].id;

        await qr.query(APPLY_MERGE_SQL, [runId, input.item.domainId, versionId]);

        await qr.query(StageEntriesSQL.clearProcessed, [runId]);

        const nextScrapeDay = computeNextScrape();

        await qr.query(DomainSQL.markUpdate, [
          input.item.domainId,
          input.contentHash,
          input.responseEtag,
          input.responseLastModified,
          input.httpStatus,
          versionId,
          nextScrapeDay,
        ]);
      }),
    );
  }

  private async tx<T>(fn: (qr: QueryRunner) => Promise<T>): Promise<T> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const result = await fn(qr);
      await qr.commitTransaction();
      return result;
    } catch (err) {
      await qr.rollbackTransaction().catch(() => undefined);
      throw err;
    } finally {
      await qr.release();
    }
  }

  private rawClient(qr: QueryRunner): CopyCapableClient {
    const client = (qr as unknown as { databaseConnection?: CopyCapableClient }).databaseConnection;
    if (!client) throw new Error('Не удалось получить сырой pg-клиент из QueryRunner');
    return client;
  }

  private async nextRunId(qr: QueryRunner): Promise<string> {
    const rows: Array<{ id: string }> = await qr.query(
      `SELECT nextval('scrape_run_seq')::text AS id`,
    );
    return rows[0].id;
  }
}
