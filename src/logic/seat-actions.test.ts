import { describe, expect, it } from 'vitest';
import { cancel, idle, pickUnseated, pressMove, pressUnseat, tapSeat, type Mode } from './seat-actions';

const none = { type: 'none' } as const;

describe('seat-actions', () => {
  it('tap opens a seat panel', () => {
    expect(tapSeat(idle, '3-5', 'g1')).toEqual({ mode: { kind: 'seat-open', seat: '3-5', occupantId: 'g1' }, command: none });
  });
  it('tap another seat re-targets the panel', () => {
    const m: Mode = { kind: 'seat-open', seat: '3-5', occupantId: 'g1' };
    expect(tapSeat(m, '4-1', null).mode).toEqual({ kind: 'seat-open', seat: '4-1', occupantId: null });
  });
  it('picking a guest for an empty seat assigns and closes', () => {
    const m: Mode = { kind: 'seat-open', seat: '4-1', occupantId: null };
    expect(pickUnseated(m, 'g9')).toEqual({ mode: idle, command: { type: 'assign', guestId: 'g9', seat: '4-1' } });
  });
  it('unseat from an occupied seat', () => {
    const m: Mode = { kind: 'seat-open', seat: '3-5', occupantId: 'g1' };
    expect(pressUnseat(m)).toEqual({ mode: idle, command: { type: 'unseat', guestId: 'g1' } });
  });
  it('move → picking-dest → tap target assigns (swap server-side)', () => {
    const open: Mode = { kind: 'seat-open', seat: '3-5', occupantId: 'g1' };
    const picking = pressMove(open);
    expect(picking).toEqual({ mode: { kind: 'picking-dest', movingId: 'g1', fromSeat: '3-5' }, command: none });
    expect(tapSeat(picking.mode, '7-2', 'g4')).toEqual({ mode: idle, command: { type: 'assign', guestId: 'g1', seat: '7-2' } });
  });
  it('tapping the origin seat while picking cancels', () => {
    const m: Mode = { kind: 'picking-dest', movingId: 'g1', fromSeat: '3-5' };
    expect(tapSeat(m, '3-5', 'g1')).toEqual({ mode: idle, command: none });
  });
  it('cancel always returns to idle without a command', () => {
    expect(cancel({ kind: 'picking-dest', movingId: 'g1', fromSeat: '3-5' })).toEqual({ mode: idle, command: none });
    expect(cancel({ kind: 'seat-open', seat: '1-1', occupantId: null })).toEqual({ mode: idle, command: none });
  });
  it('illegal events are no-ops', () => {
    expect(pressMove(idle)).toEqual({ mode: idle, command: none });
    expect(pressUnseat({ kind: 'seat-open', seat: '1-1', occupantId: null })).toEqual({ mode: { kind: 'seat-open', seat: '1-1', occupantId: null }, command: none });
    expect(pickUnseated(idle, 'g1')).toEqual({ mode: idle, command: none });
  });
});
