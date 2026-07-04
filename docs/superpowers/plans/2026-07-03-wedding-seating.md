# Wedding Seating Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bilingual (EN/简体中文) webapp where wedding guests search their name to see their chair highlighted on the venue SVG floorplan, and the host reassigns seats by clicking chairs.

**Architecture:** Static Vite multi-page frontend (guest `index.html`, host `host.html`) talking directly to Supabase (Postgres + RLS + RPCs + auth). A local build script transforms the Affinity SVG export: it derives `seat-{table}-{seat}` ids geometrically from named table groups and emits a seat-coordinate JSON used for pan/zoom targets and host name labels.

**Tech Stack:** Vite 6, TypeScript (strict), Vitest + jsdom, @supabase/supabase-js v2, svg-pan-zoom, linkedom + sharp (build script only), Netlify hosting, Supabase free tier.

## Global Constraints

- No UI framework — vanilla DOM/TS only. No CSS framework.
- TypeScript `strict: true`; `npm run check` (tsc --noEmit) must pass before every commit.
- All user-facing copy is bilingual, EN + 简体中文 shown together (e.g. `Find your seat · 查找您的座位`).
- Tables numbered 1–12; seats 1–8, clockwise from 12 o'clock. Seat key string format: `"{table}-{seat}"` e.g. `"3-5"`.
- Search minimums: ≥2 Latin letters or ≥1 CJK character (enforced in SQL **and** client).
- Anonymous role: no direct reads of `guests`; only `search_guests` RPC. All writes via `security definer` RPCs that check `auth.uid()`.
- Every network failure surfaces visibly (toast + retry) — never silent.
- Free tiers only (Supabase, Netlify).
- **Learning mode:** Tasks 2 and 7 contain USER CONTRIBUTION steps — the executor prepares the stub + tests, then pauses and asks Corey to implement (5–15 lines each). Do not implement these yourself unless Corey explicitly declines.
- Generated floorplan artifacts (`src/generated/floorplan.svg`, `src/generated/seatmap.json`) are **committed** — Netlify builds do not run the SVG pipeline.

## File Structure

```
package.json / tsconfig.json / vite.config.ts / netlify.toml / .env.example
index.html                     guest page shell
host.html                      host page shell
src/
  vite-env.d.ts                env typing
  styles.css                   shared styles (mobile-first)
  shared/types.ts              Guest, GuestMatch, TableInfo, SeatKey, SeatMap
  shared/api.ts                typed Supabase calls (only network layer in the app)
  shared/floorplan.ts          mount inline SVG, highlight, labels, pan/zoom
  shared/toast.ts              error/info toasts with retry
  logic/seat-geometry.ts       pure: centroids, clockwise seat numbering  [USER CONTRIB]
  logic/search.ts              pure: normalize, prepareQuery, rankMatches [USER CONTRIB]
  logic/seat-actions.ts        pure: host click-to-assign/move/swap state machine
  logic/csv.ts                 pure: Google-Sheets CSV parser
  guest/main.ts                guest page wiring
  host/main.ts                 host page wiring (map render + panel + sidebar)
  host/auth.ts                 login gate
  host/import.ts               CSV import UI
  generated/                   committed build artifacts (floorplan.svg, seatmap.json)
scripts/
  svg-transform.ts             pure core of the SVG pipeline (unit-tested)
  prepare-svg.ts               CLI: transform + JPEG recompress + diff guard
  make-dev-floorplan.ts        synthetic 12×8 dev floorplan generator
  make-qr.ts                   QR code for venue signage
supabase/
  migrations/0001_init.sql     schema + RLS + RPCs
  seed.sql                     12 tables + bilingual sample guests
  smoke.sql                    psql assertions for RPC behavior
assets/floorplan/              SVG sources (dev-floorplan.svg, later the real export)
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `src/vite-env.d.ts`, `index.html`, `host.html`, `src/styles.css`, `src/guest/main.ts`, `src/host/main.ts`, `.env.example`, `.gitignore` (extend)

**Interfaces:**
- Produces: `npm run dev|build|check|test` scripts; two served pages; `import.meta.env.VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY` typed.

- [ ] **Step 1: Init npm and install dependencies**

```bash
npm init -y
npm i @supabase/supabase-js svg-pan-zoom
npm i -D vite typescript vitest jsdom linkedom sharp tsx qrcode @types/qrcode @types/svg-pan-zoom
```

- [ ] **Step 2: Write configs**

`package.json` scripts block (edit in place, keep deps):

```json
{
  "name": "wedding-seating",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "npm run check && vite build",
    "preview": "vite preview",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "devmap": "tsx scripts/make-dev-floorplan.ts",
    "svg": "tsx scripts/prepare-svg.ts",
    "qr": "tsx scripts/make-qr.ts"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "scripts", "*.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        host: resolve(__dirname, 'host.html'),
      },
    },
  },
  test: { environment: 'jsdom' },
});
```

(Vitest reads the `test` key via `vite.config.ts`; add `/// <reference types="vitest/config" />` at the top of the file to type it.)

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
```

`.env.example`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<from `supabase status`>
```

Append to `.gitignore`:

```
node_modules/
dist/
.env
.env.local
```

- [ ] **Step 3: Minimal pages**

`index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Find your seat · 查找您的座位</title>
  <link rel="stylesheet" href="/src/styles.css" />
</head>
<body>
  <header class="topbar"><h1>Find your seat · 查找您的座位</h1></header>
  <main id="app"></main>
  <script type="module" src="/src/guest/main.ts"></script>
</body>
</html>
```

`host.html`: identical shape with `<title>Seating admin · 座位管理</title>`, `<h1>Seating admin · 座位管理</h1>`, script `/src/host/main.ts`.

`src/guest/main.ts` and `src/host/main.ts` (placeholder until Tasks 8/10):

```ts
document.querySelector('#app')!.textContent = 'coming soon';
```

`src/styles.css` (starter; extended in Task 8):

```css
:root { --accent: #c2482f; --ink: #222; --muted: #777; --line: #e3ded7; --bg: #faf8f5; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "PingFang SC", "Noto Sans SC", sans-serif; color: var(--ink); background: var(--bg); }
.topbar { padding: 12px 16px; border-bottom: 1px solid var(--line); background: #fff; }
.topbar h1 { margin: 0; font-size: 18px; }
```

- [ ] **Step 4: Verify** — `npm run check` passes; `npm run dev` then `curl -s localhost:5173/ | grep 'Find your seat'` and `curl -s localhost:5173/host.html | grep 'Seating admin'` both hit.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: scaffold Vite two-page TS app"`

---

### Task 2: Seat geometry (USER CONTRIBUTION)

**Files:**
- Create: `src/logic/seat-geometry.ts`, `src/logic/seat-geometry.test.ts`

**Interfaces:**
- Produces: `interface Pt { x: number; y: number }`; `centroid(pts: Pt[]): Pt`; `seatNumbersFor(center: Pt, chairs: Pt[]): number[]` — returns, for each chair index, its seat number 1..N, clockwise starting at 12 o'clock (SVG y-axis points DOWN). Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

`src/logic/seat-geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { centroid, seatNumbersFor, type Pt } from './seat-geometry';

const C: Pt = { x: 100, y: 100 };
// 8 chairs on a circle, listed in scrambled order. SVG y grows downward,
// so 12 o'clock is (100, 90) and 3 o'clock is (110, 100).
const at = (deg: number): Pt => ({
  x: 100 + 10 * Math.sin((deg * Math.PI) / 180),
  y: 100 - 10 * Math.cos((deg * Math.PI) / 180),
});

it('averages coordinates', () => {
  expect(centroid([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
});

describe('seatNumbersFor', () => {
  it('numbers 1..8 clockwise from 12 o’clock', () => {
    const chairs = [at(90), at(0), at(270), at(180), at(45), at(135), at(315), at(225)];
    //               3:00   12:00  9:00    6:00    1:30    4:30    10:30   7:30
    expect(seatNumbersFor(C, chairs)).toEqual([3, 1, 7, 5, 2, 4, 8, 6]);
  });
  it('tolerates irregular spacing and radii', () => {
    const chairs = [at(10), at(100), at(200), at(355)];
    // 355° is just left of 12 o'clock → last clockwise
    expect(seatNumbersFor(C, chairs)).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: Create the stub**

`src/logic/seat-geometry.ts`:

```ts
export interface Pt { x: number; y: number }

export function centroid(pts: Pt[]): Pt {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

/**
 * USER CONTRIBUTION (Corey): given the table center and one centroid per
 * chair, return each chair's seat number (1..chairs.length), counting
 * CLOCKWISE and starting at the 12 o'clock position.
 * Careful: in SVG, +y points DOWN. Math.atan2 is your friend.
 */
export function seatNumbersFor(center: Pt, chairs: Pt[]): number[] {
  throw new Error('not implemented yet'); // TODO(Corey)
}
```

- [ ] **Step 3: Run tests, verify the seatNumbersFor ones fail** — `npx vitest run src/logic/seat-geometry.test.ts` → centroid PASSES, both seatNumbersFor tests FAIL with "not implemented yet".

- [ ] **Step 4: PAUSE — hand to Corey.** Explain: compute each chair's angle from the center with `Math.atan2(dx, -dy)` (that specific argument order/negation makes 12 o'clock = 0 and clockwise positive), normalize negatives by adding 2π, then rank chairs by angle. ~8 lines. Executor: do NOT write this; wait for Corey, then run the tests together.

- [ ] **Step 5: Run tests to verify all pass** — `npx vitest run src/logic/seat-geometry.test.ts` → 3 passed.

- [ ] **Step 6: Commit** — `git add src/logic && git commit -m "feat: clockwise seat numbering (Corey) + centroid helper"`

---

### Task 3: SVG pipeline (transform core, dev floorplan, CLI)

**Files:**
- Create: `scripts/svg-transform.ts`, `scripts/svg-transform.test.ts` (Vitest's default glob already covers `scripts/`), `scripts/make-dev-floorplan.ts`, `scripts/prepare-svg.ts`
- Create (generated, committed): `assets/floorplan/dev-floorplan.svg`, `src/generated/floorplan.svg`, `src/generated/seatmap.json`

**Interfaces:**
- Consumes: `centroid`, `seatNumbersFor` from Task 2.
- Produces: `interface SeatMap { viewBox: string; tables: Record<string, {cx:number;cy:number;r:number}>; seats: Record<string, {cx:number;cy:number}> }` (keys `"3"` / `"3-5"`), exported from `scripts/svg-transform.ts` and re-exported by `src/shared/types.ts` in Task 5. `transformFloorplan(svgText: string, prevMap: SeatMap | null): { svg: string; seatMap: SeatMap }` — throws descriptive `Error` on violations. Runtime artifacts `src/generated/floorplan.svg` (chair ids injected) and `src/generated/seatmap.json`.

- [ ] **Step 1: Write the failing tests**

`scripts/svg-transform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { transformFloorplan, type SeatMap } from './svg-transform';
import { devFloorplanSvg } from './make-dev-floorplan';

const src = devFloorplanSvg();

describe('transformFloorplan', () => {
  it('injects seat and table ids for 12 tables × 8 chairs', () => {
    const { svg, seatMap } = transformFloorplan(src, null);
    expect(Object.keys(seatMap.tables)).toHaveLength(12);
    expect(Object.keys(seatMap.seats)).toHaveLength(96);
    for (let t = 1; t <= 12; t++)
      for (let s = 1; s <= 8; s++) expect(svg).toContain(`id="seat-${t}-${s}"`);
    expect(svg).toContain('id="table-7"');
  });
  it('numbers seat 1 at 12 o’clock', () => {
    const { seatMap } = transformFloorplan(src, null);
    const t1 = seatMap.tables['1']!;
    const s1 = seatMap.seats['1-1']!;
    expect(s1.cy).toBeLessThan(t1.cy);            // above center
    expect(Math.abs(s1.cx - t1.cx)).toBeLessThan(2); // straight up
  });
  it('rejects a group without exactly 8 chairs', () => {
    const bad = src.replace(/<path class="chair" data-t="5" data-i="0"[^/]*\/>/, '');
    expect(() => transformFloorplan(bad, null)).toThrow(/table-5.*8 chairs/s);
  });
  it('diff guard: fails when an existing seat would move', () => {
    const { seatMap } = transformFloorplan(src, null);
    const prev: SeatMap = structuredClone(seatMap);
    prev.seats['1-1'] = { cx: prev.seats['1-1']!.cx + 500, cy: prev.seats['1-1']!.cy };
    expect(() => transformFloorplan(src, prev)).toThrow(/seat 1-1/);
  });
});
```

- [ ] **Step 2: Run tests, verify failure** — `npx vitest run scripts` → FAIL (modules missing).

- [ ] **Step 3: Implement the dev floorplan generator**

`scripts/make-dev-floorplan.ts`:

```ts
// Synthetic stand-in for the real Affinity export: same contract —
// <g serif:id="table-N"> holding 1 big table path + 8 chair paths.
export function devFloorplanSvg(): string {
  const groups: string[] = [];
  for (let t = 1; t <= 12; t++) {
    const col = (t - 1) % 4, row = Math.floor((t - 1) / 4);
    const cx = 250 + col * 320, cy = 250 + row * 320;
    // Absolute path commands only (L, not h/v): the transform's centroid
    // heuristic pairs ALL numbers in `d` as x,y coords, which is only valid
    // for absolute commands. Affinity exports absolute coords too.
    const rect = (x: number, y: number, w: number, h: number) =>
      `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    const table = `<path d="${rect(cx - 60, cy - 60, 120, 120)}" fill="#eee" stroke="#999"/>`;
    const chairs = Array.from({ length: 8 }, (_, i) => {
      const a = (i * 45 * Math.PI) / 180; // chair i at i*45° clockwise from 12:00
      const x = cx + 100 * Math.sin(a), y = cy - 100 * Math.cos(a);
      return `<path class="chair" data-t="${t}" data-i="${i}" d="${rect(x - 12, y - 12, 24, 24)}" fill="#ddd" stroke="#999"/>`;
    }).join('');
    groups.push(`<g serif:id="table-${t}">${table}${chairs}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:serif="http://www.serif.com/" viewBox="0 0 1500 1200">${groups.join('')}</svg>`;
}

if (process.argv[1]?.endsWith('make-dev-floorplan.ts')) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('assets/floorplan', { recursive: true });
  writeFileSync('assets/floorplan/dev-floorplan.svg', devFloorplanSvg());
  console.log('wrote assets/floorplan/dev-floorplan.svg');
}
```

- [ ] **Step 4: Implement the transform core**

`scripts/svg-transform.ts`:

```ts
import { DOMParser } from 'linkedom';
import { centroid, seatNumbersFor, type Pt } from '../src/logic/seat-geometry';

export interface SeatMap {
  viewBox: string;
  tables: Record<string, { cx: number; cy: number; r: number }>;
  seats: Record<string, { cx: number; cy: number }>;
}

const MOVE_TOLERANCE = 25; // svg units; larger displacement of an existing seat fails the build

// Approximates a path's point cloud by pairing every number in `d`.
// Valid for absolute-command paths (which Affinity exports); relative
// h/v/l offsets would skew centroids — the validation tests catch that.
function coordsOf(d: string): Pt[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
  return pts;
}

function bboxArea(pts: Pt[]): number {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

export function transformFloorplan(svgText: string, prevMap: SeatMap | null): { svg: string; seatMap: SeatMap } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('not an SVG document');
  const seatMap: SeatMap = { viewBox: svg.getAttribute('viewBox') ?? '', tables: {}, seats: {} };

  const groups = [...doc.querySelectorAll('g')].filter(g =>
    /^table-\d+$/.test(g.getAttribute('serif:id') ?? g.getAttribute('id') ?? ''));
  if (groups.length !== 12)
    throw new Error(`expected 12 table groups, found ${groups.length} (${groups.map(g => g.getAttribute('serif:id') ?? g.getAttribute('id')).join(', ')})`);

  for (const g of groups) {
    const name = g.getAttribute('serif:id') ?? g.getAttribute('id')!;
    const t = Number(name.slice('table-'.length));
    const paths = [...g.querySelectorAll('path')];
    if (paths.length !== 9)
      throw new Error(`${name}: expected 1 table + 8 chairs (9 paths), found ${paths.length} — check the group in Affinity`);
    const withPts = paths.map(p => ({ p, pts: coordsOf(p.getAttribute('d') ?? '') }));
    withPts.sort((a, b) => bboxArea(b.pts) - bboxArea(a.pts));
    const [table, ...chairs] = withPts;
    if (chairs.length !== 8) throw new Error(`${name}: expected 8 chairs`);
    const c = centroid(table!.pts);
    const xs = table!.pts.map(p => p.x);
    seatMap.tables[String(t)] = { cx: c.x, cy: c.y, r: (Math.max(...xs) - Math.min(...xs)) / 2 };
    table!.p.setAttribute('id', `table-${t}-shape`);
    g.setAttribute('id', `table-${t}`);
    const chairCentroids = chairs.map(ch => centroid(ch.pts));
    const nums = seatNumbersFor(c, chairCentroids);
    chairs.forEach((ch, i) => {
      ch.p.setAttribute('id', `seat-${t}-${nums[i]}`);
      ch.p.classList.add('seat');
      seatMap.seats[`${t}-${nums[i]}`] = { cx: chairCentroids[i]!.x, cy: chairCentroids[i]!.y };
    });
  }

  if (prevMap) {
    const problems: string[] = [];
    for (const [key, old] of Object.entries(prevMap.seats)) {
      const now = seatMap.seats[key];
      if (!now) { problems.push(`seat ${key} disappeared`); continue; }
      if (Math.hypot(now.cx - old.cx, now.cy - old.cy) > MOVE_TOLERANCE)
        problems.push(`seat ${key} moved ${Math.round(Math.hypot(now.cx - old.cx, now.cy - old.cy))} units`);
    }
    if (problems.length)
      throw new Error(`Seat positions changed vs committed seatmap — existing assignments would scramble.\n${problems.join('\n')}\nRe-run with --force if intentional.`);
  }

  return { svg: svg.toString(), seatMap };
}
```

- [ ] **Step 5: Run tests to verify pass** — `npx vitest run scripts` → 4 passed. (If seat-1 test fails, chair `data-i="0"` sits at 12 o'clock by construction — debug `seatNumbersFor` with Corey.)

- [ ] **Step 6: Implement the CLI wrapper**

`scripts/prepare-svg.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { transformFloorplan, type SeatMap } from './svg-transform';

const force = process.argv.includes('--force');
const src = process.argv.find(a => a.endsWith('.svg')) ?? 'assets/floorplan/dev-floorplan.svg';
const MAP = 'src/generated/seatmap.json';

async function recompressJpeg(svg: string): Promise<string> {
  const m = svg.match(/xlink:href="data:image\/jpeg;base64,([^"]+)"/);
  if (!m) return svg;
  const out = await sharp(Buffer.from(m[1]!, 'base64'))
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  console.log(`embedded JPEG: ${Math.round(m[1]!.length * 0.75 / 1024)}kB → ${Math.round(out.length / 1024)}kB`);
  return svg.replace(m[1]!, out.toString('base64'));
}

const prev: SeatMap | null = !force && existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : null;
const { svg, seatMap } = transformFloorplan(readFileSync(src, 'utf8'), prev);
mkdirSync('src/generated', { recursive: true });
writeFileSync('src/generated/floorplan.svg', await recompressJpeg(svg));
writeFileSync(MAP, JSON.stringify(seatMap, null, 1));
console.log(`ok: ${Object.keys(seatMap.seats).length} seats across ${Object.keys(seatMap.tables).length} tables from ${src}`);
```

- [ ] **Step 7: Generate and verify artifacts**

```bash
npm run devmap
npm run svg
grep -c 'id="seat-' src/generated/floorplan.svg   # expect 96
npm run svg                                        # second run: passes diff guard (no movement)
```

- [ ] **Step 8: Commit** — `git add scripts assets src/generated && git commit -m "feat: SVG pipeline deriving seat ids + seatmap from table groups"`

---

### Task 4: Supabase schema, RPCs, seed, smoke

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/seed.sql`, `supabase/smoke.sql` (run `supabase init` first; commit its `supabase/config.toml`)

**Interfaces:**
- Produces (consumed by `shared/api.ts`): tables `tables(table_no,label_en,label_zh)`, `guests(id,name_en,name_zh,table_no,seat_no)`; RPCs `search_guests(q text)`, `assign_seat(p_guest_id uuid, p_table_no int, p_seat_no int)` (occupied destination ⇒ atomic swap), `unseat(p_guest_id uuid)`, `import_guests(rows jsonb) returns int`.

- [ ] **Step 1: `supabase init`** (accept defaults; do not overwrite existing files)

- [ ] **Step 2: Write the migration**

`supabase/migrations/0001_init.sql`:

```sql
create extension if not exists unaccent;
create extension if not exists pg_trgm;

create table tables (
  table_no int primary key check (table_no between 1 and 12),
  label_en text not null,
  label_zh text not null
);

create table guests (
  id uuid primary key default gen_random_uuid(),
  name_en text not null default '',
  name_zh text not null default '',
  table_no int references tables(table_no),
  seat_no int check (seat_no between 1 and 8),
  check (name_en <> '' or name_zh <> ''),
  check ((table_no is null) = (seat_no is null)),
  constraint guests_one_per_seat unique (table_no, seat_no) deferrable initially immediate,
  constraint guests_identity unique (name_en, name_zh)
);

alter table tables enable row level security;
alter table guests enable row level security;

create policy tables_read on tables for select to anon, authenticated using (true);
create policy guests_read_auth on guests for select to authenticated using (true);
-- deliberately NO anon policy on guests; also revoke to fail loudly:
revoke all on guests from anon;

create or replace function normalize_en(s text) returns text
language sql immutable as $$
  select lower(regexp_replace(unaccent(coalesce(s, '')), '\s', '', 'g'))
$$;

create or replace function search_guests(q text)
returns table (id uuid, name_en text, name_zh text, table_no int, seat_no int, label_en text, label_zh text)
language plpgsql security definer set search_path = public as $$
declare
  norm text := normalize_en(q);
  is_cjk boolean := coalesce(q, '') ~ '[一-鿿]';
begin
  if is_cjk then
    return query
      select g.id, g.name_en, g.name_zh, g.table_no, g.seat_no, t.label_en, t.label_zh
      from guests g left join tables t on t.table_no = g.table_no
      where replace(g.name_zh, ' ', '') like '%' || replace(trim(q), ' ', '') || '%'
      limit 20;
  elsif char_length(norm) >= 2 then
    return query
      select g.id, g.name_en, g.name_zh, g.table_no, g.seat_no, t.label_en, t.label_zh
      from guests g left join tables t on t.table_no = g.table_no
      where normalize_en(g.name_en) like '%' || norm || '%'
         or similarity(normalize_en(g.name_en), norm) > 0.4
      order by (normalize_en(g.name_en) like norm || '%') desc
      limit 20;
  end if; -- too-short queries return nothing
end $$;

create or replace function assign_seat(p_guest_id uuid, p_table_no int, p_seat_no int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_occupant uuid;
  v_old_table int; v_old_seat int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  set constraints guests_one_per_seat deferred;
  select g.table_no, g.seat_no into v_old_table, v_old_seat from guests g where g.id = p_guest_id;
  if not found then raise exception 'unknown guest'; end if;
  select g.id into v_occupant from guests g
    where g.table_no = p_table_no and g.seat_no = p_seat_no and g.id <> p_guest_id;
  if v_occupant is not null then
    update guests set table_no = v_old_table, seat_no = v_old_seat where id = v_occupant;
  end if;
  update guests set table_no = p_table_no, seat_no = p_seat_no where id = p_guest_id;
end $$;

create or replace function unseat(p_guest_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  update guests set table_no = null, seat_no = null where id = p_guest_id;
end $$;

create or replace function import_guests(rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  insert into guests (name_en, name_zh)
  select trim(coalesce(r->>'name_en', '')), trim(coalesce(r->>'name_zh', ''))
  from jsonb_array_elements(rows) r
  where trim(coalesce(r->>'name_en', '')) <> '' or trim(coalesce(r->>'name_zh', '')) <> ''
  on conflict on constraint guests_identity do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on all functions in schema public from anon, authenticated;
grant execute on function search_guests(text) to anon, authenticated;
grant execute on function assign_seat(uuid, int, int) to authenticated;
grant execute on function unseat(uuid) to authenticated;
grant execute on function import_guests(jsonb) to authenticated;
```

- [ ] **Step 3: Write the seed**

`supabase/seed.sql`:

```sql
insert into tables (table_no, label_en, label_zh)
select n, format('Table %s', n), format('%s号桌', n) from generate_series(1, 12) n;

insert into guests (name_en, name_zh, table_no, seat_no) values
  ('Carol Zhao',  '赵卡罗',   1, 1),
  ('Kevin Hu',    '胡凯文',   1, 2),
  ('Eric Dang',   '邓艾瑞',   1, 3),
  ('James Dang',  '邓杰姆斯', 1, 4),
  ('Victoria Li', '李维多',   2, 1),
  ('Eric Liu',    '刘艾瑞',   2, 2),
  ('Tiger Chen',  '陈泰格',   null, null),
  ('José García', '',         null, null),
  ('',            '王奶奶',   3, 1);
```

- [ ] **Step 4: Write the smoke assertions**

`supabase/smoke.sql`:

```sql
\set ON_ERROR_STOP on
begin;
-- simulate an authenticated user for RPC auth checks
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

do $$
declare n int;
begin
  select count(*) into n from search_guests('eric');   assert n = 2, 'eric should match 2';
  select count(*) into n from search_guests('e');      assert n = 0, 'short latin returns none';
  select count(*) into n from search_guests('刘');     assert n = 1, 'single CJK matches';
  select count(*) into n from search_guests('jose');   assert n = 1, 'diacritic-insensitive';
  select count(*) into n from search_guests('carolzhao'); assert n = 1, 'space-insensitive';
end $$;

do $$
declare a uuid; b uuid;
begin
  select id into a from guests where name_en = 'Carol Zhao';
  select id into b from guests where name_en = 'Kevin Hu';
  perform assign_seat(a, 1, 2);  -- Kevin sits there → swap
  assert (select seat_no from guests where id = a) = 2, 'carol moved';
  assert (select seat_no from guests where id = b) = 1, 'kevin swapped back';
  perform unseat(b);
  assert (select table_no from guests where id = b) is null, 'kevin unseated';
  perform assign_seat(b, 1, 1);
end $$;

do $$
declare n int;
begin
  select import_guests('[{"name_en":"New Guy","name_zh":"新人"},{"name_en":"Carol Zhao","name_zh":"赵卡罗"},{"name_en":"","name_zh":""}]'::jsonb) into n;
  assert n = 1, format('import inserts only the new row, got %s', n);
end $$;

-- anon must not read guests directly
do $$
begin
  set local role anon;
  begin
    perform count(*) from guests;
    raise exception 'anon read guests — RLS/grants broken';
  exception when insufficient_privilege then reset role;
  end;
end $$;
rollback;
select 'SMOKE OK' as result;
```

- [ ] **Step 5: Run it**

```bash
supabase start
supabase db reset          # applies migration + seed
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/smoke.sql
```

Expected: final line `SMOKE OK`. Fix SQL until clean.

- [ ] **Step 6: Commit** — `git add supabase && git commit -m "feat: schema, RLS, search/assign/swap/import RPCs + smoke"`

---

### Task 5: Shared types + API layer

**Files:**
- Create: `src/shared/types.ts`, `src/shared/api.ts`, `src/shared/toast.ts`
- Create: `.env.local` (not committed) with local `supabase status` values.

**Interfaces:**
- Produces:

```ts
// types.ts
export type SeatKey = string; // "3-5"
export interface Guest { id: string; name_en: string; name_zh: string; table_no: number | null; seat_no: number | null; }
export interface GuestMatch extends Guest { label_en: string | null; label_zh: string | null; }
export interface TableInfo { table_no: number; label_en: string; label_zh: string; }
export type { SeatMap } from '../../scripts/svg-transform';
export const seatKey = (t: number, s: number): SeatKey => `${t}-${s}`;
export const parseSeatKey = (k: SeatKey): { table: number; seat: number } => {
  const [t, s] = k.split('-').map(Number);
  return { table: t!, seat: s! };
};
```

```ts
// api.ts — every function throws Error(message) on failure
export async function searchGuests(q: string): Promise<GuestMatch[]>
export async function listGuests(): Promise<Guest[]>
export async function listTables(): Promise<TableInfo[]>
export async function assignSeat(guestId: string, seat: SeatKey): Promise<void>
export async function unseatGuest(guestId: string): Promise<void>
export async function importGuests(rows: { name_en: string; name_zh: string }[]): Promise<number>
export async function signIn(email: string, password: string): Promise<void>
export async function signOut(): Promise<void>
export async function hasSession(): Promise<boolean>
```

```ts
// toast.ts
export function toast(msg: string, opts?: { retry?: () => void }): void
```

- [ ] **Step 1: Implement** — `api.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import type { Guest, GuestMatch, SeatKey, TableInfo } from './types';
import { parseSeatKey } from './types';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const searchGuests = async (q: string): Promise<GuestMatch[]> =>
  unwrap(await supabase.rpc('search_guests', { q })) ?? [];
export const listGuests = async (): Promise<Guest[]> =>
  unwrap(await supabase.from('guests').select('*').order('name_en'));
export const listTables = async (): Promise<TableInfo[]> =>
  unwrap(await supabase.from('tables').select('*').order('table_no'));
export const assignSeat = async (guestId: string, seat: SeatKey): Promise<void> => {
  const { table, seat: s } = parseSeatKey(seat);
  unwrap(await supabase.rpc('assign_seat', { p_guest_id: guestId, p_table_no: table, p_seat_no: s }));
};
export const unseatGuest = async (guestId: string): Promise<void> => {
  unwrap(await supabase.rpc('unseat', { p_guest_id: guestId }));
};
export const importGuests = async (rows: { name_en: string; name_zh: string }[]): Promise<number> =>
  unwrap(await supabase.rpc('import_guests', { rows }));
export const signIn = async (email: string, password: string): Promise<void> => {
  unwrap(await supabase.auth.signInWithPassword({ email, password }));
};
export const signOut = async (): Promise<void> => { await supabase.auth.signOut(); };
export const hasSession = async (): Promise<boolean> =>
  !!(await supabase.auth.getSession()).data.session;
```

`toast.ts`:

```ts
export function toast(msg: string, opts: { retry?: () => void } = {}): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (opts.retry) {
    const b = document.createElement('button');
    b.textContent = 'Retry · 重试';
    b.onclick = () => { el.remove(); opts.retry!(); };
    el.append(b);
  }
  document.body.append(el);
  if (!opts.retry) setTimeout(() => el.remove(), 4000);
}
```

Add to `src/styles.css`:

```css
.toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  background: #333; color: #fff; padding: 10px 14px; border-radius: 8px;
  display: flex; gap: 10px; align-items: center; z-index: 99; max-width: 92vw; }
.toast button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 6px 10px; }
```

- [ ] **Step 2: Verify** — `npm run check` passes. Manual: with `supabase start` running and `.env.local` set, `npm run dev`, in browser console on `/`: `(await import('/src/shared/api.ts')).searchGuests('eric')` returns 2 rows.

- [ ] **Step 3: Commit** — `git add src/shared src/styles.css && git commit -m "feat: typed Supabase API layer + toast"`

---

### Task 6: Floorplan module

**Files:**
- Create: `src/shared/floorplan.ts`, `src/shared/floorplan.test.ts`

**Interfaces:**
- Consumes: `src/generated/floorplan.svg?raw`, `src/generated/seatmap.json` (Task 3), `SeatMap`/`SeatKey` (Task 5).
- Produces:

```ts
export interface Floorplan {
  svg: SVGSVGElement;
  seatEl(key: SeatKey): SVGGraphicsElement | null;
  highlight(key: SeatKey | null): void;                      // exclusive pulse
  setOccupied(key: SeatKey, occupied: boolean): void;        // host coloring
  addSeatLabel(key: SeatKey, text: string): void;            // host name labels
  clearSeatLabels(): void;
  zoomToSeat(key: SeatKey): void;                            // no-op when panZoom off
  onSeatTap(cb: (key: SeatKey) => void): void;
}
export function mountFloorplan(container: HTMLElement,
  opts?: { panZoom?: boolean; svgText?: string; seatMap?: SeatMap }): Floorplan
```

- [ ] **Step 1: Write the failing tests**

`src/shared/floorplan.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { mountFloorplan } from './floorplan';
import type { SeatMap } from './types';

const svgText = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g id="table-1"><path id="table-1-shape" d="M40 40 h20 v20 h-20 z"/>
  <path id="seat-1-1" class="seat" d="M45 20 h10 v10 h-10 z"/>
  <path id="seat-1-2" class="seat" d="M70 45 h10 v10 h-10 z"/></g></svg>`;
const seatMap: SeatMap = { viewBox: '0 0 100 100',
  tables: { '1': { cx: 50, cy: 50, r: 10 } },
  seats: { '1-1': { cx: 50, cy: 25 }, '1-2': { cx: 75, cy: 50 } } };

let container: HTMLElement;
beforeEach(() => { document.body.innerHTML = '<div id="c"></div>'; container = document.querySelector('#c')!; });
const mount = () => mountFloorplan(container, { panZoom: false, svgText, seatMap });

it('mounts inline and finds seats', () => {
  const fp = mount();
  expect(fp.seatEl('1-1')?.id).toBe('seat-1-1');
  expect(fp.seatEl('9-9')).toBeNull();
});
it('highlight is exclusive', () => {
  const fp = mount();
  fp.highlight('1-1'); fp.highlight('1-2');
  expect(fp.seatEl('1-1')?.classList.contains('highlight')).toBe(false);
  expect(fp.seatEl('1-2')?.classList.contains('highlight')).toBe(true);
  fp.highlight(null);
  expect(container.querySelectorAll('.highlight')).toHaveLength(0);
});
it('occupied toggling and labels', () => {
  const fp = mount();
  fp.setOccupied('1-1', true);
  expect(fp.seatEl('1-1')?.classList.contains('occupied')).toBe(true);
  fp.addSeatLabel('1-1', 'Carol Zhao');
  const label = container.querySelector('text.seat-label')!;
  expect(label.textContent).toBe('Carol Zhao');
  expect(Number(label.getAttribute('y'))).toBeLessThan(25); // pushed outward, away from table center
  fp.clearSeatLabels();
  expect(container.querySelectorAll('.seat-label')).toHaveLength(0);
});
it('delegates seat taps', () => {
  const fp = mount();
  const cb = vi.fn();
  fp.onSeatTap(cb);
  fp.seatEl('1-2')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(cb).toHaveBeenCalledWith('1-2');
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/shared` → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/shared/floorplan.ts`:

```ts
import svgPanZoom from 'svg-pan-zoom';
import generatedSvg from '../generated/floorplan.svg?raw';
import generatedMap from '../generated/seatmap.json';
import type { SeatKey, SeatMap } from './types';

export interface Floorplan {
  svg: SVGSVGElement;
  seatEl(key: SeatKey): SVGGraphicsElement | null;
  highlight(key: SeatKey | null): void;
  setOccupied(key: SeatKey, occupied: boolean): void;
  addSeatLabel(key: SeatKey, text: string): void;
  clearSeatLabels(): void;
  zoomToSeat(key: SeatKey): void;
  onSeatTap(cb: (key: SeatKey) => void): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function mountFloorplan(container: HTMLElement,
  opts: { panZoom?: boolean; svgText?: string; seatMap?: SeatMap } = {}): Floorplan {
  const seatMap = opts.seatMap ?? (generatedMap as SeatMap);
  container.innerHTML = opts.svgText ?? generatedSvg;
  const svg = container.querySelector('svg') as SVGSVGElement;
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.classList.add('floorplan');

  const pz = opts.panZoom !== false
    ? svgPanZoom(svg, { minZoom: 0.8, maxZoom: 12, zoomScaleSensitivity: 0.35, dblClickZoomEnabled: false })
    : null;

  const seatEl = (key: SeatKey) => svg.querySelector<SVGGraphicsElement>(`#seat-${CSS.escape(key)}`)
    ?? svg.querySelector<SVGGraphicsElement>(`[id="seat-${key}"]`);

  return {
    svg,
    seatEl,
    highlight(key) {
      svg.querySelectorAll('.highlight').forEach(e => e.classList.remove('highlight'));
      if (key) seatEl(key)?.classList.add('highlight');
    },
    setOccupied(key, occupied) { seatEl(key)?.classList.toggle('occupied', occupied); },
    addSeatLabel(key, text) {
      const seat = seatMap.seats[key]; if (!seat) return;
      const table = seatMap.tables[key.split('-')[0]!];
      let { cx, cy } = seat;
      if (table) { // push label outward along table→seat direction
        const d = Math.hypot(cx - table.cx, cy - table.cy) || 1;
        cx += ((cx - table.cx) / d) * 16; cy += ((cy - table.cy) / d) * 16;
      }
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(cx)); t.setAttribute('y', String(cy));
      t.setAttribute('class', 'seat-label'); t.textContent = text;
      svg.append(t);
    },
    clearSeatLabels() { svg.querySelectorAll('.seat-label').forEach(e => e.remove()); },
    zoomToSeat(key) {
      const seat = seatMap.seats[key]; if (!seat || !pz) return;
      pz.zoom(5);
      const { width, height, realZoom } = pz.getSizes();
      pz.pan({ x: width / 2 - seat.cx * realZoom, y: height / 2 - seat.cy * realZoom });
    },
    onSeatTap(cb) {
      svg.addEventListener('click', e => {
        const hit = (e.target as Element).closest('[id^="seat-"]');
        if (hit) cb(hit.id.slice('seat-'.length));
      });
    },
  };
}
```

Add to `src/styles.css`:

```css
.map { position: relative; height: 60vh; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.floorplan { width: 100%; height: 100%; display: block; touch-action: none; }
.seat.occupied { fill: #7a9e7e !important; }
.seat.highlight { animation: pulse 1.1s ease-in-out infinite; fill: var(--accent) !important; stroke: var(--accent) !important; stroke-width: 3; }
@keyframes pulse { 50% { opacity: 0.35; } }
.seat-label { font-size: 9px; text-anchor: middle; fill: #333; pointer-events: none; }
```

(`!important` is required: Affinity writes inline `style="fill:…"` on paths, and an `!important` stylesheet rule is the one thing that beats inline styles.)

- [ ] **Step 4: Run tests** — `npx vitest run src/shared` → 4 passed. Note: jsdom lacks `CSS.escape`? It exists in jsdom ≥ 20 — if not, the fallback selector line covers it.

- [ ] **Step 5: Commit** — `git add src/shared src/styles.css && git commit -m "feat: floorplan mount/highlight/labels/pan-zoom module"`

---

### Task 7: Search logic (USER CONTRIBUTION)

**Files:**
- Create: `src/logic/search.ts`, `src/logic/search.test.ts`

**Interfaces:**
- Consumes: `GuestMatch` (Task 5).
- Produces:

```ts
export type PreparedQuery = { kind: 'en' | 'zh'; q: string } | { kind: 'too-short' };
export function normalizeEn(s: string): string;      // provided helper
export function hasCjk(s: string): boolean;          // provided helper
export function prepareQuery(raw: string): PreparedQuery;                       // USER CONTRIB
export function rankMatches(p: PreparedQuery, matches: GuestMatch[]): GuestMatch[]; // USER CONTRIB
```

- [ ] **Step 1: Write failing tests**

`src/logic/search.test.ts`:

```ts
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
```

- [ ] **Step 2: Create stub with helpers implemented**

`src/logic/search.ts`:

```ts
import type { GuestMatch } from '../shared/types';

export type PreparedQuery = { kind: 'en' | 'zh'; q: string } | { kind: 'too-short' };

export const normalizeEn = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');

export const hasCjk = (s: string): boolean => /[一-鿿]/.test(s);

/**
 * USER CONTRIBUTION (Corey): classify raw input.
 * Any CJK char present → {kind:'zh', q: input minus whitespace} (≥1 CJK char is enough).
 * Otherwise normalizeEn it → need ≥2 chars, else {kind:'too-short'}.
 */
export function prepareQuery(raw: string): PreparedQuery {
  throw new Error('not implemented yet'); // TODO(Corey)
}

/**
 * USER CONTRIBUTION (Corey): order server matches for display.
 * Score each guest's relevant name (name_en normalized for 'en', name_zh
 * whitespace-stripped for 'zh'): exact match < starts-with < contains < anything
 * else the server sent (fuzzy) — ascending score, stable within ties.
 * Never filter anything out: the server already decided what matches.
 */
export function rankMatches(p: PreparedQuery, matches: GuestMatch[]): GuestMatch[] {
  throw new Error('not implemented yet'); // TODO(Corey)
}
```

- [ ] **Step 3: Run tests, verify helper tests pass and Corey's fail** — `npx vitest run src/logic/search.test.ts`.

- [ ] **Step 4: PAUSE — hand to Corey** with the guidance in the doc comments (~6 lines and ~12 lines). This encodes the product decision of how forgiving name-finding feels to guests.

- [ ] **Step 5: Run tests to verify all pass.**

- [ ] **Step 6: Commit** — `git add src/logic && git commit -m "feat: bilingual query prep + result ranking (Corey)"`

---

### Task 8: Guest page

**Files:**
- Modify: `index.html`, `src/guest/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `searchGuests` (T5), `mountFloorplan` (T6), `prepareQuery`/`rankMatches` (T7), `toast` (T5), `seatKey` (T5).

- [ ] **Step 1: Implement page**

`index.html` main content:

```html
<main class="guest">
  <div class="searchbar">
    <input id="q" type="search" autocomplete="off"
      placeholder="Your name (English or 中文) · 输入您的姓名" />
  </div>
  <div id="results" class="results"></div>
  <div id="banner" class="banner" hidden></div>
  <div id="map" class="map"></div>
</main>
```

`src/guest/main.ts`:

```ts
import { searchGuests } from '../shared/api';
import { mountFloorplan } from '../shared/floorplan';
import { toast } from '../shared/toast';
import { prepareQuery, rankMatches } from '../logic/search';
import { seatKey, type GuestMatch } from '../shared/types';

const fp = mountFloorplan(document.querySelector('#map')!);
const input = document.querySelector<HTMLInputElement>('#q')!;
const results = document.querySelector<HTMLElement>('#results')!;
const banner = document.querySelector<HTMLElement>('#banner')!;

const displayName = (g: GuestMatch) => [g.name_en, g.name_zh].filter(Boolean).join(' · ');

function showGuest(g: GuestMatch): void {
  results.innerHTML = '';
  if (g.table_no == null || g.seat_no == null) {
    banner.hidden = false;
    banner.textContent = `${displayName(g)} — no seat assigned yet · 尚未安排座位`;
    fp.highlight(null);
    return;
  }
  const key = seatKey(g.table_no, g.seat_no);
  banner.hidden = false;
  banner.innerHTML = `<strong>${displayName(g)}</strong><br>` +
    `${g.label_en ?? `Table ${g.table_no}`} · ${g.label_zh ?? `${g.table_no}号桌`}` +
    ` <small>Seat ${g.seat_no} · ${g.seat_no}号位</small>`;
  fp.highlight(key);
  fp.zoomToSeat(key);
}

function renderResults(matches: GuestMatch[]): void {
  banner.hidden = true;
  results.innerHTML = '';
  if (!matches.length) {
    results.innerHTML = `<p class="empty">Can't find your name? Ask at the welcome table.<br>找不到您的名字？请到迎宾台咨询。</p>`;
    return;
  }
  for (const g of matches) {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<span>${displayName(g)}</span><small>${g.label_en ?? ''} · ${g.label_zh ?? ''}</small>`;
    b.onclick = () => showGuest(g);
    results.append(b);
  }
  if (matches.length === 1) showGuest(matches[0]!);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let lastRun = () => {};
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const p = prepareQuery(input.value);
    if (p.kind === 'too-short') { results.innerHTML = ''; banner.hidden = true; fp.highlight(null); return; }
    lastRun = async () => {
      try { renderResults(rankMatches(p, await searchGuests(p.q))); }
      catch { toast('Connection trouble · 网络异常', { retry: lastRun }); }
    };
    lastRun();
  }, 250);
});
```

Add to `src/styles.css`:

```css
.guest { display: flex; flex-direction: column; gap: 10px; padding: 12px; max-width: 720px; margin: 0 auto; }
.searchbar input { width: 100%; font-size: 18px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; }
.results { display: flex; flex-direction: column; gap: 6px; }
.card { display: flex; justify-content: space-between; gap: 8px; padding: 12px; font-size: 16px;
  background: #fff; border: 1px solid var(--line); border-radius: 10px; text-align: left; }
.card small { color: var(--muted); }
.banner { padding: 12px; background: #fff; border: 1px solid var(--line); border-radius: 10px; font-size: 16px; }
.empty { color: var(--muted); text-align: center; padding: 8px; }
```

- [ ] **Step 2: Manual verify** (`supabase start` + `.env.local` + `npm run dev`): search `eric` → two cards; tap → map zooms, chair pulses, banner shows table bilingually. Search `刘` → one card. Search `zzz` → bilingual empty state. Stop supabase → search → toast with working Retry. Check on a phone-sized viewport; pinch/pan works.

- [ ] **Step 3: Commit** — `git add index.html src/guest src/styles.css && git commit -m "feat: guest seat-finder page"`

---

### Task 9: Host auth gate

**Files:**
- Create: `src/host/auth.ts`
- Modify: `host.html`, `src/host/main.ts` (still placeholder body behind auth), `src/styles.css`

**Interfaces:**
- Produces: `requireAuth(onReady: () => void): void` — renders login form into `#app` if no session; calls `onReady` once authenticated. Adds a signout button to `.topbar`.

- [ ] **Step 1: Implement**

`src/host/auth.ts`:

```ts
import { hasSession, signIn, signOut } from '../shared/api';
import { toast } from '../shared/toast';

export function requireAuth(onReady: () => void): void {
  void (async () => {
    if (await hasSession()) return ready(onReady);
    const app = document.querySelector('#app')!;
    app.innerHTML = `
      <form class="login">
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required />
        <button>Sign in</button>
      </form>`;
    app.querySelector('form')!.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      try {
        await signIn(String(f.get('email')), String(f.get('password')));
        ready(onReady);
      } catch (err) { toast(err instanceof Error ? err.message : 'Sign-in failed'); }
    });
  })();
}

function ready(onReady: () => void): void {
  const out = document.createElement('button');
  out.textContent = 'Sign out';
  out.className = 'signout';
  out.onclick = async () => { await signOut(); location.reload(); };
  document.querySelector('.topbar')!.append(out);
  onReady();
}
```

`src/host/main.ts`: `import { requireAuth } from './auth'; requireAuth(() => { document.querySelector('#app')!.textContent = 'authed'; });`

CSS: `.login { display:flex; flex-direction:column; gap:8px; max-width:320px; margin:48px auto; } .login input,.login button { padding:10px; font-size:16px; } .topbar { display:flex; justify-content:space-between; align-items:center; } .signout { border:0; background:none; color:var(--muted); }`

- [ ] **Step 2: Manual verify** — create local user: `supabase auth` has no CLI add; instead in Studio (`http://127.0.0.1:54323`) → Authentication → Add user (`host@test.dev` / password). Load `/host.html`, wrong password → toast; right → "authed" + Sign out works.

- [ ] **Step 3: Commit** — `git add host.html src/host src/styles.css && git commit -m "feat: host auth gate"`

---

### Task 10: Seat-action state machine

**Files:**
- Create: `src/logic/seat-actions.ts`, `src/logic/seat-actions.test.ts`

**Interfaces:**
- Produces (pure, no DOM/network):

```ts
export type Mode =
  | { kind: 'idle' }
  | { kind: 'seat-open'; seat: SeatKey; occupantId: string | null }
  | { kind: 'picking-dest'; movingId: string; fromSeat: SeatKey };
export type Command =
  | { type: 'none' }
  | { type: 'assign'; guestId: string; seat: SeatKey }   // server swaps if occupied
  | { type: 'unseat'; guestId: string };
export interface Step { mode: Mode; command: Command; }
export const idle: Mode = { kind: 'idle' };
export function tapSeat(m: Mode, seat: SeatKey, occupantId: string | null): Step;
export function pickUnseated(m: Mode, guestId: string): Step; // sidebar/panel guest pick
export function pressUnseat(m: Mode): Step;
export function pressMove(m: Mode): Step;
export function cancel(m: Mode): Step;
```

- [ ] **Step 1: Write failing tests**

`src/logic/seat-actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cancel, idle, pickUnseated, pressMove, pressUnseat, tapSeat, type Mode } from './seat-actions';

const none = { type: 'none' } as const;

describe('seat-actions', () => {
  it('tap opens a seat panel', () => {
    expect(tapSeat(idle, '3-5', 'g1')).toEqual({ mode: { kind: 'seat-open', seat: '3-5', occupantId: 'g1' }, command: none });
  });
  it('tap another seat re-targets the panel', () => {
    const m: Mode = { kind: 'seat-open', seat: '3-5', occupantId: 'g1' };
    expect(tapSeat(m, '4-1', null).mode).toEqual({ kind: 'seat-open', seat: '4-1', occupantId: null });
  });
  it('picking a guest for an empty seat assigns and closes', () => {
    const m: Mode = { kind: 'seat-open', seat: '4-1', occupantId: null };
    expect(pickUnseated(m, 'g9')).toEqual({ mode: idle, command: { type: 'assign', guestId: 'g9', seat: '4-1' } });
  });
  it('unseat from an occupied seat', () => {
    const m: Mode = { kind: 'seat-open', seat: '3-5', occupantId: 'g1' };
    expect(pressUnseat(m)).toEqual({ mode: idle, command: { type: 'unseat', guestId: 'g1' } });
  });
  it('move → picking-dest → tap target assigns (swap server-side)', () => {
    const open: Mode = { kind: 'seat-open', seat: '3-5', occupantId: 'g1' };
    const picking = pressMove(open);
    expect(picking).toEqual({ mode: { kind: 'picking-dest', movingId: 'g1', fromSeat: '3-5' }, command: none });
    expect(tapSeat(picking.mode, '7-2', 'g4')).toEqual({ mode: idle, command: { type: 'assign', guestId: 'g1', seat: '7-2' } });
  });
  it('tapping the origin seat while picking cancels', () => {
    const m: Mode = { kind: 'picking-dest', movingId: 'g1', fromSeat: '3-5' };
    expect(tapSeat(m, '3-5', 'g1')).toEqual({ mode: idle, command: none });
  });
  it('cancel always returns to idle without a command', () => {
    expect(cancel({ kind: 'picking-dest', movingId: 'g1', fromSeat: '3-5' })).toEqual({ mode: idle, command: none });
    expect(cancel({ kind: 'seat-open', seat: '1-1', occupantId: null })).toEqual({ mode: idle, command: none });
  });
  it('illegal events are no-ops', () => {
    expect(pressMove(idle)).toEqual({ mode: idle, command: none });
    expect(pressUnseat({ kind: 'seat-open', seat: '1-1', occupantId: null })).toEqual({ mode: { kind: 'seat-open', seat: '1-1', occupantId: null }, command: none });
    expect(pickUnseated(idle, 'g1')).toEqual({ mode: idle, command: none });
  });
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement**

`src/logic/seat-actions.ts`:

```ts
import type { SeatKey } from '../shared/types';

export type Mode =
  | { kind: 'idle' }
  | { kind: 'seat-open'; seat: SeatKey; occupantId: string | null }
  | { kind: 'picking-dest'; movingId: string; fromSeat: SeatKey };
export type Command =
  | { type: 'none' }
  | { type: 'assign'; guestId: string; seat: SeatKey }
  | { type: 'unseat'; guestId: string };
export interface Step { mode: Mode; command: Command; }

export const idle: Mode = { kind: 'idle' };
const stay = (mode: Mode): Step => ({ mode, command: { type: 'none' } });

export function tapSeat(m: Mode, seat: SeatKey, occupantId: string | null): Step {
  if (m.kind === 'picking-dest') {
    if (seat === m.fromSeat) return stay(idle);
    return { mode: idle, command: { type: 'assign', guestId: m.movingId, seat } };
  }
  return stay({ kind: 'seat-open', seat, occupantId });
}
export function pickUnseated(m: Mode, guestId: string): Step {
  if (m.kind !== 'seat-open' || m.occupantId !== null) return stay(m);
  return { mode: idle, command: { type: 'assign', guestId, seat: m.seat } };
}
export function pressUnseat(m: Mode): Step {
  if (m.kind !== 'seat-open' || m.occupantId === null) return stay(m);
  return { mode: idle, command: { type: 'unseat', guestId: m.occupantId } };
}
export function pressMove(m: Mode): Step {
  if (m.kind !== 'seat-open' || m.occupantId === null) return stay(m);
  return stay({ kind: 'picking-dest', movingId: m.occupantId, fromSeat: m.seat });
}
export function cancel(_m: Mode): Step { return stay(idle); }
```

- [ ] **Step 4: Run tests** — 8 passed. **Step 5: Commit** — `git commit -m "feat: click-to-assign/move/swap state machine"`

---

### Task 11: Host map + panel UI

**Files:**
- Modify: `src/host/main.ts`, `host.html`, `src/styles.css`

**Interfaces:**
- Consumes: everything from Tasks 5, 6, 10.

- [ ] **Step 1: Implement**

`host.html` main:

```html
<main class="hostwrap">
  <div id="app">
    <div id="map" class="map tall"></div>
    <aside class="sidebar">
      <h2>Unseated · 未安排 <span id="unseated-count" class="badge"></span></h2>
      <div id="unseated"></div>
      <details id="import-box"><summary>Import guests (CSV) · 导入宾客</summary><div id="import"></div></details>
    </aside>
    <div id="panel" class="panel" hidden></div>
  </div>
</main>
```

`src/host/main.ts`:

```ts
import { assignSeat, listGuests, unseatGuest } from '../shared/api';
import { mountFloorplan, type Floorplan } from '../shared/floorplan';
import { toast } from '../shared/toast';
import { requireAuth } from './auth';
import { mountImport } from './import';
import * as sm from '../logic/seat-actions';
import { seatKey, type Guest, type SeatKey } from '../shared/types';

let fp: Floorplan;
let guests: Guest[] = [];
let mode: sm.Mode = sm.idle;
const bySeat = new Map<SeatKey, Guest>();
const panel = () => document.querySelector<HTMLElement>('#panel')!;
const nameOf = (g: Guest) => [g.name_en, g.name_zh].filter(Boolean).join(' · ');

async function refresh(): Promise<void> {
  try { guests = await listGuests(); } catch { return toast('Load failed · 加载失败', { retry: refresh }); }
  bySeat.clear();
  fp.clearSeatLabels();
  document.querySelectorAll('.seat.occupied').forEach(e => e.classList.remove('occupied'));
  for (const g of guests) {
    if (g.table_no == null || g.seat_no == null) continue;
    const key = seatKey(g.table_no, g.seat_no);
    bySeat.set(key, g);
    fp.setOccupied(key, true);
    fp.addSeatLabel(key, g.name_en || g.name_zh);
  }
  const unseated = guests.filter(g => g.table_no == null);
  document.querySelector('#unseated-count')!.textContent = String(unseated.length);
  const list = document.querySelector<HTMLElement>('#unseated')!;
  list.innerHTML = '';
  for (const g of unseated) {
    const b = document.createElement('button');
    b.className = 'card'; b.textContent = nameOf(g);
    b.onclick = () => step(sm.pickUnseated(mode, g.id));
    list.append(b);
  }
}

async function runCommand(c: sm.Command): Promise<void> {
  try {
    if (c.type === 'assign') await assignSeat(c.guestId, c.seat);
    if (c.type === 'unseat') await unseatGuest(c.guestId);
  } catch (e) { toast(e instanceof Error ? e.message : 'Failed · 操作失败'); }
  if (c.type !== 'none') await refresh();
}

function renderMode(): void {
  document.body.classList.toggle('picking', mode.kind === 'picking-dest');
  const p = panel();
  if (mode.kind === 'idle') { p.hidden = true; fp.highlight(null); return; }
  p.hidden = false;
  if (mode.kind === 'picking-dest') {
    fp.highlight(mode.fromSeat);
    p.innerHTML = `<p>Tap the destination chair — occupied chairs swap. · 点击目标座位（有人则交换）</p>
      <button id="cancel">Cancel · 取消</button>`;
  } else {
    fp.highlight(mode.seat);
    const g = mode.occupantId ? guests.find(x => x.id === mode.occupantId) : null;
    p.innerHTML = g
      ? `<p><strong>${nameOf(g)}</strong> — seat ${mode.seat}</p>
         <button id="move">Move / Swap · 移动</button> <button id="unseat">Unseat · 取消座位</button> <button id="cancel">Close · 关闭</button>`
      : `<p>Empty seat ${mode.seat} · 空位 — pick a guest below or from the unseated list</p>
         <input id="pick-filter" placeholder="Filter unseated · 筛选" /><div id="pick-list"></div>
         <button id="cancel">Close · 关闭</button>`;
    if (!g) renderPickList('');
    p.querySelector('#pick-filter')?.addEventListener('input', e =>
      renderPickList((e.target as HTMLInputElement).value));
    p.querySelector('#move')?.addEventListener('click', () => step(sm.pressMove(mode)));
    p.querySelector('#unseat')?.addEventListener('click', () => step(sm.pressUnseat(mode)));
  }
  p.querySelector('#cancel')?.addEventListener('click', () => step(sm.cancel(mode)));
}

function renderPickList(filter: string): void {
  const box = panel().querySelector<HTMLElement>('#pick-list');
  if (!box) return;
  box.innerHTML = '';
  const f = filter.trim().toLowerCase();
  for (const g of guests.filter(g => g.table_no == null &&
      (!f || g.name_en.toLowerCase().includes(f) || g.name_zh.includes(f)))) {
    const b = document.createElement('button');
    b.className = 'card'; b.textContent = nameOf(g);
    b.onclick = () => step(sm.pickUnseated(mode, g.id));
    box.append(b);
  }
}

function step(s: sm.Step): void {
  mode = s.mode;
  renderMode();
  void runCommand(s.command);
}

requireAuth(() => {
  fp = mountFloorplan(document.querySelector('#map')!);
  fp.onSeatTap(key => step(sm.tapSeat(mode, key, bySeat.get(key)?.id ?? null)));
  mountImport(document.querySelector('#import')!, refresh);
  void refresh();
});
```

CSS additions:

```css
.hostwrap #app { display: grid; grid-template-columns: 1fr 300px; gap: 12px; padding: 12px; }
.map.tall { height: calc(100vh - 120px); }
.sidebar { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.badge { background: var(--accent); color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 13px; }
.panel { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 2px solid var(--line);
  padding: 12px 16px 20px; z-index: 50; box-shadow: 0 -4px 16px rgba(0,0,0,.12); }
.panel button { padding: 10px 14px; font-size: 15px; border-radius: 8px; border: 1px solid var(--line); background: #fff; }
body.picking .floorplan { cursor: crosshair; }
body.picking .seat:not(.highlight) { opacity: .75; }
@media (max-width: 800px) { .hostwrap #app { grid-template-columns: 1fr; } .map.tall { height: 55vh; } }
```

(`mountImport` doesn't exist until Task 12 — create `src/host/import.ts` now with a stub `export function mountImport(_el: HTMLElement, _onDone: () => void): void {}` so this task compiles and commits green.)

- [ ] **Step 2: Manual verify** (local supabase + seeded data): map shows green occupied chairs with names; tap empty chair → panel with pick list, assigning seats a guest; tap occupied → Move → tap another occupied chair → the two swap (both labels flip); Unseat works; sidebar count updates each time; killing supabase mid-action produces a toast, UI stays consistent after restart + retry.

- [ ] **Step 3: Commit** — `git add host.html src/host src/styles.css && git commit -m "feat: host map with click-to-assign/move/swap panel"`

---

### Task 12: CSV import

**Files:**
- Create: `src/logic/csv.ts`, `src/logic/csv.test.ts`
- Modify: `src/host/import.ts` (replace Task 11 stub)

**Interfaces:**
- Produces: `parseGuestCsv(text: string): { rows: { name_en: string; name_zh: string }[]; skipped: number }` — accepts Google Sheets/Excel CSV: optional header row, UTF-8 BOM, CRLF, quoted fields; two columns (English, Chinese); rows with both cells empty are skipped and counted. `mountImport(el: HTMLElement, onDone: () => void): void`.

- [ ] **Step 1: Write failing tests**

`src/logic/csv.test.ts`:

```ts
import { expect, it } from 'vitest';
import { parseGuestCsv } from './csv';

it('parses plain rows', () => {
  expect(parseGuestCsv('Carol Zhao,赵卡罗\nKevin Hu,胡凯文').rows).toEqual([
    { name_en: 'Carol Zhao', name_zh: '赵卡罗' },
    { name_en: 'Kevin Hu', name_zh: '胡凯文' },
  ]);
});
it('strips BOM, skips header, handles CRLF and trailing newline', () => {
  const text = '﻿English Name,中文姓名\r\nCarol Zhao,赵卡罗\r\n';
  expect(parseGuestCsv(text).rows).toEqual([{ name_en: 'Carol Zhao', name_zh: '赵卡罗' }]);
});
it('handles quoted fields with commas and escaped quotes', () => {
  expect(parseGuestCsv('"Zhao, Carol ""CC""",赵卡罗').rows).toEqual([{ name_en: 'Zhao, Carol "CC"', name_zh: '赵卡罗' }]);
});
it('skips fully-empty rows and counts them', () => {
  const r = parseGuestCsv('Carol Zhao,\n,\n,王奶奶');
  expect(r.rows).toEqual([{ name_en: 'Carol Zhao', name_zh: '' }, { name_en: '', name_zh: '王奶奶' }]);
  expect(r.skipped).toBe(1);
});
```

- [ ] **Step 2: Verify failure, then implement**

`src/logic/csv.ts`:

```ts
export function parseGuestCsv(text: string): { rows: { name_en: string; name_zh: string }[]; skipped: number } {
  const cells = split(text.replace(/^﻿/, '')); // Excel/Sheets BOM
  const rows: { name_en: string; name_zh: string }[] = [];
  let skipped = 0;
  for (const [i, line] of cells.entries()) {
    const name_en = (line[0] ?? '').trim();
    const name_zh = (line[1] ?? '').trim();
    if (i === 0 && /name|english|中文|姓名/i.test(name_en + name_zh)) continue; // header
    if (!name_en && !name_zh) { if (line.length) skipped++; continue; }
    rows.push({ name_en, name_zh });
  }
  return { rows, skipped };
}

function split(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const push = () => { row.push(cell); cell = ''; };
  const pushRow = () => { push(); if (row.some(c => c !== '')) out.push(row); else if (row.length > 1) out.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') push();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) pushRow();
  return out;
}
```

Adjust until the four tests pass exactly (the empty-row bookkeeping is fiddly; the tests are the contract).

- [ ] **Step 3: Implement the import UI**

`src/host/import.ts`:

```ts
import { importGuests } from '../shared/api';
import { toast } from '../shared/toast';
import { parseGuestCsv } from '../logic/csv';

export function mountImport(el: HTMLElement, onDone: () => void): void {
  el.innerHTML = `
    <p>Export the Google Sheet as CSV (two columns: English, 中文) and paste it here.</p>
    <textarea id="csv" rows="6" placeholder="Carol Zhao,赵卡罗"></textarea>
    <div id="csv-preview"></div>
    <button id="csv-go" disabled>Import</button>`;
  const ta = el.querySelector<HTMLTextAreaElement>('#csv')!;
  const preview = el.querySelector<HTMLElement>('#csv-preview')!;
  const go = el.querySelector<HTMLButtonElement>('#csv-go')!;
  let rows: { name_en: string; name_zh: string }[] = [];
  ta.addEventListener('input', () => {
    const r = parseGuestCsv(ta.value);
    rows = r.rows;
    preview.textContent = rows.length
      ? `${rows.length} guests ready (${r.skipped} empty rows skipped). First: ${rows[0]!.name_en || rows[0]!.name_zh}`
      : 'Nothing parseable yet.';
    go.disabled = !rows.length;
  });
  go.addEventListener('click', async () => {
    try {
      const n = await importGuests(rows);
      toast(`Imported ${n} new guests (${rows.length - n} already existed)`);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed'); }
  });
}
```

- [ ] **Step 4: Run all tests + manual verify** — `npm run test` all green. Manually: paste a 3-row CSV including one duplicate of a seeded guest → toast reports `Imported 2 new guests (1 already existed)`; they appear in the unseated sidebar.

- [ ] **Step 5: Commit** — `git add src/logic src/host && git commit -m "feat: CSV import with preview and dedupe"`

---

### Task 13: Deploy plumbing + QR + runbook

**Files:**
- Create: `netlify.toml`, `scripts/make-qr.ts`, `docs/deploy-runbook.md`

- [ ] **Step 1:** `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

- [ ] **Step 2:** `scripts/make-qr.ts`:

```ts
import { toFile } from 'qrcode';
const url = process.argv[2];
if (!url) { console.error('usage: npm run qr -- https://your-site.netlify.app'); process.exit(1); }
await toFile('qr.png', url, { width: 1200, margin: 2 });
console.log(`wrote qr.png → ${url}`);
```

- [ ] **Step 3:** `docs/deploy-runbook.md` — the exact click-path: create Supabase project → `supabase link --project-ref <ref>` → `supabase db push` → run `seed.sql` tables-insert only (NOT sample guests) via SQL editor → Dashboard → Auth → Add user (real host account) → Netlify: import repo, set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars → deploy → `npm run qr -- <url>` → print. Include the day-before checklist: real SVG through `npm run svg`, real guest CSV imported, spot-check 3 guests from a phone.

- [ ] **Step 4: Full-suite gate** — `npm run test && npm run check && npm run build` all green.

- [ ] **Step 5: Commit** — `git add netlify.toml scripts docs && git commit -m "chore: deploy config, QR generator, runbook"`

---

### Task 14: Real floorplan swap-in (blocked on Corey's Affinity work)

**Files:**
- Modify: `assets/floorplan/` (new export), `src/generated/*` (regenerated)

- [ ] **Step 1:** Corey finishes the Affinity file per the spec checklist (name 12 groups `table-1`…`table-12`, delete mockup table + name labels) and exports over `seating_affinity.svg` → move/copy to `assets/floorplan/venue.svg`.
- [ ] **Step 2:** `npm run svg -- assets/floorplan/venue.svg --force` (first real run replaces the dev map; `--force` because the dev seatmap's positions are unrelated).
- [ ] **Step 3:** Verify: `grep -c 'id="seat-'` → 96; `npm run test`; open guest + host pages, confirm all 12 tables tappable, seat 1 of each table sits where Corey expects 12 o'clock, embedded JPEG still looks right and file size dropped.
- [ ] **Step 4:** If the venue JPEG contains text Corey doesn't want published (venue name etc.), decide now; otherwise proceed.
- [ ] **Step 5: Commit** — `git add assets src/generated && git commit -m "feat: real venue floorplan"`

---

## Verification (whole-plan)

1. `npm run test` — geometry, transform, search, state machine, CSV all green.
2. `psql … -f supabase/smoke.sql` — `SMOKE OK`.
3. Manual e2e on a phone viewport: guest finds a seeded guest in both languages; host swaps two guests; guest search reflects it within one search.
4. `npm run build` → `npm run preview` — both pages work against local Supabase.
