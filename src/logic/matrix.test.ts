import { describe, expect, it } from 'vitest';
import { parseSeatingMatrix } from './matrix';

const HEADERS = 'Peacock / 孔雀,Owl,Kangaroo,Giraffe,Condor,Capuchin,Anteater,Toucan,Elephant,Koala,Crocodile,Lion';

describe('parseSeatingMatrix', () => {
  it('parses headers into table labels (slash-optional) and cells into seated guests', () => {
    const r = parseSeatingMatrix(`${HEADERS}\nCarol Zhao,Connor Hsiao\n"Wang Wei / 王伟",`);
    expect(r.errors).toEqual([]);
    expect(r.tables[0]).toEqual({ table_no: 1, label_en: 'Peacock', label_zh: '孔雀' });
    expect(r.tables[1]).toEqual({ table_no: 2, label_en: 'Owl', label_zh: '' });
    expect(r.guests).toContainEqual({ name_en: 'Carol Zhao', name_zh: '', table_no: 1, seat_no: 1 });
    expect(r.guests).toContainEqual({ name_en: 'Wang Wei', name_zh: '王伟', table_no: 1, seat_no: 2 });
    expect(r.guests).toContainEqual({ name_en: 'Connor Hsiao', name_zh: '', table_no: 2, seat_no: 1 });
    expect(r.guests).toHaveLength(3); // empty cells skipped
  });
  it('supports zh-only cells and full-width slash', () => {
    const r = parseSeatingMatrix(`${HEADERS}\n/ 王奶奶,Eric Li ／ 李毅`);
    expect(r.guests[0]).toEqual({ name_en: '', name_zh: '王奶奶', table_no: 1, seat_no: 1 });
    expect(r.guests[1]).toEqual({ name_en: 'Eric Li', name_zh: '李毅', table_no: 2, seat_no: 1 });
  });
  it('errors: wrong header count, >8 rows in a column, in-sheet duplicate identity', () => {
    expect(parseSeatingMatrix('A,B\nx,y').errors[0]).toMatch(/12.*headers|headers.*12/i);
    const nine = Array.from({ length: 9 }, (_, i) => `G${i}`).join(',\n'); // col 1 gets 9 guests
    expect(parseSeatingMatrix(`${HEADERS}\n${nine},`).errors.join(' ')).toMatch(/Peacock.*8|8.*Peacock/);
    const dup = parseSeatingMatrix(`${HEADERS}\nSame Name,\nSame Name,`);
    expect(dup.errors.join(' ')).toMatch(/duplicate/i);
    expect(parseSeatingMatrix(`${HEADERS}\nBOM test,`).errors).toEqual([]);
  });
  it('strips BOM and tolerates CRLF + trailing empty rows', () => {
    const r = parseSeatingMatrix(`﻿${HEADERS}\r\nCarol Zhao,\r\n\r\n`);
    expect(r.errors).toEqual([]);
    expect(r.guests).toHaveLength(1);
  });
});
