import { z } from 'zod';

const zBool = (def: boolean) =>
  z
    .preprocess((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v !== 'string') return def;
      const s = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(s)) return true;
      if (['0', 'false', 'no', 'off', ''].includes(s)) return false;
      return def;
    }, z.boolean())
    .default(def);

const zInt = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);

const zNum = (def: number, min = 0) => z.coerce.number().min(min).default(def);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: zInt(5432, 1),
  DB_USER: z.string().min(1).default('appads'),
  DB_PASSWORD: z.string().default('appads'),
  DB_NAME: z.string().min(1).default('appads'),
  APP_ADS_AUTO_MIGRATE: zBool(true),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: zInt(6379, 1),

  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).default('accessKey1'),
  S3_SECRET_KEY: z.string().min(1).default('verySecretKey1'),
  S3_BUCKET_RAW: z.string().min(1).default('app-ads-raw'),
  S3_FORCE_PATH_STYLE: zBool(true),

  HTTP_PROXY: z.string().optional(),
  HTTPS_PROXY: z.string().optional(),
  NO_PROXY: z.string().optional(),
  APP_ADS_USER_AGENT: z
    .string()
    .min(1)
    .default('app-ads-worker/0.1 (+https://github.com/your/app-ads-worker)'),
  APP_ADS_HTTP_DEADLINE_MS: zInt(20_000, 1),
  APP_ADS_HTTP_HEADERS_TIMEOUT_MS: zInt(10_000, 1),
  APP_ADS_HTTP_BODY_TIMEOUT_MS: zInt(20_000, 1),
  APP_ADS_HTTP_CONNECT_TIMEOUT_MS: zInt(10_000, 1),
  APP_ADS_MAX_BYTES: zInt(10 * 1024 * 1024, 1),
  APP_ADS_MAX_REDIRECTS: zInt(2, 0),
  APP_ADS_HTTP_CONNECTIONS: zInt(64, 1),
  APP_ADS_PER_HOST_RPS: zNum(2, 0.01),

  APP_ADS_QUEUE_CONCURRENCY: zInt(10, 1),
  APP_ADS_HTTP_CONCURRENCY: zInt(20, 1),
  APP_ADS_DB_WRITE_CONCURRENCY: zInt(6, 1),

  APP_ADS_REFRESH_INTERVAL_HOURS: zNum(24, 0.1),
  APP_ADS_STRETCH_AFTER: zInt(5, 1),
  APP_ADS_MAX_INTERVAL_HOURS: zNum(72, 0.1),
  APP_ADS_NO_FILE_DAYS: zNum(10, 0.1),
  APP_ADS_FAIL_THRESHOLD: zInt(10, 1),

  APP_ADS_ENABLE_DEV_SCHEDULER: zBool(false),
  APP_ADS_DEV_SCHEDULER_INTERVAL_MS: zInt(120_000, 5_000),
  APP_ADS_DEV_SCHEDULER_BUDGET: zInt(500, 1),
  APP_ADS_BATCH_SIZE: zInt(25, 1),
  APP_ADS_DEV_SEED: zBool(false),

  APP_ADS_PARTITION_MAINTENANCE: zBool(true),
  APP_ADS_PARTITION_RETENTION_MONTHS: zInt(6, 1),
});

export type Env = z.infer<typeof envSchema>;
