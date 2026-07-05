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

  if (pz) {
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { pz!.resize(); pz!.fit(); pz!.center(); }, 150);
    });

    // svg-pan-zoom has no touch support; hand-rolled pinch/pan for non-mouse pointers.
    let debugNote: ((s: string) => void) | undefined; // set only under ?fpdebug
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
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
      if (touches.size === 2) { pinchDist = dist(); gestureActive = true; }
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
        if (pinchDist > 0 && d > 0) {
          try {
            const rect = svg.getBoundingClientRect();
            const m = mid();
            const reqZoom = pz!.getZoom() * (d / pinchDist);
            pz!.zoomAtPoint(reqZoom, { x: m.x - rect.left, y: m.y - rect.top });
            if (debugNote) {
              const a = (svg.querySelector('.svg-pan-zoom_viewport')?.getAttribute('transform') ?? '')
                .match(/matrix\(([-\d.]+)/)?.[1] ?? '?';
              debugNote(`req=${reqZoom.toFixed(4)} got=${pz!.getZoom().toFixed(4)} dom_a=${Number(a).toFixed(4)}`);
            }
          } catch (err) {
            debugNote?.(`PINCH ERR: ${String(err).slice(0, 120)}`);
          }
        }
        pinchDist = d;
      }
    });
    const endTouch = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinchDist = 0;
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
      let note = '';
      debugNote = (s: string) => { note = s; paint(); };
      const paint = () => {
        hud.textContent = `pointer down:${n.down} move:${n.move} up:${n.up}\nCANCEL:${n.cancel}  touches.size:${touches.size}\ntouchstart:${n.tstart} touchmove:${n.tmove} gesture:${n.gstart}\nzoom:${pz!.getZoom().toFixed(2)}\n${note}`;
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
        const tb = seatMap.tables[no];
        if (!tb || !text) continue;
        const el = document.createElementNS(SVG_NS, 'text');
        el.setAttribute('x', String(tb.cx)); el.setAttribute('y', String(tb.cy - tb.r - 6));
        el.setAttribute('class', 'table-label');
        el.textContent = text;
        svg.append(el);
      }
    },
    setLandmarkLabels(labels) {
      svg.querySelectorAll('.landmark-label').forEach(e => e.remove());
      for (const [id, text] of Object.entries(labels)) {
        const lm = seatMap.landmarks[id];
        if (!lm || !text) continue;
        const el = document.createElementNS(SVG_NS, 'text');
        el.setAttribute('x', String(lm.cx)); el.setAttribute('y', String(lm.cy));
        el.setAttribute('class', 'landmark-label');
        el.textContent = text;
        svg.append(el);
      }
    },
  };
}
