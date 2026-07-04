import { importSeating, listGuests } from '../shared/api';
import { toast } from '../shared/toast';
import { parseSeatingMatrix, type MatrixGuest, type MatrixTable } from '../logic/matrix';
import type { Guest } from '../shared/types';

const identity = (g: { name_en: string; name_zh: string }) => `${g.name_en}|${g.name_zh}`;

export function mountImport(el: HTMLElement, onDone: () => void): void {
  el.innerHTML = `
    <p>Paste the whole seating sheet as CSV — row 1 = table names, columns = tables, rows = seats.</p>
    <textarea id="csv" rows="6" placeholder="Peacock / 孔雀,Owl,Kangaroo,..."></textarea>
    <ul class="import-errors"></ul>
    <div id="csv-preview"></div>
    <button id="csv-go" disabled>Import</button>`;
  const ta = el.querySelector<HTMLTextAreaElement>('#csv')!;
  const errorsEl = el.querySelector<HTMLUListElement>('.import-errors')!;
  const preview = el.querySelector<HTMLElement>('#csv-preview')!;
  const go = el.querySelector<HTMLButtonElement>('#csv-go')!;

  let tables: MatrixTable[] = [];
  let guests: MatrixGuest[] = [];
  // Fetch the current guest list at most once per paste-session (a promise, so
  // concurrent keystrokes share the same in-flight request); invalidated after
  // a successful import so a follow-up re-paste (the sheet always wins) sees
  // fresh new/will-unseat counts instead of stale ones.
  let existingPromise: Promise<Guest[]> | null = null;
  const getExisting = (): Promise<Guest[]> => (existingPromise ??= listGuests());

  let token = 0;
  ta.addEventListener('input', () => { void onInput(); });

  async function onInput(): Promise<void> {
    const mine = ++token;
    const r = parseSeatingMatrix(ta.value);
    tables = r.tables;
    guests = r.guests;
    // All CSV-derived strings render via textContent, never innerHTML — same
    // hardening as guest/host name rendering elsewhere.
    if (r.errors.length) {
      errorsEl.replaceChildren(...r.errors.map(msg => {
        const li = document.createElement('li');
        li.textContent = msg;
        return li;
      }));
      preview.textContent = '';
      go.disabled = true;
      return;
    }
    errorsEl.replaceChildren();
    let existing: Guest[];
    try { existing = await getExisting(); }
    catch (e) {
      if (mine !== token) return;
      preview.textContent = '';
      go.disabled = true;
      return toast(e instanceof Error ? e.message : 'Could not load current guest list');
    }
    if (mine !== token) return; // superseded by a later keystroke
    const existingIds = new Set(existing.map(identity));
    const sheetIds = new Set(guests.map(identity));
    const newCount = guests.filter(g => !existingIds.has(identity(g))).length;
    const willUnseat = existing.filter(g => g.table_no != null && !sheetIds.has(identity(g))).length;
    preview.textContent = `${guests.length} guests across 12 tables · ${newCount} new · ${willUnseat} will become unseated`;
    go.disabled = false;
  }

  go.addEventListener('click', async () => {
    try {
      const r = await importSeating({ tables, guests });
      existingPromise = null;
      toast(`Imported ${r.imported} seats (${r.new} new guests, ${r.unseated} unseated)`);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed'); }
  });
}
