import type { Guest, TableInfo } from '../shared/types';
import { EMPTY_SEAT_MARKER, UNSEATED_HEADER } from './matrix';

const escapeCsv = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const compareNames = (a: Guest, b: Guest): number =>
  a.name_en.localeCompare(b.name_en) || a.name_zh.localeCompare(b.name_zh);

const displayName = (guest: Guest): string =>
  guest.name_zh ? `${guest.name_en} / ${guest.name_zh}` : guest.name_en;

const displayTable = (table: TableInfo): string =>
  table.label_zh ? `${table.label_en} / ${table.label_zh}` : table.label_en;

export function guestListCsv(guests: Guest[], tables: TableInfo[]): string {
  const tablesByNo = new Map(tables.map(table => [table.table_no, table]));
  const seatedBySeat = new Map(guests
    .filter(guest => guest.table_no != null && guest.seat_no != null)
    .map(guest => [`${guest.table_no}-${guest.seat_no}`, guest]));
  const unseated = guests.filter(guest => guest.table_no == null).sort(compareNames);
  const rowCount = Math.max(8, unseated.length);
  const header = Array.from({ length: 12 }, (_, index) => {
    const tableNo = index + 1;
    return displayTable(tablesByNo.get(tableNo) ?? { table_no: tableNo, label_en: `Table ${tableNo}`, label_zh: `${tableNo}号桌` });
  });
  header.push(UNSEATED_HEADER);
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const seatNo = rowIndex + 1;
    const row = Array.from({ length: 12 }, (_, tableIndex) => {
      if (seatNo > 8) return '';
      const guest = seatedBySeat.get(`${tableIndex + 1}-${seatNo}`);
      return guest ? displayName(guest) : EMPTY_SEAT_MARKER;
    });
    row.push(unseated[rowIndex] ? displayName(unseated[rowIndex]!) : '');
    return row.map(escapeCsv).join(',');
  });
  return [header.map(escapeCsv).join(','), ...rows].join('\r\n') + '\r\n';
}
