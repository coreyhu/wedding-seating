# Wedding Seating Finder — Design

**Date:** 2026-07-03
**Status:** Awaiting final user approval (two cosmetic defaults marked ⚑ below)

## Overview

A small bilingual (English / Simplified Chinese) webapp for a wedding with **12 round tables × 8 seats (96 seats max; not all tables full)**:

- **Guest page (`/`)** — a guest types their name in either language; the app highlights their chair on the venue's SVG floorplan.
- **Host page (`/host`)** — password-protected; the host assigns, moves, and swaps guests by clicking chairs on the same floorplan. Edits are live: guests searching afterward see the new assignment.

## Goals

1. A guest finds their seat in under 15 seconds on a phone, in either language.
2. The host can reseat anyone from a phone at the venue, day-of.
3. Zero cost to run (free tiers only); nothing to maintain after the wedding.

## Non-goals

- RSVP tracking, meal choices, plus-one management (the Google Sheet keeps owning that).
- Drag-and-drop editing (click-to-assign/swap chosen instead).
- Realtime multi-editor sync on the host page (single host; each write refetches state).
- Offline support beyond normal browser caching.

## Architecture

Static frontend (Vite + TypeScript, no UI framework) hosted on Netlify, talking directly to Supabase (free tier) for data, auth, and row-level security. No custom server.

```
Guest phone ──search──▶ Supabase RPC: search_guests(q)   (anon key, RLS-guarded)
Host phone  ──auth────▶ Supabase Auth (email/password, single account)
            ──edits───▶ Supabase RPC: assign_seat / unseat  (authenticated only)
Floorplan SVG: inlined into both pages at build time; chairs addressable by id.
```

## The SVG contract

*(Revised 2026-07-03 after inspecting the host's sample export, which drew each table as a group of 9 paths — 8 chairs + table — layered over an embedded JPEG of the venue's floorplan.)*

The floorplan SVG (edited in Affinity by the host) is the single source of truth for geometry.

**What the host does in Affinity (final export checklist):** *(✅ completed 2026-07-03 — his v2 export satisfies all of this)*
1. Name each of the 12 table groups `table-1` … `table-12` in the Layers panel (each group = 8 chair paths + 1 table path, as in the sample). Nothing else needs naming. *(Underscore form `table_1` is also accepted by the pipeline, which is what the v2 export uses.)*
2. Delete the mockup content from the sample: the enlarged demo table and the hand-placed name labels. The app renders names dynamically.
3. Keep everything else (venue background art — fully vector as of v2, which replaced the embedded JPEG; ceremony chair rows; decoration) — the app treats it as background art.

**What the build script (`scripts/prepare-svg.ts`) does:**
- Copies Affinity's `serif:id` attributes to standard `id`.
- Within each `table-{n}` group, identifies the table (largest shape) vs. the 8 chairs, computes each chair's centroid, and derives seat numbers **1–8 clockwise from the 12 o'clock position**, injecting `id="seat-{table}-{seat}"` on each chair path.
- Recompresses/rescales any embedded raster image for mobile payloads (moot as of the v2 all-vector export, but kept as a safety net) and tightens the viewBox to the drawn content.
- **Fails the build** if any table group is missing, doesn't contain exactly 8 chairs, or — critically — if a re-export would silently renumber existing seats: the derived seat map is committed alongside the SVG and diffed on every build, so a nudged chair can't scramble assignments unnoticed.

⚑ **Default chosen (awaiting confirmation):** the two 7×6 ceremony chair grids near the Altar are open seating — decoration to the app. Only the 12 reception tables are searchable/assignable.

Seat assignments reference `(table_no, seat_no)` — never pixel coordinates — so the SVG can be re-exported freely without touching data.

## Data model (Supabase Postgres)

```sql
create table tables (
  table_no  int primary key check (table_no between 1 and 12),
  label_en  text not null,   -- default 'Table {n}'
  label_zh  text not null    -- default '{n}号桌'
);

create table guests (
  id        uuid primary key default gen_random_uuid(),
  name_en   text not null default '',
  name_zh   text not null default '',
  table_no  int references tables(table_no),
  seat_no   int check (seat_no between 1 and 8),
  check ((table_no is null) = (seat_no is null)),  -- seated fully or not at all
  unique (table_no, seat_no)                        -- a chair holds one guest, DB-enforced
    deferrable initially immediate                  -- deferred inside assign_seat to permit swaps
);
```

⚑ **Default chosen (awaiting confirmation):** tables use numeric labels only for now; the schema's label columns mean custom names ("Osmanthus / 桂花") can be added later by editing rows — no code change.

### Security model (RLS)

| Role | guests | tables | RPCs |
|------|--------|--------|------|
| `anon` (guest page) | no direct select | select | `search_guests(q)` only |
| authenticated host | full select | full select/update | `assign_seat`, `unseat`, `import_guests` |

- `search_guests(q)` (security definer): requires ≥2 Latin letters or ≥1 CJK character after normalization; returns only matching rows with `name_en, name_zh, table_no, seat_no` plus table labels. The full list is never exposed in one call (host accepted that per-name enumeration remains possible).
- `assign_seat(guest_id, table_no, seat_no)` (security definer, authenticated only): if the destination chair is occupied, **atomically swaps** the two guests inside one transaction (the unique constraint makes a non-atomic swap impossible, which is the point). Handles assign, move, and swap as one code path.
- `unseat(guest_id)`: clears `table_no`/`seat_no`.
- Writes are impossible for `anon` at the database level; the Supabase anon key shipped in the page is public by design.

## Guest page (`/`)

- All UI text shown bilingually at once (e.g. "Find your seat · 查找您的座位") — no language toggle.
- One search box. Input script is auto-detected: CJK characters match against `name_zh` (substring match on exact characters — guests type via IME); Latin input matches `name_en` normalized (case-, whitespace-, and diacritic-insensitive), with small-typo tolerance as fallback when no substring match hits. Exact matching rules are a contract point finalized in implementation.
- Matches (≥2 Latin letters or ≥1 CJK character typed — mirroring the RPC's rule) render as cards: "**Corey Hu · 胡某某** — Table 3 · 3号桌". Duplicate names simply both appear.
- Tapping a card pans/zooms the inline SVG (via `svg-pan-zoom`) to the guest's chair, which pulses via a CSS animation. ⚑ **Default chosen (awaiting confirmation):** the result text shows the table prominently and the seat number small ("Seat 5 · 5号位"), since the highlighted chair on the map is the primary answer.
- No match → bilingual "Can't find your name? Ask at the welcome table. · 找不到您的名字？请到迎宾台咨询。"
- Slow/failed network → visible bilingual "connection trouble, retrying" state; never a blank screen.

## Host page (`/host`)

- Gated by Supabase email/password auth (one account). RLS is the real enforcement; the login gate is UX.
- Floorplan renders with chairs color-coded: occupied / empty, and each seated guest's name drawn as a small dynamic label next to their chair (the live version of the host's Affinity mockup). The guest page never renders these labels — only the searched guest's own seat, per the privacy preference. Tapping a chair opens a bottom panel:
  - **Empty chair** → searchable list of *unseated* guests → tap to assign.
  - **Occupied chair** → guest's name + actions **Unseat** and **Move** → Move enters pick-destination mode (map dims, all chairs tappable) → tapping an empty chair moves; tapping an occupied chair swaps. Escape/cancel affordance exits the mode.
- Persistent sidebar (drawer on mobile): unseated guests with count badge.
- **CSV import**: paste or upload the Google Sheet export (columns: English name, Chinese name). Upserts match on the `(name_en, name_zh)` pair — re-importing never duplicates; new rows arrive unseated. Import preview shown before commit.
- After every write the page refetches assignments (no realtime subscription needed for a single editor).
- All failures surface as a visible toast with retry — never silent.

## Stack & hosting

- **Vite + TypeScript, vanilla DOM** — two pages (`index.html`, `host.html`) sharing modules (`floorplan.ts`, `search.ts`, `api.ts`). No UI framework: the whole app is DOM/SVG manipulation at ~100-guest scale.
- **Supabase free tier**: Postgres, RLS, auth, auto-generated API. Schema and policies kept in `supabase/migrations/` in-repo.
- **Netlify free tier**, auto-deploy on git push.
- A QR code pointing at the deployed URL is generated as a build artifact for venue signage.

## Testing

- **Vitest** unit tests for pure logic: name normalization/matching (English fuzzy rules, CJK detection) and the assign/move/swap state machine.
- SQL RPCs exercised via a seeded local Supabase (`supabase start`) smoke script.
- Manual end-to-end pass on a phone before sending out QR codes.

## Open items

1. ⚑ Table labels: numeric-only default — confirm or supply custom names.
2. ⚑ Seat-number display: shown small alongside the map highlight — confirm, or hide entirely, or make prominent (only if venue will have physical seat markers).
3. ⚑ Ceremony chair rows: unassigned/decorative default — confirm.
4. Host to finish the floorplan in Affinity per the export checklist above (sample already in-repo as `seating_affinity.svg`).
