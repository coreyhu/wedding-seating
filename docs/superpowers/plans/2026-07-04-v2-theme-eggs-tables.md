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

### Task 7: Matrix seating import (replaces two-column import)

**Files:**
- Create: `supabase/migrations/0003_matrix_import.sql`, `src/logic/matrix.ts`, `src/logic/matrix.test.ts`
- Delete: `src/logic/csv.ts`, `src/logic/csv.test.ts`
- Rewrite: `src/host/import.ts`
- Modify: `src/shared/api.ts` (importSeating replaces importGuests), `supabase/smoke.sql` (replace import_guests block), `docs/deploy-runbook.md` (§4 rewritten for matrix flow), `scripts/e2e.mjs` (import e2e added in Task 8's combined check — no e2e change here)

**Interfaces:**
- Consumes: `is_admin()`, deferrable `guests_one_per_seat`, `guests_identity` (v1 migration); host import panel mount point.
- Produces: `parseSeatingMatrix(text: string): MatrixResult` where `MatrixResult = { tables: MatrixTable[]; guests: MatrixGuest[]; errors: string[] }`, `MatrixTable = { table_no: number; label_en: string; label_zh: string }`, `MatrixGuest = { name_en: string; name_zh: string; table_no: number; seat_no: number }`; api `importSeating(payload: { tables: MatrixTable[]; guests: MatrixGuest[] }): Promise<{ imported: number; new: number; unseated: number }>`; SQL `import_seating(payload jsonb) returns jsonb`. `import_guests` is GONE after this task.

- [ ] **Step 1: Failing parser tests**

`src/logic/matrix.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSeatingMatrix } from './matrix';

const HEADERS = 'Peacock / 孔雀,Owl,Kangaroo,Giraffe,Condor,Capuchin,Anteater,Toucan,Elephant,Koala,Crocodile,Lion';

describe('parseSeatingMatrix', () => {
  it('parses headers into table labels (slash-optional) and cells into seated guests', () => {
    const r = parseSeatingMatrix(`${HEADERS}\nCarol Zhao,Connor Hsiao\n"Wang Wei / 王伟",`);
    expect(r.errors).toEqual([]);
    expect(r.tables[0]).toEqual({ table_no: 1, label_en: 'Peacock', label_zh: '孔雀' });
    expect(r.tables[1]).toEqual({ table_no: 2, label_en: 'Owl', label_zh: '' });
    expect(r.guests).toContainEqual({ name_en: 'Carol Zhao', name_zh: '', table_no: 1, seat_no: 1 });
    expect(r.guests).toContainEqual({ name_en: 'Wang Wei', name_zh: '王伟', table_no: 1, seat_no: 2 });
    expect(r.guests).toContainEqual({ name_en: 'Connor Hsiao', name_zh: '', table_no: 2, seat_no: 1 });
    expect(r.guests).toHaveLength(3); // empty cells skipped
  });
  it('supports zh-only cells and full-width slash', () => {
    const r = parseSeatingMatrix(`${HEADERS}\n/ 王奶奶,Eric Li ／ 李毅`);
    expect(r.guests[0]).toEqual({ name_en: '', name_zh: '王奶奶', table_no: 1, seat_no: 1 });
    expect(r.guests[1]).toEqual({ name_en: 'Eric Li', name_zh: '李毅', table_no: 2, seat_no: 1 });
  });
  it('errors: wrong header count, >8 rows in a column, in-sheet duplicate identity', () => {
    expect(parseSeatingMatrix('A,B\nx,y').errors[0]).toMatch(/12.*headers|headers.*12/i);
    const nine = Array.from({ length: 9 }, (_, i) => `G${i}`).join(',\n'); // col 1 gets 9 guests
    expect(parseSeatingMatrix(`${HEADERS}\n${nine},`).errors.join(' ')).toMatch(/Peacock.*8|8.*Peacock/);
    const dup = parseSeatingMatrix(`${HEADERS}\nSame Name,\nSame Name,`);
    expect(dup.errors.join(' ')).toMatch(/duplicate/i);
    expect(parseSeatingMatrix(`${HEADERS}\nBOM test,`).errors).toEqual([]);
  });
  it('strips BOM and tolerates CRLF + trailing empty rows', () => {
    const r = parseSeatingMatrix(`﻿${HEADERS}\r\nCarol Zhao,\r\n\r\n`);
    expect(r.errors).toEqual([]);
    expect(r.guests).toHaveLength(1);
  });
});
```

- [ ] **Step 2: RED**, then **Step 3: implement `src/logic/matrix.ts`** (move the quoted-field `split()` helper verbatim from `csv.ts` before deleting it):

```ts
export interface MatrixTable { table_no: number; label_en: string; label_zh: string }
export interface MatrixGuest { name_en: string; name_zh: string; table_no: number; seat_no: number }
export interface MatrixResult { tables: MatrixTable[]; guests: MatrixGuest[]; errors: string[] }

const splitName = (cell: string): { en: string; zh: string } => {
  const i = cell.search(/[/／]/);
  if (i < 0) return { en: cell.trim(), zh: '' };
  return { en: cell.slice(0, i).trim(), zh: cell.slice(i + 1).trim() };
};

export function parseSeatingMatrix(text: string): MatrixResult {
  const rows = split(text.replace(/^﻿/, '')); // split(): the v1 quoted-field CSV splitter, moved here verbatim
  const errors: string[] = [];
  const header = (rows[0] ?? []).map(c => c.trim());
  while (header.length && header[header.length - 1] === '') header.pop();
  if (header.length !== 12) errors.push(`expected 12 table-name headers, found ${header.length}`);
  const tables: MatrixTable[] = header.slice(0, 12).map((h, i) => {
    const { en, zh } = splitName(h);
    return { table_no: i + 1, label_en: en, label_zh: zh };
  });
  const guests: MatrixGuest[] = [];
  const seen = new Map<string, string>(); // identity -> first location
  for (let r = 1; r < rows.length; r++) {
    for (let c = 0; c < Math.min(rows[r]!.length, 12); c++) {
      const cell = rows[r]![c]!.trim();
      if (!cell || cell === '/') continue;
      const { en, zh } = splitName(cell);
      if (!en && !zh) continue;
      const seat_no = guests.filter(g => g.table_no === c + 1).length + 1;
      if (seat_no > 8) { errors.push(`${tables[c]?.label_en || `column ${c + 1}`} has more than 8 guests`); continue; }
      const key = `${en} ${zh}`;
      if (seen.has(key)) errors.push(`duplicate guest "${[en, zh].filter(Boolean).join(' / ')}" (${seen.get(key)} and ${tables[c]?.label_en})`);
      else seen.set(key, tables[c]?.label_en || `column ${c + 1}`);
      guests.push({ name_en: en, name_zh: zh, table_no: c + 1, seat_no });
    }
  }
  return { tables, guests, errors };
}
```

(Seat numbers derive from the count of non-empty cells above in the same column — blank cells don't consume a seat. This matches "row order = seat order" for dense columns, which the sheet is.)

- [ ] **Step 4: Migration `supabase/migrations/0003_matrix_import.sql`:**

```sql
create or replace function import_seating(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_new int; v_imported int; v_unseated int; v_expected int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  set constraints guests_one_per_seat deferred;

  update tables t set
    label_en = coalesce(nullif(trim(x.label_en), ''), format('Table %s', t.table_no)),
    label_zh = coalesce(nullif(trim(x.label_zh), ''), format('%s号桌', t.table_no))
  from jsonb_to_recordset(payload->'tables') as x(table_no int, label_en text, label_zh text)
  where x.table_no = t.table_no;

  insert into guests (name_en, name_zh)
  select distinct trim(coalesce(g->>'name_en', '')), trim(coalesce(g->>'name_zh', ''))
  from jsonb_array_elements(payload->'guests') g
  on conflict on constraint guests_identity do nothing;
  get diagnostics v_new = row_count;

  update guests set table_no = null, seat_no = null where table_no is not null;

  update guests gu
  set table_no = (x->>'table_no')::int, seat_no = (x->>'seat_no')::int
  from jsonb_array_elements(payload->'guests') x
  where gu.name_en = trim(coalesce(x->>'name_en', ''))
    and gu.name_zh = trim(coalesce(x->>'name_zh', ''));
  get diagnostics v_imported = row_count;

  select jsonb_array_length(payload->'guests') into v_expected;
  if v_imported <> v_expected then
    raise exception 'seat assignment mismatch: % of % guests matched', v_imported, v_expected;
  end if;

  select count(*) into v_unseated from guests where table_no is null;
  return jsonb_build_object('imported', v_imported, 'new', v_new, 'unseated', v_unseated);
end $$;

drop function if exists import_guests(jsonb);
revoke execute on function import_seating(jsonb) from public, anon, authenticated;
grant execute on function import_seating(jsonb) to authenticated;
```

- [ ] **Step 5: smoke.sql** — replace the v1 `import_guests` DO-block with:

```sql
do $$
declare r jsonb;
begin
  select import_seating(jsonb_build_object(
    'tables', jsonb_build_array(jsonb_build_object('table_no', 1, 'label_en', 'Peacock', 'label_zh', '孔雀')),
    'guests', jsonb_build_array(
      jsonb_build_object('name_en', 'Carol Zhao', 'name_zh', '赵卡罗', 'table_no', 4, 'seat_no', 1),
      jsonb_build_object('name_en', 'Brand New', 'name_zh', '', 'table_no', 4, 'seat_no', 2)
    ))) into r;
  assert (r->>'new')::int = 1, 'one new guest';
  assert (r->>'imported')::int = 2, 'two seated';
  assert (select label_en from tables where table_no = 1) = 'Peacock', 'label applied';
  assert (select table_no from guests where name_en = 'Carol Zhao') = 4, 'carol moved by import';
  assert (select count(*) from guests where name_en = 'Kevin Hu' and table_no is not null) = 0, 'absent guests unseated';
end $$;
```

Plus a non-admin negative test for `import_seating` mirroring the existing pattern, and REMOVE the `import_guests` positive/negative asserts. `supabase db reset` + smoke → `SMOKE OK`. (db reset wipes the auth user — recreate host@test.dev + admins row per `.superpowers/sdd/progress.md` Task 9 notes before e2e.)

- [ ] **Step 6: api.ts** — delete `importGuests`, add:

```ts
import type { MatrixGuest, MatrixTable } from '../logic/matrix';
export const importSeating = async (payload: { tables: MatrixTable[]; guests: MatrixGuest[] }):
  Promise<{ imported: number; new: number; unseated: number }> =>
  unwrap(await supabase.rpc('import_seating', { payload }));
```

- [ ] **Step 7: rewrite `src/host/import.ts`** — same mount contract `mountImport(el, onDone)`. Structure: static instructions (`Paste the whole seating sheet as CSV — row 1 = table names, columns = tables, rows = seats.`), textarea, preview div, import button (disabled by default). On input: `parseSeatingMatrix`; if `errors.length`, render them as a red list (`.import-errors`, one `<li>` per error, textContent) and keep the button disabled; else fetch `listGuests()` once (cache), compute `newCount` (parsed identities not in DB) and `willUnseat` (DB guests seated now but absent from the sheet), and render preview via textContent: `"{guests.length} guests across 12 tables · {newCount} new · {willUnseat} will become unseated"`. On click: `importSeating({ tables, guests })` → toast `Imported ${r.imported} seats (${r.new} new guests, ${r.unseated} unseated)` → `onDone()`; failure → toast message. All CSV-derived strings via textContent (v2 XSS rule). Delete `src/logic/csv.ts` + test in this step.

- [ ] **Step 8: runbook §4** — rewrite the import checklist item: export the Sheet as CSV → paste whole thing → preview must show 12 tables and the expected guest count → errors block import (fix the sheet, re-paste) → re-import any time, the sheet wins (map edits since last import are overwritten by design) → after import, spot-check one guest per side of the room.

- [ ] **Step 9: Verify + commit** — `npx vitest run` green (csv tests gone, matrix tests in); `npm run check`; SMOKE OK; `git add -A -- src supabase docs scripts && git commit -m "feat: matrix seating import replacing two-column import"` (the `-A` scoped to those paths picks up the csv.ts deletions).

---

### Task 8: Pinyin-bridge Chinese search

**Files:**
- Create: `src/logic/pinyin-bridge.ts`, `src/logic/pinyin-bridge.test.ts`
- Modify: `src/guest/main.ts` (zh search path), `package.json` (+tiny-pinyin), `scripts/e2e.mjs` (+1 combined matrix+bridge check)

**Interfaces:**
- Consumes: `searchGuests`, `rankMatches`, `prepareQuery` internals unchanged; Task 7's import (e2e only).
- Produces: `candidatesFromSyllables(sylls: string[]): string[]` (pure, tested); `zhToCandidates(q: string): Promise<string[]>` (dynamic-imports tiny-pinyin; resolves `[]` on any failure).

- [ ] **Step 1: Failing tests** — `src/logic/pinyin-bridge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { candidatesFromSyllables, ROMANIZATION_VARIANTS } from './pinyin-bridge';

describe('candidatesFromSyllables', () => {
  it('orders candidates: given-first rotation, original, capped and deduped', () => {
    const c = candidatesFromSyllables(['hu', 'xiang', 'ping']); // 胡向平
    expect(c[0]).toBe('xiangpinghu');   // Xiang Ping Hu — the actual sheet form
    expect(c).toContain('huxiangping');
    expect(c.length).toBeLessThanOrEqual(8);
    expect(new Set(c).size).toBe(c.length);
  });
  it('expands romanization variants one syllable at a time', () => {
    expect(candidatesFromSyllables(['xiao', 'ming'])).toContain('minghsiao'); // 萧 family → Hsiao
    expect(candidatesFromSyllables(['tan', 'da', 'wei'])).toContain('daweitam'); // 谭 → Tam
  });
  it('adds the two-syllable-surname rotation for 4+ chars', () => {
    expect(candidatesFromSyllables(['ou', 'yang', 'jia', 'ming'])).toContain('jiamingouyang');
  });
  it('drops candidates shorter than 2 chars and handles single syllables', () => {
    expect(candidatesFromSyllables(['wu'])).toEqual(expect.arrayContaining(['wu', 'ng']));
    expect(candidatesFromSyllables([])).toEqual([]);
  });
});
it('variant map stays curated (spot keys)', () => {
  for (const k of ['xiao', 'tan', 'gao', 'zeng', 'cai', 'zhang', 'wang', 'liu', 'lin', 'xie'])
    expect(ROMANIZATION_VARIANTS[k]).toBeDefined();
});
```

- [ ] **Step 2: RED**, then **Step 3: implement `src/logic/pinyin-bridge.ts`:**

```ts
export const ROMANIZATION_VARIANTS: Record<string, string[]> = {
  xiao: ['hsiao'], tan: ['tam'], wu: ['ng', 'woo'], gao: ['kao'], zeng: ['tseng'],
  cai: ['tsai', 'choi'], liu: ['lau'], zhang: ['chang', 'cheung'], wang: ['wong'],
  huang: ['wong'], li: ['lee'], zhao: ['chao', 'chiu'], xie: ['hsieh', 'tse'],
  lin: ['lam'], chen: ['chan'], zhou: ['chou', 'chow'], zhu: ['chu'], xu: ['hsu'],
  guo: ['kuo', 'kwok'], ye: ['yeh', 'yip'], he: ['ho'], mai: ['mak'], deng: ['teng'],
  qiu: ['chiu'], jiang: ['chiang'], song: ['sung'], yang: ['yeung'], luo: ['lo', 'law'],
  du: ['tu'], feng: ['fung'], zheng: ['cheng'], wei: ['wai'], lu: ['loo'], shi: ['shih'],
  cui: ['tsui'], sun: ['suen'], yao: ['yiu'], liang: ['leung'], chow: ['zhou'],
};
const CAP = 8;

export function candidatesFromSyllables(sylls: string[]): string[] {
  if (!sylls.length) return [];
  const orderings: string[][] = [sylls.slice(1).concat(sylls[0]!), sylls];
  if (sylls.length >= 4) orderings.push(sylls.slice(2).concat(sylls.slice(0, 2)));
  const out: string[] = [];
  const push = (arr: string[]) => {
    const s = arr.join('');
    if (s.length >= 2 && !out.includes(s) && out.length < CAP) out.push(s);
  };
  for (const o of orderings) push(o);
  for (const o of orderings)
    for (let i = 0; i < o.length; i++)
      for (const v of ROMANIZATION_VARIANTS[o[i]!] ?? [])
        push([...o.slice(0, i), v, ...o.slice(i + 1)]);
  if (sylls.length === 1) { // single char: allow bare syllable + variants even if short
    const s = sylls[0]!;
    if (!out.includes(s)) out.unshift(s);
    for (const v of ROMANIZATION_VARIANTS[s] ?? []) if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, CAP);
}

export async function zhToCandidates(q: string): Promise<string[]> {
  try {
    const { default: pinyin } = await import('tiny-pinyin');
    if (!pinyin.isSupported()) return [];
    const sylls = [...q].map(ch => pinyin.convertToPinyin(ch, '', true).toLowerCase()).filter(Boolean);
    return candidatesFromSyllables(sylls);
  } catch { return []; } // chunk failed to load (bad Wi-Fi) → behave as a plain miss
}
```

`npm i tiny-pinyin`. Note the single-syllable unshift means `['wu']` yields `['wu', 'ng', 'woo']` — the test's `arrayContaining(['wu','ng'])` passes.

- [ ] **Step 4: guest flow** — in `src/guest/main.ts`, inside `lastRun` replace the single fetch with:

```ts
    lastRun = async () => {
      try {
        let effective = p;
        let rows = await searchGuests(p.q);
        if (!rows.length && p.kind === 'zh') {
          const { zhToCandidates } = await import('../logic/pinyin-bridge');
          for (const cand of (await zhToCandidates(p.q)).slice(0, 3)) {
            rows = await searchGuests(cand);
            if (rows.length) { effective = { kind: 'en', q: cand }; break; }
          }
        }
        renderResults(rankMatches(effective, rows));
        dismissToast();
      } catch { toast(t('connectionTrouble'), { retry: lastRun, retryLabel: t('retry') }); }
    };
```

- [ ] **Step 5: e2e** (append at the END of `scripts/e2e.mjs`, after the table-rename block — it mutates seating, so last): authenticated host page pastes a 12-header matrix whose columns reproduce the SEED assignments exactly (headers `Table 1 / 1号桌` … `Table 12 / 12号桌` so labels stay default; column 1 rows: `Carol Zhao / 赵卡罗`, `Kevin Hu / 胡凯文`, `Eric Dang / 邓艾瑞`, `James Dang / 邓杰姆斯`; column 2: `Victoria Li / 李维多`, `Eric Liu / 刘艾瑞`; column 3: `/ 王奶奶`; column 4 seat 1: `Xiang Ping Hu` — the one new pinyin-only guest), clicks import, asserts the toast reports `1 new`; then a fresh guest page searches `胡向平` and asserts the banner shows `Xiang Ping Hu` (bridge path: raw 汉字 misses, candidate `xiangpinghu` hits). Post-state is a superset of seed at identical seats — reruns stay green.

```js
// ---------- MATRIX IMPORT + PINYIN BRIDGE (last: mutates seating to a seed superset) ----------
const MATRIX = ['Table 1 / 1号桌,Table 2 / 2号桌,Table 3 / 3号桌,Table 4 / 4号桌,Table 5 / 5号桌,Table 6 / 6号桌,Table 7 / 7号桌,Table 8 / 8号桌,Table 9 / 9号桌,Table 10 / 10号桌,Table 11 / 11号桌,Table 12 / 12号桌',
  'Carol Zhao / 赵卡罗,Victoria Li / 李维多,/ 王奶奶,Xiang Ping Hu,,,,,,,,',
  'Kevin Hu / 胡凯文,Eric Liu / 刘艾瑞,,,,,,,,,,',
  'Eric Dang / 邓艾瑞,,,,,,,,,,,',
  'James Dang / 邓杰姆斯,,,,,,,,,,,'].join('\n');
await page.click('#import-box summary');
await page.fill('#csv', MATRIX);
await page.waitForSelector('#csv-go:not([disabled])');
await page.click('#csv-go');
await page.waitForSelector('.toast', { timeout: 8000 });
check('import: matrix toast reports 1 new guest', /1 new/.test(await page.textContent('.toast')));

const bridgePage = await ctx.newPage();
await bridgePage.goto(BASE + '/');
await bridgePage.fill('#q', '胡向平');
await bridgePage.waitForSelector('#banner:not([hidden])', { timeout: 8000 });
check('bridge: 汉字 search finds pinyin-only guest', /Xiang Ping Hu/.test(await bridgePage.textContent('#banner')));
await bridgePage.close();
```

(Keep the `#csv`/`#csv-go`/`#import-box` ids in the Task 7 rewrite so this selector set holds.)

- [ ] **Step 6: Verify + commit** — `npx vitest run` green; e2e 22/22; `npm run check`; `git add src scripts/e2e.mjs package.json package-lock.json && git commit -m "feat: pinyin-bridge Chinese search with romanization variants"`

---

### Task 9: Map-first guest layout + animated zoom

**Files:**
- Modify: `src/shared/floorplan.ts` (animated zoomToPoint + resize handling), `src/shared/floorplan.test.ts` (1 test), `index.html` (overlay structure), `src/styles.css` (guest overlay layout), `scripts/e2e.mjs` (+1 layout check)
- Guest page only — `host.html`/host CSS grid untouched.

**Interfaces:**
- Consumes: everything as of Task 8. Produces: no interface changes — `zoomToPoint(cx, cy)` keeps its signature, gains animation.

- [ ] **Step 1: Failing test** — append to `src/shared/floorplan.test.ts`:

```ts
it('animated zoomToPoint stays a safe no-op without panZoom and cancels cleanly', () => {
  const fp = mount();
  expect(() => { fp.zoomToPoint(1, 2); fp.zoomToPoint(3, 4); }).not.toThrow();
});
```

- [ ] **Step 2: Implement animation in `src/shared/floorplan.ts`** — replace the `zoomToPoint` const:

```ts
  let zoomAnim = 0;
  const zoomToPoint = (cx: number, cy: number): void => {
    if (!pz) return;
    cancelAnimationFrame(zoomAnim);
    const { width, height, realZoom } = pz.getSizes();
    const startZoom = pz.getZoom();
    const startPan = pz.getPan();
    const startCenter = { x: (width / 2 - startPan.x) / realZoom, y: (height / 2 - startPan.y) / realZoom };
    const targetZoom = 5;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const apply = (z: number, c: { x: number; y: number }) => {
      pz!.zoom(z);
      const rz = pz!.getSizes().realZoom;
      pz!.pan({ x: width / 2 - c.x * rz, y: height / 2 - c.y * rz });
    };
    if (reduced || typeof requestAnimationFrame !== 'function') return apply(targetZoom, { x: cx, y: cy });
    const t0 = performance.now();
    const DURATION = 600;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION);
      const k = ease(t);
      apply(startZoom + (targetZoom - startZoom) * k,
        { x: startCenter.x + (cx - startCenter.x) * k, y: startCenter.y + (cy - startCenter.y) * k });
      if (t < 1) zoomAnim = requestAnimationFrame(frame);
    };
    zoomAnim = requestAnimationFrame(frame);
  };
```

Add resize handling inside `mountFloorplan` right after the `pz` construction (only when `pz` exists):

```ts
  if (pz) {
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { pz!.resize(); pz!.fit(); pz!.center(); }, 150);
    });
  }
```

- [ ] **Step 3: Overlay layout.** `index.html` main becomes:

```html
<main class="guest guest-mapfirst">
  <div id="map" class="map mapfull"></div>
  <div class="overlay">
    <header class="topbar panel-card">
      <h1><span class="leaf" aria-hidden="true">✿</span>Find your seat</h1>
      <button id="lang-toggle" class="lang-toggle">中文</button>
    </header>
    <div class="searchbar panel-card"><input id="q" type="search" autocomplete="off" placeholder="Your name…" /></div>
    <div id="banner" class="banner" hidden></div>
    <div id="results" class="results"></div>
  </div>
</main>
```

(The old standalone `<header class="topbar">` at body level is REMOVED from index.html — the topbar moves inside the overlay. host.html keeps its body-level topbar; the `.topbar` CSS must therefore work in both contexts. `renderStatics`'s `document.querySelector('.topbar h1')!.lastChild` selector still matches. The `.divider` element is dropped — the map IS the page now.)

Replace the guest-layout CSS block in `src/styles.css` (`.guest`, `.searchbar`, `.results`, `.map` sizing — keep `.card`/`.banner`/`.sweetheart-card`/`.empty` content styles):

```css
.guest-mapfirst { position: relative; }
.map.mapfull { position: fixed; inset: 0; height: 100dvh; border: 0; border-radius: 0; box-shadow: none; }
.overlay { position: fixed; top: 0; left: 50%; transform: translateX(-50%);
  width: min(560px, calc(100vw - 24px)); display: flex; flex-direction: column; gap: 8px;
  padding-top: 10px; z-index: 10; pointer-events: none; max-height: 100dvh; }
.overlay > *, .overlay .results > * { pointer-events: auto; }
.panel-card { border: 1px solid var(--line); border-radius: var(--radius); background: #fff; box-shadow: var(--shadow); }
.overlay .topbar { border-bottom: 1px solid var(--line); padding: 10px 14px; }
.overlay .searchbar { padding: 6px; }
.overlay .searchbar input { border: 0; outline: none; }
.overlay .searchbar:focus-within { outline: 2px solid var(--accent); }
.results { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 40vh; }
```

- [ ] **Step 4: e2e** — append after the LOCALIZATION block (uses the default `page`):

```js
const mapBox = await page.locator('#map').boundingBox();
const vp = page.viewportSize();
check('layout: map fills the viewport', mapBox.width >= vp.width - 2 && mapBox.height >= vp.height - 2);
```

- [ ] **Step 5: Verify** — `npx vitest run` + `npm run check` green; full e2e green (count grows by 1; earlier checks must still pass — the overlay must not cover the map's tap targets in the host flow, which is a different page and unaffected). Screenshot the guest page at 390×844 AND 1440×900, Read both: map edge-to-edge, floating header/search, results overlay scrolls, no horizontal scrollbar.

- [ ] **Step 6: Commit** — `git add index.html src/shared src/styles.css scripts/e2e.mjs && git commit -m "feat: map-first guest layout + animated zoom"`

---

### Task 10: Amenity discovery (chips + search + map labels)

**Files:**
- Create: `src/guest/amenities.ts`, `src/guest/amenities.test.ts`
- Modify: `src/shared/floorplan.ts` (+setLandmarkLabels), `src/shared/floorplan.test.ts` (1 test), `src/guest/main.ts` (chips render + search hook), `index.html` (chip row container), `src/styles.css` (.chips/.chip/.landmark-label), `scripts/e2e.mjs` (+2 checks)

**Interfaces:**
- Consumes: `zoomToLandmark`, `getLocale`/`onLocaleChange`, seatmap landmarks, `normalizeEn`, `PreparedQuery`.
- Produces:

```ts
// amenities.ts
export interface Amenity { id: string; emoji: string; name: { en: string; zh: string }; keywords: { en: string[]; zh: string[] } }
export const AMENITIES: Amenity[]; // exactly: bar, welcome_table, ceremony_seating, guest_artist, restroom, gift_table, dj
export function matchAmenity(p: PreparedQuery): Amenity | null; // EXACT normalized-name/keyword equality only
```

`Floorplan.setLandmarkLabels(labels: Record<string, string>): void` — same replace-on-recall contract as setTableLabels, class `landmark-label`, text at landmark cx/cy.

- [ ] **Step 1: Failing tests.** `src/guest/amenities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AMENITIES, matchAmenity } from './amenities';
import { prepareQuery } from '../logic/search';
import seatmap from '../generated/seatmap.json';

it('every amenity id exists in the generated landmarks (SVG contract guard)', () => {
  for (const a of AMENITIES) expect(seatmap.landmarks).toHaveProperty(a.id);
});
it('excludes the sweetheart table (easter egg stays secret)', () => {
  expect(AMENITIES.some(a => a.id === 'sweetheart_table')).toBe(false);
});
describe('matchAmenity', () => {
  it('matches exact names and keywords in both scripts', () => {
    expect(matchAmenity(prepareQuery('Bar'))?.id).toBe('bar');
    expect(matchAmenity(prepareQuery('bathroom'))?.id).toBe('restroom');
    expect(matchAmenity(prepareQuery('洗手间'))?.id).toBe('restroom');
    expect(matchAmenity(prepareQuery('厕所'))?.id).toBe('restroom');
  });
  it('never hijacks guest names (exact only, too-short never)', () => {
    expect(matchAmenity(prepareQuery('barb'))).toBeNull();
    expect(matchAmenity(prepareQuery('ba'))).toBeNull();
    expect(matchAmenity({ kind: 'too-short' })).toBeNull();
  });
});
```

Floorplan test (append; the test seatMap already has `landmarks: { sweetheart_table: … }`):

```ts
it('setLandmarkLabels draws at landmark coords and replaces on re-call', () => {
  const fp = mount();
  fp.setLandmarkLabels({ sweetheart_table: 'Bar' });
  fp.setLandmarkLabels({ sweetheart_table: '酒吧' });
  const els = container.querySelectorAll('.landmark-label');
  expect(els).toHaveLength(1);
  expect(els[0]!.textContent).toBe('酒吧');
});
```

- [ ] **Step 2: RED**, then implement `amenities.ts` (ids/emoji/names per spec §8; keywords: bar → ['bar','drinks','酒吧','吧台'], welcome_table → ['welcome table','welcome','迎宾台','签到'], ceremony_seating → ['ceremony','仪式','仪式区','典礼'], guest_artist → ['live artist','artist','现场创作','画家'], restroom → ['restroom','restrooms','bathroom','toilet','洗手间','厕所','卫生间'], gift_table → ['gifts','gift table','礼品台','礼金'], dj → ['dj','music','DJ台','音乐']; `matchAmenity`: too-short → null; en: q === normalizeEn(name.en) or any normalizeEn(kw); zh: q === stripped name.zh or any stripped kw). Implement `setLandmarkLabels` mirroring setTableLabels with class `landmark-label`.

- [ ] **Step 3: Wire guest page.** `index.html`: `<div id="chips" class="chips"></div>` between `.searchbar` and `#banner` inside `.overlay`. `main.ts`: `renderChips()` — buttons `{emoji} {name[locale]}`, class `chip`, onclick → `showAmenity(a)`. `showAmenity(a)`: null lastShown/lastMatches, clear results, `banner.className='banner'`, show `${a.emoji} ${a.name[getLocale()]}` via textContent, `fp.highlight(null)`, `fp.zoomToLandmark(a.id)` — NO petals. Search hook in the debounce handler AFTER the couple check: `const am = matchAmenity(p); if (am) { showAmenity(am); return; }`. `renderLandmarkLabels()`: `fp.setLandmarkLabels(Object.fromEntries(AMENITIES.map(a => [a.id, a.name[getLocale()]])))` at startup and in onLocaleChange (which also re-runs renderChips). CSS:

```css
.chips { display: flex; gap: 6px; overflow-x: auto; pointer-events: auto; padding: 2px; scrollbar-width: none; }
.chip { flex: 0 0 auto; border: 1px solid var(--line); background: #fff; border-radius: 999px;
  padding: 7px 12px; font-size: 14px; color: var(--accent-deep); box-shadow: var(--shadow); cursor: pointer; }
.landmark-label { font-size: 10px; text-anchor: middle; fill: var(--gold); pointer-events: none; }
```

- [ ] **Step 4: e2e** (append after the LOCALIZATION block):

```js
await page.fill('#q', '');
await page.locator('.chip', { hasText: 'Restrooms' }).click();
await page.waitForSelector('#banner:not([hidden])');
check('amenities: chip zooms and banners', /🚻/.test(await page.textContent('#banner')));
await page.fill('#q', '洗手间');
await page.waitForFunction(() => !document.querySelector('#banner').hidden && document.querySelector('#banner').textContent.includes('🚻'), null, { timeout: 4000 });
check('amenities: zh keyword search finds restroom', true);
```

- [ ] **Step 5: Verify** — vitest + check green; e2e 25/25 TWICE; screenshot 390px (chips visible, results not crowded). **Step 6: Commit** — `git add src index.html scripts/e2e.mjs && git commit -m "feat: amenity discovery — chips, exact-match search, landmark labels"`

---

### Task 11: Mobile pinch-to-zoom + touch pan

**Files:**
- Modify: `src/shared/floorplan.ts` (gesture layer), `src/shared/floorplan.test.ts` (1 safety test), `scripts/e2e.mjs` (+1 CDP pinch check), `docs/deploy-runbook.md` (+ "Testing from a phone" note)

**Interfaces:**
- Consumes: the `pz` instance inside `mountFloorplan`. Produces: no API changes — gestures are internal wiring added right after `pz` construction.

- [ ] **Step 1: Safety test** (append to floorplan.test.ts — gestures must be inert without panZoom):

```ts
it('mounting without panZoom attaches no gesture handlers that throw on pointer events', () => {
  const fp = mount();
  expect(() => {
    fp.svg.dispatchEvent(new Event('pointerdown'));
    fp.svg.dispatchEvent(new Event('pointermove'));
    fp.svg.dispatchEvent(new Event('pointerup'));
  }).not.toThrow();
});
```

- [ ] **Step 2: Implement the gesture layer** in `mountFloorplan`, inside the existing `if (pz)` block (alongside the resize handler):

```ts
    // svg-pan-zoom has no touch support; hand-rolled pinch/pan for non-mouse pointers.
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let gestureActive = false;
    const mid = () => {
      const [a, b] = [...touches.values()];
      return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    };
    const dist = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a!.x - b!.x, a!.y - b!.y);
    };
    svg.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { pinchDist = dist(); gestureActive = true; }
    });
    svg.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' || !touches.has(e.pointerId)) return;
      const prev = touches.get(e.pointerId)!;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (gestureActive || Math.hypot(dx, dy) > 3) {
          gestureActive = true;
          e.preventDefault();
          pz!.panBy({ x: dx, y: dy });
        }
      } else if (touches.size === 2) {
        e.preventDefault();
        const d = dist();
        if (pinchDist > 0 && d > 0) {
          const rect = svg.getBoundingClientRect();
          const m = mid();
          pz!.zoomAtPoint(pz!.getZoom() * (d / pinchDist),
            { x: m.x - rect.left, y: m.y - rect.top });
        }
        pinchDist = d;
      }
    });
    const endTouch = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinchDist = 0;
      if (touches.size === 0) gestureActive = false;
    };
    svg.addEventListener('pointerup', endTouch);
    svg.addEventListener('pointercancel', endTouch);
```

Note: no `preventDefault` on pointerdown and none on sub-threshold single-pointer moves — taps must keep firing `click` for `onTap` delegation. `panBy` composes with the double-tap... svg-pan-zoom's `dblClickZoomEnabled` is already false. Disable svg-pan-zoom's own `mouseWheelZoomEnabled`? NO — leave desktop behavior untouched.

- [ ] **Step 3: e2e** (append after the layout check; chromium CDP):

```js
const beforeMatrix = await page.evaluate(() =>
  document.querySelector('.svg-pan-zoom_viewport')?.getAttribute('transform') ?? '');
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.synthesizePinchGesture', { x: vp.width / 2, y: vp.height / 2, scaleFactor: 2, relativeSpeed: 300 });
await page.waitForTimeout(400);
const afterMatrix = await page.evaluate(() =>
  document.querySelector('.svg-pan-zoom_viewport')?.getAttribute('transform') ?? '');
check('mobile: pinch zooms the map', beforeMatrix !== '' && beforeMatrix !== afterMatrix, `${beforeMatrix} -> ${afterMatrix}`);
```

(If `Input.synthesizePinchGesture` proves unavailable/flaky in headless-shell, fall back to dispatching two synthetic PointerEvents sequences via page.evaluate and assert the same transform change — document which path was used.)

- [ ] **Step 4: Runbook** — new short section "Testing from a phone (dev)": `npx vite --host` + set `.env.local`'s `VITE_SUPABASE_URL` to the Mac's LAN IP (`ipconfig getifaddr en0`) because `127.0.0.1` on the phone is the phone; both devices on the same Wi-Fi; `npm run qr -- http://<lan-ip>:5173` for easy opening.

- [ ] **Step 5: Verify** — vitest + check green; e2e 26/26 twice; ALSO a real-ish manual probe: playwright `hasTouch: true` context, dispatch touch drag, assert pan transform changed. **Step 6: Commit** — `git add src scripts docs && git commit -m "feat: mobile pinch-to-zoom and touch pan"`

---

### Task 12: Delete unseated guests

**Files:**
- Create: `supabase/migrations/0004_delete_guest.sql`
- Modify: `supabase/smoke.sql` (+3 asserts), `src/shared/api.ts` (+deleteGuest), `src/host/main.ts` (sidebar × with arm/confirm), `src/styles.css` (.unseated-row/.delete-btn), `scripts/e2e.mjs` (+1 check), `docs/deploy-runbook.md` (§4 note)

**Interfaces:**
- Produces: SQL `delete_guest(p_guest_id uuid)`; api `deleteGuest(guestId: string): Promise<void>`.

- [ ] **Step 1: Migration**

```sql
create or replace function delete_guest(p_guest_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_table int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select table_no into v_table from guests where id = p_guest_id;
  if not found then raise exception 'unknown guest'; end if;
  if v_table is not null then raise exception 'guest is seated'; end if;
  delete from guests where id = p_guest_id;
end $$;

revoke execute on function delete_guest(uuid) from public, anon, authenticated;
grant execute on function delete_guest(uuid) to authenticated;
```

- [ ] **Step 2: smoke.sql** — inside the transaction, existing DO-block style: delete an unseated seeded guest (Tiger Chen) and assert row count drops; attempt delete on a seated guest and assert exactly 'guest is seated' raised; non-admin sub attempt asserts 'not authorized'. (All inside the rollback — seed unharmed.)

- [ ] **Step 3: api.ts**

```ts
export const deleteGuest = async (guestId: string): Promise<void> => {
  unwrap(await supabase.rpc('delete_guest', { p_guest_id: guestId }));
};
```

- [ ] **Step 4: sidebar UI** in `src/host/main.ts` refresh(): each unseated card becomes a row: the existing name button plus a sibling × button (class `delete-btn`). × click #1: textContent → 'Delete?', class +`armed`, setTimeout 3000 to disarm (restore '×'); click #2 while armed: `deleteGuest(g.id)` → toast on failure → `refresh()`. All strings textContent. CSS: `.unseated-row { display:flex; gap:4px; } .unseated-row .card { flex:1; } .delete-btn { border:1px solid var(--line); background:#fff; color:var(--muted); border-radius:10px; padding:0 10px; } .delete-btn.armed { background:var(--highlight); color:#fff; border-color:var(--highlight); }`

- [ ] **Step 5: e2e** (after the matrix-import + bridge block, host page): paste the standard MATRIX plus an extra guest `Deleteme Test` seated at table 5 seat 2, import; re-paste the ORIGINAL MATRIX (without them), import → Deleteme becomes unseated; find their row in the sidebar, tap × then 'Delete?', wait for the row to disappear; assert sidebar no longer contains 'Deleteme Test'. End state = same as before the block (rerun-stable). Bump the header count.

- [ ] **Step 6:** runbook §4: add one line — stray unseated entries (sheet noise) are removed with the sidebar ×; delete in-app AND fix the sheet or the next import resurrects them.

- [ ] **Step 7: Verify** — vitest + check green; SMOKE OK; e2e (now 29) twice. **Commit** "feat: delete unseated guests (admin RPC + sidebar confirm)".

---

## Verification (whole-plan)

1. `npx vitest run` — all unit suites green (v1 36 − csv + new i18n/couple/effects/floorplan/landmark/matrix/pinyin tests).
2. `psql … -f supabase/smoke.sql` → `SMOKE OK` (table-label + import_seating asserts; import_guests asserts gone).
3. `npm run e2e` → 22/22 (14 v1-adjusted + 2 i18n + 2 eggs + 2 table-name + 1 import + 1 bridge).
4. Visual pass on both pages at 390px: botanical theme, ✿ divider, toggle works, petals fall, sweetheart card centers on the sweetheart table.
5. `npm run build` green; initial-load bundle delta ≤ 120KB vs v1; tiny-pinyin ships as a LAZY chunk (dynamic import) and is excluded from the initial-load budget — verify it's a separate file in `dist/assets/`.
