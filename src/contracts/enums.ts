/** Состояние источника скрапинга (таблица `domain`) */
export enum DomainStatus {
  Pending = 'pending',
  Queued = 'queued',
  InProgress = 'in_progress',
  Success = 'success',
  Failed = 'failed',
  NoFile = 'no_file',
}

/** Итог одной попытки скрапинга */
export enum ScrapeOutcome {
  Created = 'created',
  Updated = 'updated',
  Unchanged304 = 'unchanged_304',
  UnchangedHash = 'unchanged_hash',
  NoFile = 'no_file',
  HttpError = 'http_error',
  NetworkError = 'network_error',
  Timeout = 'timeout',
  EmptyBody = 'empty_body',
  ParseError = 'parse_error',
  TooLarge = 'too_large',
}

/** Тип перехода состояния строки авторизации (таблица `app_ads_change`) */
export enum AppAdsChangeType {
  Added = 'added',
  Removed = 'removed',
  Reactivated = 'reactivated',
  CertChanged = 'cert_changed',
}

export enum AlgoHash {
  md5 = 'md5',
}
