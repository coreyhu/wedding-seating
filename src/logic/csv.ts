export function parseGuestCsv(text: string): { rows: { name_en: string; name_zh: string }[]; skipped: number } {
  const cells = split(text.replace(/^﻿/, '')); // Excel/Sheets BOM
  const rows: { name_en: string; name_zh: string }[] = [];
  let skipped = 0;
  for (const [i, line] of cells.entries()) {
    const name_en = (line[0] ?? '').trim();
    const name_zh = (line[1] ?? '').trim();
    if (i === 0 && /name|english|中文|姓名/i.test(name_en + name_zh)) continue; // header
    if (!name_en && !name_zh) { if (line.length) skipped++; continue; }
    rows.push({ name_en, name_zh });
  }
  return { rows, skipped };
}

function split(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const push = () => { row.push(cell); cell = ''; };
  const pushRow = () => { push(); if (row.some(c => c !== '')) out.push(row); else if (row.length > 1) out.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') push();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) pushRow();
  return out;
}
