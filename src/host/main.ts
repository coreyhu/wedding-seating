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
    const occupantId = mode.occupantId;
    const g = occupantId ? guests.find(x => x.id === occupantId) : null;
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
