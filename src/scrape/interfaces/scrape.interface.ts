import { ScrapeOutcome } from '../../contracts/enums';

export interface DomainResult {
  domainId: number;
  outcome: ScrapeOutcome;
}

export interface BatchSummary {
  batchId: string;
  total: number;
  byOutcome: Record<string, number>;
}
