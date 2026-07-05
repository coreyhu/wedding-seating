export interface MatrixTable { table_no: number; label_en: string; label_zh: string }
export interface MatrixGuest { name_en: string; name_zh: string; table_no: number; seat_no: number }
export interface MatrixResult { tables: MatrixTable[]; guests: MatrixGuest[]; errors: string[] }

const splitName = (cell: string): { en: string; zh: string } => {
  const i = cell.search(/[/／]/);
  if (i < 0) return { en: cell.trim(), zh: '' };
  return { en: cell.slice(0, i).trim(), zh: cell.slice(i + 1).trim() };
};

export function parseSeatingMatrix(text: string): MatrixResult {
  const rows = split(text.replace(/^﻿/, '')); // strip Excel/Sheets BOM
  const errors: string[] = [];
  const header = (rows[0] ?? []).map(c => c.trim());
  while (header.length && header[header.length - 1] === '') header.pop();
  if (header.length !== 12) errors.push(`expected 12 table-name headers, found ${header.length}`);
  const tables: MatrixTable[] = header.slice(0, 12).map((h, i) => {
    const { en, zh } = splitName(h);
    return { table_no: i + 1, label_en: en, label_zh: zh };
  });
  const guests: MatrixGuest[] = [];
  const seen = new Map<string, string>(); // identity -> first location
  for (let r = 1; r < rows.length; r++) {
    for (let c = 0; c < Math.min(rows[r]!.length, 12); c++) {
      const cell = rows[r]![c]!.trim();
      if (!cell || cell === '/') continue;
      const { en, zh } = splitName(cell);
      if (!en && !zh) continue;
      const seat_no = guests.filter(g => g.table_no === c + 1).length + 1;
      if (seat_no > 8) { errors.push(`${tables[c]?.label_en || `column ${c + 1}`} has more than 8 guests`); continue; }
      const key = `${en}|${zh}`;
      if (seen.has(key)) errors.push(`duplicate guest "${[en, zh].filter(Boolean).join(' / ')}" (${seen.get(key)} and ${tables[c]?.label_en})`);
      else seen.set(key, tables[c]?.label_en || `column ${c + 1}`);
      guests.push({ name_en: en, name_zh: zh, table_no: c + 1, seat_no });
    }
  }
  return { tables, guests, errors };
}

// mapping[c] = venue table number (1..12) for column index c (0-based).
// parseSeatingMatrix assigns column c the provisional table_no = c+1, so a table
// with provisional number k came from column k-1 and maps to mapping[k-1].
// seat_no is within-column ordering and is left untouched. Identity mapping
// [1..12] reproduces the positional output exactly.
export function remapColumnsToTables(r: MatrixResult, mapping: number[]): MatrixResult {
  const valid = mapping.length === 12
    && mapping.every(n => Number.isInteger(n) && n >= 1 && n <= 12)
    && new Set(mapping).size === 12;
  if (!valid) {
    return { ...r, errors: [...r.errors, `invalid table mapping: expected a permutation of 1–12, got [${mapping.join(', ')}]`] };
  }
  const to = (provisional: number): number => mapping[provisional - 1]!;
  return {
    errors: r.errors,
    tables: r.tables.map(t => ({ ...t, table_no: to(t.table_no) })),
    guests: r.guests.map(g => ({ ...g, table_no: to(g.table_no) })),
  };
}

// Default dropdown values: prefer the venue table each group already occupies
// (matched by current label), else fill with the lowest unused number. ALWAYS
// returns a permutation of 1..12. First import (labels still "Table N") → identity.
export function defaultMapping(
  tables: MatrixTable[],
  existing: { table_no: number; label_en: string; label_zh: string }[],
): number[] {
  const normEn = (s: string): string => s.trim().toLowerCase();
  const byEn = new Map<string, number>();
  const byZh = new Map<string, number>();
  for (const e of existing) {
    if (e.label_en.trim()) byEn.set(normEn(e.label_en), e.table_no);
    if (e.label_zh.trim()) byZh.set(e.label_zh.trim(), e.table_no);
  }
  const used = new Set<number>();
  const result: (number | null)[] = tables.map(() => null);
  tables.forEach((t, i) => {
    const match = (t.label_en.trim() ? byEn.get(normEn(t.label_en)) : undefined)
      ?? (t.label_zh.trim() ? byZh.get(t.label_zh.trim()) : undefined);
    if (match !== undefined && !used.has(match)) { result[i] = match; used.add(match); }
  });
  let next = 1;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === null) {
      while (used.has(next)) next++;
      result[i] = next; used.add(next);
    }
  }
  return result as number[];
}

// v1 quoted-field CSV splitter, moved here verbatim from csv.ts.
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
