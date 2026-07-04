import { describe, expect, it } from 'vitest';
import { candidatesFromSyllables, ROMANIZATION_VARIANTS } from './pinyin-bridge';

describe('candidatesFromSyllables', () => {
  it('orders candidates: given-first rotation, original, capped and deduped', () => {
    const c = candidatesFromSyllables(['hu', 'xiang', 'ping']); // 胡向平
    expect(c[0]).toBe('xiangpinghu');   // Xiang Ping Hu — the actual sheet form
    expect(c).toContain('huxiangping');
    expect(c.length).toBeLessThanOrEqual(8);
    expect(new Set(c).size).toBe(c.length);
  });
  it('expands romanization variants one syllable at a time', () => {
    expect(candidatesFromSyllables(['xiao', 'ming'])).toContain('minghsiao'); // 萧 family → Hsiao
    expect(candidatesFromSyllables(['tan', 'da', 'wei'])).toContain('daweitam'); // 谭 → Tam
  });
  it('adds the two-syllable-surname rotation for 4+ chars', () => {
    expect(candidatesFromSyllables(['ou', 'yang', 'jia', 'ming'])).toContain('jiamingouyang');
  });
  it('drops candidates shorter than 2 chars and handles single syllables', () => {
    expect(candidatesFromSyllables(['wu'])).toEqual(expect.arrayContaining(['wu', 'ng']));
    expect(candidatesFromSyllables([])).toEqual([]);
  });
});
it('variant map stays curated (spot keys)', () => {
  for (const k of ['xiao', 'tan', 'gao', 'zeng', 'cai', 'zhang', 'wang', 'liu', 'lin', 'xie'])
    expect(ROMANIZATION_VARIANTS[k]).toBeDefined();
});
