import { loadConfig, resetConfigCache } from './app-config';

describe('loadConfig', () => {
  const savedProxyEnv = {
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
  };

  beforeEach(() => {
    resetConfigCache();
    delete process.env.http_proxy;
    delete process.env.https_proxy;
  });

  afterAll(() => {
    resetConfigCache();
    if (savedProxyEnv.http_proxy !== undefined) process.env.http_proxy = savedProxyEnv.http_proxy;
    if (savedProxyEnv.https_proxy !== undefined)
      process.env.https_proxy = savedProxyEnv.https_proxy;
  });

  it('пустое окружение валидно - у каждого поля есть дефолт', () => {
    const cfg = loadConfig({});

    expect(cfg.db).toMatchObject({ host: 'localhost', port: 5432, name: 'appads' });
    expect(cfg.scrape).toEqual({
      queueConcurrency: 10,
      httpConcurrency: 20,
      dbWriteConcurrency: 6,
    });
    expect(cfg.http.maxBytes).toBe(10 * 1024 * 1024);
  });

  it('коэрсит строковые переменные окружения в нужный тип', () => {
    const cfg = loadConfig({
      DB_PORT: '5555',
      APP_ADS_PER_HOST_RPS: '3.5',
      APP_ADS_AUTO_MIGRATE: 'false',
    });

    expect(cfg.db.port).toBe(5555);
    expect(cfg.http.perHostRps).toBe(3.5);
    expect(cfg.db.autoMigrate).toBe(false);
  });

  it.each([
    ['1', true],
    ['true', true],
    ['yes', true],
    ['on', true],
    ['0', false],
    ['false', false],
    ['no', false],
    ['off', false],
  ])('булев флаг из строки %j → %s', (raw, expected) => {
    const cfg = loadConfig({ APP_ADS_ENABLE_DEV_SCHEDULER: raw });
    expect(cfg.dev.enableScheduler).toBe(expected);
  });

  it('нераспознанная строка для булева флага молча откатывается к дефолту', () => {
    const cfg = loadConfig({ APP_ADS_DEV_SEED: 'может быть' });
    expect(cfg.dev.seed).toBe(false);
  });

  it('невалидное значение обязательного поля - бросает с понятным текстом', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('невалидный URL в S3_ENDPOINT - бросает', () => {
    expect(() => loadConfig({ S3_ENDPOINT: 'не-url' })).toThrow(/S3_ENDPOINT/);
  });

  it('результат кэшируется: второй вызов не перечитывает новый source', () => {
    const first = loadConfig({ DB_PORT: '4000' });
    const second = loadConfig({ DB_PORT: '9999' });

    expect(second).toBe(first);
    expect(second.db.port).toBe(4000);
  });

  it('resetConfigCache() заставляет перечитать окружение заново', () => {
    loadConfig({ DB_PORT: '4000' });
    resetConfigCache();
    const fresh = loadConfig({ DB_PORT: '9999' });

    expect(fresh.db.port).toBe(9999);
  });

  it('proxyConfigured=true, если задан HTTP_PROXY в переданном source', () => {
    const cfg = loadConfig({ HTTP_PROXY: 'http://proxy.local:8080' });
    expect(cfg.http.proxyConfigured).toBe(true);
  });

  it('proxyConfigured=false, если прокси нигде не задан', () => {
    const cfg = loadConfig({});
    expect(cfg.http.proxyConfigured).toBe(false);
  });
});
