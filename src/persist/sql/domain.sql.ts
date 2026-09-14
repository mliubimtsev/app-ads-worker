import { DomainStatus } from '../../contracts/enums';

/**
 * Параметры везде:
 *    $1 = domainId
 */
export const DomainSQL = {
  markUnchanged: /* sql */ `
    UPDATE domain SET
        last_scraped_at = now(),
        status = CASE WHEN status = '${DomainStatus.Failed}' THEN status ELSE '${DomainStatus.Success}' END,
        etag = COALESCE($2, etag),
        last_modified = COALESCE($3, last_modified),
        next_scrape_at = $5,
        last_http_status = $4,
        locked_at = NULL,
        updated_at = now()
    WHERE id = $1
  `,
  markNoFile: /* sql */ `
    UPDATE domain SET
        status = '${DomainStatus.NoFile}',
        last_scraped_at = now(),
        last_error_at = now(),
        last_http_status = $2,
        next_scrape_at = $3,
        locked_at = NULL,
        updated_at = now()
    WHERE id = $1
  `,
  markFailure: /* sql */ `
    UPDATE domain SET
        last_error_at = now(),
        last_scraped_at = now(),
        last_http_status = $2,
        status = $3,
        next_scrape_at = $4,
        locked_at = NULL,
        updated_at = now()
    WHERE id = $1
  `,
  markUpdate: /* sql */ `
    UPDATE domain SET
        content_hash = $2,
        etag = COALESCE($3, etag),
        last_modified = COALESCE($4, last_modified),
        last_scraped_at = now(),
        last_success_at = now(),
        last_http_status = $5,
        status = '${DomainStatus.Success}',
        current_version_id = $6::bigint,
        next_scrape_at = $7,
        locked_at = NULL,
        updated_at = now()
    WHERE id = $1
  `,
};
