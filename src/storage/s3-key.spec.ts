import { rawAppAdsKey } from './s3-key';

describe('rawAppAdsKey', () => {
  it('собирает ключ по схеме app-ads/<domainId>/<yyyy>/<mm>/<dd>/<hash>.txt.gz', () => {
    const at = new Date('2026-09-10T12:00:00Z');

    expect(rawAppAdsKey(42, 'deadbeef', at)).toBe('app-ads/42/2026/09/10/deadbeef.txt.gz');
  });

  it('добивает месяц и день ведущим нулём', () => {
    const at = new Date('2026-01-05T00:00:00Z');

    expect(rawAppAdsKey(1, 'abc', at)).toBe('app-ads/1/2026/01/05/abc.txt.gz');
  });

  it('берёт дату в UTC, а не в локальной зоне рантайма', () => {
    const at = new Date('2026-12-31T23:30:00Z');

    expect(rawAppAdsKey(7, 'h', at)).toBe('app-ads/7/2026/12/31/h.txt.gz');
  });

  it('по умолчанию использует текущую дату, если Date не передан', () => {
    const key = rawAppAdsKey(9, 'ffff');

    expect(key).toMatch(/^app-ads\/9\/\d{4}\/\d{2}\/\d{2}\/ffff\.txt\.gz$/);
  });
});
