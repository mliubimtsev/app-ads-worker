import type { Readable } from 'node:stream';

export const HTTP_TRANSPORT = Symbol('HTTP_TRANSPORT');

export interface HttpGetRequest {
  url: string;
  headers?: Record<string, string>;
  /** Общий жёсткий дедлайн + возможная отмена задачи (по внешнему таймауту) */
  signal: AbortSignal;
  /** Максимальное число редиректов */
  maxRedirects: number;
}

export interface HttpGetResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}

export interface HttpTransport {
  get(req: HttpGetRequest): Promise<HttpGetResponse>;
}
