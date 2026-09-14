import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('app_ads_entries')
@Index('idx_app_ads_entries_active', ['domainId'], { where: 'removed_at IS NULL' })
@Index('idx_app_ads_entries_network_account', ['adNetworkDomain', 'accountId'])
@Index('idx_app_ads_entries_first_seen', ['firstSeenAt'])
@Index('idx_app_ads_entries_removed', ['removedAt'], { where: 'removed_at IS NOT NULL' })
export class AppAdsEntryEntity {
  @PrimaryColumn({ name: 'domain_id', type: 'int' })
  domainId: number;

  @PrimaryColumn({ name: 'ad_network_domain', type: 'varchar', length: 255 })
  adNetworkDomain: string;

  @PrimaryColumn({ name: 'account_id', type: 'varchar', length: 255 })
  accountId: string;

  @PrimaryColumn({ name: 'account_type', type: 'varchar', length: 20 })
  accountType: string;

  @Column({ name: 'cert_authority_id', type: 'varchar', length: 64, nullable: true })
  certAuthorityId: string | null;

  @Column({ name: 'first_seen_at', type: 'timestamptz', default: () => 'now()' })
  firstSeenAt: Date;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({
    name: 'is_active',
    type: 'boolean',
    generatedType: 'STORED',
    asExpression: 'removed_at IS NULL',
    insert: false,
    update: false,
  })
  isActive: boolean;
}
