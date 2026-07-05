import { describe, expect, it } from 'vitest';
import { parseSeatingMatrix, remapColumnsToTables, defaultMapping } from './matrix';

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

describe('remapColumnsToTables', () => {
  const parsed = parseSeatingMatrix(`${HEADERS}\nAmy,Ben\nCindy,`);
  it('identity mapping reproduces positional output (regression guard)', () => {
    const identity = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(remapColumnsToTables(parsed, identity)).toEqual(parsed);
  });
  it('relabels table_no via the mapping while preserving seat_no', () => {
    const mapping = [7, 3, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12]; // col1→7, col2→3
    const r = remapColumnsToTables(parsed, mapping);
    expect(r.tables[0]).toMatchObject({ table_no: 7, label_en: 'Peacock' });
    expect(r.tables[1]).toMatchObject({ table_no: 3, label_en: 'Owl' });
    // Amy was col1 seat1 → now table 7 seat 1
    expect(r.guests).toContainEqual({ name_en: 'Amy', name_zh: '', table_no: 7, seat_no: 1 });
    expect(r.guests).toContainEqual({ name_en: 'Cindy', name_zh: '', table_no: 7, seat_no: 2 });
    expect(r.guests).toContainEqual({ name_en: 'Ben', name_zh: '', table_no: 3, seat_no: 1 });
  });
  it('rejects invalid mappings (duplicate, out-of-range, wrong length) before import', () => {
    const dup = [1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(remapColumnsToTables(parsed, dup).errors.join(' ')).toMatch(/permutation|invalid/i);
    const oor = [13, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(remapColumnsToTables(parsed, oor).errors.join(' ')).toMatch(/permutation|invalid/i);
    expect(remapColumnsToTables(parsed, [1, 2, 3]).errors.join(' ')).toMatch(/permutation|invalid/i);
    // originals untouched on invalid
    expect(remapColumnsToTables(parsed, dup).tables).toEqual(parsed.tables);
  });
});

describe('defaultMapping', () => {
  const parsed = parseSeatingMatrix(`${HEADERS}\nAmy,`);
  const seeded = Array.from({ length: 12 }, (_, i) => ({ table_no: i + 1, label_en: `Table ${i + 1}`, label_zh: `${i + 1}号桌` }));
  it('first import (no label match) → identity permutation', () => {
    expect(defaultMapping(parsed.tables, seeded)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('recovers prior placement by matching current labels', () => {
    const existing = seeded.map(e => ({ ...e }));
    existing[6] = { table_no: 7, label_en: 'Peacock', label_zh: '孔雀' }; // Peacock currently at table 7
    const m = defaultMapping(parsed.tables, existing);
    expect(m[0]).toBe(7);            // column 1 (Peacock) defaults to table 7
    expect(new Set(m).size).toBe(12); // still a permutation
  });
  it('always returns a permutation of 1..12 even when two labels collide', () => {
    const existing = seeded.map(e => ({ ...e }));
    existing[0] = { table_no: 1, label_en: 'Owl', label_zh: '' };
    existing[4] = { table_no: 5, label_en: 'Owl', label_zh: '' }; // two tables both "Owl"
    const m = defaultMapping(parsed.tables, existing);
    expect(m).toHaveLength(12);
    expect(new Set(m).size).toBe(12);
    expect(m.every(n => n >= 1 && n <= 12)).toBe(true);
  });
});
