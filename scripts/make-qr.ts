import { toFile } from 'qrcode';

const url = process.argv[2];
if (!url) {
  console.error('usage: npm run qr -- https://your-site.netlify.app');
  process.exit(1);
}

await toFile('qr.png', url, { width: 1200, margin: 2 });
console.log(`wrote qr.png → ${url}`);
