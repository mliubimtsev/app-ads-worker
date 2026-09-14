import { mapSettled, Semaphore } from './concurrency';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Semaphore', () => {
  it('бросает при max < 1', () => {
    expect(() => new Semaphore(0)).toThrow();
  });

  it('не пускает больше max одновременно активных задач', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const task = () =>
      sem.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
      });

    await Promise.all([task(), task(), task(), task()]);

    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it('очередь ожидающих обслуживается по порядку (FIFO)', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    let releaseFirst: () => void = () => {};

    const first = sem.run(
      () =>
        new Promise<void>((resolve) => {
          order.push(1);
          releaseFirst = resolve;
        }),
    );
    const second = sem.run(async () => {
      order.push(2);
    });
    const third = sem.run(async () => {
      order.push(3);
    });

    await new Promise((resolve) => setImmediate(resolve));

    releaseFirst();
    await Promise.all([first, second, third]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('пробрасывает ошибку задачи наружу и всё равно освобождает слот', async () => {
    const sem = new Semaphore(1);

    await expect(sem.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    const result = await sem.run(async () => 'ok');
    expect(result).toBe('ok');
  });
});

describe('mapSettled', () => {
  it('на пустом массиве возвращает пустой результат и не вызывает fn', async () => {
    const fn = jest.fn();
    const result = await mapSettled([], 5, fn);

    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('не превышает заданный limit одновременных вызовов', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await mapSettled(items, 2, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
    });

    expect(maxActive).toBe(2);
  });

  it('сохраняет порядок результатов независимо от порядка завершения', async () => {
    const items = [
      { id: 'slow', ms: 30 },
      { id: 'fast', ms: 5 },
    ];

    const results = await mapSettled(items, 2, async (item) => {
      await delay(item.ms);
      return item.id;
    });

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      'slow',
      'fast',
    ]);
  });

  it('упавший элемент не мешает остальным - каждый получает свой settled-статус', async () => {
    const items = [1, 2, 3];

    const results = await mapSettled(items, 3, async (n) => {
      if (n === 2) throw new Error(`сбой на ${n}`);
      return n * 10;
    });

    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: 30 },
    ]);
  });

  it('limit больше числа элементов - все элементы всё равно обрабатываются', async () => {
    const items = [1, 2, 3];
    const results = await mapSettled(items, 100, async (n) => n);

    expect(results).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 3 },
    ]);
  });
});
