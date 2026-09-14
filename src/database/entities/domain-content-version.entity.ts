import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('domain_content_version')
@Index('uq_dcv_domain_hash', ['domainId', 'contentHash'], { unique: true })
@Index('uq_dcv_domain_current', ['domainId'], { unique: true, where: 'is_current' })
@Index('idx_dcv_domain_time', ['domainId', 'firstSeenAt'])
export class DomainContentVersionEntity {
  @PrimaryColumn({ name: 'id', type: 'bigint' })
  id: string;

  @Column({ name: 'domain_id', type: 'int' })
  domainId: number;

  @Column({ name: 'content_hash', type: 'bytea' })
  contentHash: Buffer;

  @Column({ name: 'algo', type: 'varchar', length: 16, default: 'md5' })
  algo: string;

  @Column({ name: 's3_bucket', type: 'varchar', length: 255 })
  s3Bucket: string;

  @Column({ name: 's3_key', type: 'varchar', length: 512 })
  s3Key: string;

  @Column({ name: 's3_uploaded_at', type: 'timestamptz', nullable: true })
  s3UploadedAt: Date | null;

  @Column({ name: 'is_current', type: 'boolean', default: false })
  isCurrent: boolean;

  @Column({ name: 'first_seen_at', type: 'timestamptz', default: () => 'now()' })
  firstSeenAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;
}
