// Synthetic stand-in for the real Affinity export: same contract —
// <g serif:id="table-N"> holding 1 big table path + 8 chair paths.
export function devFloorplanSvg(): string {
  const groups: string[] = [];
  for (let t = 1; t <= 12; t++) {
    const col = (t - 1) % 4, row = Math.floor((t - 1) / 4);
    const cx = 250 + col * 320, cy = 250 + row * 320;
    // Absolute path commands only (L, not h/v): the transform's centroid
    // heuristic pairs ALL numbers in `d` as x,y coords, which is only valid
    // for absolute commands. Affinity exports absolute coords too.
    const rect = (x: number, y: number, w: number, h: number) =>
      `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    const table = `<path d="${rect(cx - 60, cy - 60, 120, 120)}" fill="#eee" stroke="#999"/>`;
    const chairs = Array.from({ length: 8 }, (_, i) => {
      const a = (i * 45 * Math.PI) / 180; // chair i at i*45° clockwise from 12:00
      const x = cx + 100 * Math.sin(a), y = cy - 100 * Math.cos(a);
      return `<path class="chair" data-t="${t}" data-i="${i}" d="${rect(x - 12, y - 12, 24, 24)}" fill="#ddd" stroke="#999"/>`;
    }).join('');
    groups.push(`<g serif:id="table-${t}">${table}${chairs}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:serif="http://www.serif.com/" viewBox="0 0 1500 1200">${groups.join('')}</svg>`;
}

if (process.argv[1]?.endsWith('make-dev-floorplan.ts')) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('assets/floorplan', { recursive: true });
  writeFileSync('assets/floorplan/dev-floorplan.svg', devFloorplanSvg());
  console.log('wrote assets/floorplan/dev-floorplan.svg');
}
