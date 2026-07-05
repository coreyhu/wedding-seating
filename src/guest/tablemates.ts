import type { Tablemate } from '../shared/types';

export interface TablemateRow { name_en: string; name_zh: string; isSelf: boolean; }

// Display rows for "At your table", preserving the RPC's seat order. Returns []
// when there is nobody else at the table (the section is then skipped).
export function tablemateRows(rows: Tablemate[], selfId: string): TablemateRow[] {
  if (rows.filter(r => r.id !== selfId).length === 0) return [];
  return rows.map(r => ({ name_en: r.name_en, name_zh: r.name_zh, isSelf: r.id === selfId }));
}
