# Guest polish + explicit table mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add activity taglines, an empty-state card, an "At your table" tablemate list, a footer credit, and explicit CSV-grouping→venue-table mapping to the wedding seating app.

**Architecture:** Five mostly-independent changes on branch `feat/guest-polish-table-mapping` (isolated worktree at `/Users/corey/Documents/seating-guest-polish`). Guest-UI touches are vanilla-TS DOM construction; "At your table" adds one `security definer` RPC (guests connect as `anon`, which cannot read `guests` directly); table mapping adds pure remap functions in `matrix.ts` plus host dropdowns. Ships as one PR.

**Tech Stack:** Vanilla TypeScript, Vite, Vitest, Supabase (Postgres RPCs), svg-pan-zoom.

## Global Constraints

- Vanilla TS only — no new frameworks/deps.
- No silent failures **except** where spec-documented (tablemate fetch, decorative map labels).
- All user/CSV-derived strings render via `textContent`/DOM APIs, never `innerHTML` (XSS hardening).
- Bilingual: every user-visible string has `en` + `zh`; guest UI renders one locale at a time.
- Migration is **`0005_table_guests.sql`** (not `0004` — concurrent `feature/import-override` claims `0004`).
- Postgres RPC pattern: `security definer set search_path = public, extensions`; `revoke execute … from public`; explicit `grant` to intended roles.
- Run tests with `npm test` (vitest); type-check with `npm run check` (tsc --noEmit).
- Commit after each task.

---

### Task 1: Empty-state copy + card (Part B)

**Files:**
- Modify: `src/guest/i18n.ts` (the `emptyState` entry in `STRINGS`)
- Modify: `src/styles.css` (`.empty` rule, line ~30)
- Test: `src/guest/i18n.test.ts`

**Interfaces:**
- Consumes: existing `t()` / `STRINGS`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test** — append to `src/guest/i18n.test.ts`:

```ts
it('empty-state copy points guests to the planner (both locales)', () => {
  expect(t('emptyState')).toBe("Can't find your name? Ask our planner.");
  setLocale('zh');
  expect(t('emptyState')).toBe('找不到您的名字？请咨询我们的策划师。');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- i18n`
Expected: FAIL — `emptyState` still says "Ask at the welcome table."

- [ ] **Step 3: Update the copy** — in `src/guest/i18n.ts`, replace the `emptyState` line:

```ts
  emptyState: { en: "Can't find your name? Ask our planner.", zh: '找不到您的名字？请咨询我们的策划师。' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- i18n`
Expected: PASS

- [ ] **Step 5: Give `.empty` a card background** — in `src/styles.css`, replace the `.empty` rule:

```css
.empty { color: var(--muted); text-align: center; padding: 12px 16px;
  background: #fff; border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow); }
```

- [ ] **Step 6: Type-check + commit**

```bash
npm run check
git add src/guest/i18n.ts src/guest/i18n.test.ts src/styles.css
git commit -m "feat: planner empty-state copy + floating card (Part B)"
```

---

### Task 2: Activity taglines (Part A)

**Files:**
- Modify: `src/guest/amenities.ts` (`Amenity` interface + `AMENITIES` data)
- Modify: `src/guest/main.ts` (`showAmenity`, ~line 81)
- Test: `src/guest/amenities.test.ts`

**Interfaces:**
- Consumes: existing `Amenity`, `getLocale()`.
- Produces: `Amenity.tagline?: { en: string; zh: string }`.

- [ ] **Step 1: Write the failing test** — append to `src/guest/amenities.test.ts`:

```ts
it('taglines: five amenities carry bilingual taglines, ceremony/restroom do not', () => {
  const withTag = ['bar', 'welcome_table', 'guest_artist', 'gift_table', 'dj'];
  for (const id of withTag) {
    const a = AMENITIES.find(x => x.id === id)!;
    expect(a.tagline?.en?.length).toBeGreaterThan(0);
    expect(a.tagline?.zh?.length).toBeGreaterThan(0);
  }
  expect(AMENITIES.find(x => x.id === 'ceremony_seating')!.tagline).toBeUndefined();
  expect(AMENITIES.find(x => x.id === 'restroom')!.tagline).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- amenities`
Expected: FAIL — `tagline` undefined on all amenities.

- [ ] **Step 3: Add the field + copy** — in `src/guest/amenities.ts`, add to the interface:

```ts
export interface Amenity {
  id: string;
  emoji: string;
  name: { en: string; zh: string };
  keywords: { en: string[]; zh: string[] };
  tagline?: { en: string; zh: string };
}
```

Then add a `tagline` to the five amenities (leave `ceremony_seating` and `restroom` untouched):

```ts
// bar
    tagline: { en: 'Open bar all night — try our signature cocktail', zh: '全场畅饮，来尝尝我们的招牌鸡尾酒' },
// welcome_table
    tagline: { en: 'Get your photo taken and sign the guest book', zh: '拍张合影，在留言簿上签名留言' },
// guest_artist
    tagline: { en: 'Get painted live by our guest artist', zh: '让驻场艺术家为您现场作画' },
// gift_table
    tagline: { en: 'Leave any gifts here', zh: '礼物请放在这里' },
// dj
    tagline: { en: 'Taking requests all night', zh: '全程欢迎点歌' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- amenities`
Expected: PASS

- [ ] **Step 5: Render the tagline** — in `src/guest/main.ts`, replace `showAmenity`'s banner line. Current:

```ts
  banner.textContent = `${a.emoji} ${a.name[getLocale()]}`;
```

Replace with element construction (a `<strong>` name — serif via `.banner strong`; a `<small>` tagline — gold via `.banner small`):

```ts
  const title = document.createElement('strong');
  title.textContent = `${a.emoji} ${a.name[getLocale()]}`;
  banner.replaceChildren(title);
  if (a.tagline) {
    const tag = document.createElement('small');
    tag.textContent = a.tagline[getLocale()];
    banner.append(document.createElement('br'), tag);
  }
```

- [ ] **Step 6: Type-check + commit**

```bash
npm run check
git add src/guest/amenities.ts src/guest/amenities.test.ts src/guest/main.ts
git commit -m "feat: activity taglines (Part A)"
```

---

### Task 3: Footer credit (Part E)

**Files:**
- Modify: `src/guest/i18n.ts` (`credits` in `STRINGS`)
- Modify: `index.html` (footer element)
- Modify: `src/guest/main.ts` (`renderCredits`, called from `renderStatics`)
- Modify: `src/styles.css` (`.credits`)
- Test: `src/guest/i18n.test.ts`

**Interfaces:**
- Consumes: `t()`, `renderStatics()`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test** — append to `src/guest/i18n.test.ts`:

```ts
it('credits key exists in both locales and contains a heart', () => {
  expect(t('credits')).toContain('♥');
  expect(t('credits')).toContain('Lindsey Tam');
  setLocale('zh');
  expect(t('credits')).toContain('♥');
  expect(t('credits')).toContain('Corey Hu');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- i18n`
Expected: FAIL — `credits` is not a key of `STRINGS` (also a tsc error; the test asserts at runtime).

- [ ] **Step 3: Add the string** — in `src/guest/i18n.ts`, add to `STRINGS`:

```ts
  credits: { en: 'Made with ♥ by Lindsey Tam & Corey Hu', zh: 'Lindsey Tam 与 Corey Hu 用 ♥ 制作' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- i18n`
Expected: PASS

- [ ] **Step 5: Add the footer element** — in `index.html`, add as the last child of `<main>` (after the `.overlay` div, before `</main>`):

```html
    <footer id="credits" class="credits" aria-label="credit"></footer>
```

- [ ] **Step 6: Render it (locale-aware, colored heart)** — in `src/guest/main.ts`, add a `renderCredits` function and call it from `renderStatics`. Splitting on the `♥` glyph is locale-agnostic (both strings contain exactly one), so the heart can be colored without hard-coding sentence structure:

```ts
function renderCredits(): void {
  const el = document.querySelector('#credits')!;
  const [before, after] = t('credits').split('♥');
  const heart = document.createElement('span');
  heart.className = 'heart';
  heart.textContent = '♥';
  el.replaceChildren(before ?? '', heart, after ?? '');
}
```

Add `renderCredits();` to the end of `renderStatics()`:

```ts
function renderStatics(): void {
  document.querySelector('.topbar h1')!.lastChild!.textContent = t('title');
  input.placeholder = t('placeholder');
  langToggle.textContent = t('toggle');
  renderTableLabels();
  renderLandmarkLabels();
  renderChips();
  renderCredits();
}
```

- [ ] **Step 7: Style the footer** — in `src/styles.css`, append:

```css
.credits { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%);
  z-index: 8; pointer-events: none; font-family: var(--serif); font-size: 12px;
  color: var(--muted); background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px;
  box-shadow: var(--shadow); white-space: nowrap; max-width: calc(100vw - 24px); }
.credits .heart { color: var(--highlight); }
```

- [ ] **Step 8: Type-check + commit**

```bash
npm run check
git add src/guest/i18n.ts src/guest/i18n.test.ts index.html src/guest/main.ts src/styles.css
git commit -m "feat: footer credit with colored heart (Part E)"
```

---

### Task 4: `table_guests` RPC + smoke assertions (Part C — DB)

**Files:**
- Create: `supabase/migrations/0005_table_guests.sql`
- Modify: `supabase/smoke.sql` (add grant + behavior assertions)

**Interfaces:**
- Produces: RPC `table_guests(p_guest_id uuid) → (id uuid, name_en text, name_zh text, seat_no int)`, granted to `anon` + `authenticated`.

- [ ] **Step 1: Write the migration** — create `supabase/migrations/0005_table_guests.sql`:

```sql
-- Tablemates for the guest UI's "At your table" list. Keyed by guest id (not
-- table_no) so a roster is only reachable after a name search returns that id —
-- preserving the "anon cannot enumerate the whole guest list" posture that
-- search_guests() establishes. anon has no direct SELECT on guests, hence
-- security definer.
create or replace function table_guests(p_guest_id uuid)
returns table (id uuid, name_en text, name_zh text, seat_no int)
language plpgsql security definer set search_path = public, extensions as $$
declare v_table int;
begin
  select g.table_no into v_table from guests g where g.id = p_guest_id;
  if v_table is null then return; end if;   -- unknown or unseated guest → no rows
  return query
    select g.id, g.name_en, g.name_zh, g.seat_no
    from guests g
    where g.table_no = v_table
    order by g.seat_no;
end $$;

revoke execute on function table_guests(uuid) from public;
grant execute on function table_guests(uuid) to anon, authenticated;
```

- [ ] **Step 2: Add behavior assertions to `supabase/smoke.sql`** — insert this block immediately AFTER the `search_guests` `do $$ … end $$;` block (around line 16), while seed state is still intact (table 1 = Carol Zhao, Kevin Hu, Eric Dang, James Dang):

```sql
do $$
declare cnt int; tiger uuid;
begin
  cnt := (select count(*) from table_guests((select id from guests where name_en = 'Carol Zhao')));
  assert cnt = 4, 'table_guests returns all 4 seated at table 1';
  select id into tiger from guests where name_en = 'Tiger Chen';  -- unseated in seed
  cnt := (select count(*) from table_guests(tiger));
  assert cnt = 0, 'table_guests returns none for an unseated guest';
end $$;
```

- [ ] **Step 3: Add grant assertions** — inside the existing `has_function_privilege` block in `smoke.sql` (the one asserting `search_guests` execute, ~line 90), add:

```sql
  assert has_function_privilege('anon', 'table_guests(uuid)', 'execute'),
    'anon can execute table_guests';
  assert has_function_privilege('authenticated', 'table_guests(uuid)', 'execute'),
    'authenticated can execute table_guests';
```

- [ ] **Step 4: Verify** — if a local Supabase is available:

Run: `supabase db reset && psql "$DATABASE_URL" -f supabase/smoke.sql`
Expected: `SMOKE OK`
If no local Supabase (hosted deploy pending), the assertions stand as the spec; verification happens when the migration is applied (see deploy note). Do NOT block the plan on this.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_table_guests.sql supabase/smoke.sql
git commit -m "feat: table_guests RPC for At-your-table + smoke assertions (Part C db)"
```

---

### Task 5: "At your table" client render (Part C — client)

**Files:**
- Modify: `src/shared/types.ts` (`Tablemate`)
- Modify: `src/shared/api.ts` (`tableGuests`)
- Modify: `src/guest/i18n.ts` (`atYourTable`, `you`)
- Create: `src/guest/tablemates.ts` (pure `tablemateRows` helper)
- Create: `src/guest/tablemates.test.ts`
- Modify: `src/guest/main.ts` (`displayName` generalized, `showGuest`, `renderTablemates`, `loadTablemates`, generation counter + cache)
- Modify: `src/styles.css` (`.tablemates`)
- Test: `src/guest/i18n.test.ts`, `src/guest/tablemates.test.ts`

**Interfaces:**
- Consumes: RPC `table_guests` (Task 4); `GuestMatch`, `seatKey`, `displayName`, `t`.
- Produces: `Tablemate`; `tableGuests(guestId): Promise<Tablemate[]>`; `tablemateRows(rows: Tablemate[], selfId: string): TablemateRow[]` where `TablemateRow = { name_en: string; name_zh: string; isSelf: boolean }` (returns `[]` when the guest is alone).

- [ ] **Step 1: Write the failing test** (i18n keys) — append to `src/guest/i18n.test.ts`:

```ts
it('at-your-table keys exist in both locales', () => {
  expect(t('atYourTable')).toBe('At your table');
  expect(t('you')).toBe('You');
  setLocale('zh');
  expect(t('atYourTable')).toBe('同桌宾客');
  expect(t('you')).toBe('您');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- i18n`
Expected: FAIL — keys not defined.

- [ ] **Step 3: Add the i18n keys** — in `src/guest/i18n.ts` `STRINGS`:

```ts
  atYourTable: { en: 'At your table', zh: '同桌宾客' },
  you: { en: 'You', zh: '您' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- i18n`
Expected: PASS

- [ ] **Step 4a: Write the failing test for the pure helper** — create `src/guest/tablemates.test.ts` (this is the branchy logic — self-marking, solo-skip — that has no DOM harness, so unit-test it purely):

```ts
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
```

- [ ] **Step 4b: Run test to verify it fails**

Run: `npm test -- tablemates`
Expected: FAIL — `./tablemates` module not found.

- [ ] **Step 4c: Implement the pure helper** — create `src/guest/tablemates.ts`:

```ts
import type { Tablemate } from '../shared/types';

export interface TablemateRow { name_en: string; name_zh: string; isSelf: boolean; }

// Display rows for "At your table", preserving the RPC's seat order. Returns []
// when there is nobody else at the table (the section is then skipped).
export function tablemateRows(rows: Tablemate[], selfId: string): TablemateRow[] {
  if (rows.filter(r => r.id !== selfId).length === 0) return [];
  return rows.map(r => ({ name_en: r.name_en, name_zh: r.name_zh, isSelf: r.id === selfId }));
}
```

- [ ] **Step 4d: Run test to verify it passes**

Run: `npm test -- tablemates`
Expected: PASS

- [ ] **Step 5: Add the `Tablemate` type** — in `src/shared/types.ts`:

```ts
export interface Tablemate { id: string; name_en: string; name_zh: string; seat_no: number | null; }
```

- [ ] **Step 6: Add the API call** — in `src/shared/api.ts`, add `Tablemate` to the type import and add:

```ts
export const tableGuests = async (guestId: string): Promise<Tablemate[]> =>
  unwrap(await supabase.rpc('table_guests', { p_guest_id: guestId })) ?? [];
```

- [ ] **Step 7: Wire the render into `showGuest`** — in `src/guest/main.ts`:

Generalize `displayName` so it also accepts a `Tablemate`:

```ts
const displayName = (g: { name_en: string; name_zh: string }) => [g.name_en, g.name_zh].filter(Boolean).join(' · ');
```

Extend the existing import lines and add the helper import (do NOT duplicate the `../shared/api` or `../shared/types` specifiers). Change lines 2 and 6, and add one new import for the pure helper:

```ts
// was: import { searchGuests, listTables } from '../shared/api';
import { searchGuests, listTables, tableGuests } from '../shared/api';
// was: import { seatKey, type GuestMatch, type TableInfo } from '../shared/types';
import { seatKey, type GuestMatch, type TableInfo, type Tablemate } from '../shared/types';
// new import line:
import { tablemateRows } from './tablemates';
```

Add a module-level cache **and a generation counter** near the other `let` declarations (after `let lastShown`). The counter — the same pattern as the search input's `token` — is what prevents a double-render when the SAME guest object is shown twice (e.g. a double-tapped result card): an identity check (`lastShown !== g`) would let both in-flight fetches append the list:

```ts
let lastTablemates: Tablemate[] | null = null;
let tablematesGen = 0;
```

Add the two helpers. `renderTablemates` delegates the self-marking / solo-skip decision to the pure, tested `tablemateRows`:

```ts
function renderTablemates(rows: Tablemate[], selfId: string): void {
  const list = tablemateRows(rows, selfId);
  if (list.length === 0) return; // solo at table → skip the section
  const section = document.createElement('div');
  section.className = 'tablemates';
  const head = document.createElement('small');
  head.className = 'tablemates-head';
  head.textContent = t('atYourTable');
  const ul = document.createElement('ul');
  for (const r of list) {
    const item = document.createElement('li');
    if (r.isSelf) {
      const me = document.createElement('strong');
      me.textContent = `${displayName(r)} · ${t('you')}`;
      item.append(me);
    } else {
      item.textContent = displayName(r);
    }
    ul.append(item);
  }
  section.append(head, ul);
  banner.append(section);
}

async function loadTablemates(g: GuestMatch, gen: number): Promise<void> {
  try {
    const rows = await tableGuests(g.id);
    if (gen !== tablematesGen) return;       // superseded OR same-guest re-entry
    lastTablemates = rows;
    renderTablemates(rows, g.id);
  } catch { /* supplementary — the seat already rendered; skip silently (spec) */ }
}
```

In `showGuest`, after `fp.highlight(key);`, replace the `if (!opts.resurface) { … }` block with:

```ts
  fp.highlight(key);
  if (opts.resurface) {
    if (lastTablemates) renderTablemates(lastTablemates, g.id); // locale toggle: no refetch
  } else {
    fp.zoomToSeat(key);
    burstPetals(mapEl);
    lastTablemates = null;
    void loadTablemates(g, ++tablematesGen);
  }
```

- [ ] **Step 8: Style the section** — in `src/styles.css`, append:

```css
.tablemates { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
.tablemates .tablemates-head { display: block; color: var(--gold); margin-bottom: 4px; }
.tablemates ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.tablemates li { font-size: 15px; color: var(--ink); }
.tablemates strong { font-family: var(--serif); color: var(--accent-deep); }
```

- [ ] **Step 9: Type-check + run existing tests**

Run: `npm run check && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/shared/api.ts src/guest/i18n.ts src/guest/i18n.test.ts src/guest/tablemates.ts src/guest/tablemates.test.ts src/guest/main.ts src/styles.css
git commit -m "feat: At-your-table tablemate list in the guest banner (Part C client)"
```

---

### Task 6: Table-mapping remap functions (Part D1)

**Files:**
- Modify: `src/logic/matrix.ts` (add `remapColumnsToTables`, `defaultMapping`)
- Test: `src/logic/matrix.test.ts`

**Interfaces:**
- Consumes: `MatrixResult`, `MatrixTable`, `MatrixGuest` (existing).
- Produces:
  - `remapColumnsToTables(r: MatrixResult, mapping: number[]): MatrixResult` — `mapping[c]` = venue table number for column index `c` (0-based); parse assigns column `c` the provisional `table_no = c+1`.
  - `defaultMapping(tables: MatrixTable[], existing: { table_no: number; label_en: string; label_zh: string }[]): number[]` — always returns a permutation of 1..12.

- [ ] **Step 1: Write the failing tests** — append to `src/logic/matrix.test.ts`:

```ts
import { parseSeatingMatrix, remapColumnsToTables, defaultMapping } from './matrix';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- matrix`
Expected: FAIL — `remapColumnsToTables`/`defaultMapping` not exported.

- [ ] **Step 3: Implement both functions** — append to `src/logic/matrix.ts`:

```ts
// mapping[c] = venue table number (1..12) for column index c (0-based).
// parseSeatingMatrix assigns column c the provisional table_no = c+1, so a table
// with provisional number k came from column k-1 and maps to mapping[k-1].
// seat_no is within-column ordering and is left untouched. Identity mapping
// [1..12] reproduces the positional output exactly.
export function remapColumnsToTables(r: MatrixResult, mapping: number[]): MatrixResult {
  const valid = mapping.length === 12
    && mapping.every(n => Number.isInteger(n) && n >= 1 && n <= 12)
    && new Set(mapping).size === 12;
  if (!valid) {
    return { ...r, errors: [...r.errors, `invalid table mapping: expected a permutation of 1–12, got [${mapping.join(', ')}]`] };
  }
  const to = (provisional: number): number => mapping[provisional - 1]!;
  return {
    errors: r.errors,
    tables: r.tables.map(t => ({ ...t, table_no: to(t.table_no) })),
    guests: r.guests.map(g => ({ ...g, table_no: to(g.table_no) })),
  };
}

// Default dropdown values: prefer the venue table each group already occupies
// (matched by current label), else fill with the lowest unused number. ALWAYS
// returns a permutation of 1..12. First import (labels still "Table N") → identity.
export function defaultMapping(
  tables: MatrixTable[],
  existing: { table_no: number; label_en: string; label_zh: string }[],
): number[] {
  const normEn = (s: string): string => s.trim().toLowerCase();
  const byEn = new Map<string, number>();
  const byZh = new Map<string, number>();
  for (const e of existing) {
    if (e.label_en.trim()) byEn.set(normEn(e.label_en), e.table_no);
    if (e.label_zh.trim()) byZh.set(e.label_zh.trim(), e.table_no);
  }
  const used = new Set<number>();
  const result: (number | null)[] = tables.map(() => null);
  tables.forEach((t, i) => {
    const match = (t.label_en.trim() ? byEn.get(normEn(t.label_en)) : undefined)
      ?? (t.label_zh.trim() ? byZh.get(t.label_zh.trim()) : undefined);
    if (match !== undefined && !used.has(match)) { result[i] = match; used.add(match); }
  });
  let next = 1;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === null) {
      while (used.has(next)) next++;
      result[i] = next; used.add(next);
    }
  }
  return result as number[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- matrix`
Expected: PASS (all remap + defaultMapping cases).

- [ ] **Step 5: Commit**

```bash
git add src/logic/matrix.ts src/logic/matrix.test.ts
git commit -m "feat: pure column→venue-table remap + defaultMapping (Part D1)"
```

---

### Task 7: Host import mapping UI (Part D2)

**Files:**
- Modify: `src/host/import.ts` (dropdowns, current-tables fetch, remap on import)

**Interfaces:**
- Consumes: `remapColumnsToTables`, `defaultMapping` (Task 6); `listTables` (existing api); `MatrixTable`, `MatrixGuest`.
- Produces: nothing for later tasks (terminal UI wiring).

**Design notes:** The mapping `<select>`s are rebuilt only when the parsed group labels change (a signature check), so editing seat names below the header doesn't discard the user's dropdown choices. Each option text is `"{n} — {current label}"` so numbers stay tied to physical tables on re-import (when the map shows animal names). Duplicate selections → error in the existing `.import-errors` list + Import disabled.

- [ ] **Step 1: Rewrite `src/host/import.ts`** with the mapping UI. Full new file:

```ts
import { importSeating, listGuests, listTables } from '../shared/api';
import { toast } from '../shared/toast';
import { parseSeatingMatrix, remapColumnsToTables, defaultMapping, type MatrixGuest, type MatrixTable } from '../logic/matrix';
import type { Guest, TableInfo } from '../shared/types';

const identity = (g: { name_en: string; name_zh: string }) => `${g.name_en}|${g.name_zh}`;

export function mountImport(el: HTMLElement, onDone: () => void): void {
  el.innerHTML = `
    <p>Paste the whole seating sheet as CSV — row 1 = group names, columns = tables, rows = seats. Then choose which venue table each group sits at.</p>
    <textarea id="csv" rows="6" placeholder="Peacock / 孔雀,Owl,Kangaroo,..."></textarea>
    <ul class="import-errors"></ul>
    <div id="csv-mapping" class="csv-mapping"></div>
    <div id="csv-preview"></div>
    <button id="csv-go" disabled>Import</button>`;
  const ta = el.querySelector<HTMLTextAreaElement>('#csv')!;
  const errorsEl = el.querySelector<HTMLUListElement>('.import-errors')!;
  const mappingEl = el.querySelector<HTMLElement>('#csv-mapping')!;
  const preview = el.querySelector<HTMLElement>('#csv-preview')!;
  const go = el.querySelector<HTMLButtonElement>('#csv-go')!;

  let tables: MatrixTable[] = [];
  let guests: MatrixGuest[] = [];
  let mapping: number[] = [];
  let mappingSig = '';           // signature of the rendered group labels

  let existingPromise: Promise<Guest[]> | null = null;
  const getExisting = (): Promise<Guest[]> => (existingPromise ??= listGuests());
  let tablesPromise: Promise<TableInfo[]> | null = null;
  const getTables = (): Promise<TableInfo[]> => (tablesPromise ??= listTables());

  let token = 0;
  ta.addEventListener('input', () => { void onInput(); });

  // Rebuild the per-group <select>s (only when group labels change, to preserve
  // the user's picks while they edit seat rows). Each option is "{n} — {label}".
  function renderMapping(current: TableInfo[]): void {
    mappingEl.replaceChildren();
    mapping.forEach((chosen, col) => {
      const row = document.createElement('label');
      row.className = 'map-row';
      const name = document.createElement('span');
      name.textContent = tables[col]!.label_en || `Column ${col + 1}`;
      const sel = document.createElement('select');
      for (let n = 1; n <= 12; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        const lbl = current.find(c => c.table_no === n)?.label_en ?? `Table ${n}`;
        opt.textContent = `${n} — ${lbl}`;
        if (n === chosen) opt.selected = true;
        sel.append(opt);
      }
      sel.addEventListener('change', () => { mapping[col] = Number(sel.value); revalidate(); });
      row.append(name, sel);
      mappingEl.append(row);
    });
  }

  // Uniqueness check + preview refresh; no reparse.
  function revalidate(): void {
    if (new Set(mapping).size !== mapping.length) {
      errorsEl.replaceChildren(li('Each venue table can be used once — two groups map to the same table.'));
      go.disabled = true;
      return;
    }
    errorsEl.replaceChildren();
    void refreshPreview();
  }

  const li = (msg: string): HTMLLIElement => { const el2 = document.createElement('li'); el2.textContent = msg; return el2; };

  async function refreshPreview(): Promise<void> {
    const mine = ++token;
    let existing: Guest[];
    try { existing = await getExisting(); }
    catch (e) {
      if (mine !== token) return;
      preview.textContent = ''; go.disabled = true;
      return toast(e instanceof Error ? e.message : 'Could not load current guest list');
    }
    if (mine !== token) return;
    const existingIds = new Set(existing.map(identity));
    const sheetIds = new Set(guests.map(identity));
    const newCount = guests.filter(g => !existingIds.has(identity(g))).length;
    const willUnseat = existing.filter(g => g.table_no != null && !sheetIds.has(identity(g))).length;
    preview.textContent = `${guests.length} guests across 12 tables · ${newCount} new · ${willUnseat} will become unseated · seated per your table mapping`;
    go.disabled = false;
  }

  async function onInput(): Promise<void> {
    const r = parseSeatingMatrix(ta.value);
    tables = r.tables;
    guests = r.guests;
    if (r.errors.length) {
      errorsEl.replaceChildren(...r.errors.map(li));
      mappingEl.replaceChildren(); mappingSig = '';
      preview.textContent = ''; go.disabled = true;
      return;
    }
    errorsEl.replaceChildren();
    const sig = JSON.stringify(tables.map(t => [t.label_en, t.label_zh]));
    if (sig !== mappingSig) {
      let current: TableInfo[] = [];
      try { current = await getTables(); } catch { /* labels are a hint only; fall back to numbers */ }
      mapping = defaultMapping(tables, current.length ? current : tables.map(t => ({ table_no: t.table_no, label_en: `Table ${t.table_no}`, label_zh: `${t.table_no}号桌` })));
      mappingSig = sig;
      renderMapping(current);
    }
    revalidate();
  }

  go.addEventListener('click', async () => {
    const remapped = remapColumnsToTables({ tables, guests, errors: [] }, mapping);
    if (remapped.errors.length) { errorsEl.replaceChildren(...remapped.errors.map(li)); go.disabled = true; return; }
    try {
      const res = await importSeating({ tables: remapped.tables, guests: remapped.guests });
      existingPromise = null; tablesPromise = null; mappingSig = '';
      toast(`Imported ${res.imported} seats (${res.new} new guests, ${res.unseated} unseated)`);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed'); }
  });
}
```

- [ ] **Step 2: Style the mapping rows** — in `src/styles.css`, append:

```css
.csv-mapping { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.csv-mapping .map-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; }
.csv-mapping select { padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; }
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: tsc clean. (Confirms `TableInfo`, `remapColumnsToTables`, `defaultMapping`, `listTables` all line up.)

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all pass (matrix tests from Task 6 cover the remap logic this UI drives).

- [ ] **Step 5: Commit**

```bash
git add src/host/import.ts src/styles.css
git commit -m "feat: host import table-mapping dropdowns + remap on import (Part D2)"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check + full unit suite**

Run: `npm run check && npm test`
Expected: tsc clean; all tests green (baseline was 69; this plan adds ~7 tests).

- [ ] **Step 2: Existing e2e still green**

Run: `npm run e2e`
Expected: passes (guest search, amenity zoom, host import all still work). If the e2e harness needs a running dev server / Supabase, follow `docs/deploy-runbook.md`.

- [ ] **Step 3: Manual guest-flow check** (use the `/run` skill or `npm run dev`):
  - Tap an activity chip (e.g. Bar) → banner shows name + tagline; toggle 中文 → tagline localizes.
  - Search a nonexistent name → empty-state card ("Ask our planner") reads as a floating card, not blended into the map.
  - Search a seated guest → banner shows seat AND an "At your table" list with your name marked; toggle language → list re-renders (no refetch flicker); the footer credit shows with a colored heart and doesn't block map panning.
  - (At-your-table shows real data only after migration `0005` is applied — see deploy note.)

- [ ] **Step 4: Manual host mapping check:**
  - Open host page, expand "Import guests (CSV)", paste a 12-column sheet.
  - Mapping dropdowns appear, each `"{n} — {label}"`; set two to the same number → error + Import disabled; fix → enabled.
  - Import; confirm on the map that a remapped group lights up at the chosen venue table.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A && git commit -m "test: e2e + manual verification pass for guest polish + table mapping"
```

---

## Deploy note (carry into the PR description)

**Migration `0005_table_guests.sql` must be applied to the live Supabase** (`supabase db push`, or paste into the SQL editor) or "At your table" returns nothing — `anon` cannot read `guests` without the new function. Everything else (A, B, D, E) ships on merge.

## Coordination note (carry into the PR description)

Concurrent branch `feature/import-override` also edits `src/host/import.ts` and adds `0004_import_override.sql`. Migration numbers don't collide (mine is `0005`). The `import.ts` overlap (their deletion-count preview + delete-absent semantics vs. this branch's mapping dropdowns) is a normal merge — whichever lands first, the other rebases.
