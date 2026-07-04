import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { transformFloorplan, type SeatMap } from './svg-transform';

const force = process.argv.includes('--force');
const src = process.argv.find(a => a.endsWith('.svg')) ?? 'assets/floorplan/venue.svg';
const MAP = 'src/generated/seatmap.json';

async function recompressJpeg(svg: string): Promise<string> {
  const m = svg.match(/xlink:href="data:image\/jpeg;base64,([^"]+)"/);
  if (!m) return svg;
  const out = await sharp(Buffer.from(m[1]!, 'base64'))
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  console.log(`embedded JPEG: ${Math.round(m[1]!.length * 0.75 / 1024)}kB → ${Math.round(out.length / 1024)}kB`);
  return svg.replace(m[1]!, out.toString('base64'));
}

const prev: SeatMap | null = !force && existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : null;
const { svg, seatMap } = transformFloorplan(readFileSync(src, 'utf8'), prev);
mkdirSync('src/generated', { recursive: true });
writeFileSync('src/generated/floorplan.svg', await recompressJpeg(svg));
writeFileSync(MAP, JSON.stringify(seatMap, null, 1));
console.log(`ok: ${Object.keys(seatMap.seats).length} seats across ${Object.keys(seatMap.tables).length} tables from ${src}`);
