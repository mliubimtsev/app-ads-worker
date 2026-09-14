const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function withJitter(baseMs: number, maxJitterHours = 6): number {
  return baseMs + Math.random() * maxJitterHours * HOUR;
}

/**
 * Политика `next_scrape_at`. Фиксированный суточный ритм (24 ч) для любого исхода, плюс джиттер.
 */
export function computeNextScrape(now: Date = new Date()): Date {
  return new Date(withJitter(now.getTime() + DAY));
}
