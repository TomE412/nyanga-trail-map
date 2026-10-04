import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, existsSync } from 'node:fs';
const [z, lat, lon, n, out] = [+process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], process.argv[6]];
const cx = Math.floor((lon + 180) / 360 * 2 ** z);
const r = lat * Math.PI / 180, cy = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
const c = createCanvas(256 * n, 256 * n), ctx = c.getContext('2d');
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
  const f = `tiles/${z}/${cx - (n >> 1) + i}/${cy - (n >> 1) + j}.webp`;
  if (existsSync(f)) ctx.drawImage(await loadImage(f), i * 256, j * 256);
}
writeFileSync(out, await c.encode('png'));
