// Builds the race routes the app offers at setup, from the GPX files in races/.
// races/races.json lists each race (id, name, file, version, start time, notes).
// Output: data/races/index.json (the list) and data/races/<id>.json (the route).
//
// Clean-up done here so the app gets tidy data:
// - waypoints that are just copies of route points (Garmin exports these, as
//   long numbered series such as "The Epic 2025 001") are dropped; the named
//   ones left are real checkpoints (water, stations, landmarks)
// - checkpoints from every file are shared: a race gets each checkpoint that
//   lies within 100 m of its own route, since routes share sections (a race
//   always keeps the checkpoints from its own file, even off-trail ones)
// - missing heights (or all zero, as in drawn routes) are filled from the
//   Copernicus 30 m elevation data in tools/data/
// Usage: node tools/build-races.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fromFile } from 'geotiff';

const races = JSON.parse(readFileSync('races/races.json', 'utf8'));
mkdirSync('data/races', { recursive: true });

// Elevation lookup (bilinear) from the Copernicus tiles covering Nyanga.
const dem = [];
for (const f of ['tools/data/S19_00_E032_00.tif', 'tools/data/S18_00_E032_00.tif']) {
  if (!existsSync(f)) continue;
  const img = await (await fromFile(f)).getImage();
  const [w, s, e, n] = img.getBoundingBox();
  dem.push({ w, s, e, n, W: img.getWidth(), H: img.getHeight(), r: (await img.readRasters({ samples: [0] }))[0] });
}
function elevation(lat, lon) {
  const t = dem.find(d => lon >= d.w && lon < d.e && lat > d.s && lat <= d.n);
  if (!t) return null;
  const fx = (lon - t.w) / (t.e - t.w) * t.W - 0.5, fy = (t.n - lat) / (t.n - t.s) * t.H - 0.5;
  const x0 = Math.max(0, Math.min(t.W - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(t.H - 2, Math.floor(fy)));
  const ax = fx - x0, ay = fy - y0, i = y0 * t.W + x0;
  return (t.r[i] * (1 - ax) + t.r[i + 1] * ax) * (1 - ay) + (t.r[i + t.W] * (1 - ax) + t.r[i + t.W + 1] * ax) * ay;
}

const metres = (a, b) => {
  const R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const tag = (s, t) => { const m = s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : null; };

// Checkpoints from every race file. A numbered series with more than 20
// members is an export of route points, not checkpoints.
const allCheckpoints = [];
for (const race of races) {
  const xml = readFileSync(`races/${race.file}`, 'utf8');
  const w = [...xml.matchAll(/<wpt\s[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/wpt>/g)]
    .map(m => ({ lat: +m[1], lon: +m[2], name: tag(m[3], 'name') || 'Checkpoint' }));
  const series = name => name.replace(/[-\s]\d+$/, '');
  const count = {};
  w.forEach(q => { count[series(q.name)] = (count[series(q.name)] || 0) + 1; });
  for (const q of w.filter(q => count[series(q.name)] <= 20)) {
    if (allCheckpoints.some(c => c.source === q.name && metres([c.lat, c.lon], [q.lat, q.lon]) < 30)) continue;
    const name = q.name.replace(/([A-Za-z])(\d+)$/, '$1 $2');
    const kind = /water/i.test(name) ? 'water' : /station|aid|checkpoint|\bcp\b/i.test(name) ? 'station' : 'point';
    allCheckpoints.push({ lat: +q.lat.toFixed(6), lon: +q.lon.toFixed(6), name, kind, source: q.name, race: race.id });
  }
}
// Shortest distance from a point to a route line, in metres.
function distanceToRoute(pts, lat, lon) {
  const k = 111320 * Math.cos(lat * Math.PI / 180), px = lon * k, py = lat * 110574;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][1] * k, ay = pts[i][0] * 110574, bx = pts[i + 1][1] * k, by = pts[i + 1][0] * 110574;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

const index = [];
for (const race of races) {
  const xml = readFileSync(`races/${race.file}`, 'utf8');
  let pts = [...xml.matchAll(/<trkpt\s[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)]
    .map(m => [+m[1], +m[2], tag(m[3], 'ele') !== null ? +tag(m[3], 'ele') : null]);
  if (pts.length < 2) pts = [...xml.matchAll(/<rtept\s[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/rtept>/g)]
    .map(m => [+m[1], +m[2], tag(m[3], 'ele') !== null ? +tag(m[3], 'ele') : null]);
  if (pts.length < 2) throw new Error(`${race.file}: no route found`);

  const heightsMissing = pts.some(p => p[2] === null) || pts.every(p => p[2] === 0);
  if (heightsMissing) pts = pts.map(([lat, lon]) => [lat, lon, elevation(lat, lon)]);
  pts = pts.map(([lat, lon, ele]) => [+lat.toFixed(6), +lon.toFixed(6), ele == null ? null : Math.round(ele)]);

  const wpts = allCheckpoints.filter(c => c.race === race.id || distanceToRoute(pts, c.lat, c.lon) <= 100)
    .map(({ lat, lon, name, kind }) => ({ lat, lon, name, kind }));

  let dist = 0, climb = 0, ref = pts[0][2];
  for (let i = 1; i < pts.length; i++) {
    dist += metres(pts[i - 1], pts[i]);
    const e = pts[i][2];
    if (e != null && ref != null) { if (e - ref >= 5) { climb += e - ref; ref = e; } else if (e < ref) ref = e; }
  }
  const out = { id: race.id, name: race.name, version: race.version, pts, wpts };
  writeFileSync(`data/races/${race.id}.json`, JSON.stringify(out));
  index.push({ id: race.id, name: race.name, version: race.version, start: race.start || '',
    distanceKm: +(dist / 1000).toFixed(1), climbM: Math.round(climb), checkpoints: wpts.length, file: `data/races/${race.id}.json` });
  console.log(`${race.name}: ${(dist / 1000).toFixed(1)} km, ${Math.round(climb)} m climb, ${pts.length} points, ` +
    `${wpts.length} checkpoints${heightsMissing ? ' (heights from elevation data)' : ''}`);
}
writeFileSync('data/races/index.json', JSON.stringify(index, null, 1));
