export interface Pt { x: number; y: number }

export function centroid(pts: Pt[]): Pt {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

/**
 * Given the table center and one centroid per chair, returns each chair's
 * seat number (1..chairs.length), counting clockwise from 12 o'clock.
 * SVG +y points down, so atan2(dx, -dy) measures clockwise radians from 12.
 */
export function seatNumbersFor(center: Pt, chairs: Pt[]): number[] {
  const angle = (p: Pt): number => {
    const a = Math.atan2(p.x - center.x, -(p.y - center.y));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const order = chairs.map((_, i) => i).sort((a, b) => angle(chairs[a]!) - angle(chairs[b]!));
  const nums = new Array<number>(chairs.length);
  order.forEach((chairIdx, rank) => { nums[chairIdx] = rank + 1; });
  return nums;
}
