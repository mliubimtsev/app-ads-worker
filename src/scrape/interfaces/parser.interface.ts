export interface ParsedLine {
  adNetworkDomain: string;
  accountId: string;
  accountType: string;
  certAuthorityId: string | null;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** Сколько строк-данных распознано (lines.length) */
  linesParsed: number;
  /** Сколько непустых строк пропущено (директивы, битые, комментарии) */
  skipped: number;
}
