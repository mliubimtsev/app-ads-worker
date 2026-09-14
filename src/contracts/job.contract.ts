import type { JobsOptions } from 'bullmq';

/** Имя очереди BullMQ для задач скрапинга app-ads.txt */
export const APP_ADS_SCRAPE_QUEUE = 'app-ads-scrape';

/** Имя job внутри очереди. */
export const APP_ADS_SCRAPE_JOB = 'scrape';

/**
 * Продюсер кладёт всё, что нужно для условного запроса,
 * чтобы воркер не ходил в БД за метаданными
 */
export interface AppAdsScrapeItem {
  /** PK записи в таблице `domain` */
  domainId: number;
  /** Готовый URL: `https://<domain>/app-ads.txt` (нормализован продюсером) */
  url: string;
  /** ETag прошлого ответа */
  etag: string | null;
  /** HTTP `Last-Modified` прошлого ответа */
  lastModified: string | null;
  /** MD5 сырого содержимого прошлого успешного парса, hex-строка */
  contentHash: string | null;
}

/** Payload задачи очереди `app-ads-scrape` */
export interface AppAdsScrapeJob {
  /** Идентификатор батча */
  batchId: string;
  items: AppAdsScrapeItem[];
}

/**
 * Пресет job-опций: несколько попыток с экспоненциальным backoff,
 * очистка завершённых/упавших задач по возрасту.
 */
export const SCRAPE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 3600, count: 5000 },
  removeOnFail: { age: 86_400 },
};

export function scrapeJobOptions(overrides: JobsOptions = {}): JobsOptions {
  return { ...SCRAPE_JOB_OPTIONS, ...overrides };
}
