// Builds the race routes the app offers at setup, from the GPX files in races/.
// races/races.json lists each race (id, name, file, version, start time, notes).
// Output: data/races/index.json (the list) and data/races/<id>.json (the route).
//
// Clean-up done here so the app gets tidy data:
// - waypoints that are just copies of route points (Garmin exports these) are
//   dropped; real checkpoints are waypoints that do not sit on a route point
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

  const wpts = [...xml.matchAll(/<wpt\s[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/wpt>/g)]
    .map(m => ({ lat: +m[1], lon: +m[2], name: tag(m[3], 'name') || 'Checkpoint' }))
    .filter(w => !pts.some(p => metres(p, [w.lat, w.lon]) < 2));

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
