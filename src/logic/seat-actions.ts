import type { SeatKey } from '../shared/types';

export type Mode =
  | { kind: 'idle' }
  | { kind: 'seat-open'; seat: SeatKey; occupantId: string | null }
  | { kind: 'picking-dest'; movingId: string; fromSeat: SeatKey };
export type Command =
  | { type: 'none' }
  | { type: 'assign'; guestId: string; seat: SeatKey }
  | { type: 'unseat'; guestId: string };
export interface Step { mode: Mode; command: Command; }

export const idle: Mode = { kind: 'idle' };
const stay = (mode: Mode): Step => ({ mode, command: { type: 'none' } });

export function tapSeat(m: Mode, seat: SeatKey, occupantId: string | null): Step {
  if (m.kind === 'picking-dest') {
    if (seat === m.fromSeat) return stay(idle);
    return { mode: idle, command: { type: 'assign', guestId: m.movingId, seat } };
  }
  return stay({ kind: 'seat-open', seat, occupantId });
}
export function pickUnseated(m: Mode, guestId: string): Step {
  if (m.kind !== 'seat-open' || m.occupantId !== null) return stay(m);
  return { mode: idle, command: { type: 'assign', guestId, seat: m.seat } };
}
export function pressUnseat(m: Mode): Step {
  if (m.kind !== 'seat-open' || m.occupantId === null) return stay(m);
  return { mode: idle, command: { type: 'unseat', guestId: m.occupantId } };
}
export function pressMove(m: Mode): Step {
  if (m.kind !== 'seat-open' || m.occupantId === null) return stay(m);
  return stay({ kind: 'picking-dest', movingId: m.occupantId, fromSeat: m.seat });
}
export function cancel(_m: Mode): Step { return stay(idle); }
