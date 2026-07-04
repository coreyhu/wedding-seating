import { importGuests } from '../shared/api';
import { toast } from '../shared/toast';
import { parseGuestCsv } from '../logic/csv';

export function mountImport(el: HTMLElement, onDone: () => void): void {
  el.innerHTML = `
    <p>Export the Google Sheet as CSV (two columns: English name, Chinese name) and paste it here.</p>
    <textarea id="csv" rows="6" placeholder="Carol Zhao,Zhao Ka Luo"></textarea>
    <div id="csv-preview"></div>
    <button id="csv-go" disabled>Import</button>`;
  const ta = el.querySelector<HTMLTextAreaElement>('#csv')!;
  const preview = el.querySelector<HTMLElement>('#csv-preview')!;
  const go = el.querySelector<HTMLButtonElement>('#csv-go')!;
  let rows: { name_en: string; name_zh: string }[] = [];
  ta.addEventListener('input', () => {
    const r = parseGuestCsv(ta.value);
    rows = r.rows;
    // CSV-derived text (row count/first name) goes through textContent, never
    // innerHTML — same hardening as guest/host name rendering elsewhere.
    preview.textContent = rows.length
      ? `${rows.length} guests ready (${r.skipped} empty rows skipped). First: ${rows[0]!.name_en || rows[0]!.name_zh}`
      : 'Nothing parseable yet.';
    go.disabled = !rows.length;
  });
  go.addEventListener('click', async () => {
    try {
      const n = await importGuests(rows);
      toast(`Imported ${n} new guests (${rows.length - n} already existed)`);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Import failed'); }
  });
}
