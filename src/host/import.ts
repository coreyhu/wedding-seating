import { importSeating, listGuests, listTables } from '../shared/api';
import { toast } from '../shared/toast';
import { guestListCsv } from '../logic/guest-export';
import { parseSeatingMatrix, remapColumnsToTables, defaultMapping, type MatrixGuest, type MatrixTable } from '../logic/matrix';
import type { Guest, TableInfo } from '../shared/types';

const identity = (g: { name_en: string; name_zh: string }) => `${g.name_en}|${g.name_zh}`;

export function mountImport(el: HTMLElement, onDone: () => void): void {
  el.innerHTML = `
    <p>Choose a seating CSV — row 1 = group names, columns = tables, rows = seats. Exported sheets also preserve unseated guests and empty-seat positions. Then choose which venue table each group sits at.</p>
    <label class="csv-file-picker">Choose CSV file<input id="csv-file" type="file" accept=".csv,text/csv" /></label>
    <div id="csv-file-name" class="csv-file-name">No file selected</div>
    <div class="csv-actions"><button id="csv-export" type="button">Export guest list (round-trip CSV)</button></div>
    <ul class="import-errors"></ul>
    <div id="csv-mapping" class="csv-mapping"></div>
    <div id="csv-preview"></div>
    <button id="csv-go" disabled>Import</button>`;
  const fileInput = el.querySelector<HTMLInputElement>('#csv-file')!;
  const fileName = el.querySelector<HTMLElement>('#csv-file-name')!;
  const errorsEl = el.querySelector<HTMLUListElement>('.import-errors')!;
  const mappingEl = el.querySelector<HTMLElement>('#csv-mapping')!;
  const preview = el.querySelector<HTMLElement>('#csv-preview')!;
  const go = el.querySelector<HTMLButtonElement>('#csv-go')!;
  const exportButton = el.querySelector<HTMLButtonElement>('#csv-export')!;

  let tables: MatrixTable[] = [];
  let guests: MatrixGuest[] = [];
  let mapping: number[] = [];
  let mappingSig = '';           // signature of the rendered group labels
  let csvText = '';

  let existingPromise: Promise<Guest[]> | null = null;
  const getExisting = (): Promise<Guest[]> => (existingPromise ??= listGuests());
  let tablesPromise: Promise<TableInfo[]> | null = null;
  const getTables = (): Promise<TableInfo[]> => (tablesPromise ??= listTables());

  let token = 0;
  let fileToken = 0;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const mine = ++fileToken;
    if (!file) {
      csvText = '';
      fileName.textContent = 'No file selected';
      errorsEl.replaceChildren(); mappingEl.replaceChildren(); preview.textContent = ''; go.disabled = true;
      return;
    }
    try {
      const text = await file.text();
      if (mine !== fileToken) return;
      csvText = text;
      fileName.textContent = `Selected: ${file.name}`;
      void onInput();
    } catch (error) {
      if (mine !== fileToken) return;
      csvText = '';
      fileName.textContent = 'Could not read that file';
      errorsEl.replaceChildren(); mappingEl.replaceChildren(); preview.textContent = ''; go.disabled = true;
      toast(error instanceof Error ? error.message : 'Could not read CSV file');
    }
  });

  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    try {
      const [currentGuests, currentTables] = await Promise.all([listGuests(), listTables()]);
      const file = new Blob([guestListCsv(currentGuests, currentTables)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'seating-list.csv';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not export guest list');
    } finally {
      exportButton.disabled = false;
    }
  });

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
    // Import is full-override: the sheet is the guest list, so anyone in the DB
    // but absent from the sheet is DELETED (seated or not) — count them all.
    const toDelete = existing.filter(g => !sheetIds.has(identity(g)));
    preview.replaceChildren();
    const base = document.createElement('div');
    base.textContent = `${guests.length} guests across 12 tables · ${newCount} new · seated per your table mapping`;
    preview.append(base);
    if (toDelete.length > 0) {
      const warn = document.createElement('div');
      warn.className = 'preview-warn';
      // Name the guests, not just a count — a destructive delete is easy to
      // trigger by accident (a partial paste, or a name re-spelled between
      // exports), and seeing WHO would go lets the host catch a surprise.
      const names = toDelete.map(g => g.name_en || g.name_zh);
      const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? `, +${names.length - 8} more` : '');
      warn.textContent = `⚠ ${toDelete.length} guest${toDelete.length === 1 ? '' : 's'} will be DELETED (absent from this sheet): ${shown}`;
      preview.append(warn);
    }
    go.disabled = false;
  }

  async function onInput(): Promise<void> {
    const mine = ++token;
    const r = parseSeatingMatrix(csvText);
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
      if (mine !== token) return; // superseded during the getTables() fetch
      mapping = defaultMapping(tables, current.length ? current : tables.map(t => ({ table_no: t.table_no, label_en: `Table ${t.table_no}`, label_zh: `${t.table_no}号桌` })));
      mappingSig = sig;
      renderMapping(current);
    }
    revalidate();
  }

  go.addEventListener('click', async () => {
    const parsed = parseSeatingMatrix(csvText);
    const remapped = remapColumnsToTables(parsed, mapping);
    if (remapped.errors.length) { errorsEl.replaceChildren(...remapped.errors.map(li)); go.disabled = true; return; }
    try {
      const res = await importSeating({ tables: remapped.tables, guests: remapped.guests });
      existingPromise = null; tablesPromise = null; mappingSig = '';
      toast(`Imported ${res.imported} seats (${res.new} new guests, ${res.deleted} deleted)`);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed'); }
  });
}
