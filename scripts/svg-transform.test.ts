import { describe, expect, it } from 'vitest';
import { pathPoints, transformFloorplan, type SeatMap } from './svg-transform';
import { centroid } from '../src/logic/seat-geometry';
import { devFloorplanSvg } from './make-dev-floorplan';

const src = devFloorplanSvg();

describe('pathPoints', () => {
  it('walks absolute commands', () => {
    expect(pathPoints('M 10 10 L 30 10 L 30 30 L 10 30 Z')).toEqual([
      { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }]);
  });
  it('walks a real Affinity chair path (relative l/c commands)', () => {
    // verbatim from Corey's export: a chair of table 1 near (1552, 1751)
    const d = 'M1547.242,1743.243l10.2,0l0,17l-10.2,0c-4.694,0 -8.5,-3.806 -8.5,-8.5c0,-4.694 3.806,-8.5 8.5,-8.5Z';
    const c = centroid(pathPoints(d));
    expect(c.x).toBeGreaterThan(1540); expect(c.x).toBeLessThan(1560);
    expect(c.y).toBeGreaterThan(1740); expect(c.y).toBeLessThan(1762);
  });
});

describe('transformFloorplan', () => {
  it('injects seat and table ids for 12 tables × 8 chairs', () => {
    const { svg, seatMap } = transformFloorplan(src, null);
    expect(Object.keys(seatMap.tables)).toHaveLength(12);
    expect(Object.keys(seatMap.seats)).toHaveLength(96);
    for (let t = 1; t <= 12; t++)
      for (let s = 1; s <= 8; s++) expect(svg).toContain(`id="seat-${t}-${s}"`);
    expect(svg).toContain('id="table-7"');
  });
  it('accepts underscore group names and tightens the viewBox', () => {
    const underscored = src.replace(/table-(\d+)/g, 'table_$1');
    const { seatMap } = transformFloorplan(underscored, null);
    expect(Object.keys(seatMap.seats)).toHaveLength(96);
    expect(seatMap.viewBox).not.toBe('0 0 1500 1200'); // tightened to content
  });
  it('numbers seat 1 at 12 o’clock', () => {
    const { seatMap } = transformFloorplan(src, null);
    const t1 = seatMap.tables['1']!;
    const s1 = seatMap.seats['1-1']!;
    expect(s1.cy).toBeLessThan(t1.cy);            // above center
    expect(Math.abs(s1.cx - t1.cx)).toBeLessThan(2); // straight up
  });
  it('rejects a group without exactly 8 chairs', () => {
    const bad = src.replace(/<path class="chair" data-t="5" data-i="0"[^/]*\/>/, '');
    expect(() => transformFloorplan(bad, null)).toThrow(/table-5.*8 chairs/s);
  });
  it('diff guard: fails when an existing seat would move', () => {
    const { seatMap } = transformFloorplan(src, null);
    const prev: SeatMap = structuredClone(seatMap);
    prev.seats['1-1'] = { cx: prev.seats['1-1']!.cx + 500, cy: prev.seats['1-1']!.cy };
    expect(() => transformFloorplan(src, prev)).toThrow(/seat 1-1/);
  });
});

describe('landmarks', () => {
  const withLandmarks = src.replace('</svg>',
    `<g id="sweetheart_table"><circle cx="700" cy="80" r="20"/><path d="M 690 70 L 710 70 L 710 90 L 690 90 Z"/></g>
     <path id="bar" d="M 100 1000 L 140 1000 L 140 1040 L 100 1040 Z"/></svg>`);
  it('extracts non-table ids with centers', () => {
    const { seatMap } = transformFloorplan(withLandmarks, null);
    expect(seatMap.landmarks['sweetheart_table']!.cx).toBeCloseTo(700, 0);
    expect(seatMap.landmarks['bar']).toEqual({ cx: 120, cy: 1020 });
  });
  it('never records tables/seats/container as landmarks', () => {
    const { seatMap } = transformFloorplan(withLandmarks, null);
    expect(Object.keys(seatMap.landmarks)).toEqual(expect.not.arrayContaining(
      Object.keys(seatMap.tables).map(t => `table-${t}`)));
    expect(seatMap.landmarks['guest_tables']).toBeUndefined();
  });
  it('diff guard ignores landmark changes and tolerates prev maps without landmarks', () => {
    const { seatMap } = transformFloorplan(withLandmarks, null);
    const prev = structuredClone(seatMap) as SeatMap & { landmarks?: unknown };
    delete (prev as unknown as Record<string, unknown>).landmarks;   // v1 seatmap.json shape
    expect(() => transformFloorplan(withLandmarks, prev as SeatMap)).not.toThrow();
  });
});
