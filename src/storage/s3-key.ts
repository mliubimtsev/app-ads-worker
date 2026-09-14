/**
 * Ключ сырого файла в объектном хранилище:
 *   app-ads/<domainId>/<yyyy>/<mm>/<dd>/<contentHashHex>.txt.gz
 * Ключ по хэшу - повторный PUT того же содержимого идемпотентен.
 */
export function rawAppAdsKey(
  domainId: number,
  contentHashHex: string,
  at: Date = new Date(),
): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(at.getUTCDate()).padStart(2, '0');
  return `app-ads/${domainId}/${yyyy}/${mm}/${dd}/${contentHashHex}.txt.gz`;
}
