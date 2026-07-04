import { describe, expect, it } from 'vitest';
import { hasCjk, normalizeEn, prepareQuery, rankMatches } from './search';
import type { GuestMatch } from '../shared/types';

const g = (name_en: string, name_zh = ''): GuestMatch =>
  ({ id: name_en + name_zh, name_en, name_zh, table_no: 1, seat_no: 1, label_en: 'Table 1', label_zh: '1号桌' });

it('normalizeEn lowers, strips spaces and diacritics', () => {
  expect(normalizeEn('  José  GARCÍA ')).toBe('josegarcia');
});
it('hasCjk detects characters', () => {
  expect(hasCjk('刘')).toBe(true);
  expect(hasCjk('liu')).toBe(false);
});

describe('prepareQuery (Corey)', () => {
  it('single CJK char is enough', () => expect(prepareQuery('刘')).toEqual({ kind: 'zh', q: '刘' }));
  it('CJK wins for mixed input', () => expect(prepareQuery('liu 刘')).toEqual({ kind: 'zh', q: 'liu刘' }));
  it('short latin is rejected', () => expect(prepareQuery(' e ')).toEqual({ kind: 'too-short' }));
  it('latin is normalized', () => expect(prepareQuery('José G')).toEqual({ kind: 'en', q: 'joseg' }));
  it('empty is too short', () => expect(prepareQuery('   ')).toEqual({ kind: 'too-short' }));
});

describe('rankMatches (Corey)', () => {
  it('exact beats prefix beats substring', () => {
    const m = [g('Christina Wang'), g('Chris Wang'), g('Wang Christopher')];
    expect(rankMatches({ kind: 'en', q: 'chriswang' }, m).map(x => x.name_en))
      .toEqual(['Chris Wang', 'Christina Wang', 'Wang Christopher']);
    // 'chriswang': exact for Chris Wang; prefix of 'christinawang'; substring? not of
    // 'wangchristopher' — server fuzz may return it; it must sort last, not vanish.
  });
  it('zh ranking mirrors en using name_zh', () => {
    const m = [g('', '刘艾瑞'), g('', '艾瑞刘'), g('', '小刘艾瑞拉')];
    expect(rankMatches({ kind: 'zh', q: '刘艾瑞' }, m).map(x => x.name_zh))
      .toEqual(['刘艾瑞', '小刘艾瑞拉', '艾瑞刘']);
    // exact first; then the one containing the full query; the reordered name last
  });
  it('never drops server results', () => {
    const m = [g('Aunt Fuzzy')];
    expect(rankMatches({ kind: 'en', q: 'antfuzzy' }, m)).toHaveLength(1);
  });
});
