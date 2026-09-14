import { MigrationInterface, QueryRunner } from 'typeorm';

/** Число HASH-партиций таблицы app_ads_entries */
const HASH_PARTITIONS = 8;

/** Начало месяца (UTC) со сдвигом на `offset` месяцев */
function monthStart(base: Date, offset: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Суффикс партиции: y2026m03 */
export function monthSuffix(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `y${d.getUTCFullYear()}m${m}`;
}

export class InitAppAds1740000000000 implements MigrationInterface {
  name = 'InitAppAds1740000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ─── domain ───────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "domain" (
        "id"                 	serial PRIMARY KEY,
        "domain_name"        	varchar(255) NOT NULL,
        "status"             	varchar(32) NOT NULL DEFAULT 'pending',
        "content_hash"       	bytea,
        "current_version_id" 	bigint,
        "etag"               	text,
        "last_modified"      	text,
        "last_scraped_at"    	timestamptz,
        "last_success_at"    	timestamptz,
        "last_error_at"      	timestamptz,
        "last_http_status"   	smallint,
        "locked_at"          	timestamptz,
        "next_scrape_at"     	timestamptz,
        "created_at"         	timestamptz NOT NULL DEFAULT now(),
        "updated_at"         	timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX "uq_domain_domain_name" ON "domain" ("domain_name")`);
    await q.query(`
      CREATE INDEX "idx_domain_next_scrape_at" ON "domain" ("next_scrape_at")
      WHERE "status" IN ('pending','ok','failed','no_file')
    `);

    // ─── последовательности для пред-аллокации id ──────────────────────────
    await q.query(`CREATE SEQUENCE "scrape_run_seq" AS bigint`);

    // ─── app_ads_entries: PARTITION BY HASH (domain_id) ────────────────────
    await q.query(`
      CREATE TABLE "app_ads_entries" (
        "domain_id"         	int NOT NULL,
        "ad_network_domain" 	varchar(255) NOT NULL,
        "account_id"        	varchar(255) NOT NULL,
        "account_type"      	varchar(20) NOT NULL,
        "cert_authority_id" 	varchar(64),
        "first_seen_at"     	timestamptz NOT NULL DEFAULT now(),
        "removed_at"        	timestamptz,
        "is_active"         	boolean GENERATED ALWAYS AS ("removed_at" IS NULL) STORED,
        CONSTRAINT "pk_app_ads_entries"
          PRIMARY KEY ("domain_id", "ad_network_domain", "account_id", "account_type")
      ) PARTITION BY HASH ("domain_id")
    `);
    for (let i = 0; i < HASH_PARTITIONS; i += 1) {
      await q.query(`
        CREATE TABLE "app_ads_entries_p${i}" PARTITION OF "app_ads_entries"
        FOR VALUES WITH (MODULUS ${HASH_PARTITIONS}, REMAINDER ${i})
      `);
    }
    await q.query(`
      CREATE INDEX "idx_app_ads_entries_active" ON "app_ads_entries" ("domain_id")
      WHERE "removed_at" IS NULL
    `);
    await q.query(`
      CREATE INDEX "idx_app_ads_entries_network_account"
      ON "app_ads_entries" ("ad_network_domain", "account_id")
    `);
    await q.query(`
      CREATE INDEX "idx_app_ads_entries_first_seen" ON "app_ads_entries" ("first_seen_at")
    `);
    await q.query(`
      CREATE INDEX "idx_app_ads_entries_removed" ON "app_ads_entries" ("removed_at")
      WHERE "removed_at" IS NOT NULL
    `);

    // ─── domain_content_version ───────────────────────────────────────────
    await q.query(`
      CREATE TABLE "domain_content_version" (
        "id"             	serial PRIMARY KEY,
        "domain_id"      	int NOT NULL,
        "content_hash"   	bytea NOT NULL,
        "algo"           	varchar(16) NOT NULL DEFAULT 'md5',
        "s3_bucket"      	varchar(255) NOT NULL,
        "s3_key"         	varchar(512) NOT NULL,
        "s3_uploaded_at" 	timestamptz,
        "is_current"     	boolean NOT NULL DEFAULT false,
        "first_seen_at"  	timestamptz NOT NULL DEFAULT now(),
        "last_seen_at"   	timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_dcv_domain_hash"
      ON "domain_content_version" ("domain_id", "content_hash")
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_dcv_domain_current"
      ON "domain_content_version" ("domain_id") WHERE "is_current"
    `);
    await q.query(`
      CREATE INDEX "idx_dcv_domain_time"
      ON "domain_content_version" ("domain_id", "first_seen_at" DESC)
    `);

    // ─── app_ads_change: PARTITION BY RANGE (changed_at) ──────────────────
    await q.query(`
      CREATE TABLE "app_ads_change" (
        "id"                    	bigint GENERATED ALWAYS AS IDENTITY,
        "changed_at"            	timestamptz NOT NULL DEFAULT now(),
        "domain_id"             	int NOT NULL,
        "ad_network_domain"     	varchar(255) NOT NULL,
        "account_id"            	varchar(255) NOT NULL,
        "account_type"          	varchar(20) NOT NULL,
        "change_type"           	varchar(16) NOT NULL,
        "old_cert_authority_id" 	varchar(64),
        "new_cert_authority_id" 	varchar(64),
        "content_version_id"    	bigint,
        CONSTRAINT "pk_app_ads_change" PRIMARY KEY ("id", "changed_at")
      ) PARTITION BY RANGE ("changed_at")
    `);
    await q.query(`
      CREATE INDEX "idx_aac_domain_time" ON "app_ads_change" ("domain_id", "changed_at" DESC)
    `);
    await q.query(`CREATE INDEX "idx_aac_time_brin" ON "app_ads_change" USING brin ("changed_at")`);

    // ─── месячные партиции: [-1 .. +3] месяца + DEFAULT ──────────────────
    const now = new Date();
    for (let offset = -1; offset <= 3; offset += 1) {
      const from = monthStart(now, offset);
      const to = monthStart(now, offset + 1);
      const suffix = monthSuffix(from);
      await q.query(`
        CREATE TABLE "app_ads_change_${suffix}" PARTITION OF "app_ads_change"
        FOR VALUES FROM ('${ymd(from)}') TO ('${ymd(to)}')
      `);
    }
    await q.query(`CREATE TABLE "app_ads_change_default" PARTITION OF "app_ads_change" DEFAULT`);

    // ─── stage_app_ads: UNLOGGED staging под COPY ────────────────────────
    await q.query(`
      CREATE UNLOGGED TABLE "stage_app_ads" (
        "run_id"            	bigint NOT NULL,
        "ad_network_domain" 	varchar(255) NOT NULL,
        "account_id"        	varchar(255) NOT NULL,
        "account_type"      	varchar(20) NOT NULL,
        "cert_authority_id" 	varchar(64)
      )
    `);
    await q.query(`CREATE INDEX "idx_stage_app_ads_run" ON "stage_app_ads" ("run_id")`);
    await q.query(`
      ALTER TABLE "stage_app_ads"
      SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 10000)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "stage_app_ads" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "scrape_run" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "app_ads_change" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "domain_content_version" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "app_ads_entries" CASCADE`);
    await q.query(`DROP SEQUENCE IF EXISTS "scrape_run_seq"`);
    await q.query(`DROP TABLE IF EXISTS "domain" CASCADE`);
  }
}
