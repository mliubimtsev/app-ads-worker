import { AppAdsChangeEntity } from './app-ads-change.entity';
import { AppAdsEntryEntity } from './app-ads-entry.entity';
import { DomainContentVersionEntity } from './domain-content-version.entity';
import { DomainEntity } from './domain.entity';

export { AppAdsChangeEntity, AppAdsEntryEntity, DomainContentVersionEntity, DomainEntity };

export const ENTITIES = [
  DomainEntity,
  AppAdsEntryEntity,
  AppAdsChangeEntity,
  DomainContentVersionEntity,
];
