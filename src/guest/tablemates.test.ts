import { expect, it } from 'vitest';
import { tablemateRows } from './tablemates';

const tm = (id: string, name_en: string) => ({ id, name_en, name_zh: '', seat_no: 1 });

it('includes everyone in the given (seat) order and marks self', () => {
  const rows = tablemateRows([tm('a', 'Amy'), tm('me', 'Me'), tm('b', 'Ben')], 'me');
  expect(rows.map(r => [r.name_en, r.isSelf])).toEqual([['Amy', false], ['Me', true], ['Ben', false]]);
});
it('returns [] when the guest is alone at the table (nobody else to show)', () => {
  expect(tablemateRows([tm('me', 'Me')], 'me')).toEqual([]);
});
it('still shows others if self is somehow absent from the rows (defensive)', () => {
  expect(tablemateRows([tm('a', 'Amy')], 'me')).toHaveLength(1);
});
