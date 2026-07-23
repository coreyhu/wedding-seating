import '@fontsource/fraunces/600.css';
import { assignSeat, listGuests, listTables, rotateTable, setTableLabel, swapTables, unseatAll, unseatGuest } from '../shared/api';
import { mountFloorplan, type Floorplan } from '../shared/floorplan';
import { toast } from '../shared/toast';
import { requireAuth } from './auth';
import { mountGuestList } from './guest-list';
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
  unseatedList = guests.filter(g => g.table_no == null);
  const seated = guests.length - unseatedList.length;
  document.querySelector('#unseated-count')!.textContent = String(unseatedList.length);
  document.querySelector('#sidebar-stats')!.textContent =
    `${seated} of ${guests.length} seated · ${tables.length} tables`;
  renderRoster();
}

let unseatedList: Guest[] = [];
function renderRoster(): void {
  const filter = (document.querySelector<HTMLInputElement>('#roster-filter')?.value ?? '').trim().toLowerCase();
  const box = document.querySelector<HTMLElement>('#unseated')!;
  box.replaceChildren();
  const shown = unseatedList.filter(g =>
    !filter || g.name_en.toLowerCase().includes(filter) || g.name_zh.includes(filter));
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'roster-empty';
    empty.textContent = unseatedList.length ? 'No matches' : 'Everyone has a seat 🌿';
    box.append(empty);
    return;
  }
  for (const g of shown) {
    const row = document.createElement('button');
    row.className = 'roster-row';
    row.textContent = nameOf(g);
    row.onclick = () => step(sm.pickUnseated(mode, g.id));
    box.append(row);
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
  fp.zoomToTable(tableNo);
  const tb = tables.find(x => x.table_no === tableNo);
  const p = panel();
  p.hidden = false;
  p.replaceChildren();
  const title = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `Table ${tableNo} name`;
  title.append(strong);
  const seatedGuests = guests
    .filter(g => g.table_no === tableNo)
    .sort((a, b) => (a.seat_no ?? 0) - (b.seat_no ?? 0));
  const rosterTitle = document.createElement('p');
  rosterTitle.className = 'table-roster-title';
  rosterTitle.textContent = `Guests at this table (${seatedGuests.length})`;
  const roster = document.createElement('ul');
  roster.className = 'table-roster';
  if (seatedGuests.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'table-roster-empty';
    empty.textContent = 'No guests seated here yet';
    roster.append(empty);
  } else {
    for (const guest of seatedGuests) {
      const item = document.createElement('li');
      item.textContent = nameOf(guest);
      roster.append(item);
    }
  }
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

  const rotate = document.createElement('button');
  rotate.id = 'rotate-table';
  rotate.textContent = 'Rotate seats →';
  rotate.onclick = async () => {
    try { await rotateTable(tableNo); }
    catch (e) { return toast(e instanceof Error ? e.message : 'Failed'); }
    await refresh();
    openTableEditor(tableNo); // reopen so the host can rotate again
  };
  const swap = document.createElement('button');
  swap.id = 'swap-table';
  swap.textContent = 'Swap with table…';
  swap.onclick = () => beginTableSwap(tableNo);

  p.append(title, rosterTitle, roster, en, zh, document.createElement('br'), save, close,
    document.createElement('br'), rotate, swap);
}

const tableLabelOf = (n: number) => tables.find(t => t.table_no === n)?.label_en || `Table ${n}`;
let swapSource: number | null = null;

function beginTableSwap(tableNo: number): void {
  swapSource = tableNo;
  document.body.classList.add('picking-table');
  const p = panel();
  p.hidden = false;
  p.replaceChildren();
  const msg = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = tableLabelOf(tableNo);
  msg.append('Swapping ', strong, ' — tap another table to trade all its guests.');
  const cancel = document.createElement('button');
  cancel.id = 'swap-cancel';
  cancel.textContent = 'Cancel';
  cancel.onclick = cancelTableSwap;
  p.append(msg, document.createElement('br'), cancel);
}
function cancelTableSwap(): void {
  swapSource = null;
  document.body.classList.remove('picking-table');
  panel().hidden = true;
}
async function doTableSwap(target: number): Promise<void> {
  const src = swapSource;
  cancelTableSwap();
  if (src == null || src === target) return;
  try { await swapTables(src, target); }
  catch (e) { return toast(e instanceof Error ? e.message : 'Swap failed'); }
  await refresh();
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
    if (swapSource !== null) {                 // picking a table to swap with
      if (hit.kind === 'table') void doTableSwap(hit.tableNo);
      return;                                   // ignore seat taps while picking
    }
    if (hit.kind === 'seat') return step(sm.tapSeat(mode, hit.key, bySeat.get(hit.key)?.id ?? null));
    if (mode.kind !== 'picking-dest') openTableEditor(hit.tableNo);
  });
  mountGuestList(document.querySelector('#guest-list')!, refresh);
  mountImport(document.querySelector('#import')!, refresh);
  wireUnseatAll();
  document.querySelector('#roster-filter')?.addEventListener('input', renderRoster);
  void refresh();
});
