import { expect, it } from 'vitest';
import { guestListCsv } from './guest-export';
import { parseSeatingMatrix } from './matrix';
import type { Guest, TableInfo } from '../shared/types';

const tables: TableInfo[] = [
  { table_no: 1, label_en: 'Peacock', label_zh: '孔雀' },
  { table_no: 2, label_en: 'Owl', label_zh: '猫头鹰' },
];

const guest = (name_en: string, table_no: number | null, seat_no: number | null, name_zh = ''): Guest =>
  ({ id: name_en, name_en, name_zh, table_no, seat_no });

it('round-trips table and seat positions, unseated guests, and labels', () => {
  const csv = guestListCsv([
    guest('Zoe', null, null),
    guest('Table two, second', 2, 2),
    guest('Table one, third', 1, 3),
    guest('Table one, first', 1, 1),
    guest('Amy', null, null),
  ], tables);
  const parsed = parseSeatingMatrix(csv);

  expect(parsed.errors).toEqual([]);
  expect(parsed.tables.slice(0, 2)).toEqual(tables);
  expect(parsed.guests).toEqual([
    { name_en: 'Table one, first', name_zh: '', table_no: 1, seat_no: 1 },
    { name_en: 'Amy', name_zh: '', table_no: null, seat_no: null },
    { name_en: 'Table two, second', name_zh: '', table_no: 2, seat_no: 2 },
    { name_en: 'Zoe', name_zh: '', table_no: null, seat_no: null },
    { name_en: 'Table one, third', name_zh: '', table_no: 1, seat_no: 3 },
  ]);
});

it('escapes commas, quotes, and line breaks in guest and table names', () => {
  const csv = guestListCsv([
    guest('Lee, "Lucky"', 1, 1, '李\n乐'),
  ], [{ table_no: 1, label_en: 'Rose, Garden', label_zh: '' }]);

  expect(csv).toContain('"Lee, ""Lucky"" / 李\n乐"');
  expect(parseSeatingMatrix(csv).guests).toContainEqual({ name_en: 'Lee, "Lucky"', name_zh: '李\n乐', table_no: 1, seat_no: 1 });
});

it('accepts English-only and Chinese-only unseated-column headers', () => {
  const header = Array.from({ length: 12 }, (_, index) => `Table ${index + 1}`).join(',');
  expect(parseSeatingMatrix(`${header},Unseated\n,,,,,,,,,,,,Guest`).guests)
    .toContainEqual({ name_en: 'Guest', name_zh: '', table_no: null, seat_no: null });
  expect(parseSeatingMatrix(`${header},未安排\n,,,,,,,,,,,,/ 宾客`).guests)
    .toContainEqual({ name_en: '', name_zh: '宾客', table_no: null, seat_no: null });
});
