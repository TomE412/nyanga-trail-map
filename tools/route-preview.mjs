// Draws a GPX route over the race map tiles, to check it follows the trail.
// Usage: node tools/route-preview.mjs route.gpx <zoom> out.png [tile folder]
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [gpx, z, out, dir] = [process.argv[2], +process.argv[3], process.argv[4], process.argv[5] || 'tiles-turaco26'];
const x = readFileSync(gpx, 'utf8');
const pts = [...x.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => [+m[1], +m[2]]);
const lon2x = lon => (lon + 180) / 360 * 2 ** z, lat2y = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const xs = pts.map(p => lon2x(p[1])), ys = pts.map(p => lat2y(p[0]));
const x0 = Math.floor(Math.min(...xs)), x1 = Math.floor(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.floor(Math.max(...ys));
const c = createCanvas((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256), ctx = c.getContext('2d');
ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, c.width, c.height);
for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) { const f = `${dir}/${z}/${tx}/${ty}.webp`; if (existsSync(f)) ctx.drawImage(await loadImage(f), (tx - x0) * 256, (ty - y0) * 256); }
ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(230,81,0,0.85)'; ctx.beginPath();
pts.forEach((p, i) => { const X = (xs[i] - x0) * 256, Y = (ys[i] - y0) * 256; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
const dot = (i, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc((xs[i] - x0) * 256, (ys[i] - y0) * 256, 10, 0, 7); ctx.fill(); };
dot(0, '#2e7d32'); dot(pts.length - 1, '#c62828');
writeFileSync(out, await c.encode('png')); console.log(c.width, c.height);
