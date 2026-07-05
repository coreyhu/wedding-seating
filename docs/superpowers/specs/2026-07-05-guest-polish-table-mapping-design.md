# Guest-facing polish + explicit table mapping — design

Date: 2026-07-05
Branch: `feat/guest-polish-table-mapping`

Four changes, grouped as three low-risk guest-UI touches (A–C) and one
higher-stakes import change (D). D mutates the seating source of truth and is
cleanly separable — it may ship as its own PR.

---

## A. Activity taglines

Give each activity a short tagline shown when a guest taps its chip (or searches
it) and the map zooms to it.

**Data.** Add an optional field to the `Amenity` type in `src/guest/amenities.ts`:

```ts
tagline?: { en: string; zh: string };
```

Copy (Chinese is a first pass — user may correct wording):

| id | English | 中文 |
|---|---|---|
| `bar` | Open bar all night — try our signature cocktail | 全场畅饮，来尝尝我们的招牌鸡尾酒 |
| `welcome_table` | Get your photo taken and sign the guest book | 拍张合影，在留言簿上签名留言 |
| `guest_artist` | Get painted live by our guest artist | 让驻场艺术家为您现场作画 |
| `gift_table` | Leave any gifts here | 礼物请放在这里 |
| `dj` | Taking requests all night | 全程欢迎点歌 |

`ceremony_seating` and `restroom` get no tagline.

**Render.** `showAmenity()` in `src/guest/main.ts` currently does
`banner.textContent = …`, which can't carry a second styled line. Switch it to
element construction mirroring `showGuest()`: a serif name line, then — if a
tagline exists — a `<small>` tagline line (`.banner small` is already styled
gold). No tagline → name only, unchanged.

---

## B. Empty-state text + card

- **Copy.** `emptyState` in `src/guest/i18n.ts`:
  - en: `Can't find your name? Ask our planner.`
  - zh: `找不到您的名字？请咨询我们的策划师。`
- **Card.** `.empty` currently has no background, so it blends into the SVG
  floorplan. Give it the same floating-card treatment as the other panels
  (white background, `--line` border, `--radius`, `--shadow`, padding) so it
  reads as a card. Change is CSS-only in `src/styles.css`.

---

## C. "At your table"

When a **seated** guest is shown, list everyone at their table so they can find
their tablemates.

**Why an RPC (not a client query).** `anon` (the role guests connect as) has no
SELECT on `guests` by design — `0001_init.sql` does `revoke all on guests from
anon`, and guest data is reached only through the `search_guests()` security-
definer RPC. So this needs a new security-definer function granted to `anon`.

**DB — new migration `supabase/migrations/0005_table_guests.sql`** (numbered
`0005`, not `0004`: the concurrent `feature/import-override` branch claims
`0004_import_override.sql`)**:**

```sql
create or replace function table_guests(p_guest_id uuid)
returns table (id uuid, name_en text, name_zh text, seat_no int)
language plpgsql security definer set search_path = public, extensions as $$
declare v_table int;
begin
  select g.table_no into v_table from guests g where g.id = p_guest_id;
  if v_table is null then return; end if;       -- unknown or unseated guest
  return query
    select g.id, g.name_en, g.name_zh, g.seat_no
    from guests g
    where g.table_no = v_table
    order by g.seat_no;
end $$;

revoke execute on function table_guests(uuid) from public;
grant execute on function table_guests(uuid) to anon, authenticated;
```

Keyed by **guest id** (user's choice): a roster is reachable only after a real
name lookup returns that id — no anonymous table-by-table enumeration of the
whole guest list.

**Client.**
- `src/shared/api.ts`: `tableGuests(guestId: string): Promise<Tablemate[]>`
  calling `supabase.rpc('table_guests', { p_guest_id: guestId })`.
- `src/shared/types.ts`: `export interface Tablemate { id: string; name_en:
  string; name_zh: string; seat_no: number | null; }`.
- `src/guest/main.ts` `showGuest()`: after the seat banner renders for a seated
  guest, fetch tablemates and append a section **inside the banner card**:
  heading "At your table" / "同桌宾客", then all names in seat order. The
  current guest's own name is **marked** (bold + "You" / "您"). Names only, no
  seat numbers.

**Behavior details:**
- Result cached per shown guest (module var `lastTablemates`) so the language
  toggle re-renders from cache without a refetch (`showGuest(..., {resurface:
  true})` path).
- If the guest is the only person at the table, the section is skipped.
- Fetch failure fails **silently** — the seat (the critical answer) already
  rendered; tablemates are supplementary. No toast.

**New i18n keys:** `atYourTable` (en `At your table` / zh `同桌宾客`), `you`
(en `You` / zh `您`).

---

## D. Explicit table-grouping → venue-table mapping

**Problem.** The CSV is a matrix: row 1 = animal-group headers, columns =
tables, rows = seats. `parseSeatingMatrix` hard-codes `table_no = c + 1`
(matrix.ts:34) — column 1 is *always* venue table 1. The animal name only sets
the label; it never controls which physical table (fixed SVG position, baked-in
seat coordinates like `7-3`) the group sits at. The user wants to choose that
binding.

**Mechanism (user's choice): assign in the host app after pasting.** After a
clean parse, the import panel shows one dropdown per grouping; the user picks
which venue table number (1–12) each group maps to. Mapping is recovered on
re-import by matching group names against current table labels.

### D1. Pure remap layer (`src/logic/matrix.ts`)

`parseSeatingMatrix` is unchanged — it keeps producing column-ordinal
`table_no = c + 1` and per-column `seat_no`. Add two pure, tested functions:

```ts
// mapping[c] = venue table number (1..12) for column index c
export function remapColumnsToTables(r: MatrixResult, mapping: number[]): MatrixResult
```
- Validates `mapping` is a permutation of 1..12 (length 12, each in range,
  unique). Invalid → returns a `MatrixResult` with an `errors` entry and the
  original tables/guests untouched.
- Valid → returns a new result where every `table.table_no` and
  `guest.table_no` is replaced via `mapping`; `seat_no` is left untouched
  (it is within-column ordering, unaffected by relabeling the table).
- Identity mapping `[1,2,…,12]` reproduces today's positional output exactly
  (regression guard).

```ts
// Choose sensible default dropdown values. ALWAYS returns a permutation of 1..12.
export function defaultMapping(
  tables: MatrixTable[],           // parsed groups (column-ordinal table_no)
  existing: { table_no: number; label_en: string; label_zh: string }[],
): number[]
```
- For each column, if its group name matches an existing table label (trimmed,
  case-insensitive on `label_en`, exact on `label_zh`), prefer that table
  number. Assign matched numbers first; fill any remaining columns with the
  lowest unused numbers. Guarantees a valid permutation even when labels
  partially match or two headers collide onto the same existing label.
- First import: existing labels are the seeded "Table N", nothing matches, so
  this returns identity `[1,…,12]` — backward compatible.

### D2. Host import UI (`src/host/import.ts`)

- Fetch current tables once per paste-session (a `listTables()` promise,
  mirroring the existing `getExisting`/`listGuests` pattern), invalidated after
  a successful import.
- After a clean parse, render a mapping list: for each group, a label and a
  `<select>` with options `1`…`12`. **Each option's text is `"{n} — {current
  label}"`** so the number stays tied to a physical table even on re-import when
  the map shows animal names rather than "Table n". Group names render via
  `textContent` (same XSS hardening as elsewhere).
- Initial values from `defaultMapping`.
- On any change: validate uniqueness. Duplicate assignment → show an error in
  the existing `.import-errors` list and disable Import. (With 12 distinct
  options across 12 selects, "all distinct" ⇔ permutation.)
- Preview line updated to reflect that positions come from the mapping.
- On Import: apply `remapColumnsToTables(result, mapping)` and send the remapped
  `{ tables, guests }` to `importSeating` (unchanged RPC — it upserts labels by
  `table_no` and assigns seats, so the remapped numbers flow through untouched).

### D3. Discovery

The host map is co-visible with the import panel (`host.html` grid: map left,
sidebar+import right) and renders table labels, so the user can read a number
off a dropdown and find that table on the map. First import: map shows
"Table 1…12" matching the numbers. Re-import: the `"n — label"` option text
keeps them aligned when the map shows animal names. No new map-numbering UI
needed.

---

## E. Footer credit

A small signature on the **guest page** (`index.html`), fixed at the bottom
center: "Made with ♥ by Lindsey Tam & Corey Hu".

- Names are English-only in both locales — `couple.ts` records that the couple's
  Chinese names aren't chosen yet, so the same names show for zh; only the
  framing words localize.
- New i18n key `credits` in `src/guest/i18n.ts`:
  - en: `Made with ♥ by Lindsey Tam & Corey Hu`
  - zh: `Lindsey Tam 与 Corey Hu 用 ♥ 制作` (first-pass — user may correct)
- Render: a `<footer>` element (or a div in the overlay) with `pointer-events:
  none` so it never blocks map panning, `z-index` below the toast (toast is 99),
  and a subtle card/pill background so it doesn't blend into the SVG floorplan
  (same lesson as the empty-state card in B). Muted text, ♥ in `--highlight` or
  `--accent`.
- Re-rendered on locale change (added to `renderStatics()`).

---

## Coordination with `feature/import-override` (concurrent branch)

Both branches edit `src/host/import.ts` and add a `0004`/`0005` migration.
Resolved: my migration is `0005` (no clash). The `import.ts` overlap is a
normal merge — their edits (deletion-count in the preview + delete-absent
semantics) and mine (mapping dropdowns + remap in the preview/Import handler)
touch the same `onInput()`/preview/Import region but are logically independent.
Whichever branch merges first, the other rebases. Built in an isolated worktree
so the two efforts don't fight over the shared checkout.

---

## Testing

- **A:** unit test — the five amenities carry taglines with both `en` and `zh`;
  the other two do not. (extends `src/guest/amenities.test.ts`)
- **B:** update any assertion on the old `emptyState` string in
  `src/guest/i18n.test.ts`; assert the new copy + presence of the two new keys.
- **C:** the RPC is exercised in the deploy/e2e path; unit-test the client
  `tableGuests` shape if a Supabase mock exists, else rely on e2e.
- **D (highest-stakes — locked as tested invariants in `matrix.test.ts`):**
  1. Identity mapping `[1..12]` reproduces positional output (regression guard).
  2. A shuffled mapping relabels `table_no`; `seat_no` is preserved.
  3. Invalid mapping (duplicate / out-of-range / wrong length) is rejected
     before import (errors, originals untouched).
  4. `defaultMapping` **always** returns a permutation of 1..12 — including
     partial-label-match and colliding-label cases.
- **E:** unit test — `credits` key present with `en` and `zh`. (i18n.test.ts)

## Deploy dependency (must surface to user)

Change **C requires applying migration `0005` to the live Supabase** (`supabase
db push`, or paste the SQL into the Supabase SQL editor). On merge alone,
"At your table" returns nothing because `anon` can't read `guests` without the
new function. A, B, D, and E are frontend-only (D changes no schema — `table_no`
values just differ) and ship on merge.

## Out of scope / non-goals

- No change to the CSV format itself (mapping lives in the host UI, not the
  sheet).
- No new map-numbering overlay.
- Sweetheart-table easter egg and other amenities unchanged.
