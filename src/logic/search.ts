import type { GuestMatch } from '../shared/types';

export type PreparedQuery = { kind: 'en' | 'zh'; q: string } | { kind: 'too-short' };

export const normalizeEn = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');

export const hasCjk = (s: string): boolean => /[一-鿿]/.test(s);

/**
 * Classify raw input.
 * Any CJK char present → {kind:'zh', q: input minus whitespace} (≥1 CJK char is enough).
 * Otherwise normalizeEn it → need ≥2 chars, else {kind:'too-short'}.
 */
export function prepareQuery(raw: string): PreparedQuery {
  if (hasCjk(raw)) return { kind: 'zh', q: raw.replace(/\s+/g, '') };
  const q = normalizeEn(raw);
  return q.length >= 2 ? { kind: 'en', q } : { kind: 'too-short' };
}

/** exact < starts-with < contains < anything else, as an ascending sort key. */
const tierOf = (name: string, q: string): number =>
  name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3;

/**
 * Order server matches for display.
 * Score each guest's relevant name (name_en normalized for 'en', name_zh
 * whitespace-stripped for 'zh'): exact match < starts-with < contains < anything
 * else the server sent (fuzzy) — ascending score, stable within ties.
 * Never filter anything out: the server already decided what matches.
 */
export function rankMatches(p: PreparedQuery, matches: GuestMatch[]): GuestMatch[] {
  if (p.kind === 'too-short') return matches;
  const relevantName = (m: GuestMatch): string =>
    p.kind === 'en' ? normalizeEn(m.name_en) : m.name_zh.replace(/\s+/g, '');
  return [...matches].sort((a, b) => tierOf(relevantName(a), p.q) - tierOf(relevantName(b), p.q));
}
