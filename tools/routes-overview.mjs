// Draws several GPX routes (and their named checkpoints) over the race map.
// Usage: node tools/routes-overview.mjs <zoom> out.png a.gpx b.gpx ...
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [z, out, ...files] = [+process.argv[2], process.argv[3], ...process.argv.slice(4)];
const COLORS = ['#e65100', '#1565c0', '#c2185b', '#2e7d32'];
const routes = files.map(f => {
  const x = readFileSync(f, 'utf8');
  // Each <trk> is drawn as its own line (multi-day races have one per day).
  const pts = [...x.matchAll(/<trk>[\s\S]*?<\/trk>/g)].flatMap((t, k) =>
    [...t[0].matchAll(/<trkpt\s[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g)].map((m, i) => [+m[1], +m[2], i === 0]));
  const w = [...x.matchAll(/<wpt\s[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/wpt>/g)]
    .map(m => ({ lat: +m[1], lon: +m[2], name: (m[3].match(/<name>([^<]*)/) || [])[1] || '' }));
  const groups = {}; w.forEach(q => { const k = q.name.replace(/[-\s]\d+$/, ''); groups[k] = (groups[k] || 0) + 1; });
  return { f, pts, wpts: w.filter(q => groups[q.name.replace(/[-\s]\d+$/, '')] <= 20) };
});
const lon2x = lon => (lon + 180) / 360 * 2 ** z, lat2y = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const all = routes.flatMap(r => r.pts);
const x0 = Math.floor(Math.min(...all.map(p => lon2x(p[1])))), x1 = Math.floor(Math.max(...all.map(p => lon2x(p[1]))));
const y0 = Math.floor(Math.min(...all.map(p => lat2y(p[0])))), y1 = Math.floor(Math.max(...all.map(p => lat2y(p[0]))));
const c = createCanvas((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256), ctx = c.getContext('2d');
for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) { const f = `tiles-turaco26/${z}/${tx}/${ty}.webp`; if (existsSync(f)) ctx.drawImage(await loadImage(f), (tx - x0) * 256, (ty - y0) * 256); }
const X = lon => (lon2x(lon) - x0) * 256, Y = lat => (lat2y(lat) - y0) * 256;
routes.forEach((r, k) => {
  ctx.lineWidth = 5 - k; ctx.strokeStyle = COLORS[k]; ctx.globalAlpha = 0.85; ctx.beginPath();
  r.pts.forEach(p => (p[2] ? ctx.moveTo(X(p[1]), Y(p[0])) : ctx.lineTo(X(p[1]), Y(p[0])))); ctx.stroke(); ctx.globalAlpha = 1;
  for (const w of r.wpts) { ctx.fillStyle = COLORS[k]; ctx.beginPath(); ctx.arc(X(w.lon), Y(w.lat), 7, 0, 7); ctx.fill(); ctx.fillStyle = '#000'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(w.name, X(w.lon) + 9, Y(w.lat) - 6); }
  ctx.fillStyle = COLORS[k]; ctx.font = 'bold 22px sans-serif'; ctx.fillText(`${r.f.split('/').pop()} (start ●)`, 12, 28 + k * 26);
  ctx.beginPath(); ctx.arc(X(r.pts[0][1]), Y(r.pts[0][0]), 12, 0, 7); ctx.fill();
});
writeFileSync(out, await c.encode('png')); console.log(c.width, c.height);
