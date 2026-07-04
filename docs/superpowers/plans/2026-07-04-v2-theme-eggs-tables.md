# Wedding Seating v2 Implementation Plan — Theme, Eggs, Table Names, Localization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botanical Garden theme on both pages, petal/sweetheart easter eggs, tap-to-edit custom table names, and guest-page EN/中文 localization (auto-detect + toggle) on the shipped v1 app.

**Architecture:** All additive to v1's vanilla-TS structure: a no-library `i18n.ts` string dict for the guest page; decorative `effects.ts` + `couple.ts` modules; one new admin-gated RPC (`set_table_label`, migration 0002); `svg-transform` gains landmark extraction; `floorplan.ts` gains `zoomToPoint`/`onTap`/`setTableLabels`. The host page drops its bilingual strings (English-only).

**Tech Stack:** unchanged (Vite, vanilla TS, Supabase, Vitest, Playwright) + `@fontsource/fraunces` (self-hosted font, the only new dependency).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-v2-theme-eggs-tables-design.md`. v1 constraints stand except: **guest UI is single-language per locale** (localStorage `locale` > `navigator.language` zh-prefix > `'en'`); **host page is English-only**.
- Guest **names** always render dual (`name_en · name_zh` joined with ' · ', skipping empty parts) in both locales. Table labels are **name-only**: locale zh → `label_zh`, en → `label_en` (DB defaults are `Table {n}`/`{n}号桌`, so unnamed tables still read sensibly).
- Theme tokens (exact): `--ink:#3c4a3e; --accent-deep:#4e6b51; --accent:#7d9480; --bg:#f4f6f0; --line:#d5ddd0; --gold:#87795a; --highlight:#c2482f`. The seat `.highlight`/`.occupied` `!important` rules and the highlight color are UNCHANGED.
- Effects are decorative: wrapped in try/catch, never throw into the search flow; `prefers-reduced-motion: reduce` disables petals. Guest map table labels may silently skip on fetch failure (spec-documented exception to no-silent-failures).
- Couple config: `Corey Hu` / `Lindsey Tam`, `name_zh: ''` (empty never matches). Couple match is EXACT (normalized equality), never substring.
- Payload budget: theme + fonts ≤ 120KB added; no CJK webfonts; no CDN URLs anywhere.
- TS strict; `npm run check` green before every commit; commit only the task's files; local Supabase stack assumed running (`supabase start` if not; test admin host@test.dev/password123 already in `admins`).
- All 36 v1 unit tests and 14 v1 e2e checks must stay green throughout. e2e runs: `npx vite --port 5199 --strictPort` in background + `npm run e2e`.

## File Structure

```
src/guest/i18n.ts (new)        locale detect/persist/toggle + string dict + t()
src/guest/effects.ts (new)     burstPetals
src/guest/couple.ts (new)      COUPLE config + matchesCouple
supabase/migrations/0002_table_labels.sql (new)
scripts/svg-transform.ts       + landmarks extraction (SeatMap.landmarks)
src/shared/floorplan.ts        + zoomToPoint/zoomToLandmark, onSeatTap→onTap, setTableLabels
src/shared/api.ts              + setTableLabel
src/shared/toast.ts            + optional retryLabel
src/styles.css                 botanical rewrite
index.html / host.html         header flourish, lang toggle (guest), English host title
src/guest/main.ts              i18n wiring, couple check, petals, map labels
src/host/main.ts               table-tap editor, English copy, map labels
scripts/e2e.mjs                +5 checks
supabase/smoke.sql             +set_table_label asserts
```

---

### Task 1: Landmarks + zoom refactor

**Files:**
- Modify: `scripts/svg-transform.ts` (SeatMap interface + extraction after the table loop), `scripts/svg-transform.test.ts`, `src/shared/floorplan.ts`, `src/shared/floorplan.test.ts`
- Regenerate + commit: `src/generated/floorplan.svg`, `src/generated/seatmap.json`

**Interfaces:**
- Consumes: v1 `transformFloorplan`, `pathPoints`, `centroid`, `Floorplan`.
- Produces: `SeatMap.landmarks: Record<string, { cx: number; cy: number }>`; `Floorplan.zoomToPoint(cx: number, cy: number): void`; `Floorplan.zoomToLandmark(id: string): void` (safe no-op if unknown/panZoom off). `zoomToSeat` behavior unchanged.

- [ ] **Step 1: Write failing tests**

Append to `scripts/svg-transform.test.ts`:

```ts
describe('landmarks', () => {
  const withLandmarks = src.replace('</svg>',
    `<g id="sweetheart_table"><circle cx="700" cy="80" r="20"/><path d="M 690 70 L 710 70 L 710 90 L 690 90 Z"/></g>
     <path id="bar" d="M 100 1000 L 140 1000 L 140 1040 L 100 1040 Z"/></svg>`);
  it('extracts non-table ids with centers', () => {
    const { seatMap } = transformFloorplan(withLandmarks, null);
    expect(seatMap.landmarks['sweetheart_table']!.cx).toBeCloseTo(700, 0);
    expect(seatMap.landmarks['bar']).toEqual({ cx: 120, cy: 1020 });
  });
  it('never records tables/seats/container as landmarks', () => {
    const { seatMap } = transformFloorplan(withLandmarks, null);
    expect(Object.keys(seatMap.landmarks)).toEqual(expect.not.arrayContaining(
      Object.keys(seatMap.tables).map(t => `table-${t}`)));
    expect(seatMap.landmarks['guest_tables']).toBeUndefined();
  });
  it('diff guard ignores landmark changes and tolerates prev maps without landmarks', () => {
    const { seatMap } = transformFloorplan(withLandmarks, null);
    const prev = structuredClone(seatMap) as SeatMap & { landmarks?: unknown };
    delete (prev as Record<string, unknown>).landmarks;   // v1 seatmap.json shape
    expect(() => transformFloorplan(withLandmarks, prev as SeatMap)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run scripts` → landmarks tests FAIL (`landmarks` undefined).

- [ ] **Step 3: Implement extraction**

In `scripts/svg-transform.ts`: add `landmarks: Record<string, { cx: number; cy: number }>` to `SeatMap`; initialize `landmarks: {}` in the seatMap literal. After the table-group loop (before viewBox tightening), add:

```ts
  const SKIP_LANDMARK = /^(table|seat)[-_]/;
  for (const el of [...doc.querySelectorAll('[id]')]) {
    const id = el.getAttribute('id')!;
    if (el.tagName.toLowerCase() === 'svg' || id === 'guest_tables' || SKIP_LANDMARK.test(id)) continue;
    const pts: Pt[] = [];
    const paths = el.tagName.toLowerCase() === 'path' ? [el] : [...el.querySelectorAll('path')];
    for (const p of paths) pts.push(...pathPoints(p.getAttribute('d') ?? ''));
    const circles = el.tagName.toLowerCase() === 'circle' ? [el] : [...el.querySelectorAll('circle')];
    for (const c of circles) pts.push({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) });
    if (!pts.length) continue;
    const center = centroid(pts);
    seatMap.landmarks[id] = { cx: center.x, cy: center.y };
  }
```

In the diff-guard block, nothing changes (it only reads `prevMap.seats`) — verify by reading it, don't touch it.

- [ ] **Step 4: floorplan tests + zoom refactor**

Append to `src/shared/floorplan.test.ts` (extend the test `seatMap` const with `landmarks: { sweetheart_table: { cx: 10, cy: 10 } }` — the `SeatMap` type now requires the field; also add `landmarks: {}` where other test maps are built if any):

```ts
it('zoomToLandmark and zoomToPoint are safe no-ops without panZoom', () => {
  const fp = mount();
  expect(() => { fp.zoomToLandmark('sweetheart_table'); fp.zoomToLandmark('nope'); fp.zoomToPoint(1, 2); }).not.toThrow();
});
```

In `src/shared/floorplan.ts`, extend the `Floorplan` interface with `zoomToPoint(cx: number, cy: number): void; zoomToLandmark(id: string): void;` and implement by extracting the existing zoom math:

```ts
    zoomToPoint(cx, cy) {
      if (!pz) return;
      pz.zoom(5);
      const { width, height, realZoom } = pz.getSizes();
      pz.pan({ x: width / 2 - cx * realZoom, y: height / 2 - cy * realZoom });
    },
    zoomToSeat(key) {
      const seat = seatMap.seats[key];
      if (seat) this.zoomToPoint(seat.cx, seat.cy);
    },
    zoomToLandmark(id) {
      const lm = seatMap.landmarks[id];
      if (lm) this.zoomToPoint(lm.cx, lm.cy);
    },
```

(`this` works because the returned object literal's methods are shorthand — if TS complains about `this` typing, hoist `zoomToPoint` to a local `const zoomToPoint = (cx: number, cy: number) => {...}` and reference it from all three; either form is fine.)

- [ ] **Step 5: Run all tests, regenerate artifacts**

```bash
npx vitest run && npm run svg
node -e "const m=require('./src/generated/seatmap.json'); console.log(Object.keys(m.landmarks))"
```

Expected: tests green; `npm run svg` passes the diff guard (seats unmoved); landmark keys include `sweetheart_table`, `bar`, `reception_area`, `ceremony_seating`, `welcome_table`, `dj_table`, `gift_table`, `guest_artist` (order may vary; `guest_tables` absent).

- [ ] **Step 6: Commit** — `git add scripts src/shared src/generated && git commit -m "feat: landmark extraction + zoomToPoint/zoomToLandmark"`

---

### Task 2: i18n module (guest)

**Files:**
- Create: `src/guest/i18n.ts`, `src/guest/i18n.test.ts`
- Modify: `src/shared/toast.ts` (optional `retryLabel`)

**Interfaces:**
- Produces: `type Locale = 'en' | 'zh'`; `detectLocale(): Locale`; `getLocale(): Locale`; `setLocale(l: Locale): void` (persists + fires subscribers); `onLocaleChange(cb: () => void): void`; `t(key: StringKey): string`; `seatText(n: number): string`; `pickLabel(en: string | null, zh: string | null): string`. Toast gains `opts.retryLabel?: string` (default `'Retry'`).

- [ ] **Step 1: Write failing tests**

`src/guest/i18n.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { detectLocale, getLocale, onLocaleChange, pickLabel, seatText, setLocale, t } from './i18n';

beforeEach(() => { localStorage.clear(); setLocale('en'); });

it('detect: localStorage wins over navigator', () => {
  localStorage.setItem('locale', 'zh');
  vi.stubGlobal('navigator', { language: 'en-US' });
  expect(detectLocale()).toBe('zh');
});
it('detect: zh-prefixed navigator language → zh, else en', () => {
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  expect(detectLocale()).toBe('zh');
  vi.stubGlobal('navigator', { language: 'fr-FR' });
  expect(detectLocale()).toBe('en');
});
it('t() and seatText follow the locale; setLocale persists and notifies', () => {
  const cb = vi.fn();
  onLocaleChange(cb);
  expect(t('title')).toBe('Find your seat');
  expect(seatText(5)).toBe('Seat 5');
  setLocale('zh');
  expect(t('title')).toBe('查找您的座位');
  expect(seatText(5)).toBe('5号位');
  expect(localStorage.getItem('locale')).toBe('zh');
  expect(cb).toHaveBeenCalled();
  expect(getLocale()).toBe('zh');
});
it('pickLabel picks by locale with cross-fallback', () => {
  expect(pickLabel('Fern', '蕨')).toBe('Fern');
  setLocale('zh');
  expect(pickLabel('Fern', '蕨')).toBe('蕨');
  expect(pickLabel('Fern', '')).toBe('Fern');
  expect(pickLabel(null, null)).toBe('');
});
```

- [ ] **Step 2: Verify RED**, then **Step 3: Implement**

`src/guest/i18n.ts`:

```ts
export type Locale = 'en' | 'zh';

const STRINGS = {
  title: { en: 'Find your seat', zh: '查找您的座位' },
  placeholder: { en: 'Your name…', zh: '请输入您的姓名…' },
  emptyState: { en: "Can't find your name? Ask at the welcome table.", zh: '找不到您的名字？请到迎宾台咨询。' },
  noSeat: { en: 'no seat assigned yet', zh: '尚未安排座位' },
  connectionTrouble: { en: 'Connection trouble', zh: '网络异常' },
  retry: { en: 'Retry', zh: '重试' },
  toggle: { en: '中文', zh: 'EN' }, // the language you'd switch TO
} as const;
export type StringKey = keyof typeof STRINGS;

let locale: Locale = 'en';
const subscribers: Array<() => void> = [];

export function detectLocale(): Locale {
  const saved = localStorage.getItem('locale');
  if (saved === 'en' || saved === 'zh') return saved;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export const getLocale = (): Locale => locale;
export function setLocale(l: Locale): void {
  locale = l;
  localStorage.setItem('locale', l);
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  document.title = STRINGS.title[l];
  subscribers.forEach(cb => cb());
}
export const onLocaleChange = (cb: () => void): void => { subscribers.push(cb); };
export const t = (key: StringKey): string => STRINGS[key][locale];
export const seatText = (n: number): string => (locale === 'zh' ? `${n}号位` : `Seat ${n}`);
export const pickLabel = (en: string | null, zh: string | null): string =>
  (locale === 'zh' ? zh || en : en || zh) || '';
```

`src/shared/toast.ts` — complete new file content (only the signature and the button label change vs v1):

```ts
export function dismissToast(): void {
  document.querySelector('.toast')?.remove();
}

export function toast(msg: string, opts: { retry?: () => void; retryLabel?: string } = {}): void {
  dismissToast();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (opts.retry) {
    const b = document.createElement('button');
    b.textContent = opts.retryLabel ?? 'Retry';
    b.onclick = () => { el.remove(); opts.retry!(); };
    el.append(b);
  }
  document.body.append(el);
  if (!opts.retry) setTimeout(() => el.remove(), 4000);
}
```

(This also switches the host page's default retry label to English, which Task 3 relies on.)

- [ ] **Step 4: GREEN + full suite** — `npx vitest run` all green (v1 tests unaffected; no v1 test asserts the retry label text — verify with `grep -rn "重试" src/ scripts/e2e.mjs`; the e2e toast check greps '网络异常' on the message, which Task 5 updates — leave e2e untouched in this task).

  ⚠️ Deviation note: v1 `scripts/e2e.mjs` asserts `/网络异常/.test(toast)` — that stays true only while `src/guest/main.ts` still hardcodes the bilingual string, which it does until Task 4. Run `npm run e2e` here to prove nothing broke yet.

- [ ] **Step 5: Commit** — `git add src/guest src/shared/toast.ts && git commit -m "feat: guest i18n module + parameterized toast retry label"`

---

### Task 3: Botanical theme + host English copy

**Files:**
- Modify: `src/styles.css` (full rewrite), `index.html` (title/header/toggle button), `host.html` (English title/header), `src/host/main.ts` + `src/host/import.ts` + `src/host/auth.ts` (English-only strings), `src/guest/main.ts` (font import line ONLY — full rewiring is Task 4), `package.json` (+@fontsource/fraunces)
- No new tests (visual task); all existing tests + e2e must stay green except e2e string assertions listed below.

**Interfaces:**
- Consumes: theme tokens from Global Constraints (exact values).
- Produces: CSS classes used by later tasks: `.lang-toggle`, `.petal` + `@keyframes petal-fall`, `.table-label`, `.sweetheart-card`. `.highlight`/`.occupied`/`.seat-label`/`.toast`/`.panel`/`.card`/etc. keep their v1 selector names.

- [ ] **Step 1: Install font** — `npm i @fontsource/fraunces` and add `import '@fontsource/fraunces/600.css';` as the first line of `src/guest/main.ts` AND `src/host/main.ts`.

- [ ] **Step 2: Rewrite `src/styles.css`** (complete file):

```css
:root {
  --ink: #3c4a3e; --accent-deep: #4e6b51; --accent: #7d9480; --bg: #f4f6f0;
  --line: #d5ddd0; --gold: #87795a; --highlight: #c2482f; --muted: #8a9a8c;
  --radius: 14px; --shadow: 0 2px 14px rgba(60, 74, 62, 0.08);
  --serif: 'Fraunces', Georgia, serif;
  --sans: -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--sans); color: var(--ink); background: var(--bg); }
.topbar { padding: 14px 16px; border-bottom: 1px solid var(--line); background: #fff;
  display: flex; justify-content: space-between; align-items: center; }
.topbar h1 { margin: 0; font-family: var(--serif); font-weight: 600; font-size: 20px; color: var(--accent-deep); letter-spacing: 0.01em; }
.topbar .leaf { color: var(--accent); margin-right: 8px; }
.lang-toggle { border: 1px solid var(--line); background: #fff; color: var(--accent-deep);
  border-radius: 999px; padding: 6px 14px; font-size: 14px; cursor: pointer; }
.signout { border: 0; background: none; color: var(--muted); }

.guest { display: flex; flex-direction: column; gap: 10px; padding: 12px; max-width: 720px; margin: 0 auto; }
.searchbar input { width: 100%; font-size: 18px; padding: 13px 16px; border: 1px solid var(--line);
  border-radius: 999px; background: #fff; color: var(--ink); }
.searchbar input:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
.results { display: flex; flex-direction: column; gap: 6px; }
.card { display: flex; justify-content: space-between; gap: 8px; padding: 12px 16px; font-size: 16px;
  background: #fff; border: 1px solid var(--line); border-radius: var(--radius); text-align: left;
  box-shadow: var(--shadow); cursor: pointer; }
.card:active { border-color: var(--accent); }
.card small { color: var(--gold); }
.banner { padding: 14px 16px; background: #fff; border: 1px solid var(--line); border-radius: var(--radius);
  font-size: 16px; box-shadow: var(--shadow); }
.banner strong { font-family: var(--serif); font-weight: 600; color: var(--accent-deep); }
.banner small { color: var(--gold); }
.sweetheart-card { padding: 18px 16px; background: linear-gradient(160deg, #fff, #eef2ea);
  border: 1px solid var(--accent); border-radius: var(--radius); text-align: center;
  font-family: var(--serif); font-size: 17px; color: var(--accent-deep); box-shadow: var(--shadow); }
.empty { color: var(--muted); text-align: center; padding: 8px; }
.divider { text-align: center; color: var(--accent); font-size: 13px; letter-spacing: 0.5em; padding: 2px 0; }

.map { position: relative; height: 60vh; background: #fff; border: 1px solid var(--line);
  border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
.floorplan { width: 100%; height: 100%; display: block; touch-action: none; }
.seat.occupied { fill: #7a9e7e !important; }
.seat.highlight { animation: pulse 1.1s ease-in-out infinite; fill: var(--highlight) !important;
  stroke: var(--highlight) !important; stroke-width: 3; }
@keyframes pulse { 50% { opacity: 0.35; } }
.seat-label { font-size: 9px; text-anchor: middle; fill: #333; pointer-events: none; }
.table-label { font-size: 11px; text-anchor: middle; fill: var(--accent-deep); pointer-events: none;
  font-weight: 600; }

.petal { position: absolute; top: -20px; font-size: 16px; pointer-events: none; z-index: 5;
  animation: petal-fall 1.6s ease-in forwards; }
@keyframes petal-fall { to { transform: translate(var(--drift, 0px), 72vh) rotate(220deg); opacity: 0; } }

.toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  background: var(--ink); color: #fff; padding: 10px 14px; border-radius: 10px;
  display: flex; gap: 10px; align-items: center; z-index: 99; max-width: 92vw; }
.toast button { background: var(--accent-deep); color: #fff; border: 0; border-radius: 8px; padding: 6px 12px; }

.hostwrap #app { display: grid; grid-template-columns: 1fr 300px; gap: 12px; padding: 12px; }
.map.tall { height: calc(100vh - 120px); }
.sidebar { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.badge { background: var(--accent-deep); color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 13px; }
.panel { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 2px solid var(--line);
  padding: 12px 16px 20px; z-index: 50; box-shadow: 0 -4px 16px rgba(60, 74, 62, 0.14); }
.panel button { padding: 10px 14px; font-size: 15px; border-radius: 10px; border: 1px solid var(--line); background: #fff; color: var(--ink); }
.panel input { padding: 10px 12px; font-size: 15px; border: 1px solid var(--line); border-radius: 10px; }
body.picking .floorplan { cursor: crosshair; }
body.picking .seat:not(.highlight) { opacity: 0.75; }
.login { display: flex; flex-direction: column; gap: 8px; max-width: 320px; margin: 48px auto; }
.login input, .login button { padding: 11px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; }
.login button { background: var(--accent-deep); color: #fff; border: 0; }
@media (max-width: 800px) { .hostwrap #app { grid-template-columns: 1fr; } .map.tall { height: 55vh; } }
```

- [ ] **Step 3: Headers.** `index.html`: `<title>Find your seat</title>` (i18n owns it at runtime from Task 4); topbar becomes:

```html
<header class="topbar">
  <h1><span class="leaf" aria-hidden="true">✿</span>Find your seat</h1>
  <button id="lang-toggle" class="lang-toggle">中文</button>
</header>
```

Add `<div class="divider" aria-hidden="true">✿ ❀ ✿</div>` between `.searchbar` and `#results` inside `.guest`. `host.html`: title + h1 → `Seating admin` (no toggle, keep structure otherwise).

- [ ] **Step 4: Host copy → English.** In `src/host/main.ts`, `src/host/import.ts`, `src/host/auth.ts` replace every bilingual literal with its English half — exact list (grep `[一-鿿]` to find them all): `'Unseated · 未安排'`→`'Unseated'` (host.html sidebar h2), `'Load failed · 加载失败'`→`'Load failed'`, `'Failed · 操作失败'`→`'Failed'`, `'Move / Swap · 移动'`→`'Move / Swap'`, `'Unseat · 取消座位'`→`'Unseat'`, `'Close · 关闭'`→`'Close'`, `'Cancel · 取消'`→`'Cancel'`, picking-dest instruction → `'Tap the destination chair — occupied chairs swap.'`, empty-seat prompt → `'Empty seat — pick a guest below or from the unseated list'`, `'Filter unseated · 筛选'`→`'Filter unseated'`, `'Retry · 重试'` handled by Task 2's toast default, import panel strings (already English), `'Imported N new guests'` (already English). After edits: `grep -n "[一-鿿]" src/host/*.ts host.html` returns NOTHING.

- [ ] **Step 5: Verify** — `npm run check`; `npx vitest run` (all green); `npm run e2e` — ALL 14 v1 checks still pass (the guest page's bilingual strings are untouched until Task 4, and the host panel checks target ids `#move`/`#unseat`/`#cancel`, which don't change). Screenshot both pages (playwright one-liner) and LOOK at the PNGs yourself: sage/cream theme visible, serif title, map intact, no layout breakage at 390px width.

- [ ] **Step 6: Commit** — `git add -u && git add package.json package-lock.json && git commit -m "feat: botanical theme + English-only host copy"`

---

### Task 4: Guest localization wiring

**Files:**
- Modify: `src/guest/main.ts` (full rewrite below), `scripts/e2e.mjs` (2 new checks + 1 updated assertion)

**Interfaces:**
- Consumes: Task 2 i18n (all exports), Task 1 floorplan, v1 api/search/toast.
- Produces: module-level render pattern later extended by Task 5 (`renderResults`, `showGuest`, `lastMatches`/`lastShown` re-render state); `fp` and the `#map` container exposed within the module for Task 5's petals.

- [ ] **Step 1: Rewrite `src/guest/main.ts`:**

```ts
import '@fontsource/fraunces/600.css';
import { searchGuests, listTables } from '../shared/api';
import { mountFloorplan } from '../shared/floorplan';
import { dismissToast, toast } from '../shared/toast';
import { prepareQuery, rankMatches } from '../logic/search';
import { seatKey, type GuestMatch, type TableInfo } from '../shared/types';
import { detectLocale, getLocale, onLocaleChange, pickLabel, seatText, setLocale, t } from './i18n';

const fp = mountFloorplan(document.querySelector('#map')!);
const input = document.querySelector<HTMLInputElement>('#q')!;
const results = document.querySelector<HTMLElement>('#results')!;
const banner = document.querySelector<HTMLElement>('#banner')!;
const langToggle = document.querySelector<HTMLButtonElement>('#lang-toggle')!;

let tables: TableInfo[] = [];
let lastMatches: GuestMatch[] | null = null;
let lastShown: GuestMatch | null = null;

const displayName = (g: GuestMatch) => [g.name_en, g.name_zh].filter(Boolean).join(' · ');
const tableLabel = (g: GuestMatch) => pickLabel(g.label_en, g.label_zh);

function renderStatics(): void {
  document.querySelector('.topbar h1')!.lastChild!.textContent = t('title');
  input.placeholder = t('placeholder');
  langToggle.textContent = t('toggle');
  renderTableLabels();
}

function renderTableLabels(): void {
  const labels: Record<number, string> = {};
  for (const tb of tables) labels[tb.table_no] = pickLabel(tb.label_en, tb.label_zh);
  fp.setTableLabels(labels);
}

function showGuest(g: GuestMatch): void {
  lastShown = g;
  results.replaceChildren();
  banner.hidden = false;
  if (g.table_no == null || g.seat_no == null) {
    banner.textContent = `${displayName(g)} — ${t('noSeat')}`;
    fp.highlight(null);
    return;
  }
  const key = seatKey(g.table_no, g.seat_no);
  const strong = document.createElement('strong');
  strong.textContent = displayName(g);
  const small = document.createElement('small');
  small.textContent = seatText(g.seat_no);
  banner.replaceChildren(strong, document.createElement('br'),
    `${tableLabel(g)} `, small);
  fp.highlight(key);
  fp.zoomToSeat(key);
}

function renderResults(matches: GuestMatch[]): void {
  lastMatches = matches;
  lastShown = null;
  banner.hidden = true;
  results.replaceChildren();
  if (!matches.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = t('emptyState');
    results.append(p);
    return;
  }
  for (const g of matches) {
    const b = document.createElement('button');
    b.className = 'card';
    const name = document.createElement('span');
    name.textContent = displayName(g);
    const where = document.createElement('small');
    where.textContent = tableLabel(g);
    b.append(name, where);
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
    if (p.kind === 'too-short') {
      lastMatches = null; lastShown = null;
      results.replaceChildren(); banner.hidden = true; fp.highlight(null);
      return;
    }
    lastRun = async () => {
      try {
        renderResults(rankMatches(p, await searchGuests(p.q)));
        dismissToast();
      } catch { toast(t('connectionTrouble'), { retry: lastRun, retryLabel: t('retry') }); }
    };
    lastRun();
  }, 250);
});

langToggle.addEventListener('click', () => setLocale(getLocale() === 'en' ? 'zh' : 'en'));
onLocaleChange(() => {
  renderStatics();
  if (lastShown) showGuest(lastShown);
  else if (lastMatches) renderResults(lastMatches);
});

setLocale(detectLocale());
void (async () => {
  try { tables = await listTables(); renderTableLabels(); }
  catch { /* decorative map labels — spec-documented silent skip */ }
})();
```

Note: `fp.setTableLabels` does not exist until Task 6. For THIS task, add the minimal version to `src/shared/floorplan.ts` now (Task 6 reuses it unchanged): interface member `setTableLabels(labels: Record<number, string>): void;` implemented as:

```ts
    setTableLabels(labels) {
      svg.querySelectorAll('.table-label').forEach(e => e.remove());
      for (const [no, text] of Object.entries(labels)) {
        const tb = seatMap.tables[no];
        if (!tb || !text) continue;
        const el = document.createElementNS(SVG_NS, 'text');
        el.setAttribute('x', String(tb.cx)); el.setAttribute('y', String(tb.cy - tb.r - 6));
        el.setAttribute('class', 'table-label');
        el.textContent = text;
        svg.append(el);
      }
    },
```

Plus one floorplan test:

```ts
it('setTableLabels draws above the table and replaces on re-call', () => {
  const fp = mount();
  fp.setTableLabels({ 1: 'Fern' });
  fp.setTableLabels({ 1: '蕨' });
  const els = container.querySelectorAll('.table-label');
  expect(els).toHaveLength(1);
  expect(els[0]!.textContent).toBe('蕨');
  expect(Number(els[0]!.getAttribute('y'))).toBeLessThan(40); // cy 50 - r 10 - 6
});
```

- [ ] **Step 2: e2e updates** in `scripts/e2e.mjs`: change the guest toast assertion from `/网络异常/` to `/Connection trouble|网络异常/` (locale-dependent). Append after the guest-page section (before HOST PAGE), reusing `BASE`/`check`:

```js
// ---------- LOCALIZATION ----------
const zhCtx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
const zhPage = await zhCtx.newPage();
await zhPage.goto(BASE + '/');
check('i18n: zh-CN browser lands on Chinese', (await zhPage.getAttribute('#q', 'placeholder')).includes('姓名'));
await zhPage.click('#lang-toggle');
check('i18n: toggle switches to English live', (await zhPage.getAttribute('#q', 'placeholder')).includes('Your name'));
await zhCtx.close();
```

- [ ] **Step 3: Verify** — `npm run check`; `npx vitest run` green; e2e full run: 16/16 (14 v1 + 2 new). The v1 banner check asserts `/号桌/` — with an `en` default locale the banner now says `Table 1`; UPDATE that v1 assertion to `/Table 1|1号桌/`.

- [ ] **Step 4: Commit** — `git add src/guest src/shared/floorplan.* scripts/e2e.mjs && git commit -m "feat: guest-page localization with auto-detect + live toggle"`

---

### Task 5: Petal burst + sweetheart celebration

**Files:**
- Create: `src/guest/effects.ts`, `src/guest/effects.test.ts`, `src/guest/couple.ts`, `src/guest/couple.test.ts`
- Modify: `src/guest/main.ts` (two integration points), `scripts/e2e.mjs` (+2 checks)

**Interfaces:**
- Consumes: `PreparedQuery`, `normalizeEn` (v1 `logic/search.ts`); Task 1 `zoomToLandmark`; Task 4 module structure; Task 2 `getLocale`.
- Produces: `burstPetals(container: HTMLElement, opts?: { count?: number }): void`; `COUPLE` const; `matchesCouple(p: PreparedQuery): boolean`.

- [ ] **Step 1: Failing tests**

`src/guest/couple.test.ts`:

```ts
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
```

`src/guest/effects.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { burstPetals } from './effects';

beforeEach(() => { document.body.innerHTML = '<div id="c"></div>'; });
const c = () => document.querySelector<HTMLElement>('#c')!;

it('spawns the requested number of petals and removes them on animationend', () => {
  burstPetals(c(), { count: 5 });
  const petals = c().querySelectorAll('.petal');
  expect(petals).toHaveLength(5);
  petals.forEach(p => p.dispatchEvent(new Event('animationend')));
  expect(c().querySelectorAll('.petal')).toHaveLength(0);
});
it('no-ops under prefers-reduced-motion', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
  burstPetals(c());
  expect(c().querySelectorAll('.petal')).toHaveLength(0);
  vi.unstubAllGlobals();
});
it('never throws, even on a detached container', () => {
  expect(() => burstPetals(document.createElement('div'))).not.toThrow();
});
```

- [ ] **Step 2: RED**, then **Step 3: Implement**

`src/guest/couple.ts`:

```ts
import { normalizeEn, type PreparedQuery } from '../logic/search';

export const COUPLE = {
  partners: [
    { name_en: 'Corey Hu', name_zh: '' },    // name_zh optional: '' never matches
    { name_en: 'Lindsey Tam', name_zh: '' }, // Chinese names not chosen yet
  ],
  message: {
    en: 'You found us! Come say hi at the sweetheart table 🌿',
    zh: '被你找到啦！快来甜心桌打个招呼 🌿',
  },
} as const;

export function matchesCouple(p: PreparedQuery): boolean {
  if (p.kind === 'too-short') return false;
  return COUPLE.partners.some(partner =>
    p.kind === 'en'
      ? p.q === normalizeEn(partner.name_en)
      : partner.name_zh !== '' && p.q === partner.name_zh.replace(/\s+/g, ''));
}
```

`src/guest/effects.ts`:

```ts
const GLYPHS = ['✿', '❀', '🌸', '❁'];
const TINTS = ['#7d9480', '#c9a1a8', '#87795a'];

export function burstPetals(container: HTMLElement, opts: { count?: number } = {}): void {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < (opts.count ?? 16); i++) {
      const p = document.createElement('span');
      p.className = 'petal';
      p.textContent = GLYPHS[i % GLYPHS.length]!;
      p.style.left = `${8 + Math.random() * 84}%`;
      p.style.color = TINTS[i % TINTS.length]!;
      p.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 120)}px`);
      p.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
      p.addEventListener('animationend', () => p.remove());
      frag.append(p);
    }
    container.append(frag);
  } catch { /* decorative — must never break search */ }
}
```

- [ ] **Step 4: Integrate in `src/guest/main.ts`.** Add imports (`burstPetals`, `COUPLE`, `matchesCouple`, `getLocale` already imported). Add after the `const langToggle` line: `const mapEl = document.querySelector<HTMLElement>('#map')!;`. Two integration points:

(a) end of `showGuest` success path (after `fp.zoomToSeat(key)`): `burstPetals(mapEl);`

(b) in the debounce handler, immediately after the too-short early-return:

```ts
    if (matchesCouple(p)) {
      lastMatches = null; lastShown = null;
      results.replaceChildren();
      banner.hidden = false;
      banner.className = 'sweetheart-card';
      banner.textContent = COUPLE.message[getLocale()];
      fp.highlight(null);
      fp.zoomToLandmark('sweetheart_table');
      burstPetals(mapEl, { count: 48 });
      return;
    }
```

And `showGuest`/`renderResults` must reset `banner.className = 'banner'` as their first banner-touching line (the sweetheart card changes it).

- [ ] **Step 5: e2e** — append to the guest section of `scripts/e2e.mjs`:

```js
await page.fill('#q', 'eric');
await page.waitForSelector('.card');
await page.locator('.card').first().click();
await page.waitForSelector('.petal', { timeout: 3000 });
check('eggs: petals fall when a seat is found', true);

await page.fill('#q', 'Corey Hu');
await page.waitForSelector('.sweetheart-card:not([hidden])', { timeout: 4000 });
check('eggs: sweetheart celebration on exact couple name',
  /found us|找到/.test(await page.textContent('.sweetheart-card')));
```

- [ ] **Step 6: Verify + commit** — `npx vitest run` green; e2e 18/18; `git add src/guest scripts/e2e.mjs && git commit -m "feat: petal burst + sweetheart celebration easter eggs"`

---

### Task 6: Custom table names (RPC + host editor)

**Files:**
- Create: `supabase/migrations/0002_table_labels.sql`
- Modify: `supabase/smoke.sql` (3 asserts), `src/shared/api.ts` (+setTableLabel), `src/shared/floorplan.ts` (onSeatTap → onTap), `src/shared/floorplan.test.ts`, `src/host/main.ts` (table editor + labels), `scripts/e2e.mjs` (+1 check)

**Interfaces:**
- Consumes: v1 `is_admin()`, Task 4 `setTableLabels`, Task 2 `pickLabel` (guest side already wired).
- Produces: SQL `set_table_label(p_table_no int, p_label_en text, p_label_zh text)`; `setTableLabel(tableNo: number, labelEn: string, labelZh: string): Promise<void>` in api.ts; `Floorplan.onTap(cb: (hit: { kind: 'seat'; key: SeatKey } | { kind: 'table'; tableNo: number }) => void): void` **replacing** `onSeatTap` (both call sites updated in this task).

- [ ] **Step 1: Migration** — `supabase/migrations/0002_table_labels.sql`:

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

- [ ] **Step 2: Smoke asserts** — append inside `supabase/smoke.sql`'s transaction (before `rollback`), following the existing DO-block style:

```sql
do $$
begin
  perform set_table_label(3, 'Fern', '蕨');
  assert (select label_zh from tables where table_no = 3) = '蕨', 'label set';
  perform set_table_label(3, '', '');
  assert (select label_en from tables where table_no = 3) = 'Table 3', 'empty restores default';
end $$;

do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  begin
    perform set_table_label(1, 'x', 'x');
    raise exception 'non-admin renamed a table — gate broken';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
end $$;
```

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/smoke.sql` (psql at `/opt/homebrew/opt/libpq/bin/psql`) → `SMOKE OK`. NOTE: db reset wipes the test admin/user — re-create: `curl` admin API user + `insert into admins…` (see `.superpowers/sdd/progress.md` Task 9 notes) before any authenticated e2e.

- [ ] **Step 3: api.ts** — add:

```ts
export const setTableLabel = async (tableNo: number, labelEn: string, labelZh: string): Promise<void> => {
  unwrap(await supabase.rpc('set_table_label', { p_table_no: tableNo, p_label_en: labelEn, p_label_zh: labelZh }));
};
```

- [ ] **Step 4: floorplan onTap** — replace `onSeatTap` in interface + implementation:

```ts
    onTap(cb) {
      svg.addEventListener('click', e => {
        const seat = (e.target as Element).closest('[id^="seat-"]');
        if (seat) return cb({ kind: 'seat', key: seat.id.slice('seat-'.length) });
        const table = (e.target as Element).closest('[id^="table-"]');
        const m = table?.id.match(/^table-(\d+)/);
        if (m) cb({ kind: 'table', tableNo: Number(m[1]) });
      });
    },
```

Update the floorplan test `delegates seat taps` to use `onTap` and assert `{ kind: 'seat', key: '1-2' }`; add a table-tap test (click `#table-1-shape` → `{ kind: 'table', tableNo: 1 }`). Update the ONLY call site (`src/host/main.ts`, inside `requireAuth`):

```ts
  fp.onTap(hit => {
    if (hit.kind === 'seat') return step(sm.tapSeat(mode, hit.key, bySeat.get(hit.key)?.id ?? null));
    if (mode.kind !== 'picking-dest') openTableEditor(hit.tableNo);
  });
```

- [ ] **Step 5: Host editor + host map labels.** In `src/host/main.ts`: `refresh()` additionally fetches tables and draws labels:

```ts
  let tables: TableInfo[] = [];
  // inside refresh(), after listGuests succeeds:
  tables = await listTables();
  fp.setTableLabels(Object.fromEntries(tables.map(tb => [tb.table_no, tb.label_en])));
```

(`listGuests`/`listTables` failures already route to the existing catch → toast + retry.) New function, same file:

```ts
function openTableEditor(tableNo: number): void {
  mode = sm.idle;             // closes any open seat panel state
  renderMode();               // hides panel, clears highlight
  const tb = tables.find(x => x.table_no === tableNo);
  const p = panel();
  p.hidden = false;
  p.replaceChildren();
  const title = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `Table ${tableNo} name`;
  title.append(strong);
  const en = document.createElement('input');
  en.placeholder = 'English name (empty = default)';
  en.value = tb && tb.label_en !== `Table ${tableNo}` ? tb.label_en : '';
  const zh = document.createElement('input');
  zh.placeholder = '中文名 (empty = default)';
  zh.value = tb && tb.label_zh !== `${tableNo}号桌` ? tb.label_zh : '';
  const save = document.createElement('button');
  save.textContent = 'Save';
  save.onclick = async () => {
    try { await setTableLabel(tableNo, en.value, zh.value); }
    catch (e) { return toast(e instanceof Error ? e.message : 'Failed'); }
    p.hidden = true;
    await refresh();
  };
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.onclick = () => { p.hidden = true; };
  p.append(title, en, zh, document.createElement('br'), save, close);
}
```

Import `setTableLabel`, `listTables`, `TableInfo` in host/main.ts.

- [ ] **Step 6: e2e** — append to the HOST section (after the unseat-restore check, still authenticated):

```js
// rename table 1 (it has seeded guests, so the guest banner can be checked)
await page.locator('svg [id="table-1-shape"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])');
await page.locator('#panel input').first().fill('Fern');
await page.locator('#panel input').nth(1).fill('蕨');
await page.locator('#panel button', { hasText: 'Save' }).click();
await page.waitForFunction(() =>
  [...document.querySelectorAll('.table-label')].some(t => t.textContent === 'Fern'), null, { timeout: 5000 });
check('tables: rename renders on host map', true);

// guest banner shows the custom name only (name-only display rule)
const guestPage2 = await ctx.newPage();
await guestPage2.goto(BASE + '/');
await guestPage2.fill('#q', 'carol zhao');
await guestPage2.waitForSelector('#banner:not([hidden])', { timeout: 5000 });
const bannerTxt = await guestPage2.textContent('#banner');
check('tables: guest banner shows custom name, no number', /Fern/.test(bannerTxt) && !/Table 1/.test(bannerTxt));
await guestPage2.close();

// restore defaults (also exercises empty-restores-default)
await page.locator('svg [id="table-1-shape"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])');
await page.locator('#panel input').first().fill('');
await page.locator('#panel input').nth(1).fill('');
await page.locator('#panel button', { hasText: 'Save' }).click();
await page.waitForFunction(() =>
  ![...document.querySelectorAll('.table-label')].some(t => t.textContent === 'Fern'), null, { timeout: 5000 });
```

- [ ] **Step 7: Verify + commit** — `npm run check`; `npx vitest run` green; `SMOKE OK`; e2e 20/20; `git add supabase src/shared src/host scripts/e2e.mjs && git commit -m "feat: custom table names — set_table_label RPC + tap-to-edit host editor"`

---

## Verification (whole-plan)

1. `npx vitest run` — all unit suites green (v1 36 + new i18n/couple/effects/floorplan/landmark tests).
2. `psql … -f supabase/smoke.sql` → `SMOKE OK` (now includes table-label asserts).
3. `npm run e2e` → 20/20 (14 v1-adjusted + 2 i18n + 2 eggs + 2 table-name).
4. Visual pass on both pages at 390px: botanical theme, ✿ divider, toggle works, petals fall, sweetheart card centers on the sweetheart table.
5. `npm run build` green; bundle delta ≤ 120KB vs v1 (`du -sh dist`).
