import { ScrapeOutcome } from '../contracts/enums';

export abstract class ScrapeError extends Error {
  abstract readonly retryable: boolean;
  abstract readonly outcome: ScrapeOutcome;
  abstract readonly errorClass: string;
}

/** Тело превысило лимит размера */
export class TooLargeError extends ScrapeError {
  readonly retryable = false;
  readonly outcome = ScrapeOutcome.TooLarge;
  readonly errorClass = 'too_large';
}

/** Превышен жёсткий дедлайн запроса */
export class DeadlineError extends ScrapeError {
  readonly retryable = true;
  readonly outcome = ScrapeOutcome.Timeout;
  readonly errorClass = 'timeout';
}

/** 200 OK, но тело пустое */
export class EmptyBodyError extends ScrapeError {
  readonly retryable = false;
  readonly outcome = ScrapeOutcome.EmptyBody;
  readonly errorClass = 'empty_body';
}

/** Тело получено, но не распарсилось (0 валидных строк при непустом теле) */
export class ContentParseError extends ScrapeError {
  readonly retryable = false;
  readonly outcome = ScrapeOutcome.ParseError;
  readonly errorClass = 'parse_error';
}

/** Сетевой сбой без ответа (DNS/соединение/сброс) */
export class NetworkError extends ScrapeError {
  readonly retryable = true;
  readonly outcome = ScrapeOutcome.NetworkError;
  readonly errorClass: string;
  constructor(message: string, code?: string) {
    super(message);
    this.errorClass = code ? `network:${code}` : 'network_error';
  }
}

/** HTTP-ответ 4xx/5xx (кроме 304/404, которые обрабатываются отдельно) */
export class HttpStatusError extends ScrapeError {
  readonly outcome = ScrapeOutcome.HttpError;
  readonly errorClass: string;
  constructor(
    readonly status: number,
    readonly bodySnippet: string | null,
  ) {
    super(`HTTP ${status}`);
    this.errorClass = `http_${status}`;
  }
  /** 429 и 5xx - временные, прочие 4xx - постоянные */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}
