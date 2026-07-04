# Wedding Seating v2 — Botanical Theme, Easter Eggs, Custom Table Names

**Date:** 2026-07-04
**Status:** Awaiting user review (one ⚑ input pending: couple names)
**Builds on:** v1 (merged to main 2026-07-04) — see `2026-07-03-wedding-seating-design.md`. All v1 global constraints stand (vanilla TS, bilingual copy, no silent failures, free tiers) except where amended here.

## Scope

1. **Botanical Garden visual theme** (user-selected from mockups) — both pages, hand-rolled CSS, no UI kit.
2. **Easter eggs** (user-selected): petal burst on seat-find; sweetheart celebration when the couple's names are searched.
3. **Custom table names** — name-only display (user-selected), tap-a-table editor on the host map.

Explicitly out of scope (offered, declined): venue-quip searches, Konami disco mode, any UI framework/component kit (Shoelace/Tailwind evaluated and rejected: ~6 already-tested component types don't justify restyling-by-rewrite).

## 1. Botanical theme

- **Tokens** (replace `:root` in `src/styles.css`): `--ink: #3c4a3e`, `--accent-deep: #4e6b51`, `--accent: #7d9480`, `--bg: #f4f6f0`, `--line: #d5ddd0`, `--gold: #87795a`, `--highlight: #c2482f` (unchanged — the venue art is salmon-toned; a sage highlight would camouflage; the existing warm pulse is e2e-proven visible).
- **Type**: English display text (page titles, guest names in banner) in **Fraunces** via `@fontsource/fraunces` (self-hosted, woff2 subset, ≤2 weights — no CDN, venue Wi-Fi rule). Chinese text stays on the system stack (`PingFang SC`, `Noto Sans SC` fallback) — CJK webfonts are MB-scale and banned by the payload budget. Body stays system sans.
- **Chrome**: 14px organic radii, soft diffuse shadows, cream page background, sage borders; ✿ divider under the guest title; inline-SVG leaf flourish in the header corners (hand-drawn path, ~300 bytes, `aria-hidden`).
- **Host page** keeps its density; same tokens, no decorative flourishes in the working area.
- **Payload budget**: theme adds ≤120KB total (fonts included). No new runtime JS dependencies.
- Seat/table map art (the Affinity SVG) is untouched.

## 2. Easter eggs

### 2a. Petal burst on find (`src/guest/effects.ts`)

- `burstPetals(container: HTMLElement, opts?: {count?: number}): void` — spawns ~16 absolutely-positioned petal glyphs (✿/❀/🌸 mix, sage/blush tints) above the map, animating fall + horizontal drift + fade over ~1.5s, then removes them. Pure DOM/CSS animation, no canvas, no timers left behind.
- Triggered in `showGuest` after a successful highlight (not for unseated guests).
- **Respects `prefers-reduced-motion: reduce`** → function no-ops.
- Fire-and-forget: any exception is swallowed (an effect must never break search).

### 2b. Sweetheart celebration (`src/guest/couple.ts`)

- Config exported from `couple.ts`:
  ```ts
  export const COUPLE = {
    partners: [
      { name_en: '⚑COREY_EN', name_zh: '⚑COREY_ZH' },
      { name_en: '⚑PARTNER_EN', name_zh: '⚑PARTNER_ZH' },
    ],
    message_en: 'You found us! Come say hi at the sweetheart table',
    message_zh: '被你找到啦！快来甜心桌打个招呼',
  };
  ```
  ⚑ Names supplied by Corey before ship; placeholder values fail a build-time assert (`prepare-svg`-style guard in a unit test: values must not start with '⚑').
- `matchesCouple(p: PreparedQuery): boolean` — reuses `normalizeEn`/CJK rules from `logic/search.ts`. **Exact match only**: EN matches iff the normalized query equals a partner's normalized `name_en`; ZH iff the whitespace-stripped query equals `name_zh`. (Substring matching was considered and rejected: a real guest sharing a name fragment with either partner would get the easter egg instead of their own seat.)
- Guest search flow: couple match is checked **first**; on match the normal RPC flow is skipped and a special result renders: full-width botanical card with `message_en`/`message_zh` → map zooms to the sweetheart table landmark → `burstPetals` with `count: 48`.
- The couple's names ship in the JS bundle — accepted (they're on the invitation).

### 2c. Landmark plumbing (enables 2b; future-proofs venue quips)

- `scripts/svg-transform.ts`: any element in the source SVG carrying an `id` that is **not** `table-*`/`seat-*` (e.g. `sweetheart_table`, `bar`, `ceremony_seating`) gets its bbox center recorded in `seatMap.landmarks: Record<string, {cx, cy}>`.
- `SeatMap` type gains `landmarks`; `shared/floorplan.ts` gains `zoomToPoint(cx, cy)` (extracted from `zoomToSeat`, which becomes a thin wrapper).
- Diff guard ignores landmarks (decorative; no assignments reference them).

## 3. Custom table names

- **Display rule (user choice: name only):** wherever a table is shown to guests, render `label_en · label_zh` with **no** table number. DB defaults are `Table {n}` / `{n}号桌`, so unnamed tables degrade to exactly the v1 display. The `Seat N · N号位` small-text is unaffected — only the table portion changes.
- **DB (migration `0002_table_labels.sql`):**
  ```sql
  create or replace function set_table_label(p_table_no int, p_label_en text, p_label_zh text)
  returns void language plpgsql security definer set search_path = public, extensions as $$
  begin
    if not is_admin() then raise exception 'not authorized'; end if;
    update tables set
      label_en = coalesce(nullif(trim(p_label_en), ''), format('Table %s', p_table_no)),
      label_zh = coalesce(nullif(trim(p_label_zh), ''), format('%s号桌', p_table_no))
    where table_no = p_table_no;
    if not found then raise exception 'unknown table'; end if;
  end $$;
  revoke execute on function set_table_label(int, text, text) from public, anon, authenticated;
  grant execute on function set_table_label(int, text, text) to authenticated;
  ```
  Clearing a name restores the numeric default (that's the `coalesce(nullif…)`).
- **API**: `setTableLabel(tableNo, labelEn, labelZh)` and `listTables()` (already exists, currently unused — becomes used) in `shared/api.ts`.
- **Host UI**: `floorplan.onSeatTap` generalizes to `onTap(cb: (hit: {kind:'seat', key} | {kind:'table', tableNo}) => void)` (seat ids `seat-*`; table hits from `table-{n}` group / `table-{n}-shape`). Tapping a table from idle **or** seat-open opens the name editor (replacing any open seat panel — same "re-target" behavior as tapping another seat); tapping a table while `picking-dest` does nothing (destination picking stays seat-only; no state-machine changes — the table-editor panel is UI state alongside the machine, cleared on any seat tap or cancel).
- **Maps**: both pages render each table's `label_zh` (fallback `label_en`) as a small `.table-label` text at the table center (from `seatmap.json`). Guest page fetches labels via... `search_guests` only returns labels per match — **guest map labels need `listTables()` for anon**. `tables` already grants anon select (v1). Guest page calls `listTables()` once at load; on failure, silently skips map labels (decorative — exception to the no-silent-failure rule, scoped to decoration).
- **E2e additions**: rename a table via host UI → banner for a guest at that table shows the new name only; sweetheart search shows the celebration card; petals appear after a find; reduced-motion run shows none.

## Error handling

- `set_table_label` failures → toast with message (host page pattern).
- Effects (`burstPetals`, celebration) are decorative: wrapped, never throw into the search flow.
- Guest map labels: decorative, silent skip on fetch failure (documented exception).

## Testing

- Unit: `matchesCouple` (EN substring/length rules, ZH rules, no-placeholder assert), landmark extraction in `svg-transform.test.ts`, label-fallback rendering helper.
- E2e: 4 new checks (above) appended to `scripts/e2e.mjs`.
- Existing 36 unit + 14 e2e must stay green; theme must not break the `.highlight`/`.occupied` `!important` contract.

## ⚑ Open input

1. Couple names (EN + 中文 for both partners) — required before ship; build fails on placeholders by design.
