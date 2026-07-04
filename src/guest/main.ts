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
  const name = document.createElement('strong');
  name.textContent = displayName(g);
  const seat = document.createElement('small');
  seat.textContent = `Seat ${g.seat_no} · ${g.seat_no}号位`;
  banner.replaceChildren(
    name,
    document.createElement('br'),
    `${g.label_en ?? `Table ${g.table_no}`} · ${g.label_zh ?? `${g.table_no}号桌`} `,
    seat,
  );
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
    const name = document.createElement('span');
    name.textContent = displayName(g);
    const where = document.createElement('small');
    where.textContent = `${g.label_en ?? ''} · ${g.label_zh ?? ''}`;
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
    if (p.kind === 'too-short') { results.innerHTML = ''; banner.hidden = true; fp.highlight(null); return; }
    lastRun = async () => {
      try { renderResults(rankMatches(p, await searchGuests(p.q))); }
      catch { toast('Connection trouble · 网络异常', { retry: lastRun }); }
    };
    lastRun();
  }, 250);
});
