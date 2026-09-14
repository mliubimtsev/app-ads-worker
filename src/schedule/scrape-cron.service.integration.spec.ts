import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import type { Queue } from 'bullmq';
import type { AppConfig } from '../config/app-config';
import { APP_ADS_SCRAPE_JOB, type AppAdsScrapeJob } from '../contracts/job.contract';
import { InitAppAds1740000000000 } from '../database/migrations/1740000000000-InitAppAds';
import { ScrapeCronService } from './scrape-cron.service';

/**
 * Интеграционные тесты гоняются на настоящем Postgres (testcontainers), а не на
 * моках `dataSource.query`, потому что вся суть tick() — в SQL: фильтр по
 * status, FOR UPDATE SKIP LOCKED и то, сколько строк реально вернул запрос
 * при заданном бюджете. Именно это разошлось с ожиданиями при ручном
 * тестировании (см. обсуждение "1000 доменов → 10 батчей").
 */

function buildConfig(dev: AppConfig['dev']): AppConfig {
  return {
    nodeEnv: 'test',
    db: { host: 'localhost', port: 5432, user: 'x', password: 'x', name: 'x', autoMigrate: false },
    redis: { host: 'localhost', port: 6379 },
    s3: {
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKey: 'x',
      secretKey: 'x',
      bucketRaw: 'x',
      forcePathStyle: true,
    },
    http: {
      userAgent: 'test',
      deadlineMs: 1000,
      headersTimeoutMs: 1000,
      bodyTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      maxBytes: 1,
      maxRedirects: 0,
      connections: 1,
      perHostRps: 1,
      proxyConfigured: false,
    },
    scrape: { queueConcurrency: 1, httpConcurrency: 1, dbWriteConcurrency: 1 },
    refresh: {
      intervalHours: 24,
      stretchAfter: 5,
      maxIntervalHours: 72,
      noFileDays: 10,
      failThreshold: 10,
    },
    dev,
    partition: { maintenanceEnabled: false, retentionMonths: 6 },
  };
}

interface QueueMock {
  add: jest.Mock;
}

function fakeQueue(): QueueMock {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

function asQueue(mock: QueueMock): Queue {
  return mock as unknown as Queue;
}

/** Вставляет `count` подходящих для скрапа доменов, возвращает их id по порядку. */
async function insertEligibleDomains(
  dataSource: DataSource,
  count: number,
  status = 'pending',
): Promise<number[]> {
  const rows = (await dataSource.query(
    `
    INSERT INTO domain (domain_name, status, next_scrape_at)
    SELECT 'domain-' || gs || '-' || floor(random() * 1e9)::text, $2, now() - interval '1 hour'
    FROM generate_series(1, $1) AS gs
    RETURNING id
    `,
    [count, status],
  )) as { id: number }[];
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

function itemIds(jobs: AppAdsScrapeJob[]): number[] {
  return jobs.flatMap((j) => j.items.map((i) => i.domainId));
}

describe('ScrapeCronService (integration, реальный Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
      entities: [],
      migrations: [InitAppAds1740000000000],
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 120_000);

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE domain RESTART IDENTITY CASCADE');
  });

  it('не берёт больше домена, чем позволяет бюджет тика, остальные остаются нетронутыми', async () => {
    await insertEligibleDomains(dataSource, 1000);
    const queue = fakeQueue();
    const service = new ScrapeCronService(
      buildConfig({
        enableScheduler: true,
        schedulerIntervalMs: 120_000,
        schedulerBudget: 300,
        batchSize: 25,
        seed: false,
      }),
      dataSource,
      asQueue(queue),
    );

    await service.tick();

    expect(queue.add).toHaveBeenCalledTimes(12); // ceil(300 / 25)
    const jobs = queue.add.mock.calls.map((call) => call[1] as AppAdsScrapeJob);
    expect(itemIds(jobs)).toHaveLength(300);

    const [{ c: queuedCount }] = (await dataSource.query(
      `SELECT count(*)::int AS c FROM domain WHERE status = 'queued'`,
    )) as { c: number }[];
    const [{ c: pendingCount }] = (await dataSource.query(
      `SELECT count(*)::int AS c FROM domain WHERE status = 'pending'`,
    )) as { c: number }[];
    expect(queuedCount).toBe(300);
    expect(pendingCount).toBe(700);
  });

  it('режет отобранные домены на батчи по batchSize, последний батч может быть неполным', async () => {
    await insertEligibleDomains(dataSource, 10);
    const queue = fakeQueue();
    const service = new ScrapeCronService(
      buildConfig({
        enableScheduler: true,
        schedulerIntervalMs: 120_000,
        schedulerBudget: 1000,
        batchSize: 3,
        seed: false,
      }),
      dataSource,
      asQueue(queue),
    );

    await service.tick();

    expect(queue.add).toHaveBeenCalledTimes(4); // 3 + 3 + 3 + 1
    const sizes = queue.add.mock.calls.map((call) => (call[1] as AppAdsScrapeJob).items.length);
    expect(sizes).toEqual([3, 3, 3, 1]);
    queue.add.mock.calls.forEach((call) => {
      expect(call[0]).toBe(APP_ADS_SCRAPE_JOB);
    });
  });

  it('домены с недопустимым status не попадают в выборку и не трогаются', async () => {
    const eligible = await insertEligibleDomains(dataSource, 5, 'pending');
    const blocked = await insertEligibleDomains(dataSource, 3, 'blocked');
    const queue = fakeQueue();
    const service = new ScrapeCronService(
      buildConfig({
        enableScheduler: true,
        schedulerIntervalMs: 120_000,
        schedulerBudget: 1000,
        batchSize: 100,
        seed: false,
      }),
      dataSource,
      asQueue(queue),
    );

    await service.tick();

    const jobs = queue.add.mock.calls.map((call) => call[1] as AppAdsScrapeJob);
    const pickedIds = itemIds(jobs).sort((a, b) => a - b);
    expect(pickedIds).toEqual(eligible);

    const [{ c: stillBlocked }] = (await dataSource.query(
      `SELECT count(*)::int AS c FROM domain WHERE id = ANY($1::int[]) AND status = 'blocked'`,
      [blocked],
    )) as { c: number }[];
    expect(stillBlocked).toBe(3);
  });

  it('переводит отобранные домены в status=queued и проставляет locked_at', async () => {
    const ids = await insertEligibleDomains(dataSource, 5);
    const queue = fakeQueue();
    const service = new ScrapeCronService(
      buildConfig({
        enableScheduler: true,
        schedulerIntervalMs: 120_000,
        schedulerBudget: 1000,
        batchSize: 100,
        seed: false,
      }),
      dataSource,
      asQueue(queue),
    );

    await service.tick();

    const rows = (await dataSource.query(
      `SELECT status, locked_at FROM domain WHERE id = ANY($1::int[])`,
      [ids],
    )) as { status: string; locked_at: Date | null }[];
    expect(rows).toHaveLength(5);
    rows.forEach((r) => {
      expect(r.status).toBe('queued');
      expect(r.locked_at).not.toBeNull();
    });
  });

  it('пропускает домен, заблокированный конкурентной транзакцией (FOR UPDATE SKIP LOCKED)', async () => {
    const ids = await insertEligibleDomains(dataSource, 5);
    const lockedId = ids[0];

    const lockRunner = dataSource.createQueryRunner();
    await lockRunner.connect();
    await lockRunner.startTransaction();
    await lockRunner.query('SELECT id FROM domain WHERE id = $1 FOR UPDATE', [lockedId]);

    try {
      const queue = fakeQueue();
      const service = new ScrapeCronService(
        buildConfig({
          enableScheduler: true,
          schedulerIntervalMs: 120_000,
          schedulerBudget: 1000,
          batchSize: 100,
          seed: false,
        }),
        dataSource,
        asQueue(queue),
      );

      await service.tick();

      const jobs = queue.add.mock.calls.map((call) => call[1] as AppAdsScrapeJob);
      const pickedIds = itemIds(jobs);
      expect(pickedIds).toHaveLength(4);
      expect(pickedIds).not.toContain(lockedId);
    } finally {
      await lockRunner.rollbackTransaction();
      await lockRunner.release();
    }
  });

  it('ничего не ставит в очередь, если подходящих доменов нет', async () => {
    const queue = fakeQueue();
    const service = new ScrapeCronService(
      buildConfig({
        enableScheduler: true,
        schedulerIntervalMs: 120_000,
        schedulerBudget: 1000,
        batchSize: 100,
        seed: false,
      }),
      dataSource,
      asQueue(queue),
    );

    await service.tick();

    expect(queue.add).not.toHaveBeenCalled();
  });
});
