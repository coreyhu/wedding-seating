import svgPanZoom from 'svg-pan-zoom';
import generatedSvg from '../generated/floorplan.svg?raw';
import generatedMap from '../generated/seatmap.json';
import type { SeatKey, SeatMap } from './types';

export interface Floorplan {
  svg: SVGSVGElement;
  seatEl(key: SeatKey): SVGGraphicsElement | null;
  highlight(key: SeatKey | null): void;
  setOccupied(key: SeatKey, occupied: boolean): void;
  addSeatLabel(key: SeatKey, text: string): void;
  clearSeatLabels(): void;
  zoomToSeat(key: SeatKey): void;
  zoomToPoint(cx: number, cy: number): void;
  zoomToLandmark(id: string): void;
  onSeatTap(cb: (key: SeatKey) => void): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// jsdom (our test environment) has no global `CSS`, so `CSS.escape` isn't
// merely missing a method — the whole `CSS` reference throws a TypeError,
// which `??` cannot catch. Guard the escape call instead of relying on
// nullish-coalescing to fall through. In real browsers this still prefers
// CSS.escape; in jsdom (and for the plain `t-s` numeric keys this app uses)
// the unescaped id is a valid selector anyway, so behavior is unchanged.
const escapeId = (key: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(key) : key;

export function mountFloorplan(container: HTMLElement,
  opts: { panZoom?: boolean; svgText?: string; seatMap?: SeatMap } = {}): Floorplan {
  const seatMap = opts.seatMap ?? (generatedMap as SeatMap);
  container.innerHTML = opts.svgText ?? generatedSvg;
  const svg = container.querySelector('svg') as SVGSVGElement;
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.classList.add('floorplan');

  const pz = opts.panZoom !== false
    ? svgPanZoom(svg, { minZoom: 0.8, maxZoom: 12, zoomScaleSensitivity: 0.35, dblClickZoomEnabled: false })
    : null;

  const seatEl = (key: SeatKey) => svg.querySelector<SVGGraphicsElement>(`#seat-${escapeId(key)}`)
    ?? svg.querySelector<SVGGraphicsElement>(`[id="seat-${key}"]`);

  const zoomToPoint = (cx: number, cy: number) => {
    if (!pz) return;
    pz.zoom(5);
    const { width, height, realZoom } = pz.getSizes();
    pz.pan({ x: width / 2 - cx * realZoom, y: height / 2 - cy * realZoom });
  };

  return {
    svg,
    seatEl,
    highlight(key) {
      svg.querySelectorAll('.highlight').forEach(e => e.classList.remove('highlight'));
      if (key) seatEl(key)?.classList.add('highlight');
    },
    setOccupied(key, occupied) { seatEl(key)?.classList.toggle('occupied', occupied); },
    addSeatLabel(key, text) {
      const seat = seatMap.seats[key]; if (!seat) return;
      const table = seatMap.tables[key.split('-')[0]!];
      let { cx, cy } = seat;
      if (table) { // push label outward along table→seat direction
        const d = Math.hypot(cx - table.cx, cy - table.cy) || 1;
        cx += ((cx - table.cx) / d) * 16; cy += ((cy - table.cy) / d) * 16;
      }
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(cx)); t.setAttribute('y', String(cy));
      t.setAttribute('class', 'seat-label'); t.textContent = text;
      svg.append(t);
    },
    clearSeatLabels() { svg.querySelectorAll('.seat-label').forEach(e => e.remove()); },
    zoomToSeat(key) {
      const seat = seatMap.seats[key];
      if (seat) zoomToPoint(seat.cx, seat.cy);
    },
    zoomToPoint(cx, cy) { zoomToPoint(cx, cy); },
    zoomToLandmark(id) {
      const lm = seatMap.landmarks[id];
      if (lm) zoomToPoint(lm.cx, lm.cy);
    },
    onSeatTap(cb) {
      svg.addEventListener('click', e => {
        const hit = (e.target as Element).closest('[id^="seat-"]');
        if (hit) cb(hit.id.slice('seat-'.length));
      });
    },
  };
}
