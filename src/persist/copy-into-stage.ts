import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { from as copyFrom } from 'pg-copy-streams';
import type { ParsedLine } from '../scrape/interfaces/parser.interface';

export interface CopyCapableClient {
  query(stream: ReturnType<typeof copyFrom>): NodeJS.WritableStream;
}

function csvField(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function* csvRows(runId: string, lines: readonly ParsedLine[]): Generator<string> {
  for (const l of lines) {
    yield [
      csvField(runId),
      csvField(l.adNetworkDomain),
      csvField(l.accountId),
      csvField(l.accountType),
      csvField(l.certAuthorityId),
    ].join(',') + '\n';
  }
}

/**
 * Заливает распарсенные строки в UNLOGGED stage_app_ads через COPY FROM STDIN
 * `client` - сырой pg-клиент той же транзакции (из QueryRunner), чтобы COPY
 * участвовал в общем commit/rollback
 */
export async function copyIntoStage(
  client: CopyCapableClient,
  runId: string,
  lines: readonly ParsedLine[],
): Promise<void> {
  if (lines.length === 0) return;
  const sink = client.query(
    copyFrom(
      `COPY stage_app_ads
       (run_id, ad_network_domain, account_id, account_type, cert_authority_id)
       FROM STDIN WITH (FORMAT csv)`,
    ),
  );
  await pipeline(Readable.from(csvRows(runId, lines)), sink);
}
