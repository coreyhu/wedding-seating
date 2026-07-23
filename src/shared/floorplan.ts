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
  zoomToTable(tableNo: number): void;
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
// ~12px on a ~1600px-wide host window.
const LABEL_DIVISORS = { seat: 150, table: 110, landmark: 125 } as const;
export function labelFontSize(viewBoxWidth: number, kind: keyof typeof LABEL_DIVISORS): number {
  const w = viewBoxWidth > 0 ? viewBoxWidth : 1000;
  return Math.round((w / LABEL_DIVISORS[kind]) * 10) / 10;
}

// Labels can live inside the map's zoomed SVG group, so they normally grow
// along with the floorplan. The host view caps that growth: once zoomed past
// the fitted view, divide the SVG font size by the zoom level so the rendered
// text stays legible without colliding with adjacent guest names.
export function zoomCappedLabelFontSize(baseSize: number, zoom: number): number {
  const maxScreenScale = 1.35;
  return (baseSize * maxScreenScale) / Math.max(maxScreenScale, zoom);
}

export function shouldHideTableLabels(zoom: number): boolean {
  return zoom > 1.6;
}

export function mountFloorplan(container: HTMLElement,
  opts: {
    panZoom?: boolean;
    svgText?: string;
    seatMap?: SeatMap;
    capLabelZoom?: boolean;
    hideTableLabelsOnZoom?: boolean;
    minimumMapLabelFontPx?: number;
  } = {}): Floorplan {
  const seatMap = opts.seatMap ?? (generatedMap as SeatMap);
  container.innerHTML = opts.svgText ?? generatedSvg;
  const svg = container.querySelector('svg') as SVGSVGElement;
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.classList.add('floorplan');
  const vbW = Number(seatMap.viewBox.split(/\s+/)[2]) || 1000;
  const fontFor = (kind: 'seat' | 'table' | 'landmark'): number => {
    const baseFont = labelFontSize(vbW, kind);
    if (kind === 'seat' || !opts.minimumMapLabelFontPx) return baseFont;

    // The SVG uses a much wider coordinate space than a phone display. Keep
    // table and landmark labels from shrinking to a few physical pixels when
    // the whole floor plan is fitted into a narrow viewport.
    const mapWidth = svg.getBoundingClientRect().width;
    if (!mapWidth) return baseFont;
    return Math.max(baseFont, (opts.minimumMapLabelFontPx * vbW) / mapWidth);
  };
  // The source SVG's table centre and the generated seat map can occasionally
  // disagree (the export's path centre versus its inferred bounding box). The
  // eight chair centres are the coordinates we actually render, so their
  // average is the most reliable visual centre for both labels and table zoom.
  const tableCenter = (tableNo: number): { cx: number; cy: number } | null => {
    const fallback = seatMap.tables[String(tableNo)];
    if (!fallback) return null;
    const chairs = Object.entries(seatMap.seats)
      .filter(([key]) => key.startsWith(`${tableNo}-`))
      .map(([, seat]) => seat);
    if (chairs.length !== 8) return fallback;
    return {
      cx: chairs.reduce((sum, seat) => sum + seat.cx, 0) / chairs.length,
      cy: chairs.reduce((sum, seat) => sum + seat.cy, 0) / chairs.length,
    };
  };
  let labelZoom = 1;
  const updateLabelSizes = (zoom: number): void => {
    labelZoom = zoom;
    if (opts.capLabelZoom) {
      svg.querySelectorAll<SVGTextElement>('[data-label-kind]').forEach(el => {
        const kind = el.dataset.labelKind as 'seat' | 'table' | 'landmark';
        const baseFont = fontFor(kind);
        if (!baseFont) return;
        el.dataset.baseLabelFont = String(baseFont);
        const font = zoomCappedLabelFontSize(baseFont, zoom);
        el.setAttribute('font-size', String(font));
        el.setAttribute('stroke-width', String(font * 0.18));
      });
    }
    if (opts.hideTableLabelsOnZoom) {
      const visibility = shouldHideTableLabels(zoom) ? 'hidden' : 'visible';
      svg.querySelectorAll('.table-label').forEach(el => el.setAttribute('visibility', visibility));
    }
  };
  // A white halo (paint-order: stroke under the fill) keeps labels legible
  // over the map's varied colours. Halo width scales with the font.
  const makeLabel = (kind: 'seat' | 'table' | 'landmark', cssClass: string, x: number, y: number, text: string): void => {
    const el = document.createElementNS(SVG_NS, 'text');
    el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
    const font = fontFor(kind);
    el.dataset.labelKind = kind;
    el.dataset.baseLabelFont = String(font);
    const effectiveFont = opts.capLabelZoom ? zoomCappedLabelFontSize(font, labelZoom) : font;
    el.setAttribute('font-size', String(effectiveFont));
    el.setAttribute('stroke', '#ffffff'); el.setAttribute('stroke-width', String(effectiveFont * 0.18));
    el.setAttribute('paint-order', 'stroke'); el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('dominant-baseline', 'middle');
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
        onZoom: updateLabelSizes,
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
    const startZoom = pz.getZoom();
    const targetZoom = 5;
    const viewport = svg.querySelector<SVGGraphicsElement>('.svg-pan-zoom_viewport');
    const screenCenter = () => {
      const rect = svg.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const pointAtScreenCenter = () => {
      const ctm = viewport?.getScreenCTM();
      if (!ctm) return { x: cx, y: cy };
      const center = screenCenter();
      const point = svg.createSVGPoint();
      point.x = center.x; point.y = center.y;
      return point.matrixTransform(ctm.inverse());
    };
    // `getZoom()` is relative to svg-pan-zoom's fitted base transform, not a
    // screen-pixel scale. Center through the viewport's live screen CTM rather
    // than multiplying SVG coordinates by that relative value (which sent a
    // selected table far off-center on the production floorplan).
    const centerOn = (point: { x: number; y: number }) => {
      const ctm = viewport?.getScreenCTM();
      if (!ctm) return;
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = point.x; svgPoint.y = point.y;
      const rendered = svgPoint.matrixTransform(ctm);
      const center = screenCenter();
      pz!.panBy({ x: center.x - rendered.x, y: center.y - rendered.y });
    };
    const startCenter = pointAtScreenCenter();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const apply = (z: number, c: { x: number; y: number }) => {
      pz!.zoom(z);
      centerOn(c);
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
      makeLabel('seat', 'seat-label', seat.cx, seat.cy, text);
    },
    clearSeatLabels() { svg.querySelectorAll('.seat-label').forEach(e => e.remove()); },
    zoomToSeat(key) {
      const seat = seatMap.seats[key];
      if (seat) zoomToPoint(seat.cx, seat.cy);
    },
    zoomToTable(tableNo) {
      const table = tableCenter(tableNo);
      if (table) zoomToPoint(table.cx, table.cy);
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
      for (const [no, text] of Object.entries(labels)) {
        const tb = tableCenter(Number(no));
        if (!tb || !text) continue;
        // Keep the table name centered in the visual ring of chairs, rather
        // than trusting a table-path coordinate that may be offset in an SVG
        // export.
        makeLabel('table', 'table-label', tb.cx, tb.cy, text);
      }
      if (opts.hideTableLabelsOnZoom && shouldHideTableLabels(labelZoom)) {
        svg.querySelectorAll('.table-label').forEach(el => el.setAttribute('visibility', 'hidden'));
      }
    },
    setLandmarkLabels(labels) {
      svg.querySelectorAll('.landmark-label').forEach(e => e.remove());
      for (const [id, text] of Object.entries(labels)) {
        const lm = seatMap.landmarks[id];
        if (!lm || !text) continue;
        makeLabel('landmark', 'landmark-label', lm.cx, lm.cy, text);
      }
    },
  };
}
