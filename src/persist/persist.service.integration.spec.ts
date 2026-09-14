import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { DomainStatus, ScrapeOutcome } from '../contracts/enums';
import { InitAppAds1740000000000 } from '../database/migrations/1740000000000-InitAppAds';
import type { ParsedLine } from '../scrape/interfaces/parser.interface';
import type {
  AttemptContext,
  FailureInput,
  NoFileInput,
  UnchangedInput,
  UpdateInput,
} from './persist.types';
import { PersistService } from './persist.service';
import type { AppAdsScrapeItem } from '../contracts/job.contract';

function makeItem(domainId: number): AppAdsScrapeItem {
  return {
    domainId,
    url: `https://domain-${domainId}.example/app-ads.txt`,
    etag: null,
    lastModified: null,
    contentHash: null,
  };
}

function baseAttempt(domainId: number, httpStatus: number | null): AttemptContext {
  return {
    item: makeItem(domainId),
    startedAt: new Date(),
    attempt: 1,
    httpStatus,
    responseEtag: null,
    responseLastModified: null,
    bytesDownloaded: null,
  };
}

function line(
  adNetworkDomain: string,
  accountId: string,
  accountType: string,
  certAuthorityId: string | null = null,
): ParsedLine {
  return { adNetworkDomain, accountId, accountType, certAuthorityId };
}

function makeUpdateInput(
  domainId: number,
  lines: ParsedLine[],
  overrides: Partial<UpdateInput> = {},
): UpdateInput {
  return {
    ...baseAttempt(domainId, 200),
    responseEtag: '"v1"',
    contentHash: Buffer.from('deadbeef', 'hex'),
    parsed: { lines, linesParsed: lines.length, skipped: 0 },
    s3: { bucket: 'test-bucket', key: 'raw-key', gzipSize: 42 },
    firstScrape: true,
    ...overrides,
  };
}

function makeUnchangedInput(domainId: number, outcome: UnchangedInput['outcome']): UnchangedInput {
  return {
    ...baseAttempt(domainId, outcome === ScrapeOutcome.Unchanged304 ? 304 : 200),
    outcome,
    contentHash: outcome === ScrapeOutcome.UnchangedHash ? Buffer.from('deadbeef', 'hex') : null,
  };
}

function makeNoFileInput(domainId: number): NoFileInput {
  return { ...baseAttempt(domainId, 404), bodySnippet: null };
}

function makeFailureInput(domainId: number): FailureInput {
  return {
    ...baseAttempt(domainId, 500),
    outcome: ScrapeOutcome.HttpError,
    errorClass: 'http_500',
    errorMessage: 'HTTP 500',
    bodySnippet: null,
  };
}

describe('PersistService (интеграционные, реальный PostgreSQL через testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let ds: DataSource;
  let persist: PersistService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    ds = new DataSource({
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
      entities: [],
      migrations: [InitAppAds1740000000000],
      synchronize: false,
      logging: false,
    });
    await ds.initialize();
    await ds.runMigrations();

    const cfg = { scrape: { dbWriteConcurrency: 4 } } as unknown as AppConfig;
    persist = new PersistService(ds, cfg);
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await ds.query(
      `TRUNCATE domain, app_ads_entries, app_ads_change, domain_content_version, stage_app_ads
       RESTART IDENTITY CASCADE`,
    );
    await ds.query(
      `INSERT INTO domain (id, domain_name, status) VALUES (1, 'example.com', 'pending')`,
    );
  });

  describe('applyUpdate - первый скрап', () => {
    it('создаёт активные строки в app_ads_entries', async () => {
      await persist.applyUpdate(
        makeUpdateInput(1, [
          line('google.com', 'pub-1', 'DIRECT'),
          line('appnexus.com', '2', 'RESELLER', 'cert-1'),
        ]),
      );

      const entries = await ds.query(
        `SELECT ad_network_domain, account_id, account_type, cert_authority_id, removed_at
           FROM app_ads_entries WHERE domain_id = 1 ORDER BY ad_network_domain`,
      );

      expect(entries).toEqual([
        {
          ad_network_domain: 'appnexus.com',
          account_id: '2',
          account_type: 'RESELLER',
          cert_authority_id: 'cert-1',
          removed_at: null,
        },
        {
          ad_network_domain: 'google.com',
          account_id: 'pub-1',
          account_type: 'DIRECT',
          cert_authority_id: null,
          removed_at: null,
        },
      ]);
    });

    it('НЕ журналирует "added" в app_ads_change (журнал - только переходы существующих строк)', async () => {
      await persist.applyUpdate(makeUpdateInput(1, [line('google.com', 'pub-1', 'DIRECT')]));

      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM app_ads_change WHERE domain_id = 1`,
      );
      expect(n).toBe(0);
    });

    it('обновляет domain: status/hash/etag/current_version_id/next_scrape_at', async () => {
      await persist.applyUpdate(makeUpdateInput(1, [line('google.com', 'pub-1', 'DIRECT')]));

      const [dom] = await ds.query(
        `SELECT status, content_hash, etag, current_version_id, next_scrape_at, last_http_status
           FROM domain WHERE id = 1`,
      );

      expect(dom.status).toBe(DomainStatus.Success);
      expect(dom.content_hash).toEqual(Buffer.from('deadbeef', 'hex'));
      expect(dom.etag).toBe('"v1"');
      expect(dom.current_version_id).not.toBeNull();
      expect(dom.next_scrape_at).not.toBeNull();
      expect(dom.last_http_status).toBe(200);
    });

    it('создаёт текущую версию контента в domain_content_version', async () => {
      await persist.applyUpdate(makeUpdateInput(1, [line('google.com', 'pub-1', 'DIRECT')]));

      const versions = await ds.query(
        `SELECT is_current, s3_bucket, s3_key FROM domain_content_version WHERE domain_id = 1`,
      );

      expect(versions).toEqual([{ is_current: true, s3_bucket: 'test-bucket', s3_key: 'raw-key' }]);
    });

    it('очищает stage_app_ads после обработки run', async () => {
      await persist.applyUpdate(makeUpdateInput(1, [line('google.com', 'pub-1', 'DIRECT')]));

      const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM stage_app_ads`);
      expect(n).toBe(0);
    });
  });

  describe('applyUpdate - переходы между прогонами (SCD2-lite)', () => {
    it('пропавшая строка помечается removed и журналируется', async () => {
      await persist.applyUpdate(
        makeUpdateInput(1, [
          line('google.com', '1', 'DIRECT'),
          line('appnexus.com', '2', 'RESELLER'),
        ]),
      );

      await persist.applyUpdate(
        makeUpdateInput(1, [line('google.com', '1', 'DIRECT')], { firstScrape: false }),
      );

      const [gone] = await ds.query(
        `SELECT removed_at FROM app_ads_entries WHERE domain_id = 1 AND ad_network_domain = 'appnexus.com'`,
      );
      expect(gone.removed_at).not.toBeNull();

      const changes = await ds.query(`SELECT change_type FROM app_ads_change WHERE domain_id = 1`);
      expect(changes).toEqual([{ change_type: 'removed' }]);
    });

    it('вернувшаяся строка реактивируется, а не создаётся заново', async () => {
      await persist.applyUpdate(
        makeUpdateInput(1, [
          line('google.com', '1', 'DIRECT'),
          line('appnexus.com', '2', 'RESELLER'),
        ]),
      );
      await persist.applyUpdate(
        makeUpdateInput(1, [line('google.com', '1', 'DIRECT')], { firstScrape: false }),
      );
      await persist.applyUpdate(
        makeUpdateInput(
          1,
          [line('google.com', '1', 'DIRECT'), line('appnexus.com', '2', 'RESELLER')],
          { firstScrape: false },
        ),
      );

      const rows = await ds.query(
        `SELECT removed_at FROM app_ads_entries WHERE domain_id = 1 AND ad_network_domain = 'appnexus.com'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].removed_at).toBeNull();

      const changes = await ds.query(
        `SELECT change_type FROM app_ads_change WHERE domain_id = 1 ORDER BY id`,
      );
      expect(changes.map((c: { change_type: string }) => c.change_type)).toEqual([
        'removed',
        'reactivated',
      ]);
    });

    it('смена cert_authority_id того же ключа - cert_changed, без дублирования строки', async () => {
      await persist.applyUpdate(
        makeUpdateInput(1, [line('google.com', '1', 'DIRECT', 'cert-old')]),
      );
      await persist.applyUpdate(
        makeUpdateInput(1, [line('google.com', '1', 'DIRECT', 'cert-new')], { firstScrape: false }),
      );

      const entries = await ds.query(
        `SELECT cert_authority_id FROM app_ads_entries WHERE domain_id = 1`,
      );
      expect(entries).toEqual([{ cert_authority_id: 'cert-new' }]);

      const changes = await ds.query(
        `SELECT change_type, old_cert_authority_id, new_cert_authority_id
           FROM app_ads_change WHERE domain_id = 1`,
      );
      expect(changes).toEqual([
        {
          change_type: 'cert_changed',
          old_cert_authority_id: 'cert-old',
          new_cert_authority_id: 'cert-new',
        },
      ]);
    });

    it('повторный прогон без изменений не создаёт change-записей и не трогает first_seen_at', async () => {
      await persist.applyUpdate(makeUpdateInput(1, [line('google.com', '1', 'DIRECT')]));
      const [before] = await ds.query(
        `SELECT first_seen_at FROM app_ads_entries WHERE domain_id = 1`,
      );

      await persist.applyUpdate(
        makeUpdateInput(1, [line('google.com', '1', 'DIRECT')], { firstScrape: false }),
      );

      const [after] = await ds.query(
        `SELECT first_seen_at FROM app_ads_entries WHERE domain_id = 1`,
      );
      expect(after.first_seen_at).toEqual(before.first_seen_at);

      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM app_ads_change WHERE domain_id = 1`,
      );
      expect(n).toBe(0);
    });
  });

  describe('applyUpdate - версии контента', () => {
    it('при новом хэше старая версия перестаёт быть текущей, новая становится текущей', async () => {
      await persist.applyUpdate(
        makeUpdateInput(1, [line('google.com', '1', 'DIRECT')], {
          contentHash: Buffer.from('aaaa', 'hex'),
          s3: { bucket: 'raw', key: 'k1', gzipSize: 1 },
        }),
      );
      await persist.applyUpdate(
        makeUpdateInput(
          1,
          [line('google.com', '1', 'DIRECT'), line('appnexus.com', '2', 'RESELLER')],
          {
            firstScrape: false,
            contentHash: Buffer.from('bbbb', 'hex'),
            s3: { bucket: 'raw', key: 'k2', gzipSize: 1 },
          },
        ),
      );

      const versions = await ds.query(
        `SELECT s3_key, is_current FROM domain_content_version WHERE domain_id = 1 ORDER BY first_seen_at`,
      );
      expect(versions).toEqual([
        { s3_key: 'k1', is_current: false },
        { s3_key: 'k2', is_current: true },
      ]);
    });
  });

  describe('applyUpdate - атомарность транзакции', () => {
    it('ошибка внутри транзакции откатывает всё целиком', async () => {
      const tooLong: ParsedLine = {
        adNetworkDomain: 'x'.repeat(300),
        accountId: '1',
        accountType: 'DIRECT',
        certAuthorityId: null,
      };

      await expect(persist.applyUpdate(makeUpdateInput(1, [tooLong]))).rejects.toThrow();

      const [{ n: entryCount }] = await ds.query(
        `SELECT count(*)::int AS n FROM app_ads_entries WHERE domain_id = 1`,
      );
      expect(entryCount).toBe(0);

      const [{ n: stageCount }] = await ds.query(`SELECT count(*)::int AS n FROM stage_app_ads`);
      expect(stageCount).toBe(0);

      const [dom] = await ds.query(`SELECT status, content_hash FROM domain WHERE id = 1`);
      expect(dom.status).toBe('pending');
      expect(dom.content_hash).toBeNull();
    });
  });

  describe('recordUnchanged', () => {
    it('304: обновляет domain, не трогает domain_content_version', async () => {
      await persist.recordUnchanged(makeUnchangedInput(1, ScrapeOutcome.Unchanged304));

      const [dom] = await ds.query(
        `SELECT status, next_scrape_at, last_scraped_at FROM domain WHERE id = 1`,
      );
      expect(dom.status).toBe(DomainStatus.Success);
      expect(dom.next_scrape_at).not.toBeNull();
      expect(dom.last_scraped_at).not.toBeNull();

      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM domain_content_version WHERE domain_id = 1`,
      );
      expect(n).toBe(0);
    });

    it('совпадение хэша: продлевает last_seen_at у текущей версии контента', async () => {
      await persist.applyUpdate(makeUpdateInput(1, [line('google.com', '1', 'DIRECT')]));
      const [before] = await ds.query(
        `SELECT last_seen_at FROM domain_content_version WHERE domain_id = 1 AND is_current`,
      );

      await persist.recordUnchanged(makeUnchangedInput(1, ScrapeOutcome.UnchangedHash));

      const [after] = await ds.query(
        `SELECT last_seen_at FROM domain_content_version WHERE domain_id = 1 AND is_current`,
      );
      expect(new Date(after.last_seen_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.last_seen_at).getTime(),
      );
    });

    it('failed-домен не понижается обратно в success после 304', async () => {
      await ds.query(`UPDATE domain SET status = 'failed' WHERE id = 1`);

      await persist.recordUnchanged(makeUnchangedInput(1, ScrapeOutcome.Unchanged304));

      const [dom] = await ds.query(`SELECT status FROM domain WHERE id = 1`);
      expect(dom.status).toBe(DomainStatus.Failed);
    });
  });

  describe('recordNoFile', () => {
    it('помечает домен no_file и не трогает существующие активные строки', async () => {
      await persist.applyUpdate(makeUpdateInput(1, [line('google.com', '1', 'DIRECT')]));

      await persist.recordNoFile(makeNoFileInput(1));

      const [dom] = await ds.query(
        `SELECT status, last_http_status, last_error_at FROM domain WHERE id = 1`,
      );
      expect(dom.status).toBe(DomainStatus.NoFile);
      expect(dom.last_http_status).toBe(404);
      expect(dom.last_error_at).not.toBeNull();

      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM app_ads_entries WHERE domain_id = 1 AND removed_at IS NULL`,
      );
      expect(n).toBe(1);
    });
  });

  describe('recordFailure', () => {
    it('фиксирует failed, HTTP-код ошибки и следующий next_scrape_at', async () => {
      await persist.recordFailure(makeFailureInput(1));

      const [dom] = await ds.query(
        `SELECT status, last_http_status, last_error_at, next_scrape_at FROM domain WHERE id = 1`,
      );
      expect(dom.status).toBe(DomainStatus.Failed);
      expect(dom.last_http_status).toBe(500);
      expect(dom.last_error_at).not.toBeNull();
      expect(dom.next_scrape_at).not.toBeNull();
    });
  });

  describe('семафор dbWriteConcurrency', () => {
    it('не мешает параллельным applyUpdate по разным доменам', async () => {
      await ds.query(
        `INSERT INTO domain (id, domain_name, status) VALUES (2, 'second.example', 'pending')`,
      );

      await Promise.all([
        persist.applyUpdate(makeUpdateInput(1, [line('google.com', '1', 'DIRECT')])),
        persist.applyUpdate(makeUpdateInput(2, [line('appnexus.com', '2', 'RESELLER')])),
      ]);

      const counts = await ds.query(
        `SELECT domain_id, count(*)::int AS n FROM app_ads_entries
           WHERE domain_id IN (1, 2) GROUP BY domain_id ORDER BY domain_id`,
      );
      expect(counts).toEqual([
        { domain_id: 1, n: 1 },
        { domain_id: 2, n: 1 },
      ]);
    });
  });
});
