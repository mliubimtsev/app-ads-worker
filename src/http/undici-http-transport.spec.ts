import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { UndiciHttpTransport } from './undici-http-transport';
import type { AppConfig } from '../config/app-config';

function makeConfig(): AppConfig {
  return {
    http: {
      userAgent: 'app-ads-worker-test/1.0',
      connections: 10,
      headersTimeoutMs: 5000,
      bodyTimeoutMs: 5000,
      connectTimeoutMs: 5000,
      proxyConfigured: false,
    },
  } as unknown as AppConfig;
}

describe('UndiciHttpTransport', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastHeaders: http.IncomingHttpHeaders = {};
  let transport: UndiciHttpTransport;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastHeaders = req.headers;

      if (req.url === '/conditional') {
        if (req.headers['if-none-match'] === '"v1"') {
          res.statusCode = 304;
          res.end();
          return;
        }
        res.setHeader('etag', '"v1"');
        res.end('содержимое app-ads.txt');
        return;
      }

      if (req.url === '/redirect') {
        res.statusCode = 302;
        res.setHeader('location', '/final');
        res.end();
        return;
      }

      if (req.url === '/final') {
        res.statusCode = 200;
        res.end('финальная страница');
        return;
      }

      if (req.url === '/slow') {
        setTimeout(() => res.end('слишком поздно'), 300);
        return;
      }

      if (req.url === '/multi-header') {
        res.setHeader('x-multi', ['a', 'b']);
        res.end('ok');
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    transport = new UndiciHttpTransport(makeConfig());
  });

  afterAll(async () => {
    await transport.onModuleDestroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('условный GET: 200+etag, затем 304 по If-None-Match', async () => {
    const first = await transport.get({
      url: `${baseUrl}/conditional`,
      signal: AbortSignal.timeout(2000),
      maxRedirects: 0,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBe('"v1"');

    const second = await transport.get({
      url: `${baseUrl}/conditional`,
      headers: { 'if-none-match': '"v1"' },
      signal: AbortSignal.timeout(2000),
      maxRedirects: 0,
    });
    expect(second.statusCode).toBe(304);
  });

  it('maxRedirects=0 не следует за редиректом, maxRedirects>=1 следует', async () => {
    const notFollowed = await transport.get({
      url: `${baseUrl}/redirect`,
      signal: AbortSignal.timeout(2000),
      maxRedirects: 0,
    });
    expect(notFollowed.statusCode).toBe(302);

    const followed = await transport.get({
      url: `${baseUrl}/redirect`,
      signal: AbortSignal.timeout(2000),
      maxRedirects: 1,
    });
    expect(followed.statusCode).toBe(200);
  });

  it('внешний AbortSignal обрывает зависший запрос по дедлайну', async () => {
    await expect(
      transport.get({
        url: `${baseUrl}/slow`,
        signal: AbortSignal.timeout(50),
        maxRedirects: 0,
      }),
    ).rejects.toThrow();
  });

  it('дефолтные и кастомные заголовки реально уходят на сервер', async () => {
    await transport.get({
      url: `${baseUrl}/conditional`,
      headers: { 'if-none-match': '"custom"' },
      signal: AbortSignal.timeout(2000),
      maxRedirects: 0,
    });

    expect(lastHeaders['user-agent']).toBe('app-ads-worker-test/1.0');
    expect(lastHeaders['accept-encoding']).toBe('identity');
    expect(lastHeaders['if-none-match']).toBe('"custom"');
  });

  it('каждый запрос закрывает соединение, не оставляя keep-alive сокет в пуле', async () => {
    await transport.get({
      url: `${baseUrl}/conditional`,
      signal: AbortSignal.timeout(2000),
      maxRedirects: 0,
    });

    expect(lastHeaders.connection).toBe('close');
  });

  it('множественное значение заголовка ответа схлопывается через запятую', async () => {
    const res = await transport.get({
      url: `${baseUrl}/multi-header`,
      signal: AbortSignal.timeout(2000),
      maxRedirects: 0,
    });

    expect(res.headers['x-multi']).toBe('a, b');
  });
});
