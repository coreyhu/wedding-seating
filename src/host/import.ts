import { importSeating, listGuests, listTables } from '../shared/api';
import { toast } from '../shared/toast';
import { parseSeatingMatrix, remapColumnsToTables, defaultMapping, type MatrixGuest, type MatrixTable } from '../logic/matrix';
import type { Guest, TableInfo } from '../shared/types';

const identity = (g: { name_en: string; name_zh: string }) => `${g.name_en}|${g.name_zh}`;

export function mountImport(el: HTMLElement, onDone: () => void): void {
  el.innerHTML = `
    <p>Paste the whole seating sheet as CSV — row 1 = group names, columns = tables, rows = seats. Then choose which venue table each group sits at.</p>
    <textarea id="csv" rows="6" placeholder="Peacock / 孔雀,Owl,Kangaroo,..."></textarea>
    <ul class="import-errors"></ul>
    <div id="csv-mapping" class="csv-mapping"></div>
    <div id="csv-preview"></div>
    <button id="csv-go" disabled>Import</button>`;
  const ta = el.querySelector<HTMLTextAreaElement>('#csv')!;
  const errorsEl = el.querySelector<HTMLUListElement>('.import-errors')!;
  const mappingEl = el.querySelector<HTMLElement>('#csv-mapping')!;
  const preview = el.querySelector<HTMLElement>('#csv-preview')!;
  const go = el.querySelector<HTMLButtonElement>('#csv-go')!;

  let tables: MatrixTable[] = [];
  let guests: MatrixGuest[] = [];
  let mapping: number[] = [];
  let mappingSig = '';           // signature of the rendered group labels

  let existingPromise: Promise<Guest[]> | null = null;
  const getExisting = (): Promise<Guest[]> => (existingPromise ??= listGuests());
  let tablesPromise: Promise<TableInfo[]> | null = null;
  const getTables = (): Promise<TableInfo[]> => (tablesPromise ??= listTables());

  let token = 0;
  ta.addEventListener('input', () => { void onInput(); });

  // Rebuild the per-group <select>s (only when group labels change, to preserve
  // the user's picks while they edit seat rows). Each option is "{n} — {label}".
  function renderMapping(current: TableInfo[]): void {
    mappingEl.replaceChildren();
    mapping.forEach((chosen, col) => {
      const row = document.createElement('label');
      row.className = 'map-row';
      const name = document.createElement('span');
      name.textContent = tables[col]!.label_en || `Column ${col + 1}`;
      const sel = document.createElement('select');
      for (let n = 1; n <= 12; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        const lbl = current.find(c => c.table_no === n)?.label_en ?? `Table ${n}`;
        opt.textContent = `${n} — ${lbl}`;
        if (n === chosen) opt.selected = true;
        sel.append(opt);
      }
      sel.addEventListener('change', () => { mapping[col] = Number(sel.value); revalidate(); });
      row.append(name, sel);
      mappingEl.append(row);
    });
  }

  // Uniqueness check + preview refresh; no reparse.
  function revalidate(): void {
    if (new Set(mapping).size !== mapping.length) {
      errorsEl.replaceChildren(li('Each venue table can be used once — two groups map to the same table.'));
      go.disabled = true;
      token++;   // invalidate any in-flight refreshPreview so it can't re-enable Import
      return;
    }
    errorsEl.replaceChildren();
    void refreshPreview();
  }

  const li = (msg: string): HTMLLIElement => { const el2 = document.createElement('li'); el2.textContent = msg; return el2; };

  async function refreshPreview(): Promise<void> {
    const mine = ++token;
    let existing: Guest[];
    try { existing = await getExisting(); }
    catch (e) {
      if (mine !== token) return;
      preview.textContent = ''; go.disabled = true;
      return toast(e instanceof Error ? e.message : 'Could not load current guest list');
    }
    if (mine !== token) return;
    const existingIds = new Set(existing.map(identity));
    const sheetIds = new Set(guests.map(identity));
    const newCount = guests.filter(g => !existingIds.has(identity(g))).length;
    const willUnseat = existing.filter(g => g.table_no != null && !sheetIds.has(identity(g))).length;
    preview.textContent = `${guests.length} guests across 12 tables · ${newCount} new · ${willUnseat} will become unseated · seated per your table mapping`;
    go.disabled = false;
  }

  async function onInput(): Promise<void> {
    const r = parseSeatingMatrix(ta.value);
    tables = r.tables;
    guests = r.guests;
    if (r.errors.length) {
      errorsEl.replaceChildren(...r.errors.map(li));
      mappingEl.replaceChildren(); mappingSig = '';
      preview.textContent = ''; go.disabled = true;
      return;
    }
    errorsEl.replaceChildren();
    const sig = JSON.stringify(tables.map(t => [t.label_en, t.label_zh]));
    if (sig !== mappingSig) {
      let current: TableInfo[] = [];
      try { current = await getTables(); } catch { /* labels are a hint only; fall back to numbers */ }
      mapping = defaultMapping(tables, current.length ? current : tables.map(t => ({ table_no: t.table_no, label_en: `Table ${t.table_no}`, label_zh: `${t.table_no}号桌` })));
      mappingSig = sig;
      renderMapping(current);
    }
    revalidate();
  }

  go.addEventListener('click', async () => {
    const remapped = remapColumnsToTables({ tables, guests, errors: [] }, mapping);
    if (remapped.errors.length) { errorsEl.replaceChildren(...remapped.errors.map(li)); go.disabled = true; return; }
    try {
      const res = await importSeating({ tables: remapped.tables, guests: remapped.guests });
      existingPromise = null; tablesPromise = null; mappingSig = '';
      toast(`Imported ${res.imported} seats (${res.new} new guests, ${res.unseated} unseated)`);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed'); }
  });
}
