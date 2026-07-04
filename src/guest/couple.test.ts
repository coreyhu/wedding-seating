import { expect, it } from 'vitest';
import { COUPLE, matchesCouple } from './couple';
import { prepareQuery } from '../logic/search';

it('every partner has a non-empty English name (ship guard)', () => {
  for (const p of COUPLE.partners) expect(p.name_en.trim().length).toBeGreaterThan(0);
});
it('matches exact normalized English names only', () => {
  expect(matchesCouple(prepareQuery('Corey Hu'))).toBe(true);
  expect(matchesCouple(prepareQuery('  corey  HU '))).toBe(true);
  expect(matchesCouple(prepareQuery('lindsey tam'))).toBe(true);
  expect(matchesCouple(prepareQuery('corey'))).toBe(false);       // partial: someone's real search
  expect(matchesCouple(prepareQuery('corey human'))).toBe(false); // superstring
});
it('empty Chinese names never match; too-short never matches', () => {
  expect(matchesCouple(prepareQuery('刘'))).toBe(false);
  expect(matchesCouple({ kind: 'too-short' })).toBe(false);
});
