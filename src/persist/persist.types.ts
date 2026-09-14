import type { ScrapeOutcome } from '../contracts/enums';
import type { AppAdsScrapeItem } from '../contracts/job.contract';
import type { ParseResult } from '../scrape/interfaces/parser.interface';
import type { RawUploadResult } from '../storage/raw-file.store';

/** Общий контекст одной попытки скрапинга */
export interface AttemptContext {
  item: AppAdsScrapeItem;
  startedAt: Date;
  attempt: number;
  httpStatus: number | null;
  responseEtag: string | null;
  responseLastModified: string | null;
  bytesDownloaded: number | null;
}

export interface UnchangedInput extends AttemptContext {
  outcome: ScrapeOutcome.Unchanged304 | ScrapeOutcome.UnchangedHash;
  contentHash: Buffer | null;
}

export interface NoFileInput extends AttemptContext {
  bodySnippet: string | null;
}

export interface FailureInput extends AttemptContext {
  outcome: ScrapeOutcome;
  errorClass: string;
  errorMessage: string;
  bodySnippet: string | null;
}

export interface UpdateInput extends AttemptContext {
  contentHash: Buffer;
  parsed: ParseResult;
  s3: RawUploadResult;
  firstScrape: boolean;
}

export interface UpdateCounts {
  added: number;
  removed: number;
  reactivated: number;
  certChanged: number;
}
