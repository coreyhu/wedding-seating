import { expect, it } from 'vitest';
import { parseGuestCsv } from './csv';

it('parses plain rows', () => {
  expect(parseGuestCsv('Carol Zhao,赵卡罗\nKevin Hu,胡凯文').rows).toEqual([
    { name_en: 'Carol Zhao', name_zh: '赵卡罗' },
    { name_en: 'Kevin Hu', name_zh: '胡凯文' },
  ]);
});
it('strips BOM, skips header, handles CRLF and trailing newline', () => {
  const text = '﻿English Name,中文姓名\r\nCarol Zhao,赵卡罗\r\n';
  expect(parseGuestCsv(text).rows).toEqual([{ name_en: 'Carol Zhao', name_zh: '赵卡罗' }]);
});
it('handles quoted fields with commas and escaped quotes', () => {
  expect(parseGuestCsv('"Zhao, Carol ""CC""",赵卡罗').rows).toEqual([{ name_en: 'Zhao, Carol "CC"', name_zh: '赵卡罗' }]);
});
it('skips fully-empty rows and counts them', () => {
  const r = parseGuestCsv('Carol Zhao,\n,\n,王奶奶');
  expect(r.rows).toEqual([{ name_en: 'Carol Zhao', name_zh: '' }, { name_en: '', name_zh: '王奶奶' }]);
  expect(r.skipped).toBe(1);
});
