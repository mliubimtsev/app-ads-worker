import { Readable } from 'node:stream';
import { drain, readBodyCapped, readSnippet } from './body';
import { TooLargeError } from './errors';

function readableThatErrors(chunks: string[], err: Error): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i < chunks.length) {
        this.push(chunks[i]);
        i += 1;
        return;
      }
      process.nextTick(() => this.emit('error', err));
    },
  });
}

describe('readBodyCapped', () => {
  it('склеивает чанки разных типов (Buffer/строка/Uint8Array) в один Buffer', async () => {
    const chunks: Array<Buffer | string | Uint8Array> = [
      Buffer.from('ab'),
      'cd',
      new Uint8Array([0x65, 0x66]),
    ];
    const buf = await readBodyCapped(Readable.from(chunks), 1024);

    expect(buf.toString('utf8')).toBe('abcdef');
  });

  it('ровно на границе лимита - не бросает', async () => {
    const buf = await readBodyCapped(Readable.from(['12345']), 5);
    expect(buf.length).toBe(5);
  });

  it('превышение лимита - бросает TooLargeError и уничтожает поток', async () => {
    const stream = Readable.from(['123456']);

    await expect(readBodyCapped(stream, 5)).rejects.toThrow(TooLargeError);
    expect(stream.destroyed).toBe(true);
  });
});

describe('readSnippet', () => {
  it('не читает больше limit байт, даже если в потоке есть ещё данные', async () => {
    const stream = Readable.from(['0123456789']);
    const snippet = await readSnippet(stream, 4);

    expect(snippet).toBe('0123');
    expect(stream.destroyed).toBe(true);
  });

  it('на ошибке потока не бросает - возвращает то, что успело прийти', async () => {
    const stream = readableThatErrors(['перв', 'ый кусок'], new Error('оборвалось соединение'));

    const snippet = await readSnippet(stream, 1000);

    expect(snippet).toBe('первый кусок');
    expect(stream.destroyed).toBe(true);
  });
});

describe('drain', () => {
  it('уничтожает поток и не бросает, даже если поток потом эмитит error', () => {
    const stream = Readable.from(['что-то']);

    expect(() => drain(stream)).not.toThrow();
    expect(stream.destroyed).toBe(true);

    expect(() => stream.emit('error', new Error('поздняя ошибка'))).not.toThrow();
  });
});
