import '@fontsource/fraunces/600.css';
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
  try { guests = await listGuests(); } catch { return toast('Load failed', { retry: refresh }); }
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

requireAuth(() => {
  fp = mountFloorplan(document.querySelector('#map')!);
  fp.onSeatTap(key => step(sm.tapSeat(mode, key, bySeat.get(key)?.id ?? null)));
  mountImport(document.querySelector('#import')!, refresh);
  void refresh();
});
