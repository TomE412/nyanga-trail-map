// Makes the app icons from the SkyRun logo (tools/skyrun-logo.jpg).
// - icon-192/512.png: the logo filling the square (home screen, browser tab)
// - icon-maskable-192/512.png: the logo smaller, inside the safe circle that
//   Android may cut the icon to
// - apple-touch-icon.png: iPhone home screen (iOS rounds the corners itself)
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';

const src = await loadImage(readFileSync('tools/skyrun-logo.jpg'));
// Find the logo inside the picture: everything clearly darker than the background.
const probe = createCanvas(src.width, src.height), pc = probe.getContext('2d');
pc.drawImage(src, 0, 0);
const px = pc.getImageData(0, 0, src.width, src.height).data;
const bg = [px[0], px[1], px[2]];
let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
for (let y = 0; y < src.height; y += 2) for (let x = 0; x < src.width; x += 2) {
  const i = (y * src.width + x) * 4;
  if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 60) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
}
const lw = x1 - x0, lh = y1 - y0;
console.log(`background rgb(${bg}), logo at x ${x0}-${x1}, y ${y0}-${y1}`);

async function icon(size, logoShare, file) {
  const c = createCanvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${bg})`; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  const w = size * logoShare, h = w * lh / lw;
  ctx.drawImage(src, x0, y0, lw, lh, (size - w) / 2, (size - h) / 2, w, h);
  writeFileSync(file, await c.encode('png'));
}
await icon(192, 0.9, 'icon-192.png');
await icon(512, 0.9, 'icon-512.png');
await icon(180, 0.88, 'apple-touch-icon.png');
await icon(192, 0.68, 'icon-maskable-192.png');
await icon(512, 0.68, 'icon-maskable-512.png');
console.log('icons written');
