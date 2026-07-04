import { describe, expect, it } from 'vitest';
import { centroid, seatNumbersFor, type Pt } from './seat-geometry';

const C: Pt = { x: 100, y: 100 };
// 8 chairs on a circle, listed in scrambled order. SVG y grows downward,
// so 12 o'clock is (100, 90) and 3 o'clock is (110, 100).
const at = (deg: number): Pt => ({
  x: 100 + 10 * Math.sin((deg * Math.PI) / 180),
  y: 100 - 10 * Math.cos((deg * Math.PI) / 180),
});

it('averages coordinates', () => {
  expect(centroid([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
});

describe('seatNumbersFor', () => {
  it('numbers 1..8 clockwise from 12 o’clock', () => {
    const chairs = [at(90), at(0), at(270), at(180), at(45), at(135), at(315), at(225)];
    //               3:00   12:00  9:00    6:00    1:30    4:30    10:30   7:30
    expect(seatNumbersFor(C, chairs)).toEqual([3, 1, 7, 5, 2, 4, 8, 6]);
  });
  it('tolerates irregular spacing and radii', () => {
    const chairs = [at(10), at(100), at(200), at(355)];
    // 355° is just left of 12 o'clock → last clockwise
    expect(seatNumbersFor(C, chairs)).toEqual([1, 2, 3, 4]);
  });
});
