import { ScrapeOutcome } from '../contracts/enums';
import {
  ContentParseError,
  DeadlineError,
  EmptyBodyError,
  HttpStatusError,
  NetworkError,
  ScrapeError,
  TooLargeError,
} from './errors';

describe('классы ScrapeError', () => {
  it('TooLargeError: постоянная, outcome=too_large', () => {
    const err = new TooLargeError('тело больше лимита');

    expect(err).toBeInstanceOf(ScrapeError);
    expect(err.retryable).toBe(false);
    expect(err.outcome).toBe(ScrapeOutcome.TooLarge);
    expect(err.errorClass).toBe('too_large');
    expect(err.message).toBe('тело больше лимита');
  });

  it('DeadlineError: временная, outcome=timeout', () => {
    const err = new DeadlineError('дедлайн');

    expect(err.retryable).toBe(true);
    expect(err.outcome).toBe(ScrapeOutcome.Timeout);
    expect(err.errorClass).toBe('timeout');
  });

  it('EmptyBodyError: постоянная, outcome=empty_body', () => {
    const err = new EmptyBodyError('пусто');

    expect(err.retryable).toBe(false);
    expect(err.outcome).toBe(ScrapeOutcome.EmptyBody);
    expect(err.errorClass).toBe('empty_body');
  });

  it('ContentParseError: постоянная, outcome=parse_error', () => {
    const err = new ContentParseError('0 валидных строк');

    expect(err.retryable).toBe(false);
    expect(err.outcome).toBe(ScrapeOutcome.ParseError);
    expect(err.errorClass).toBe('parse_error');
  });

  describe('NetworkError', () => {
    it('с кодом - errorClass включает код, временная', () => {
      const err = new NetworkError('socket hang up', 'ECONNRESET');

      expect(err.retryable).toBe(true);
      expect(err.outcome).toBe(ScrapeOutcome.NetworkError);
      expect(err.errorClass).toBe('network:ECONNRESET');
    });

    it('без кода - errorClass дженерик', () => {
      const err = new NetworkError('неизвестный сбой');

      expect(err.errorClass).toBe('network_error');
    });
  });

  describe('HttpStatusError.retryable', () => {
    it.each([
      [429, true],
      [500, true],
      [503, true],
      [599, true],
      [400, false],
      [403, false],
      [404, false],
      [451, false],
    ])('статус %i → retryable=%s', (status, expected) => {
      const err = new HttpStatusError(status, null);

      expect(err.retryable).toBe(expected);
      expect(err.outcome).toBe(ScrapeOutcome.HttpError);
      expect(err.errorClass).toBe(`http_${status}`);
      expect(err.message).toBe(`HTTP ${status}`);
    });

    it('хранит status и bodySnippet как есть', () => {
      const err = new HttpStatusError(500, 'кусок тела ошибки');

      expect(err.status).toBe(500);
      expect(err.bodySnippet).toBe('кусок тела ошибки');
    });
  });
});
