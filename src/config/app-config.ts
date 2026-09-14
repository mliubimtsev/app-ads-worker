import { envSchema, type Env } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly name: string;
    readonly autoMigrate: boolean;
  };
  readonly redis: { readonly host: string; readonly port: number };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly bucketRaw: string;
    readonly forcePathStyle: boolean;
  };
  readonly http: {
    readonly userAgent: string;
    readonly deadlineMs: number;
    readonly headersTimeoutMs: number;
    readonly bodyTimeoutMs: number;
    readonly connectTimeoutMs: number;
    readonly maxBytes: number;
    readonly maxRedirects: number;
    readonly connections: number;
    readonly perHostRps: number;
    readonly proxyConfigured: boolean;
  };
  readonly scrape: {
    readonly queueConcurrency: number;
    readonly httpConcurrency: number;
    readonly dbWriteConcurrency: number;
  };
  readonly refresh: {
    readonly intervalHours: number;
    readonly stretchAfter: number;
    readonly maxIntervalHours: number;
    readonly noFileDays: number;
    readonly failThreshold: number;
  };
  readonly dev: {
    readonly enableScheduler: boolean;
    readonly schedulerIntervalMs: number;
    readonly schedulerBudget: number;
    readonly batchSize: number;
    readonly seed: boolean;
  };
  readonly partition: {
    readonly maintenanceEnabled: boolean;
    readonly retentionMonths: number;
  };
}

function toConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      name: env.DB_NAME,
      autoMigrate: env.APP_ADS_AUTO_MIGRATE,
    },
    redis: { host: env.REDIS_HOST, port: env.REDIS_PORT },
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucketRaw: env.S3_BUCKET_RAW,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    http: {
      userAgent: env.APP_ADS_USER_AGENT,
      deadlineMs: env.APP_ADS_HTTP_DEADLINE_MS,
      headersTimeoutMs: env.APP_ADS_HTTP_HEADERS_TIMEOUT_MS,
      bodyTimeoutMs: env.APP_ADS_HTTP_BODY_TIMEOUT_MS,
      connectTimeoutMs: env.APP_ADS_HTTP_CONNECT_TIMEOUT_MS,
      maxBytes: env.APP_ADS_MAX_BYTES,
      maxRedirects: env.APP_ADS_MAX_REDIRECTS,
      connections: env.APP_ADS_HTTP_CONNECTIONS,
      perHostRps: env.APP_ADS_PER_HOST_RPS,
      proxyConfigured: Boolean(
        env.HTTP_PROXY || env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy,
      ),
    },
    scrape: {
      queueConcurrency: env.APP_ADS_QUEUE_CONCURRENCY,
      httpConcurrency: env.APP_ADS_HTTP_CONCURRENCY,
      dbWriteConcurrency: env.APP_ADS_DB_WRITE_CONCURRENCY,
    },
    refresh: {
      intervalHours: env.APP_ADS_REFRESH_INTERVAL_HOURS,
      stretchAfter: env.APP_ADS_STRETCH_AFTER,
      maxIntervalHours: env.APP_ADS_MAX_INTERVAL_HOURS,
      noFileDays: env.APP_ADS_NO_FILE_DAYS,
      failThreshold: env.APP_ADS_FAIL_THRESHOLD,
    },
    dev: {
      enableScheduler: env.APP_ADS_ENABLE_DEV_SCHEDULER,
      schedulerIntervalMs: env.APP_ADS_DEV_SCHEDULER_INTERVAL_MS,
      schedulerBudget: env.APP_ADS_DEV_SCHEDULER_BUDGET,
      batchSize: env.APP_ADS_BATCH_SIZE,
      seed: env.APP_ADS_DEV_SEED,
    },
    partition: {
      maintenanceEnabled: env.APP_ADS_PARTITION_MAINTENANCE,
      retentionMonths: env.APP_ADS_PARTITION_RETENTION_MONTHS,
    },
  };
}

let cached: AppConfig | null = null;

/**
 * Разбирает и валидирует `process.env`, возвращает типизированный конфиг
 * Результат кэшируется
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Невалидное окружение:\n${details}`);
  }
  cached = toConfig(parsed.data);
  return cached;
}

/** Для тестов - сбросить кэш. */
export function resetConfigCache(): void {
  cached = null;
}
