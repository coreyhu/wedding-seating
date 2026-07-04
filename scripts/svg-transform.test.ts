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
    expect(() => transformFloorplan(bad, null)).toThrow(/table-5.*(8 chair paths|9 paths)/s);
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

describe('v3 Affinity export shape (circle tables, nested chair groups, auto-id noise)', () => {
  // One table in the v3 structure: table_N > auto-named inner g > 9 sub-groups
  // (8 wrapping a chair path each, 1 wrapping the table CIRCLE), plus ceremony
  // chairs and container groups carrying Affinity auto-ids like chair42/table3.
  const v3Table = (t: number, cx: number, cy: number) => {
    const chairs = Array.from({ length: 8 }, (_, i) => {
      const a = (i * 45 * Math.PI) / 180;
      const x = cx + 100 * Math.sin(a), y = cy - 100 * Math.cos(a);
      return `<g><path d="M ${x - 12} ${y - 12} L ${x + 12} ${y - 12} L ${x + 12} ${y + 12} L ${x - 12} ${y + 12} Z"/></g>`;
    }).join('');
    return `<g id="table_${t}"><g id="table${t === 1 ? '' : t}">${chairs}<g><circle cx="${cx}" cy="${cy}" r="60"/></g></g></g>`;
  };
  const v3src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 3000">
    <g id="tables">${Array.from({ length: 12 }, (_, i) => v3Table(i + 1, 300 + (i % 4) * 320, 300 + Math.floor(i / 4) * 320)).join('')}</g>
    <g id="ceremony_seating"><g id="chair"><path d="M 10 2000 L 20 2000 L 20 2010 L 10 2010 Z"/></g><g id="chair1"><path d="M 40 2000 L 50 2000 L 50 2010 L 40 2010 Z"/></g></g>
    <path id="dj" d="M 3000 100 L 3050 100 L 3050 150 L 3000 150 Z"/>
    <g id="sweetheart_table"><circle cx="3500" cy="200" r="25"/></g>
  </svg>`;

  it('accepts circle-table groups and derives 96 seats with circle geometry', () => {
    const { svg, seatMap } = transformFloorplan(v3src, null);
    expect(Object.keys(seatMap.seats)).toHaveLength(96);
    expect(seatMap.tables['1']).toEqual({ cx: 300, cy: 300, r: 60 });
    expect(svg).toContain('id="table-1-shape"');
    expect(svg).toContain('id="seat-12-8"');
  });
  it('excludes Affinity auto-ids from landmarks but keeps real ones', () => {
    const { seatMap } = transformFloorplan(v3src, null);
    const keys = Object.keys(seatMap.landmarks).sort();
    expect(keys).toEqual(['ceremony_seating', 'dj', 'sweetheart_table']);
  });
  it('still rejects a malformed group with an actionable message', () => {
    const bad = v3src.replace(/<g><circle cx="300" cy="300" r="60"\/><\/g>/, '');
    expect(() => transformFloorplan(bad, null)).toThrow(/table_1/);
  });
});
