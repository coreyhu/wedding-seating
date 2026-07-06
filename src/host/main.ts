import '@fontsource/fraunces/600.css';
import { assignSeat, listGuests, listTables, setTableLabel, unseatAll, unseatGuest } from '../shared/api';
import { mountFloorplan, type Floorplan } from '../shared/floorplan';
import { toast } from '../shared/toast';
import { requireAuth } from './auth';
import { mountImport } from './import';
import * as sm from '../logic/seat-actions';
import { seatKey, type Guest, type SeatKey, type TableInfo } from '../shared/types';

let fp: Floorplan;
let guests: Guest[] = [];
let tables: TableInfo[] = [];
let mode: sm.Mode = sm.idle;
const bySeat = new Map<SeatKey, Guest>();
const panel = () => document.querySelector<HTMLElement>('#panel')!;
const nameOf = (g: Guest) => [g.name_en, g.name_zh].filter(Boolean).join(' · ');

async function refresh(): Promise<void> {
  try { guests = await listGuests(); tables = await listTables(); }
  catch { return toast('Load failed', { retry: refresh }); }
  fp.setTableLabels(Object.fromEntries(tables.map(tb => [tb.table_no, tb.label_en])));
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
  } catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
  if (c.type !== 'none') await refresh();
}

function renderMode(): void {
  document.body.classList.toggle('picking', mode.kind === 'picking-dest');
  const p = panel();
  if (mode.kind === 'idle') { p.hidden = true; fp.highlight(null); return; }
  p.hidden = false;
  if (mode.kind === 'picking-dest') {
    fp.highlight(mode.fromSeat);
    p.innerHTML = `<p>Tap the destination chair — occupied chairs swap.</p>
      <button id="cancel">Cancel</button>`;
  } else {
    fp.highlight(mode.seat);
    const occupantId = mode.occupantId;
    const g = occupantId ? guests.find(x => x.id === occupantId) : null;
    // Guest names are user-derived: build panel content via DOM APIs
    // (textContent), never innerHTML interpolation (same hardening as the
    // guest page). Ids/structure match the static markup exactly so the
    // listener wiring below and CSS are unaffected.
    const btn = (id: string, label: string) => {
      const b = document.createElement('button');
      b.id = id; b.textContent = label;
      return b;
    };
    const info = document.createElement('p');
    if (g) {
      const name = document.createElement('strong');
      name.textContent = nameOf(g);
      info.append(name, ` — seat ${mode.seat}`);
      p.replaceChildren(info,
        btn('move', 'Move / Swap'), ' ',
        btn('unseat', 'Unseat'), ' ',
        btn('cancel', 'Close'));
    } else {
      info.textContent = 'Empty seat — pick a guest below or from the unseated list';
      const filter = document.createElement('input');
      filter.id = 'pick-filter';
      filter.placeholder = 'Filter unseated';
      const list = document.createElement('div');
      list.id = 'pick-list';
      p.replaceChildren(info, filter, list, btn('cancel', 'Close'));
      renderPickList('');
    }
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

function wireUnseatAll(): void {
  const btn = document.querySelector<HTMLButtonElement>('#unseat-all');
  if (!btn) return;
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => { armed = false; btn.classList.remove('armed'); btn.textContent = 'Unseat all'; };
  btn.onclick = async () => {
    if (!armed) {
      armed = true;
      btn.classList.add('armed');
      btn.textContent = 'Unseat everyone?';
      clearTimeout(timer);
      timer = setTimeout(disarm, 3000);
      return;
    }
    clearTimeout(timer);
    disarm();
    try { await unseatAll(); }
    catch (e) { return toast(e instanceof Error ? e.message : 'Failed'); }
    await refresh();
  };
}

requireAuth(() => {
  fp = mountFloorplan(document.querySelector('#map')!);
  fp.onTap(hit => {
    if (hit.kind === 'seat') return step(sm.tapSeat(mode, hit.key, bySeat.get(hit.key)?.id ?? null));
    if (mode.kind !== 'picking-dest') openTableEditor(hit.tableNo);
  });
  mountImport(document.querySelector('#import')!, refresh);
  wireUnseatAll();
  void refresh();
});
