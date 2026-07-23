import '@fontsource/fraunces/600.css';
import { searchGuests, listTables, tableGuests, tableGuestsByTable } from '../shared/api';
import { mountFloorplan } from '../shared/floorplan';
import { dismissToast, toast } from '../shared/toast';
import { prepareQuery, rankMatches } from '../logic/search';
import { seatKey, type GuestMatch, type TableGuest, type TableInfo, type Tablemate } from '../shared/types';
import { detectLocale, getLocale, onLocaleChange, pickLabel, seatText, setLocale, t } from './i18n';
import { burstPetals } from './effects';
import { COUPLE, matchesCouple } from './couple';
import { AMENITIES, matchAmenity, type Amenity } from './amenities';
import { tablemateRows } from './tablemates';

const fp = mountFloorplan(document.querySelector('#map')!, {
  capLabelZoom: true,
  minimumMapLabelFontPx: 11,
  // Once a guest has zoomed in to find their chair, the table name no longer
  // helps navigation and can obscure the seat ring.
  hideTableLabelsOnZoom: true,
});
const input = document.querySelector<HTMLInputElement>('#q')!;
const results = document.querySelector<HTMLElement>('#results')!;
const banner = document.querySelector<HTMLElement>('#banner')!;
const chips = document.querySelector<HTMLElement>('#chips')!;
const langToggle = document.querySelector<HTMLButtonElement>('#lang-toggle')!;
const mapEl = document.querySelector<HTMLElement>('#map')!;

let tables: TableInfo[] = [];
let lastMatches: GuestMatch[] | null = null;
let lastShown: GuestMatch | null = null;
let lastTablemates: Tablemate[] | null = null;
let tablematesGen = 0;
let lastAmenity: Amenity | null = null;
let selectedTableNo: number | null = null;
let lastTableGuests: TableGuest[] | null = null;
let lastTableGuestsTableNo: number | null = null;
let tableGuestsGen = 0;

const displayName = (g: { name_en: string; name_zh: string }) => [g.name_en, g.name_zh].filter(Boolean).join(' · ');
const tableLabel = (g: GuestMatch) => pickLabel(g.label_en, g.label_zh);
const tableLabelByNo = (tableNo: number) => {
  const table = tables.find(t => t.table_no === tableNo);
  return table ? pickLabel(table.label_en, table.label_zh) : (getLocale() === 'zh' ? `${tableNo}号桌` : `Table ${tableNo}`);
};

function renderStatics(): void {
  document.querySelector('.topbar h1')!.lastChild!.textContent = t('title');
  input.placeholder = t('placeholder');
  langToggle.textContent = t('toggle');
  renderTableLabels();
  renderLandmarkLabels();
  renderChips();
  renderCredits();
}

function renderCredits(): void {
  const el = document.querySelector('#credits')!;
  const [before, after] = t('credits').split('♥');
  const heart = document.createElement('span');
  heart.className = 'heart';
  heart.textContent = '♥';
  el.replaceChildren(before ?? '', heart, after ?? '');
}

function renderTableLabels(): void {
  const labels: Record<number, string> = {};
  for (const tb of tables) labels[tb.table_no] = pickLabel(tb.label_en, tb.label_zh);
  fp.setTableLabels(labels);
}

function renderChips(): void {
  chips.replaceChildren();
  for (const a of AMENITIES) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = `${a.emoji} ${a.name[getLocale()]}`;
    b.onclick = () => showAmenity(a);
    chips.append(b);
  }
}

function renderLandmarkLabels(): void {
  fp.setLandmarkLabels(Object.fromEntries(AMENITIES.map(a => [a.id, a.name[getLocale()]])));
}

function showGuest(g: GuestMatch, opts: { resurface?: boolean } = {}): void {
  lastShown = g;
  lastAmenity = null;
  selectedTableNo = null;
  tableGuestsGen++;
  results.replaceChildren();
  banner.className = 'banner';
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
  if (opts.resurface) {
    if (lastTablemates) renderTablemates(lastTablemates, g.id); // locale toggle: no refetch
  } else {
    fp.zoomToSeat(key);
    burstPetals(mapEl);
    lastTablemates = null;
    void loadTablemates(g, ++tablematesGen);
  }
}

function renderTablemates(rows: Tablemate[], selfId: string): void {
  const list = tablemateRows(rows, selfId);
  if (list.length === 0) return; // solo at table → skip the section
  // Collapsed by default so the tablemate list (up to 7 names) doesn't push the
  // map off a phone screen; tap the summary to expand.
  const section = document.createElement('details');
  section.className = 'tablemates';
  const head = document.createElement('summary');
  head.className = 'tablemates-head';
  const others = list.filter(r => !r.isSelf).length;
  head.textContent = `${t('atYourTable')} (${others})`;
  const ul = document.createElement('ul');
  for (const r of list) {
    const item = document.createElement('li');
    if (r.isSelf) {
      const me = document.createElement('strong');
      me.textContent = `${displayName(r)} · ${t('you')}`;
      item.append(me);
    } else {
      item.textContent = displayName(r);
    }
    ul.append(item);
  }
  section.append(head, ul);
  banner.append(section);
}

async function loadTablemates(g: GuestMatch, gen: number): Promise<void> {
  try {
    const rows = await tableGuests(g.id);
    if (gen !== tablematesGen || lastShown?.id !== g.id) return; // superseded, re-entry, OR banner now shows something else
    lastTablemates = rows;
    renderTablemates(rows, g.id);
  } catch { /* supplementary — the seat already rendered; skip silently (spec) */ }
}

function showAmenity(a: Amenity, opts: { resurface?: boolean } = {}): void {
  lastShown = null;
  lastMatches = null;
  lastAmenity = a;
  selectedTableNo = null;
  tableGuestsGen++;
  results.replaceChildren();
  banner.className = 'banner';
  banner.hidden = false;
  const title = document.createElement('strong');
  title.textContent = `${a.emoji} ${a.name[getLocale()]}`;
  banner.replaceChildren(title);
  if (a.tagline) {
    const tag = document.createElement('small');
    tag.textContent = a.tagline[getLocale()];
    banner.append(document.createElement('br'), tag);
  }
  fp.highlight(null);
  if (!opts.resurface) fp.zoomToLandmark(a.id); // locale toggle re-renders text without re-zooming
}

function renderResults(matches: GuestMatch[]): void {
  lastMatches = matches;
  lastShown = null;
  lastAmenity = null;
  selectedTableNo = null;
  tableGuestsGen++;
  banner.className = 'banner';
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

function renderTableGuests(tableNo: number, rows: TableGuest[] | null | undefined): void {
  banner.className = 'banner table-guests';
  banner.hidden = false;
  const title = document.createElement('strong');
  title.textContent = tableLabelByNo(tableNo);
  const subtitle = document.createElement('small');
  subtitle.textContent = rows === null ? `${t('tableGuests')} · ${t('loading')}` : t('tableGuests');
  banner.replaceChildren(title, document.createElement('br'), subtitle);
  if (rows === null) return;
  if (rows === undefined) {
    const error = document.createElement('p');
    error.className = 'table-guests-empty';
    error.textContent = t('connectionTrouble');
    banner.append(error);
    return;
  }
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'table-guests-empty';
    empty.textContent = t('noTableGuests');
    banner.append(empty);
    return;
  }
  const ul = document.createElement('ul');
  for (const guest of rows) {
    const item = document.createElement('li');
    item.textContent = displayName(guest);
    ul.append(item);
  }
  banner.append(ul);
}

function showTable(tableNo: number, opts: { resurface?: boolean } = {}): void {
  lastShown = null;
  lastMatches = null;
  lastAmenity = null;
  results.replaceChildren();
  selectedTableNo = tableNo;
  fp.highlight(null);
  fp.zoomToTable(tableNo);
  const cachedRows = lastTableGuestsTableNo === tableNo ? lastTableGuests : null;
  renderTableGuests(tableNo, cachedRows);
  if (cachedRows || opts.resurface) return;
  const gen = ++tableGuestsGen;
  void loadTableGuests(tableNo, gen);
}

async function loadTableGuests(tableNo: number, gen: number): Promise<void> {
  try {
    const rows = await tableGuestsByTable(tableNo);
    if (gen !== tableGuestsGen || selectedTableNo !== tableNo) return;
    lastTableGuests = rows;
    lastTableGuestsTableNo = tableNo;
    renderTableGuests(tableNo, rows);
  } catch {
    if (gen !== tableGuestsGen || selectedTableNo !== tableNo) return;
    renderTableGuests(tableNo, undefined);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let lastRun = () => {};
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const p = prepareQuery(input.value);
    if (p.kind === 'too-short') {
      lastMatches = null; lastShown = null; lastAmenity = null; selectedTableNo = null; tableGuestsGen++;
      results.replaceChildren(); banner.hidden = true; fp.highlight(null);
      return;
    }
    if (matchesCouple(p)) {
      lastMatches = null; lastShown = null; lastAmenity = null; selectedTableNo = null; tableGuestsGen++;
      results.replaceChildren();
      banner.hidden = false;
      banner.className = 'sweetheart-card';
      banner.textContent = COUPLE.message[getLocale()];
      fp.highlight(null);
      fp.zoomToLandmark('sweetheart_table');
      burstPetals(mapEl, { count: 48 });
      return;
    }
    const am = matchAmenity(p);
    if (am) { showAmenity(am); return; }
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
    lastRun();
  }, 250);
});

langToggle.addEventListener('click', () => setLocale(getLocale() === 'en' ? 'zh' : 'en'));
onLocaleChange(() => {
  renderStatics();
  if (lastShown) showGuest(lastShown, { resurface: true });
  else if (lastAmenity) showAmenity(lastAmenity, { resurface: true });
  else if (selectedTableNo !== null) showTable(selectedTableNo, { resurface: true });
  else if (lastMatches) renderResults(lastMatches);
});

setLocale(detectLocale());
void (async () => {
  try {
    tables = await listTables();
    renderTableLabels();
    if (selectedTableNo !== null) renderTableGuests(selectedTableNo,
      lastTableGuestsTableNo === selectedTableNo ? lastTableGuests : null);
  }
  catch { /* decorative map labels — spec-documented silent skip */ }
})();

fp.onTap(hit => {
  if (hit.kind === 'table') showTable(hit.tableNo);
});
