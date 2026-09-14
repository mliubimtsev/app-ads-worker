/**
 * Параметры:
 *    $1 = runId
 *    $2 = domainId
 *    $3 = versionId
 */

import { AppAdsChangeType } from '../../contracts/enums';

export const APPLY_MERGE_SQL = /* sql */ `
WITH
  stage_entries AS (
    SELECT DISTINCT ON (ad_network_domain, account_id, account_type)
      ad_network_domain, 
      account_id, 
      account_type, 
      cert_authority_id
    FROM stage_app_ads
    WHERE run_id = $1
    ORDER BY ad_network_domain, account_id, account_type
  ),

  current_entries AS (
    SELECT 
      ad_network_domain, 
      account_id, 
      account_type, 
      cert_authority_id, 
      removed_at
    FROM app_ads_entries
    WHERE domain_id = $2
  ),

  classified_changes AS (
    SELECT
      ad_network_domain,
      account_id,
      account_type,
      s.cert_authority_id AS new_cert,
      c.cert_authority_id AS old_cert,
      CASE
        WHEN c.ad_network_domain IS NULL THEN '${AppAdsChangeType.Added}'
        WHEN s.ad_network_domain IS NULL AND c.removed_at IS NULL THEN '${AppAdsChangeType.Removed}'
        WHEN s.ad_network_domain IS NULL THEN NULL
        WHEN c.removed_at IS NOT NULL THEN '${AppAdsChangeType.Reactivated}'
        WHEN s.cert_authority_id IS DISTINCT FROM c.cert_authority_id THEN '${AppAdsChangeType.CertChanged}'
        ELSE NULL
      END AS change_type
    FROM stage_entries s
    FULL OUTER JOIN current_entries c
      USING (ad_network_domain, account_id, account_type)
  ),

  diff AS (
    SELECT *
    FROM classified_changes
    WHERE change_type IS NOT NULL
  ),

  upserted AS (
    INSERT INTO app_ads_entries AS a
      (domain_id, ad_network_domain, account_id, account_type, cert_authority_id,
      first_seen_at, removed_at)
    SELECT
      $2,
      ad_network_domain,
      account_id,
      account_type,
      new_cert,
      now(),
      NULL
    FROM diff
    WHERE change_type != '${AppAdsChangeType.Removed}'
    ON CONFLICT (domain_id, ad_network_domain, account_id, account_type)
    DO UPDATE SET
      removed_at = NULL,
      cert_authority_id = EXCLUDED.cert_authority_id
    RETURNING 1
  ),

  removed AS (
    UPDATE app_ads_entries a SET
      removed_at = now()
    FROM diff d
    WHERE a.domain_id = $2
      AND a.removed_at IS NULL
      AND a.ad_network_domain = d.ad_network_domain
      AND a.account_id = d.account_id
      AND a.account_type = d.account_type
      AND d.change_type = '${AppAdsChangeType.Removed}'
    RETURNING 1
  )

INSERT INTO app_ads_change
  (domain_id, ad_network_domain, account_id, account_type, change_type,
   old_cert_authority_id, new_cert_authority_id, content_version_id)
SELECT 
  $2, 
  ad_network_domain, 
  account_id, 
  account_type, 
  change_type,
  old_cert, 
  new_cert, 
  $3::bigint
FROM diff
CROSS JOIN (SELECT count(*) AS upserted_count FROM upserted) u
CROSS JOIN (SELECT count(*) AS removed_count FROM removed) r
WHERE change_type != '${AppAdsChangeType.Added}'
`;
