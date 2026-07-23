import { createClient } from '@supabase/supabase-js';
import type { Guest, GuestMatch, SeatKey, TableGuest, TableInfo, Tablemate } from './types';
import { parseSeatKey } from './types';
import type { MatrixGuest, MatrixTable } from '../logic/matrix';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const searchGuests = async (q: string): Promise<GuestMatch[]> =>
  unwrap(await supabase.rpc('search_guests', { q })) ?? [];
export const listGuests = async (): Promise<Guest[]> =>
  unwrap(await supabase.from('guests').select('*').order('name_en'));
export const listTables = async (): Promise<TableInfo[]> =>
  unwrap(await supabase.from('tables').select('*').order('table_no'));
export const tableGuests = async (guestId: string): Promise<Tablemate[]> =>
  unwrap(await supabase.rpc('table_guests', { p_guest_id: guestId })) ?? [];
export const tableGuestsByTable = async (tableNo: number): Promise<TableGuest[]> =>
  unwrap(await supabase.rpc('table_guests_by_table', { p_table_no: tableNo })) ?? [];
export const assignSeat = async (guestId: string, seat: SeatKey): Promise<void> => {
  const { table, seat: s } = parseSeatKey(seat);
  unwrap(await supabase.rpc('assign_seat', { p_guest_id: guestId, p_table_no: table, p_seat_no: s }));
};
export const unseatGuest = async (guestId: string): Promise<void> => {
  unwrap(await supabase.rpc('unseat', { p_guest_id: guestId }));
};
export const addGuest = async (nameEn: string, nameZh: string): Promise<string> =>
  unwrap(await supabase.rpc('add_guest', { p_name_en: nameEn, p_name_zh: nameZh }));
export const removeGuest = async (guestId: string): Promise<void> => {
  unwrap(await supabase.rpc('remove_guest', { p_guest_id: guestId }));
};
export const updateGuestName = async (guestId: string, nameEn: string, nameZh: string): Promise<void> => {
  unwrap(await supabase.rpc('update_guest_name', {
    p_guest_id: guestId, p_name_en: nameEn, p_name_zh: nameZh,
  }));
};
export const unseatAll = async (): Promise<number> =>
  unwrap(await supabase.rpc('unseat_all', {}));
export const rotateTable = async (tableNo: number): Promise<void> => {
  unwrap(await supabase.rpc('rotate_table', { p_table_no: tableNo }));
};
export const swapTables = async (a: number, b: number): Promise<void> => {
  unwrap(await supabase.rpc('swap_tables', { p_a: a, p_b: b }));
};
export const importSeating = async (payload: { tables: MatrixTable[]; guests: MatrixGuest[] }):
  Promise<{ imported: number; new: number; deleted: number }> =>
  unwrap(await supabase.rpc('import_seating', { payload }));
export const setTableLabel = async (tableNo: number, labelEn: string, labelZh: string): Promise<void> => {
  unwrap(await supabase.rpc('set_table_label', { p_table_no: tableNo, p_label_en: labelEn, p_label_zh: labelZh }));
};
export const signIn = async (email: string, password: string): Promise<void> => {
  // Not routed through unwrap(): auth-js's error-branch `data` is an object of
  // null-valued fields (RequestResultSafeDestructure), not `null` itself, so it
  // doesn't structurally satisfy unwrap<T>()'s `{ data: T | null; ... }` shape.
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
};
export const signOut = async (): Promise<void> => {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
};
export const hasSession = async (): Promise<boolean> => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return !!data.session;
};
