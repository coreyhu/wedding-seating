import { beforeEach, describe, expect, it, vi } from 'vitest';
import { labelFontSize, mountFloorplan, zoomCappedLabelFontSize } from './floorplan';
import type { SeatMap } from './types';

describe('labelFontSize', () => {
  it('scales the font to the viewBox so on-screen size is stable across exports', () => {
    // v3 map (~4850 wide) must yield a much larger unit font than the old
    // ~2283-wide map — the fixed 9-unit font that rendered at ~3.5px is the bug.
    expect(labelFontSize(4850, 'seat')).toBeGreaterThan(20);
    expect(labelFontSize(4850, 'seat')).toBeCloseTo(32.3, 0);
    // bigger coordinate space → bigger unit font, proportionally
    expect(labelFontSize(4850, 'seat')).toBeGreaterThan(labelFontSize(2283, 'seat'));
    // table names are larger than seat names; landmarks in between
    expect(labelFontSize(4850, 'table')).toBeGreaterThan(labelFontSize(4850, 'seat'));
    expect(labelFontSize(4850, 'landmark')).toBeGreaterThan(labelFontSize(4850, 'seat'));
  });
  it('falls back to a sane width when the viewBox is missing/zero', () => {
    expect(labelFontSize(0, 'seat')).toBeGreaterThan(0);
  });
});

it('caps host label growth after the fitted zoom level', () => {
  expect(zoomCappedLabelFontSize(24, 1)).toBeCloseTo(24, 8);
  expect(zoomCappedLabelFontSize(24, 4)).toBeCloseTo(8.1, 1);
  expect(zoomCappedLabelFontSize(24, 0.8)).toBeCloseTo(24, 8);
});

const svgText = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g id="table-1"><path id="table-1-shape" d="M40 40 h20 v20 h-20 z"/>
  <path id="seat-1-1" class="seat" d="M45 20 h10 v10 h-10 z"/>
  <path id="seat-1-2" class="seat" d="M70 45 h10 v10 h-10 z"/></g></svg>`;
const seatMap: SeatMap = { viewBox: '0 0 100 100',
  // Deliberately offset: table labels should use the centre of all eight
  // rendered chairs, which is what users see on the floorplan.
  tables: { '1': { cx: 42, cy: 43, r: 10 } },
  seats: {
    '1-1': { cx: 50, cy: 25 }, '1-2': { cx: 75, cy: 50 },
    '1-3': { cx: 50, cy: 75 }, '1-4': { cx: 25, cy: 50 },
    '1-5': { cx: 32, cy: 32 }, '1-6': { cx: 68, cy: 32 },
    '1-7': { cx: 68, cy: 68 }, '1-8': { cx: 32, cy: 68 },
  },
  landmarks: { sweetheart_table: { cx: 10, cy: 10 } } };

let container: HTMLElement;
beforeEach(() => { document.body.innerHTML = '<div id="c"></div>'; container = document.querySelector('#c')!; });
const mount = () => mountFloorplan(container, { panZoom: false, svgText, seatMap });

it('mounts inline and finds seats', () => {
  const fp = mount();
  expect(fp.seatEl('1-1')?.id).toBe('seat-1-1');
  expect(fp.seatEl('9-9')).toBeNull();
});
it('highlight is exclusive', () => {
  const fp = mount();
  fp.highlight('1-1'); fp.highlight('1-2');
  expect(fp.seatEl('1-1')?.classList.contains('highlight')).toBe(false);
  expect(fp.seatEl('1-2')?.classList.contains('highlight')).toBe(true);
  fp.highlight(null);
  expect(container.querySelectorAll('.highlight')).toHaveLength(0);
});
it('occupied toggling and labels', () => {
  const fp = mount();
  fp.setOccupied('1-1', true);
  expect(fp.seatEl('1-1')?.classList.contains('occupied')).toBe(true);
  fp.addSeatLabel('1-1', 'Carol Zhao');
  const label = container.querySelector('text.seat-label')!;
  expect(label.textContent).toBe('Carol Zhao');
  expect(Number(label.getAttribute('y'))).toBe(25); // centered on the occupied chair
  fp.clearSeatLabels();
  expect(container.querySelectorAll('.seat-label')).toHaveLength(0);
});
it('delegates seat taps', () => {
  const fp = mount();
  const cb = vi.fn();
  fp.onTap(cb);
  fp.seatEl('1-2')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(cb).toHaveBeenCalledWith({ kind: 'seat', key: '1-2' });
});
it('delegates table taps', () => {
  const fp = mount();
  const cb = vi.fn();
  fp.onTap(cb);
  container.querySelector('#table-1-shape')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(cb).toHaveBeenCalledWith({ kind: 'table', tableNo: 1 });
});
it('zoom helpers are safe no-ops without panZoom', () => {
  const fp = mount();
  expect(() => {
    fp.zoomToLandmark('sweetheart_table'); fp.zoomToLandmark('nope');
    fp.zoomToTable(1); fp.zoomToTable(99); fp.zoomToPoint(1, 2);
  }).not.toThrow();
});
it('setTableLabels draws inside the table and replaces on re-call', () => {
  const fp = mount();
  fp.setTableLabels({ 1: 'Fern' });
  fp.setTableLabels({ 1: '蕨' });
  const els = container.querySelectorAll('.table-label');
  expect(els).toHaveLength(1);
  expect(els[0]!.textContent).toBe('蕨');
  expect(Number(els[0]!.getAttribute('x'))).toBe(50);
  expect(Number(els[0]!.getAttribute('y'))).toBe(50); // centered on the table
});
it('animated zoomToPoint stays a safe no-op without panZoom and cancels cleanly', () => {
  const fp = mount();
  expect(() => { fp.zoomToPoint(1, 2); fp.zoomToPoint(3, 4); }).not.toThrow();
});
it('setLandmarkLabels draws at landmark coords and replaces on re-call', () => {
  const fp = mount();
  fp.setLandmarkLabels({ sweetheart_table: 'Bar' });
  fp.setLandmarkLabels({ sweetheart_table: '酒吧' });
  const els = container.querySelectorAll('.landmark-label');
  expect(els).toHaveLength(1);
  expect(els[0]!.textContent).toBe('酒吧');
});
it('mounting without panZoom attaches no gesture handlers that throw on pointer events', () => {
  const fp = mount();
  expect(() => {
    fp.svg.dispatchEvent(new Event('pointerdown'));
    fp.svg.dispatchEvent(new Event('pointermove'));
    fp.svg.dispatchEvent(new Event('pointerup'));
  }).not.toThrow();
});
