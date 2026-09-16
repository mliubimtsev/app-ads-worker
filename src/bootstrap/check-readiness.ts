import { Client as PgClient } from 'pg';
import Redis from 'ioredis';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/app-config';

const READINESS_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(name: string, deadline: number, check: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() >= deadline) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`${name} недоступен: ${reason}`);
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function checkPostgres(cfg: AppConfig): Promise<void> {
  const client = new PgClient({
    host: cfg.db.host,
    port: cfg.db.port,
    user: cfg.db.user,
    password: cfg.db.password,
    database: cfg.db.name,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(cfg: AppConfig): Promise<void> {
  const redis = new Redis({
    host: cfg.redis.host,
    port: cfg.redis.port,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}

async function checkS3(cfg: AppConfig): Promise<void> {
  const client = new S3Client({
    endpoint: cfg.s3.endpoint,
    region: cfg.s3.region,
    forcePathStyle: cfg.s3.forcePathStyle,
    credentials: { accessKeyId: cfg.s3.accessKey, secretAccessKey: cfg.s3.secretKey },
  });
  await client.send(new ListBucketsCommand({}));
}

export async function checkReadiness(cfg: AppConfig): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;

  await waitFor('PostgreSQL', deadline, () => checkPostgres(cfg));
  await waitFor('Redis', deadline, () => checkRedis(cfg));
  await waitFor('S3', deadline, () => checkS3(cfg));
}
