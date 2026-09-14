import { HostThrottler } from './host-throttler';
import type { AppConfig } from '../config/app-config';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeThrottler(perHostRps: number): HostThrottler {
  const cfg = { http: { perHostRps } } as unknown as AppConfig;
  return new HostThrottler(cfg);
}

describe('HostThrottler', () => {
  it('на одном хосте не пускает больше 2 запросов одновременно', async () => {
    const throttler = makeThrottler(1000);
    let active = 0;
    let maxActive = 0;

    const task = () =>
      throttler.run('example.com', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
      });

    await Promise.all([task(), task(), task(), task()]);

    expect(maxActive).toBe(2);
  });

  it('разные хосты не блокируют друг друга', async () => {
    const throttler = makeThrottler(1000);
    const order: string[] = [];

    const slowOnHostA = throttler.run('a.example', async () => {
      order.push('a-start');
      await delay(50);
      order.push('a-end');
    });
    const fastOnHostB = throttler.run('b.example', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await Promise.all([slowOnHostA, fastOnHostB]);

    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });

  it('на одном хосте выдерживает минимальный интервал между запросами (по perHostRps)', async () => {
    const throttler = makeThrottler(10);
    const timestamps: number[] = [];

    await throttler.run('example.com', async () => {
      timestamps.push(Date.now());
    });
    await throttler.run('example.com', async () => {
      timestamps.push(Date.now());
    });

    const gap = timestamps[1] - timestamps[0];
    expect(gap).toBeGreaterThanOrEqual(80);
  });
});
