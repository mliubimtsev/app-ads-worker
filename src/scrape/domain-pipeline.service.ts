import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { mapSettled } from '../common/concurrency';
import { ScrapeOutcome } from '../contracts/enums';
import type { AppAdsScrapeItem, AppAdsScrapeJob } from '../contracts/job.contract';
import { drain, readBodyCapped, readSnippet } from '../http/body';
import {
  ContentParseError,
  EmptyBodyError,
  HttpStatusError,
  NetworkError,
  ScrapeError,
  DeadlineError,
} from '../http/errors';
import { HostThrottler } from '../http/host-throttler';
import { HTTP_TRANSPORT, type HttpTransport } from '../http/http-transport';
import { PersistService } from '../persist/persist.service';
import type { AttemptContext } from '../persist/persist.types';
import { RawFileStore } from '../storage/raw-file.store';
import { parseAppAds } from './app-ads-parser';
import { BatchSummary, DomainResult } from './interfaces/scrape.interface';

const SNIPPET_BYTES = 2048;

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

function conditionalHeaders(item: AppAdsScrapeItem): Record<string, string> {
  const headers: Record<string, string> = {};
  if (item.etag) headers['if-none-match'] = item.etag;
  if (item.lastModified) headers['if-modified-since'] = item.lastModified;
  return headers;
}

function isAbortLike(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return (
    e?.name === 'AbortError' ||
    e?.name === 'TimeoutError' ||
    e?.code === 'UND_ERR_ABORTED' ||
    e?.code === 'ABORT_ERR'
  );
}

/**
 * Конвейер обработки одного домена
 */
@Injectable()
export class DomainPipelineService {
  private readonly logger = new Logger(DomainPipelineService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(HTTP_TRANSPORT) private readonly transport: HttpTransport,
    private readonly throttler: HostThrottler,
    private readonly rawStore: RawFileStore,
    private readonly persist: PersistService,
  ) {}

  async runBatch(job: AppAdsScrapeJob, attempt: number): Promise<BatchSummary> {
    const settled = await mapSettled(job.items, this.cfg.scrape.httpConcurrency, (item) =>
      this.processDomain(item, attempt),
    );

    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected.length > 0) {
      this.logger.error(
        { batchId: job.batchId, systemErrors: rejected.length },
        'системные ошибки в батче - джоба уйдёт в retry',
      );
      throw rejected[0].reason;
    }

    const byOutcome: Record<string, number> = {};
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        byOutcome[r.value.outcome] = (byOutcome[r.value.outcome] ?? 0) + 1;
      }
    }
    this.logger.log({ batchId: job.batchId, total: job.items.length, byOutcome }, 'батч обработан');
    return { batchId: job.batchId, total: job.items.length, byOutcome };
  }

  async processDomain(item: AppAdsScrapeItem, attempt: number): Promise<DomainResult> {
    const startedAt = new Date();
    const host = safeHost(item.url);
    const base: Omit<
      AttemptContext,
      'httpStatus' | 'responseEtag' | 'responseLastModified' | 'bytesDownloaded'
    > = { item, startedAt, attempt };

    try {
      const res = await this.throttler.run(host, () =>
        this.transport.get({
          url: item.url,
          headers: conditionalHeaders(item),
          signal: AbortSignal.timeout(this.cfg.http.deadlineMs),
          maxRedirects: this.cfg.http.maxRedirects,
        }),
      );

      const ctx: AttemptContext = {
        ...base,
        httpStatus: res.statusCode,
        responseEtag: res.headers['etag'] ?? null,
        responseLastModified: res.headers['last-modified'] ?? null,
        bytesDownloaded: null,
      };

      if (res.statusCode === 304) {
        drain(res.body);
        await this.persist.recordUnchanged({
          ...ctx,
          outcome: ScrapeOutcome.Unchanged304,
          contentHash: null,
          httpStatus: res.statusCode,
        });
        return { domainId: item.domainId, outcome: ScrapeOutcome.Unchanged304 };
      }

      if (res.statusCode === 404) {
        const snippet = await readSnippet(res.body, SNIPPET_BYTES);
        await this.persist.recordNoFile({ ...ctx, bodySnippet: snippet });
        return { domainId: item.domainId, outcome: ScrapeOutcome.NoFile };
      }

      if (res.statusCode >= 300) {
        // 304/404 обработаны выше; сюда попадают неразрешённые 3xx и все 4xx/5xx
        const snippet = await readSnippet(res.body, SNIPPET_BYTES);
        throw new HttpStatusError(res.statusCode, snippet);
      }

      const raw = await readBodyCapped(res.body, this.cfg.http.maxBytes);
      if (raw.length === 0) throw new EmptyBodyError('200 OK с пустым телом');

      const contentHash = createHash('md5').update(raw).digest();
      if (item.contentHash && contentHash.equals(Buffer.from(item.contentHash, 'hex'))) {
        await this.persist.recordUnchanged({
          ...ctx,
          outcome: ScrapeOutcome.UnchangedHash,
          contentHash,
        });
        return { domainId: item.domainId, outcome: ScrapeOutcome.UnchangedHash };
      }

      const parsed = parseAppAds(raw.toString('utf8'));
      if (parsed.lines.length === 0) {
        throw new ContentParseError(`0 валидных строк из ${raw.length} байт`);
      }

      const s3 = await this.rawStore.putRawAppAds(item.domainId, contentHash.toString('hex'), raw);
      await this.persist.applyUpdate({
        ...ctx,
        contentHash,
        parsed,
        s3,
        firstScrape: !item.contentHash,
      });
      return {
        domainId: item.domainId,
        outcome: item.contentHash ? ScrapeOutcome.Updated : ScrapeOutcome.Created,
      };
    } catch (err) {
      return this.handleError(err, base);
    }
  }

  /**
   * Фиксирует доменную/сетевую ошибку и возвращает результат
   */
  private async handleError(
    err: unknown,
    base: Omit<
      AttemptContext,
      'httpStatus' | 'responseEtag' | 'responseLastModified' | 'bytesDownloaded'
    >,
  ): Promise<DomainResult> {
    let scrapeErr: ScrapeError;
    let httpStatus: number | null = null;
    let bodySnippet: string | null = null;

    if (err instanceof ScrapeError) {
      scrapeErr = err;
      if (err instanceof HttpStatusError) {
        httpStatus = err.status;
        bodySnippet = err.bodySnippet;
      }
    } else if (isAbortLike(err)) {
      scrapeErr = new DeadlineError('превышен жёсткий дедлайн запроса');
    } else {
      const e = err as { code?: string; message?: string; name?: string };
      const looksNetwork = Boolean(e?.code) || e?.name === 'TypeError';
      if (!looksNetwork) {
        throw err;
      }
      scrapeErr = new NetworkError(e.message ?? String(err), e.code);
    }

    await this.persist.recordFailure({
      ...base,
      httpStatus,
      responseEtag: null,
      responseLastModified: null,
      bytesDownloaded: null,
      outcome: scrapeErr.outcome,
      errorClass: scrapeErr.errorClass,
      errorMessage: scrapeErr.message,
      bodySnippet,
    });
    return { domainId: base.item.domainId, outcome: scrapeErr.outcome };
  }
}
