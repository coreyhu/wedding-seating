export type SeatKey = string; // "3-5"
export interface Guest { id: string; name_en: string; name_zh: string; table_no: number | null; seat_no: number | null; }
export interface GuestMatch extends Guest { label_en: string | null; label_zh: string | null; }
export interface TableInfo { table_no: number; label_en: string; label_zh: string; }
export interface TableGuest { name_en: string; name_zh: string; seat_no: number | null; }
export interface Tablemate extends TableGuest { id: string; }
export type { SeatMap } from '../../scripts/svg-transform';
export const seatKey = (t: number, s: number): SeatKey => `${t}-${s}`;
export const parseSeatKey = (k: SeatKey): { table: number; seat: number } => {
  const [t, s] = k.split('-').map(Number);
  return { table: t!, seat: s! };
};
