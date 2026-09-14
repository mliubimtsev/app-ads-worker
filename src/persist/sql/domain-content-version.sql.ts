import { AlgoHash } from '../../contracts/enums';

export const DomainContentVersionSQL = {
  markUnchanged: /* sql */ `
    UPDATE domain_content_version SET last_seen_at = now()
    WHERE domain_id = $1 AND is_current
  `,
  markReset: /* sql */ `
    UPDATE domain_content_version SET is_current = false
    WHERE domain_id = $1 AND is_current
    `,

  /**
   * Параметры:
   *    $1 = domainId
   *    $2 = contentHash
   *    $3 = s3_bucket
   *    $4 = s3_key
   */
  markUpdate: /* sql */ `
    INSERT INTO domain_content_version
        (domain_id, content_hash, algo, s3_bucket, s3_key, s3_uploaded_at, is_current)
    VALUES ($1, $2, '${AlgoHash.md5}', $3, $4, now(), true)
    ON CONFLICT (domain_id, content_hash) DO UPDATE SET
        last_seen_at = now(), is_current = true, s3_uploaded_at = now()
    RETURNING id
    `,
};
