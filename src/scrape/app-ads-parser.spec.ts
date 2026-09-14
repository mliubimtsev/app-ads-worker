import { parseAppAds } from './app-ads-parser';

describe('parseAppAds', () => {
  describe('корректные строки данных', () => {
    it('разбирает строку из 3 полей, cert = null', () => {
      const res = parseAppAds('google.com, pub-1234, DIRECT');

      expect(res.lines).toEqual([
        {
          adNetworkDomain: 'google.com',
          accountId: 'pub-1234',
          accountType: 'DIRECT',
          certAuthorityId: null,
        },
      ]);
      expect(res.linesParsed).toBe(1);
      expect(res.skipped).toBe(0);
    });

    it('берёт 4-е поле как certAuthorityId', () => {
      const { lines } = parseAppAds('google.com, pub-1234, DIRECT, f08c47fec0942fa0');

      expect(lines[0].certAuthorityId).toBe('f08c47fec0942fa0');
    });

    it('пустое 4-е поле → certAuthorityId = null, строка остаётся валидной', () => {
      const { lines, skipped } = parseAppAds('google.com, 1, DIRECT, ');

      expect(lines).toHaveLength(1);
      expect(lines[0].certAuthorityId).toBeNull();
      expect(skipped).toBe(0);
    });

    it('игнорирует лишние поля после 4-го', () => {
      const { lines } = parseAppAds('google.com, 1, DIRECT, cert123, LOREM, IPSUM');

      expect(lines[0]).toMatchObject({ accountId: '1', certAuthorityId: 'cert123' });
    });

    it('приводит accountType к верхнему регистру', () => {
      expect(parseAppAds('google.com, 1, reseller').lines[0].accountType).toBe('RESELLER');
    });

    it('обрезает пробелы вокруг каждого поля', () => {
      const { lines } = parseAppAds('   google.com  ,  pub-1  ,  Direct  ');

      expect(lines[0]).toEqual({
        adNetworkDomain: 'google.com',
        accountId: 'pub-1',
        accountType: 'DIRECT',
        certAuthorityId: null,
      });
    });

    it('не дедуплицирует одинаковые строки (это задача merge-слоя)', () => {
      const { lines } = parseAppAds('google.com, 1, DIRECT\ngoogle.com, 1, DIRECT');

      expect(lines).toHaveLength(2);
    });
  });

  describe('нормализация домена рекламной сети', () => {
    it.each([
      ['google.com, 1, DIRECT', 'google.com'],
      ['GOOGLE.COM, 1, DIRECT', 'google.com'],
      ['http://example.com, 1, DIRECT', 'example.com'],
      ['https://example.com, 1, DIRECT', 'example.com'],
      ['www.example.com, 1, DIRECT', 'example.com'],
      ['HTTPS://WWW.Example.com/path/x, 1, DIRECT', 'example.com'],
    ])('%j → домен %j', (input, expected) => {
      expect(parseAppAds(input).lines[0].adNetworkDomain).toBe(expected);
    });

    it('снимает только один ведущий www.', () => {
      expect(parseAppAds('www.www.example.com, 1, DIRECT').lines[0].adNetworkDomain).toBe(
        'www.example.com',
      );
    });

    it('строка со схлопнувшимся в пустоту доменом отбрасывается и идёт в skipped', () => {
      const res = parseAppAds('https://, 1, DIRECT');

      expect(res.lines).toHaveLength(0);
      expect(res.skipped).toBe(1);
    });
  });

  describe('комментарии', () => {
    it('строка-комментарий целиком не попадает ни в lines, ни в skipped', () => {
      const res = parseAppAds('# это заголовок файла\n#ещё один\n   # с отступом');

      expect(res).toEqual({ lines: [], linesParsed: 0, skipped: 0 });
    });

    it('обрезает инлайн-комментарий от первого #', () => {
      const { lines } = parseAppAds('google.com, 1, DIRECT # закомментировано');

      expect(lines[0]).toMatchObject({ adNetworkDomain: 'google.com', accountType: 'DIRECT' });
    });

    it('инлайн-комментарий, оставляющий < 3 полей, делает строку битой', () => {
      const res = parseAppAds('google.com, 1 # DIRECT');

      expect(res.lines).toHaveLength(0);
      expect(res.skipped).toBe(1);
    });
  });

  describe('директивы формата', () => {
    it.each([
      'OWNERDOMAIN=example.com',
      'MANAGERDOMAIN=example.com',
      'CONTACT=ads@example.com',
      'SUBDOMAIN=sub.example.com',
    ])('«%s» уходит в skipped, не в lines', (line) => {
      const res = parseAppAds(line);

      expect(res.lines).toHaveLength(0);
      expect(res.skipped).toBe(1);
    });

    it('директива с инлайн-комментарием всё равно распознаётся', () => {
      expect(parseAppAds('CONTACT=ads@example.com # почта').skipped).toBe(1);
    });
  });

  describe('битые строки → skipped', () => {
    it.each([
      ['одно поле', 'google.com'],
      ['два поля', 'google.com, pub-1'],
      ['пустое 1-е поле', ', pub-1, DIRECT'],
      ['пустое 2-е поле', 'google.com, , DIRECT'],
      ['пустое 3-е поле', 'google.com, pub-1, '],
    ])('%s → +1 к skipped, 0 строк', (_name, input) => {
      const res = parseAppAds(input);

      expect(res.lines).toHaveLength(0);
      expect(res.skipped).toBe(1);
      expect(res.linesParsed).toBe(0);
    });
  });

  describe('пустые строки и разделители', () => {
    it('пустые строки между данными не влияют на skipped', () => {
      const res = parseAppAds('google.com, 1, DIRECT\n\n\n   \nappnexus.com, 2, RESELLER\n');

      expect(res.linesParsed).toBe(2);
      expect(res.skipped).toBe(0);
    });

    it('\\r\\n и \\n дают одинаковый результат', () => {
      const body = ['google.com, 1, DIRECT', 'appnexus.com, 2, RESELLER'];

      expect(parseAppAds(body.join('\n'))).toEqual(parseAppAds(body.join('\r\n')));
    });

    it.each(['', '   ', '\n\n', '  \r\n  \r\n'])('пустой ввод %j → пустой результат', (input) => {
      expect(parseAppAds(input)).toEqual({ lines: [], linesParsed: 0, skipped: 0 });
    });
  });

  describe('ограничения длины', () => {
    it('домен обрезается до 255 символов', () => {
      const long = 'a'.repeat(300);

      expect(parseAppAds(`${long}, 1, DIRECT`).lines[0].adNetworkDomain).toHaveLength(255);
    });

    it('accountId обрезается до 255 символов', () => {
      const long = 'x'.repeat(300);

      expect(parseAppAds(`google.com, ${long}, DIRECT`).lines[0].accountId).toHaveLength(255);
    });

    it('accountType обрезается до 20 символов (уже после верхнего регистра)', () => {
      const long = 'd'.repeat(40);

      expect(parseAppAds(`google.com, 1, ${long}`).lines[0].accountType).toBe('D'.repeat(20));
    });

    it('certAuthorityId обрезается до 64 символов', () => {
      const long = 'c'.repeat(100);

      expect(parseAppAds(`google.com, 1, DIRECT, ${long}`).lines[0].certAuthorityId).toHaveLength(
        64,
      );
    });
  });

  describe('инвариант и реалистичный фрагмент', () => {
    it('linesParsed всегда равен lines.length', () => {
      const res = parseAppAds(
        'google.com, 1, DIRECT\nбитая строка\nOWNERDOMAIN=x.com\nappnexus.com, 2, RESELLER',
      );

      expect(res.linesParsed).toBe(res.lines.length);
    });

    it('разбирает смешанный фрагмент app-ads.txt', () => {
      const file = [
        '# app-ads.txt for example.com',
        'OWNERDOMAIN=example.com',
        '',
        'google.com, pub-0001, DIRECT, f08c47fec0942fa0',
        'appnexus.com, 1957, RESELLER # SSP-партнёр',
        'rubiconproject.com, 17960, DIRECT',
        'broken-without-type',
        '',
        'CONTACT=adops@example.com',
      ].join('\n');

      const res = parseAppAds(file);

      expect(res.linesParsed).toBe(3);
      expect(res.skipped).toBe(3);
      expect(res.lines.map((l) => l.adNetworkDomain)).toEqual([
        'google.com',
        'appnexus.com',
        'rubiconproject.com',
      ]);
      expect(res.lines[1]).toEqual({
        adNetworkDomain: 'appnexus.com',
        accountId: '1957',
        accountType: 'RESELLER',
        certAuthorityId: null,
      });
    });
  });
});
