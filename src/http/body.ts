import type { Readable } from 'node:stream';
import { TooLargeError } from './errors';

/** Нормализует чанк потока (Buffer | Uint8Array | string) в Buffer */
function toBuf(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  return Buffer.from(chunk as Uint8Array);
}

/**
 * Читает поток тела в буфер, файлы app-ads.txt небольшие
 * (лимит по умолчанию 10 МБ), поэтому буферизация проще и надёжнее
 * стриминга - и позволяет сверить хэш до любой записи в S3/БД
 */
export async function readBodyCapped(body: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = toBuf(chunk);
    total += buf.length;
    if (total > maxBytes) {
      body.destroy();
      throw new TooLargeError(`Тело превышает лимит ${maxBytes} байт`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

/** Прочитать не больше `limit` */
export async function readSnippet(body: Readable, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const buf = toBuf(chunk);
      chunks.push(buf);
      total += buf.length;
      if (total >= limit) break;
    }
  } catch {
    // тело ошибки
  } finally {
    body.destroy();
  }
  return Buffer.concat(chunks).subarray(0, limit).toString('utf8');
}

/** Закрыть неиспользуемый поток (например, при 304) */
export function drain(body: Readable): void {
  body.on('error', () => {});
  body.destroy();
}
