import { isAppAdsScrapeJob } from './validate-job';
import type { AppAdsScrapeItem, AppAdsScrapeJob } from '../contracts/job.contract';

function validItem(overrides: Partial<AppAdsScrapeItem> = {}): AppAdsScrapeItem {
  return {
    domainId: 1,
    url: 'https://example.com/app-ads.txt',
    etag: null,
    lastModified: null,
    contentHash: null,
    ...overrides,
  };
}

function validJob(overrides: Partial<AppAdsScrapeJob> = {}): AppAdsScrapeJob {
  return { batchId: 'batch-1', items: [validItem()], ...overrides };
}

describe('isAppAdsScrapeJob', () => {
  it('принимает валидный payload с одним и с несколькими items', () => {
    expect(isAppAdsScrapeJob(validJob())).toBe(true);
    expect(isAppAdsScrapeJob(validJob({ items: [validItem(), validItem({ domainId: 2 })] }))).toBe(
      true,
    );
  });

  it('принимает etag/lastModified/contentHash как строку ИЛИ null', () => {
    expect(
      isAppAdsScrapeJob(
        validJob({
          items: [validItem({ etag: '"v1"', lastModified: 'Mon, 01 Jan', contentHash: 'ab' })],
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['не объект', null],
    ['не объект (массив)', []],
    ['без batchId', { items: [validItem()] }],
    ['batchId не строка', { batchId: 42, items: [validItem()] }],
    ['items не массив', { batchId: 'b1', items: 'nope' }],
    ['items пустой', { batchId: 'b1', items: [] }],
  ])('%s → false', (_name, payload) => {
    expect(isAppAdsScrapeJob(payload)).toBe(false);
  });

  it.each([
    ['domainId отсутствует', { ...validItem(), domainId: undefined }],
    ['domainId не целое', { ...validItem(), domainId: 1.5 }],
    ['domainId строкой', { ...validItem(), domainId: '1' }],
    ['url пустой', { ...validItem(), url: '' }],
    ['url отсутствует', { ...validItem(), url: undefined }],
    ['etag не строка и не null', { ...validItem(), etag: 42 }],
    ['contentHash не строка и не null', { ...validItem(), contentHash: {} }],
  ])('битый item (%s) → весь job невалиден', (_name, badItem) => {
    expect(isAppAdsScrapeJob({ batchId: 'b1', items: [badItem] })).toBe(false);
  });
});
