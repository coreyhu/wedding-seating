import { beforeEach, expect, it, vi } from 'vitest';
import { mountFloorplan } from './floorplan';
import type { SeatMap } from './types';

const svgText = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g id="table-1"><path id="table-1-shape" d="M40 40 h20 v20 h-20 z"/>
  <path id="seat-1-1" class="seat" d="M45 20 h10 v10 h-10 z"/>
  <path id="seat-1-2" class="seat" d="M70 45 h10 v10 h-10 z"/></g></svg>`;
const seatMap: SeatMap = { viewBox: '0 0 100 100',
  tables: { '1': { cx: 50, cy: 50, r: 10 } },
  seats: { '1-1': { cx: 50, cy: 25 }, '1-2': { cx: 75, cy: 50 } } };

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
  expect(Number(label.getAttribute('y'))).toBeLessThan(25); // pushed outward, away from table center
  fp.clearSeatLabels();
  expect(container.querySelectorAll('.seat-label')).toHaveLength(0);
});
it('delegates seat taps', () => {
  const fp = mount();
  const cb = vi.fn();
  fp.onSeatTap(cb);
  fp.seatEl('1-2')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(cb).toHaveBeenCalledWith('1-2');
});
