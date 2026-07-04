import { DOMParser } from 'linkedom';
import { centroid, seatNumbersFor, type Pt } from '../src/logic/seat-geometry';

export interface SeatMap {
  viewBox: string;
  tables: Record<string, { cx: number; cy: number; r: number }>;
  seats: Record<string, { cx: number; cy: number }>;
  landmarks: Record<string, { cx: number; cy: number }>;
}

const MOVE_TOLERANCE = 25; // svg units; larger displacement of an existing seat fails the build

// Walks a path's command stream and returns the on-curve endpoint after each
// command (control points excluded). Affinity exports relative l/c commands
// after an absolute M, so a real interpreter is required — naive number
// pairing produces garbage centroids.
export function pathPoints(d: string): Pt[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const pts: Pt[] = [];
  let x = 0, y = 0, sx = 0, sy = 0, i = 0, cmd = '';
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[a-zA-Z]/.test(t)) {
      cmd = t; i++;
      if (cmd.toUpperCase() === 'Z') { x = sx; y = sy; continue; }
    }
    const rel = cmd === cmd.toLowerCase();
    const skip = { M: 0, L: 0, T: 0, H: 0, V: 0, C: 4, S: 2, Q: 2, A: 5 }[cmd.toUpperCase()];
    if (skip === undefined) throw new Error(`unsupported path command '${cmd}'`);
    for (let k = 0; k < skip; k++) num();       // control points / arc params
    if (cmd.toUpperCase() === 'H') { const nx = num(); x = rel ? x + nx : nx; }
    else if (cmd.toUpperCase() === 'V') { const ny = num(); y = rel ? y + ny : ny; }
    else { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; }
    if (cmd.toUpperCase() === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; } // implicit lineto after M
    pts.push({ x, y });
  }
  return pts;
}

function bboxArea(pts: Pt[]): number {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

export function transformFloorplan(svgText: string, prevMap: SeatMap | null): { svg: string; seatMap: SeatMap } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('not an SVG document');
  const seatMap: SeatMap = { viewBox: svg.getAttribute('viewBox') ?? '', tables: {}, seats: {}, landmarks: {} };

  const nameOf = (g: Element) => {
    const raw = [g.getAttribute('serif:id'), g.getAttribute('id')].find(v => /^table[-_]\d+$/.test(v ?? ''));
    return raw ?? null;
  };
  const groups = [...doc.querySelectorAll('g')].filter(g => nameOf(g) !== null);
  if (groups.length !== 12)
    throw new Error(`expected 12 table groups, found ${groups.length} (${groups.map(nameOf).join(', ')})`);

  for (const g of groups) {
    const name = nameOf(g)!;
    const t = Number(name.match(/^table[-_](\d+)$/)![1]);
    const paths = [...g.querySelectorAll('path')];
    const groupCircles = [...g.querySelectorAll('circle')];
    let c: Pt;
    let chairs: Array<{ p: Element; pts: Pt[] }>;
    if (groupCircles.length === 1 && paths.length === 8) {
      // v3 Affinity export: the table is a <circle>, the 8 chairs are paths
      // (each wrapped in its own auto-named <g>).
      const circle = groupCircles[0]!;
      c = { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) };
      seatMap.tables[String(t)] = { cx: c.x, cy: c.y, r: Number(circle.getAttribute('r')) };
      circle.setAttribute('id', `table-${t}-shape`);
      chairs = paths.map(p => ({ p, pts: pathPoints(p.getAttribute('d') ?? '') }));
    } else if (groupCircles.length === 0 && paths.length === 9) {
      // v2 export: table + chairs all paths; the table is the largest shape.
      const withPts = paths.map(p => ({ p, pts: pathPoints(p.getAttribute('d') ?? '') }));
      withPts.sort((a, b) => bboxArea(b.pts) - bboxArea(a.pts));
      const [table, ...rest] = withPts;
      chairs = rest;
      c = centroid(table!.pts);
      const xs = table!.pts.map(p => p.x);
      seatMap.tables[String(t)] = { cx: c.x, cy: c.y, r: (Math.max(...xs) - Math.min(...xs)) / 2 };
      table!.p.setAttribute('id', `table-${t}-shape`);
    } else {
      throw new Error(`${name}: expected either 8 chair paths + 1 table circle, or 9 paths (largest = table); found ${paths.length} paths + ${groupCircles.length} circles — check the group in Affinity`);
    }
    g.setAttribute('id', `table-${t}`);
    const chairCentroids = chairs.map(ch => centroid(ch.pts));
    const nums = seatNumbersFor(c, chairCentroids);
    chairs.forEach((ch, i) => {
      ch.p.setAttribute('id', `seat-${t}-${nums[i]}`);
      ch.p.classList.add('seat');
      seatMap.seats[`${t}-${nums[i]}`] = { cx: chairCentroids[i]!.x, cy: chairCentroids[i]!.y };
    });
  }

  // Skip our injected ids (table-N…/seat-N-M) AND Affinity's auto-assigned
  // object ids (chair, chair42, table3, tables…) — only deliberately-named
  // venue features become landmarks.
  const SKIP_LANDMARK = /^(?:(table|seat)[-_]|(?:tables?|seats?|chairs?)\d*$)/;
  for (const el of [...doc.querySelectorAll('[id]')]) {
    const id = el.getAttribute('id')!;
    if (el.tagName.toLowerCase() === 'svg' || id === 'guest_tables' || SKIP_LANDMARK.test(id)) continue;
    const pts: Pt[] = [];
    const paths = el.tagName.toLowerCase() === 'path' ? [el] : [...el.querySelectorAll('path')];
    for (const p of paths) pts.push(...pathPoints(p.getAttribute('d') ?? ''));
    const circles = el.tagName.toLowerCase() === 'circle' ? [el] : [...el.querySelectorAll('circle')];
    for (const c of circles) pts.push({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) });
    if (!pts.length) continue;
    const center = centroid(pts);
    seatMap.landmarks[id] = { cx: center.x, cy: center.y };
  }

  // Tighten viewBox: the Affinity page is much taller than the drawn map.
  // Circles (v3 table shapes) contribute their extremes too.
  const all = [...doc.querySelectorAll('path')].flatMap(p => pathPoints(p.getAttribute('d') ?? ''));
  for (const ci of [...doc.querySelectorAll('circle')]) {
    const cx = Number(ci.getAttribute('cx')), cy = Number(ci.getAttribute('cy')), r = Number(ci.getAttribute('r')) || 0;
    all.push({ x: cx - r, y: cy - r }, { x: cx + r, y: cy + r });
  }
  const xs2 = all.map(p => p.x), ys2 = all.map(p => p.y);
  const PAD = 40;
  const minX = Math.min(...xs2) - PAD, minY = Math.min(...ys2) - PAD;
  svg.setAttribute('viewBox',
    [minX, minY, Math.max(...xs2) + PAD - minX, Math.max(...ys2) + PAD - minY].map(Math.round).join(' '));
  seatMap.viewBox = svg.getAttribute('viewBox')!;

  if (prevMap) {
    const problems: string[] = [];
    for (const [key, old] of Object.entries(prevMap.seats)) {
      const now = seatMap.seats[key];
      if (!now) { problems.push(`seat ${key} disappeared`); continue; }
      if (Math.hypot(now.cx - old.cx, now.cy - old.cy) > MOVE_TOLERANCE)
        problems.push(`seat ${key} moved ${Math.round(Math.hypot(now.cx - old.cx, now.cy - old.cy))} units`);
    }
    if (problems.length)
      throw new Error(`Seat positions changed vs committed seatmap — existing assignments would scramble.\n${problems.join('\n')}\nRe-run with --force if intentional.`);
  }

  return { svg: svg.toString(), seatMap };
}
