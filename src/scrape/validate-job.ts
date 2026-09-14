import type { AppAdsScrapeItem, AppAdsScrapeJob } from '../contracts/job.contract';

function isItem(x: unknown): x is AppAdsScrapeItem {
  if (typeof x !== 'object' || x === null) return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.domainId === 'number' &&
    Number.isInteger(i.domainId) &&
    typeof i.url === 'string' &&
    i.url.length > 0 &&
    (i.etag === null || typeof i.etag === 'string') &&
    (i.lastModified === null || typeof i.lastModified === 'string') &&
    (i.contentHash === null || typeof i.contentHash === 'string')
  );
}

/** Type-guard payload задачи очереди `app-ads-scrape` */
export function isAppAdsScrapeJob(x: unknown): x is AppAdsScrapeJob {
  if (typeof x !== 'object' || x === null) return false;
  const j = x as Record<string, unknown>;
  return (
    typeof j.batchId === 'string' &&
    Array.isArray(j.items) &&
    j.items.length > 0 &&
    j.items.every(isItem)
  );
}
