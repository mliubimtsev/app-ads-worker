import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { DomainPipelineService } from './domain-pipeline.service';
import { ScrapeOutcome } from '../contracts/enums';
import type { AppConfig } from '../config/app-config';
import type { HttpGetRequest, HttpGetResponse, HttpTransport } from '../http/http-transport';
import type { HostThrottler } from '../http/host-throttler';
import type { RawFileStore } from '../storage/raw-file.store';
import type { PersistService } from '../persist/persist.service';
import type { AppAdsScrapeItem, AppAdsScrapeJob } from '../contracts/job.contract';

function makeCfg(): AppConfig {
  return {
    scrape: { httpConcurrency: 4, dbWriteConcurrency: 4, queueConcurrency: 2 },
    http: { deadlineMs: 5000, maxRedirects: 3, maxBytes: 10 * 1024 * 1024 },
  } as unknown as AppConfig;
}

function response(
  statusCode: number,
  body: string | null = null,
  headers: Record<string, string> = {},
): HttpGetResponse {
  return { statusCode, headers, body: Readable.from(body === null ? [] : [body]) };
}

function makeItem(overrides: Partial<AppAdsScrapeItem> = {}): AppAdsScrapeItem {
  return {
    domainId: 1,
    url: 'https://example.com/app-ads.txt',
    etag: null,
    lastModified: null,
    contentHash: null,
    ...overrides,
  };
}

function makeSut() {
  const transport = { get: jest.fn() };
  const throttler = {
    run: jest.fn((_host: string, fn: () => Promise<unknown>) => fn()),
  } as unknown as HostThrottler;
  const rawStore = {
    putRawAppAds: jest.fn().mockResolvedValue({ bucket: 'raw', key: 'k', gzipSize: 1 }),
  };
  const persist = {
    recordUnchanged: jest.fn().mockResolvedValue(undefined),
    recordNoFile: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    applyUpdate: jest.fn().mockResolvedValue(undefined),
  };

  const sut = new DomainPipelineService(
    makeCfg(),
    transport as unknown as HttpTransport,
    throttler,
    rawStore as unknown as RawFileStore,
    persist as unknown as PersistService,
  );

  return { sut, transport, throttler, rawStore, persist };
}

describe('DomainPipelineService.processDomain', () => {
  beforeEach(() => jest.clearAllMocks());

  it('304 → recordUnchanged(Unchanged304); контент не читается, S3/applyUpdate не трогаются', async () => {
    const { sut, transport, persist, rawStore } = makeSut();
    transport.get.mockResolvedValue(response(304));

    const res = await sut.processDomain(makeItem(), 1);

    expect(res).toEqual({ domainId: 1, outcome: ScrapeOutcome.Unchanged304 });
    expect(persist.recordUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: ScrapeOutcome.Unchanged304, contentHash: null }),
    );
    expect(rawStore.putRawAppAds).not.toHaveBeenCalled();
    expect(persist.applyUpdate).not.toHaveBeenCalled();
  });

  it('404 → recordNoFile (не recordUnchanged, не applyUpdate)', async () => {
    const { sut, transport, persist } = makeSut();
    transport.get.mockResolvedValue(response(404, 'not found'));

    const res = await sut.processDomain(makeItem(), 1);

    expect(res).toEqual({ domainId: 1, outcome: ScrapeOutcome.NoFile });
    expect(persist.recordNoFile).toHaveBeenCalledTimes(1);
    expect(persist.recordUnchanged).not.toHaveBeenCalled();
  });

  it('200 + совпавший contentHash → recordUnchanged(UnchangedHash); парсинг и S3 не выполняются', async () => {
    const { sut, transport, persist, rawStore } = makeSut();
    const body = 'google.com, 1, DIRECT\n';
    const hashHex = createHash('md5').update(body).digest('hex');
    transport.get.mockResolvedValue(response(200, body));

    const res = await sut.processDomain(makeItem({ contentHash: hashHex }), 1);

    expect(res).toEqual({ domainId: 1, outcome: ScrapeOutcome.UnchangedHash });
    expect(rawStore.putRawAppAds).not.toHaveBeenCalled();
    expect(persist.applyUpdate).not.toHaveBeenCalled();
  });

  it('200 + новый контент → грузит в S3 и вызывает applyUpdate; outcome/firstScrape зависят от прошлого contentHash', async () => {
    const { sut, transport, persist, rawStore } = makeSut();
    transport.get.mockImplementation(async () => response(200, 'google.com, 1, DIRECT\n'));

    const first = await sut.processDomain(makeItem({ contentHash: null }), 1);
    expect(first.outcome).toBe(ScrapeOutcome.Created);
    expect(persist.applyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ firstScrape: true }),
    );

    const second = await sut.processDomain(makeItem({ contentHash: 'aaaa' }), 1);
    expect(second.outcome).toBe(ScrapeOutcome.Updated);
    expect(persist.applyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ firstScrape: false }),
    );

    expect(rawStore.putRawAppAds).toHaveBeenCalledTimes(2);
  });

  it('доменная ошибка (представитель - HTTP 500) → recordFailure, НЕ пробрасывается наружу', async () => {
    const { sut, transport, persist } = makeSut();
    transport.get.mockResolvedValue(response(500, 'upstream error'));

    const res = await sut.processDomain(makeItem(), 1);

    expect(res.outcome).toBe(ScrapeOutcome.HttpError);
    expect(persist.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: ScrapeOutcome.HttpError, httpStatus: 500 }),
    );
  });

  it('сетевой сбой (err.code) классифицируется как NetworkError', async () => {
    const { sut, transport, persist } = makeSut();
    transport.get.mockRejectedValue(
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    );

    const res = await sut.processDomain(makeItem(), 1);

    expect(res.outcome).toBe(ScrapeOutcome.NetworkError);
    expect(persist.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: ScrapeOutcome.NetworkError }),
    );
  });

  it('превышение дедлайна (AbortError) классифицируется как Timeout', async () => {
    const { sut, transport, persist } = makeSut();
    transport.get.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const res = await sut.processDomain(makeItem(), 1);

    expect(res.outcome).toBe(ScrapeOutcome.Timeout);
    expect(persist.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: ScrapeOutcome.Timeout }),
    );
  });

  it('неопознанная ошибка (не ScrapeError, без code, не abort) пробрасывается наружу - batch уйдёт в retry', async () => {
    const { sut, transport, persist } = makeSut();
    transport.get.mockRejectedValue(new Error('внезапный баг в коде'));

    await expect(sut.processDomain(makeItem(), 1)).rejects.toThrow('внезапный баг в коде');
    expect(persist.recordFailure).not.toHaveBeenCalled();
  });
});

describe('DomainPipelineService.runBatch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('системная (непредвиденная) ошибка одного домена валит весь батч', async () => {
    const { sut, transport } = makeSut();
    transport.get.mockRejectedValue(new Error('непредвиденный сбой'));

    const job: AppAdsScrapeJob = { batchId: 'b1', items: [makeItem()] };

    await expect(sut.runBatch(job, 1)).rejects.toThrow('непредвиденный сбой');
  });

  it('доменные исходы не валят батч и агрегируются в byOutcome', async () => {
    const { sut, transport } = makeSut();
    transport.get.mockImplementation(async (req: HttpGetRequest) =>
      req.url.includes('second') ? response(404) : response(304),
    );

    const job: AppAdsScrapeJob = {
      batchId: 'b1',
      items: [
        makeItem({ domainId: 1, url: 'https://first.example/app-ads.txt' }),
        makeItem({ domainId: 2, url: 'https://second.example/app-ads.txt' }),
      ],
    };

    const summary = await sut.runBatch(job, 1);

    expect(summary).toEqual({
      batchId: 'b1',
      total: 2,
      byOutcome: {
        [ScrapeOutcome.Unchanged304]: 1,
        [ScrapeOutcome.NoFile]: 1,
      },
    });
  });
});
