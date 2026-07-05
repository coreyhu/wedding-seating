# Wedding Seating v2 — Botanical Theme, Easter Eggs, Custom Table Names

**Date:** 2026-07-04
**Status:** Awaiting user review (one ⚑ input pending: couple names)
**Builds on:** v1 (merged to main 2026-07-04) — see `2026-07-03-wedding-seating-design.md`. All v1 global constraints stand (vanilla TS, no silent failures, free tiers) except one **amendment**: the v1 "bilingual copy shown together" rule is replaced by localization (§4) — guest UI renders in ONE language at a time; the host page becomes English-only.

## Scope

1. **Botanical Garden visual theme** (user-selected from mockups) — both pages, hand-rolled CSS, no UI kit.
2. **Easter eggs** (user-selected): petal burst on seat-find; sweetheart celebration when the couple's names are searched.
3. **Custom table names** — name-only display (user-selected), tap-a-table editor on the host map.
4. **Guest-page localization** (user-requested, replacing side-by-side bilingual copy): auto-detected EN/中文 with a persistent toggle.
5. **Matrix seating import** (user-requested after sharing the real Google Sheet, 2026-07-04): one paste imports guests + table names + full seating from the sheet's actual layout (columns = tables, rows = seats). **Replaces** the v1 two-column import.
6. **Pinyin-bridge Chinese search** (user-requested "something more elegant" than hand-annotating Chinese names): 汉字 queries match romanized names via on-the-fly pinyin conversion + a curated romanization-variant map; slash-format (`English / 中文`) cells remain a manual override.

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
      { name_en: 'Corey Hu', name_zh: '' },    // name_zh optional: '' never matches
      { name_en: 'Lindsey Tam', name_zh: '' }, // Chinese names not chosen yet; add when they exist
    ],
    message: { en: 'You found us! Come say hi at the sweetheart table 🌿', zh: '被你找到啦！快来甜心桌打个招呼 🌿' },
  };
  ```
  A unit test asserts every partner has a non-empty `name_en` (guards against placeholder regressions).
- `matchesCouple(p: PreparedQuery): boolean` — reuses `normalizeEn`/CJK rules from `logic/search.ts`. **Exact match only**: EN matches iff the normalized query equals a partner's normalized `name_en`; ZH iff the whitespace-stripped query equals `name_zh`. (Substring matching was considered and rejected: a real guest sharing a name fragment with either partner would get the easter egg instead of their own seat.)
- Guest search flow: couple match is checked **first**; on match the normal RPC flow is skipped and a special result renders: full-width botanical card with `COUPLE.message[locale]` (§4) → map zooms to the sweetheart table landmark → `burstPetals` with `count: 48`.
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

## 4. Guest-page localization

- **`src/guest/i18n.ts`** — no library. `type Locale = 'en' | 'zh'`; a dict of ~15 UI strings per locale; `t(key): string`; `detectLocale()`: localStorage `locale` if set, else `navigator.language` starting with `zh` → `'zh'`, else `'en'`; `setLocale(l)` persists to localStorage and re-renders static copy. `<html lang>` and `document.title` track the locale.
- **Toggle**: a small persistent `EN / 中文` control in the guest header (shows the language you'd switch *to*). No first-visit chooser (user choice: auto-detect + toggle).
- **What localizes**: all guest UI strings — title, search placeholder, empty state, connection toast + retry label, "no seat assigned" banner, seat text (`Seat 5` / `5号位`), sweetheart message, and **table labels** (EN locale → `label_en`, 中文 → `label_zh`; still name-only per §3).
- **What stays dual**: guest names render as `name_en · name_zh` in both locales — names are identity data, and seeing both forms helps guests confirm it's really them.
- **Host page**: English-only (user choice). The v1 bilingual host strings ("Unseated · 未安排" etc.) become English during the theme pass — copy churn stays inside files the theme already touches.
- **E2e**: a `zh-CN` browser-locale context must land on 中文 automatically; toggling to EN must swap the placeholder and a table label live.

## 5. Matrix seating import

Replaces the v1 two-column import end-to-end (parser, RPC, UI). The Google Sheet is the source of truth for seating.

- **Input**: CSV export of the sheet. Row 1 = table display names, columns left→right = tables 1–12 (exactly 12 non-empty headers required; anything else is a preview-time error). Header cells may be `Peacock` or `Peacock / 孔雀`. Data rows: cell at (row i, column t) = guest seated at table t, seat i (row order = seat order, 1–8). More than 8 names in a column is an error naming the column. Empty cells skipped.
- **Cell format**: `English Name`, `English / 中文`, or `/ 中文` (at least one side non-empty; both sides trimmed).
- **Semantics (full replace)**: inside ONE transaction — upsert guests by `(name_en, name_zh)` pair; clear ALL seat assignments; assign exactly per the matrix; update all 12 table labels from headers (`label_zh` falls back to `label_en`'s default rule via the existing coalesce pattern when no `/ 中文` given: header without Chinese sets `label_zh` to the numeric default `{n}号桌`); guests in the DB but absent from the sheet end up unseated (never deleted). Duplicate `(name_en, name_zh)` pairs *within the sheet* are a preview-time error (two seats can't hold the same identity).
- **RPC**: `import_seating(payload jsonb)` — admin-gated security definer; payload `{ tables: [{table_no, label_en, label_zh}×12], guests: [{name_en, name_zh, table_no, seat_no}] }`; returns `{ imported: int, new: int, unseated: int }` for the toast. Uses the deferrable constraint (clear-then-assign). Migration `0003_matrix_import.sql` creates it and **drops `import_guests`** (and its grants); smoke.sql asserts updated accordingly.
- **UI**: same host import panel; preview shows per-table counts, new-guest count, how many existing DB guests would become unseated, and all errors (column overflow, in-sheet duplicates, ≠12 headers) BEFORE the import button enables.
- **Runbook**: §4 day-before checklist rewritten for the matrix flow (paste whole sheet, check "imported = sheet cell count", re-import any time — sheet wins).
- Table mapping note: column order = table numbers 1–12 as derived by the SVG pipeline; the host verifies Peacock physically sits at "table 1" on the map after import and, if not, renames tables via the tap editor (user chose "decide later").

## 6. Pinyin-bridge Chinese search

Guest-side only; no schema changes; the server's `search_guests` is called with derived Latin candidates.

- **Trigger**: `prepareQuery` yields `kind: 'zh'`. First, the raw 汉字 query goes to the RPC as today (slash-override `name_zh` data still matches exactly). If zero rows come back, the bridge activates.
- **Conversion**: `tiny-pinyin` (~80KB) is **dynamically imported on first use** — English-only users never download it. `src/logic/pinyin-bridge.ts` exposes `pinyinCandidates(zhQuery: string): string[]`: per-character toneless pinyin → candidate strings, in order: (1) given-name-first rotation (first syllable moved to end — 胡向平 → `xiangpinghu`), (2) original order (`huxiangping`), (3) two-syllable-surname rotation when ≥4 chars. Each candidate also expands through a curated **ROMANIZATION_VARIANTS** map (~40 entries: xiao→hsiao, tan→tam, wu→ng, gao→kao, zeng→tseng, cai→tsai/choi, liu→lau, zhang→chang/cheung, wang/huang→wong, li→lee, zhao→chao/chiu, xie→hsieh/tse, lin→lam, chen→chan, …), one substitution at a time, deduped, **capped at 8 candidates total**.
- **Search loop**: candidates are tried sequentially against `search_guests` (each ≥2 Latin chars, so the RPC accepts them); first candidate returning rows wins; results ranked with the existing `'en'` ranking against that candidate. Hard cap 4 RPC calls per query (raw + 3 candidates); misses fall through to the normal empty state (zh locale copy already suggests asking at the welcome table).
- **Non-goals**: no hanzi guessing for EN queries; heteronym surnames beyond the variant map may miss (accepted; slash override exists); no server changes.
- **Tests**: unit tests use real sheet names (胡向平→Xiang Ping Hu; 萧→Hsiao via variant; 谭→Tam via variant); e2e: matrix-import a mini sheet in the host flow, then a 汉字 search on the guest page finds a pinyin-only guest through the bridge.

## 7. Map-first guest layout + animated zoom (user feedback 2026-07-04, desktop testing)

- **Layout (guest page only; host unchanged):** the floorplan fills the entire viewport (`position: fixed; inset: 0; height: 100dvh`). Everything else floats above it as overlay panels: one top-center overlay column (max-width 560px) containing the header card (leaf + title left, language toggle right), the search pill, and the results/banner stack (results scroll internally, `max-height: 40vh`). Panels are solid theme cards with shadows; pointer events pass through the overlay column's empty space to the map. Petals now fall over the full viewport (their container is the map).
- **Resize correctness:** svg-pan-zoom must `resize()` + re-fit on window resize and at mount (the map box is no longer a fixed 60vh card).
- **Animated zoom:** `zoomToPoint` animates over ~600ms with cubic ease-in-out via requestAnimationFrame, interpolating the view center in SVG coordinates and the zoom level simultaneously (center(t) = lerp(startCenter, targetCenter), zoom(t) = lerp(startZoom, 5); pan derived per frame as `size/2 − center(t)·realZoom(t)`). A new zoom call cancels any in-flight animation. `prefers-reduced-motion` or missing rAF → instant jump (current behavior). `zoomToSeat`/`zoomToLandmark` inherit the animation automatically.

- `set_table_label` failures → toast with message (host page pattern).
- Effects (`burstPetals`, celebration) are decorative: wrapped, never throw into the search flow.
- Guest map labels: decorative, silent skip on fetch failure (documented exception).

## 8. Amenity discovery (user-requested 2026-07-04, post-v2)

Guests can find venue features, not just seats. Guest page only.

- **Data**: `src/guest/amenities.ts` — curated list for exactly these landmark ids (all others stay internal; `sweetheart_table` deliberately excluded to protect the easter egg): `bar` (🍸 Bar/酒吧), `welcome_table` (💌 Welcome Table/迎宾台), `ceremony_seating` (💒 Ceremony/仪式区), `guest_artist` (🎨 Live Artist/现场创作), `restroom` (🚻 Restrooms/洗手间), `gift_table` (🎁 Gifts/礼品台), `dj` (🎧 DJ/DJ台). Each entry: `{ id, emoji, name: {en, zh}, keywords: {en: string[], zh: string[]} }` (keywords cover synonyms: 'bathroom'/'toilet'/'厕所'/'卫生间' → restroom, etc.). A unit test asserts every amenity id exists in the generated `seatmap.json` landmarks — a re-export that drops one fails the build.
- **Chips**: a horizontally scrollable chip row in the overlay directly under the search bar — `{emoji} {name[locale]}` per amenity; tapping zooms (`zoomToLandmark`) and shows the amenity banner (`banner` element, normal 'banner' class: `{emoji} {name[locale]}`). Chips re-render on locale change and must not shrink the results area (row ~40px, horizontal scroll, pointer-events auto).
- **Search**: after the couple check, before the RPC — if the prepared query EXACTLY equals an amenity's normalized name or any keyword (en: normalizeEn; zh: whitespace-stripped), render that amenity (banner + zoom), skip the RPC. Exact-match only so guest names can never be hijacked ('bar' → amenity; 'barb…' → guest search).
- **Map labels**: amenity names render on the map at landmark coordinates in the current locale — new `Floorplan.setLandmarkLabels(labels: Record<string, string>)` mirroring `setTableLabels` (class `.landmark-label`, smaller/muted vs table labels); re-rendered on locale change. Guest page only.
- **Non-goals**: no petals for amenities (reserved for seat finds); no host-side amenity editing (curated in code); no wayfinding.

## 9. Mobile touch gestures (user feedback 2026-07-04, phone testing)

svg-pan-zoom ships no touch support — desktop scroll/drag works, phones cannot pinch or pan. Fix with a hand-rolled Pointer Events gesture layer (no new dependency), active only for non-mouse pointers:

- One touch pointer down + move → `panBy` (drag-to-pan).
- Two pointers → pinch: zoom about the pinch midpoint (`zoomAtPoint` with the distance ratio) while tracking midpoint drift for combined pinch+pan.
- Taps stay taps: `preventDefault` only fires on gesture MOVEMENT past a small threshold, never on pointerdown, so click delegation (seat taps, host editor) is untouched.
- Requires the existing `touch-action: none` on `.floorplan` (already present since v1).
- Applies to both pages (shared `mountFloorplan`); host gains pinch too.
- E2e: a CDP-synthesized pinch on the guest map must change the viewport transform scale.
- Runbook note: phone-testing the DEV server needs `vite --host` + `.env.local`'s Supabase URL set to the Mac's LAN IP (127.0.0.1 on a phone is the phone) — one paragraph under a new "Testing from a phone" heading.

## 10. Delete unseated guests (user-requested 2026-07-05)

- Host sidebar: each unseated guest card gains a small × button. First tap arms it (button text becomes "Delete?", auto-disarms after 3s); second tap deletes via RPC and refreshes.
- **RPC `delete_guest(p_guest_id uuid)`** (migration `0004_delete_guest.sql`): admin-gated; raises `'guest is seated'` if `table_no is not null` (unseat first — a mis-tap can never remove someone from a table); raises `'unknown guest'` if no row. Standard grants pattern.
- Import interplay (documented in runbook §4): deletion is permanent, but a name still present in the sheet is re-created by the next import — clean the sheet AND delete in-app for stray entries.
- Seated guests: no delete affordance shown at all.
- Tests: smoke (delete unseated ✓, refuse seated ✓, non-admin rejected ✓); e2e: import a throwaway guest via the matrix panel, re-import without them (→ unseated), × ×, gone from sidebar — leaves state rerun-stable.

## Testing

- Unit: `matchesCouple` (EN substring/length rules, ZH rules, no-placeholder assert), landmark extraction in `svg-transform.test.ts`, label-fallback rendering helper.
- E2e: 4 new checks (above) appended to `scripts/e2e.mjs`.
- Existing 36 unit + 14 e2e must stay green; theme must not break the `.highlight`/`.occupied` `!important` contract.

## Open input

None — couple names supplied (Corey Hu, Lindsey Tam; Chinese names to be added to `COUPLE` if/when chosen).
