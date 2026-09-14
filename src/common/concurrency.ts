/**
 * Счётный семафор
 * Используется как ограничитель параллелизма записи в БД
 */
export class Semaphore {
  private readonly waiters: Array<() => void> = [];
  private active = 0;

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore: max должен быть >= 1');
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}

/**
 * Обходит `items` с ограничением параллелизма `limit`
 * возвращает `PromiseSettledResult` по каждому элементу (как `allSettled`)
 */
export async function mapSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
