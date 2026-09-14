import { ParsedLine, ParseResult } from './interfaces/parser.interface';

/** Директивы формата (SUBDOMAIN=, OWNERDOMAIN=, CONTACT=, ...) - игнорируем */
const DIRECTIVE_RE = /^[A-Za-z][A-Za-z-]*=/;

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .slice(0, 255);
}

/**
 * Разбирает содержимое app-ads.txt в набор нормализованных строк авторизации:
 *  - отбрасывает пустые строки, комментарии (`#`), директивы (`WORD=`);
 *  - обрезает инлайн-комментарий от первого `#`;
 *  - строка данных: split(','), нужно >= 3 непустых поля;
 *  - нормализует домен (lower, без www, без схемы/пути), account_type -> UPPER;
 *  - 4-е поле (cert) опционально.
 */
export function parseAppAds(content: string): ParseResult {
  const lines: ParsedLine[] = [];
  let skipped = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const hashIdx = rawLine.indexOf('#');
    const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
    if (line.length === 0) continue;
    if (DIRECTIVE_RE.test(line)) {
      skipped += 1;
      continue;
    }

    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
      skipped += 1;
      continue;
    }

    const adNetworkDomain = normalizeDomain(parts[0]);
    const accountId = parts[1].slice(0, 255);
    const accountType = parts[2].toUpperCase().slice(0, 20);
    const certAuthorityId = parts[3] ? parts[3].slice(0, 64) : null;
    if (!adNetworkDomain) {
      skipped += 1;
      continue;
    }

    lines.push({
      adNetworkDomain,
      accountId,
      accountType,
      certAuthorityId,
    });
  }

  return { lines, linesParsed: lines.length, skipped };
}
