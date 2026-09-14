import { AppAdsChangeType } from '../../contracts/enums';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('app_ads_change')
@Index('idx_aac_domain_time', ['domainId', 'changedAt'])
export class AppAdsChangeEntity {
  @PrimaryColumn({ name: 'id', type: 'bigint' })
  id: string;

  @PrimaryColumn({ name: 'changed_at', type: 'timestamptz', default: () => 'now()' })
  changedAt: Date;

  @Column({ name: 'domain_id', type: 'int' })
  domainId: number;

  @Column({ name: 'ad_network_domain', type: 'varchar', length: 255 })
  adNetworkDomain: string;

  @Column({ name: 'account_id', type: 'varchar', length: 255 })
  accountId: string;

  @Column({ name: 'account_type', type: 'varchar', length: 20 })
  accountType: string;

  @Column({ name: 'change_type', type: 'varchar', length: 16 })
  changeType: AppAdsChangeType;

  @Column({ name: 'old_cert_authority_id', type: 'varchar', length: 64, nullable: true })
  oldCertAuthorityId: string | null;

  @Column({ name: 'new_cert_authority_id', type: 'varchar', length: 64, nullable: true })
  newCertAuthorityId: string | null;

  @Column({ name: 'content_version_id', type: 'bigint', nullable: true })
  contentVersionId: string | null;
}
