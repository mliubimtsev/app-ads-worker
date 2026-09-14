import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { Agent, type Dispatcher, EnvHttpProxyAgent, request } from 'undici';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { HttpGetRequest, HttpGetResponse, HttpTransport } from './http-transport';

function flattenHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * Реализация транспорта на нативном клиенте Node (undici).
 *  - единый dispatcher, выбранный один раз: EnvHttpProxyAgent при заданных
 *    HTTP_PROXY/HTTPS_PROXY (учитывает NO_PROXY), иначе обычный Agent;
 *  - жёсткий общий дедлайн приходит извне через `signal`
 */
@Injectable()
export class UndiciHttpTransport implements HttpTransport, OnModuleDestroy {
  private readonly logger = new Logger(UndiciHttpTransport.name);
  private readonly dispatcher: Dispatcher;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    const opts = {
      connections: cfg.http.connections,
      headersTimeout: cfg.http.headersTimeoutMs,
      bodyTimeout: cfg.http.bodyTimeoutMs,
      connect: { timeout: cfg.http.connectTimeoutMs },
    };
    this.dispatcher = cfg.http.proxyConfigured ? new EnvHttpProxyAgent(opts) : new Agent(opts);
    this.logger.log(
      `HTTP transport: ${cfg.http.proxyConfigured ? 'через прокси (EnvHttpProxyAgent)' : 'прямой egress'}`,
    );
  }

  async get(req: HttpGetRequest): Promise<HttpGetResponse> {
    const res = await request(req.url, {
      method: 'GET',
      headers: {
        'user-agent': this.cfg.http.userAgent,
        accept: 'text/plain, */*',
        'accept-encoding': 'identity',
        ...req.headers,
      },
      signal: req.signal,
      maxRedirections: req.maxRedirects,
      dispatcher: this.dispatcher,
      reset: true,
    });

    return {
      statusCode: res.statusCode,
      headers: flattenHeaders(res.headers),
      body: res.body as unknown as Readable,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispatcher.close().catch(() => undefined);
  }
}
