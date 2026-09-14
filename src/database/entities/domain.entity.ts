import { DomainStatus } from '../../contracts/enums';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'domain' })
export class DomainEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Index('uq_domain_domain_name', { unique: true })
  @Column({ name: 'domain_name', type: 'varchar', length: 255 })
  domainName: string;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'pending' })
  status: DomainStatus;

  @Column({ name: 'content_hash', type: 'bytea', nullable: true })
  contentHash: Buffer | null;

  @Column({ name: 'current_version_id', type: 'bigint', nullable: true })
  currentVersionId: string | null;

  @Column({ name: 'etag', type: 'text', nullable: true })
  etag: string | null;

  @Column({ name: 'last_modified', type: 'text', nullable: true })
  lastModified: string | null;

  @Column({ name: 'last_scraped_at', type: 'timestamptz', nullable: true })
  lastScrapedAt: Date | null;

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt: Date | null;

  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true })
  lastErrorAt: Date | null;

  @Column({ name: 'last_http_status', type: 'smallint', nullable: true })
  lastHttpStatus: number | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @Index('idx_domain_next_scrape_at')
  @Column({ name: 'next_scrape_at', type: 'timestamptz', nullable: true })
  nextScrapeAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
