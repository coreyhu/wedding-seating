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
  onTap(cb: (hit: { kind: 'seat'; key: SeatKey } | { kind: 'table'; tableNo: number }) => void): void;
  setTableLabels(labels: Record<number, string>): void;
  setLandmarkLabels(labels: Record<string, string>): void;
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

// Map labels are SVG <text> sized in user units, so their on-screen size is
// (fontUnits × containerPx / viewBoxWidth). To render at a consistent legible
// size regardless of which Affinity export we're on (the v3 botanical map is
// ~2× the coordinate space of v2 — a fixed 9-unit font rendered at ~3.5px),
// scale the font to the viewBox width. Divisors tuned so a seat name reads
// ~12px on a ~1600px-wide host window and grows as you pinch-zoom in.
const LABEL_DIVISORS = { seat: 200, table: 130, landmark: 150 } as const;
export function labelFontSize(viewBoxWidth: number, kind: keyof typeof LABEL_DIVISORS): number {
  const w = viewBoxWidth > 0 ? viewBoxWidth : 1000;
  return Math.round((w / LABEL_DIVISORS[kind]) * 10) / 10;
}

export function mountFloorplan(container: HTMLElement,
  opts: { panZoom?: boolean; svgText?: string; seatMap?: SeatMap } = {}): Floorplan {
  const seatMap = opts.seatMap ?? (generatedMap as SeatMap);
  container.innerHTML = opts.svgText ?? generatedSvg;
  const svg = container.querySelector('svg') as SVGSVGElement;
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.classList.add('floorplan');
  const vbW = Number(seatMap.viewBox.split(/\s+/)[2]) || 1000;
  const fontFor = (kind: 'seat' | 'table' | 'landmark') => labelFontSize(vbW, kind);
  // A white halo (paint-order: stroke under the fill) keeps labels legible
  // over the map's varied colours. Halo width scales with the font.
  const makeLabel = (cssClass: string, x: number, y: number, font: number, text: string): void => {
    const el = document.createElementNS(SVG_NS, 'text');
    el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
    el.setAttribute('font-size', String(font));
    el.setAttribute('stroke', '#ffffff'); el.setAttribute('stroke-width', String(font * 0.18));
    el.setAttribute('paint-order', 'stroke'); el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('class', cssClass);
    el.textContent = text;
    // Append INSIDE svg-pan-zoom's viewport group so labels share the map's
    // pan/zoom transform. svg-pan-zoom strips the root's viewBox and moves the
    // coordinate transform onto that group; a label on the root would render at
    // raw user coordinates — far off-screen. Falls back to the root when
    // pan/zoom is disabled (tests), where the viewBox is still intact.
    (svg.querySelector('.svg-pan-zoom_viewport') ?? svg).append(el);
  };

  const pz = opts.panZoom !== false
    ? svgPanZoom(svg, {
        minZoom: 0.8, maxZoom: 12, zoomScaleSensitivity: 0.35, dblClickZoomEnabled: false,
        // svg-pan-zoom binds its OWN touch handlers, and its pan logic rebuilds
        // the CTM from a touchstart-time snapshot on every touchmove
        // (handleMouseMove → firstEventCTM.translate) — stomping any zoom our
        // pinch layer applies mid-gesture (the iOS "pinch does nothing" bug;
        // reproduced in chromium with staggered touch starts). Halt ALL of the
        // library's touch listeners: touch is owned by our gesture layer below,
        // mouse/wheel stay with the library for desktop.
        customEventsHandler: {
          haltEventListeners: ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel'],
          init: () => {},
          destroy: () => {},
        },
      })
    : null;

  if (pz) {
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { pz!.resize(); pz!.fit(); pz!.center(); }, 150);
    });

    // svg-pan-zoom's touch handlers are halted (see options above); this layer
    // owns all touch input. One finger pans; two fingers pinch-zoom about the
    // midpoint AND pan with the midpoint's drift, so guests can roam and zoom
    // in a single gesture.
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let prevMid: { x: number; y: number } | null = null;
    let gestureActive = false;
    const mid = () => {
      const [a, b] = [...touches.values()];
      return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    };
    const dist = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a!.x - b!.x, a!.y - b!.y);
    };
    svg.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { pinchDist = dist(); prevMid = mid(); gestureActive = true; }
    });
    svg.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' || !touches.has(e.pointerId)) return;
      const prev = touches.get(e.pointerId)!;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (gestureActive || Math.hypot(dx, dy) > 3) {
          gestureActive = true;
          e.preventDefault();
          pz!.panBy({ x: dx, y: dy });
        }
      } else if (touches.size === 2) {
        e.preventDefault();
        const d = dist();
        const m = mid();
        if (pinchDist > 0 && d > 0) {
          if (prevMid) pz!.panBy({ x: m.x - prevMid.x, y: m.y - prevMid.y });
          const rect = svg.getBoundingClientRect();
          pz!.zoomAtPoint(pz!.getZoom() * (d / pinchDist),
            { x: m.x - rect.left, y: m.y - rect.top });
        }
        pinchDist = d;
        prevMid = m;
      }
    });
    const endTouch = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) { pinchDist = 0; prevMid = null; }
      if (touches.size === 0) gestureActive = false;
    };
    svg.addEventListener('pointerup', endTouch);
    svg.addEventListener('pointercancel', endTouch);

    // iOS Safari claims two-finger gestures for its native pinch recognizer even
    // with touch-action: none, firing pointercancel and killing the gesture (the
    // reason pinch "did nothing" on iPhone while one-finger pan worked). Blocking
    // the default ONLY for multi-touch keeps the pointer stream alive; single
    // touches are left alone so taps still synthesize clicks.
    const blockNativeMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    svg.addEventListener('touchstart', blockNativeMultiTouch, { passive: false });
    svg.addEventListener('touchmove', blockNativeMultiTouch, { passive: false });
    // Older-iOS proprietary gesture events: stop Safari's page zoom outright.
    svg.addEventListener('gesturestart' as keyof SVGSVGElementEventMap, (e: Event) => e.preventDefault());

    // Diagnostic HUD for real-device gesture debugging: open the page with
    // ?fpdebug to see exactly which events the browser delivers. Zero cost
    // and invisible without the flag.
    if (location.search.includes('fpdebug')) {
      const hud = document.createElement('div');
      hud.style.cssText = 'position:fixed;bottom:4px;left:4px;z-index:999;background:rgba(0,0,0,.78);color:#7CFC00;font:12px/1.5 monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
      document.body.append(hud);
      const n: Record<string, number> = { down: 0, move: 0, up: 0, cancel: 0, tstart: 0, tmove: 0, gstart: 0 };
      const paint = () => {
        hud.textContent = `pointer down:${n.down} move:${n.move} up:${n.up}\nCANCEL:${n.cancel}  touches.size:${touches.size}\ntouchstart:${n.tstart} touchmove:${n.tmove} gesture:${n.gstart}\nzoom:${pz!.getZoom().toFixed(2)} pan:${(() => { const p = pz!.getPan(); return `${p.x | 0},${p.y | 0}`; })()}`;
      };
      const count = (ev: string, k: string) => svg.addEventListener(ev as keyof SVGSVGElementEventMap, () => { n[k] = (n[k] ?? 0) + 1; paint(); });
      count('pointerdown', 'down'); count('pointermove', 'move'); count('pointerup', 'up');
      count('pointercancel', 'cancel'); count('touchstart', 'tstart'); count('touchmove', 'tmove');
      count('gesturestart', 'gstart');
      paint();
    }
  }

  const seatEl = (key: SeatKey) => svg.querySelector<SVGGraphicsElement>(`#seat-${escapeId(key)}`)
    ?? svg.querySelector<SVGGraphicsElement>(`[id="seat-${key}"]`);

  let zoomAnim = 0;
  const zoomToPoint = (cx: number, cy: number): void => {
    if (!pz) return;
    cancelAnimationFrame(zoomAnim);
    const { width, height, realZoom } = pz.getSizes();
    const startZoom = pz.getZoom();
    const startPan = pz.getPan();
    const startCenter = { x: (width / 2 - startPan.x) / realZoom, y: (height / 2 - startPan.y) / realZoom };
    const targetZoom = 5;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const apply = (z: number, c: { x: number; y: number }) => {
      pz!.zoom(z);
      const rz = pz!.getSizes().realZoom;
      pz!.pan({ x: width / 2 - c.x * rz, y: height / 2 - c.y * rz });
    };
    if (reduced || typeof requestAnimationFrame !== 'function') return apply(targetZoom, { x: cx, y: cy });
    const t0 = performance.now();
    const DURATION = 600;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION);
      const k = ease(t);
      apply(startZoom + (targetZoom - startZoom) * k,
        { x: startCenter.x + (cx - startCenter.x) * k, y: startCenter.y + (cy - startCenter.y) * k });
      if (t < 1) zoomAnim = requestAnimationFrame(frame);
    };
    zoomAnim = requestAnimationFrame(frame);
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
      const font = fontFor('seat');
      let { cx, cy } = seat;
      if (table) { // push label outward past the chair, scaled to the font
        const d = Math.hypot(cx - table.cx, cy - table.cy) || 1;
        const push = font * 1.1;
        cx += ((cx - table.cx) / d) * push; cy += ((cy - table.cy) / d) * push;
      }
      makeLabel('seat-label', cx, cy, font, text);
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
    onTap(cb) {
      svg.addEventListener('click', e => {
        const seat = (e.target as Element).closest('[id^="seat-"]');
        if (seat) return cb({ kind: 'seat', key: seat.id.slice('seat-'.length) });
        const table = (e.target as Element).closest('[id^="table-"]');
        const m = table?.id.match(/^table-(\d+)/);
        if (m) cb({ kind: 'table', tableNo: Number(m[1]) });
      });
    },
    setTableLabels(labels) {
      svg.querySelectorAll('.table-label').forEach(e => e.remove());
      const font = fontFor('table');
      for (const [no, text] of Object.entries(labels)) {
        const tb = seatMap.tables[no];
        if (!tb || !text) continue;
        makeLabel('table-label', tb.cx, tb.cy - tb.r - font * 0.6, font, text);
      }
    },
    setLandmarkLabels(labels) {
      svg.querySelectorAll('.landmark-label').forEach(e => e.remove());
      const font = fontFor('landmark');
      for (const [id, text] of Object.entries(labels)) {
        const lm = seatMap.landmarks[id];
        if (!lm || !text) continue;
        makeLabel('landmark-label', lm.cx, lm.cy, font, text);
      }
    },
  };
}
