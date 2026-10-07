// Plans the "Harare Prep" practice loop along real streets, using the
// OpenStreetMap road network in tools/data/harare/. Quiet streets are
// preferred and busy main roads avoided. Writes races/harare-prep.gpx with
// the route and a few practice checkpoints.
// Usage: node tools/make-harare-route.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

// Turning points of the loop (start and finish at the first one).
const VIA = [
  { lat: -17.8105, lon: 31.1130, name: 'Start: Greendale' },
  { lat: -17.7935, lon: 31.1180, name: 'Lewisam Avenue' },
  { lat: -17.8005, lon: 31.0960, name: 'Kensington Road' },
  { lat: -17.8150, lon: 31.0960, name: 'Glenara' },
];
// Practice checkpoints, placed this far along the loop (km).
const CHECKPOINTS = [{ km: 2.5, name: 'Practice water 1', kind: 'water' }, { km: 5, name: 'Practice station', kind: 'station' }, { km: 7.5, name: 'Practice water 2', kind: 'water' }];
// Cost per metre by road type: lower is preferred.
const COST = { residential: 1, living_street: 1, unclassified: 1.1, tertiary: 1.3, service: 1.6, secondary: 2.2, primary: 4, tertiary_link: 1.3, secondary_link: 2.2, primary_link: 4 };

const ways = new Map();
for (const f of readdirSync('tools/data/harare').filter(f => f.startsWith('part-')))
  for (const e of JSON.parse(readFileSync(`tools/data/harare/${f}`, 'utf8')).elements) if (e.type === 'way' && e.geometry) ways.set(e.id, e);

const metres = (a, b) => {
  const R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Road network: junctions are points shared by ways (same coordinates).
const key = p => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
const nodes = new Map(), edges = new Map();
for (const w of ways.values()) {
  const t = w.tags || {}, c = COST[t.highway];
  if (!c || t.access === 'private' || t.access === 'no') continue;
  const g = w.geometry;
  for (let i = 0; i < g.length - 1; i++) {
    const a = key(g[i]), b = key(g[i + 1]), d = metres([g[i].lat, g[i].lon], [g[i + 1].lat, g[i + 1].lon]);
    nodes.set(a, [g[i].lat, g[i].lon]); nodes.set(b, [g[i + 1].lat, g[i + 1].lon]);
    for (const [u, v] of [[a, b], [b, a]]) { if (!edges.has(u)) edges.set(u, []); edges.get(u).push([v, d * c, d]); }
  }
}
const nearest = p => { let best, bd = Infinity; for (const [k, q] of nodes) { const d = metres([p.lat, p.lon], q); if (d < bd) { bd = d; best = k; } } return best; };

function route(from, to) { // Dijkstra with a simple binary heap
  const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
  const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (u === to) break;
    if (d > dist.get(u)) continue;
    for (const [v, c] of edges.get(u) || []) { const nd = d + c; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); push([nd, v]); } }
  }
  if (!prev.has(to)) throw new Error('no route found');
  const path = [to]; while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path.map(k => nodes.get(k));
}

const stops = [...VIA, VIA[0]].map(nearest);
let pts = [];
for (let i = 0; i < stops.length - 1; i++) { const leg = route(stops[i], stops[i + 1]); pts = pts.concat(i ? leg.slice(1) : leg); }
// A turning point in the middle of a street makes the route go there and come
// straight back; trim those out-and-back tails (repeat until none are left).
for (let changed = true; changed;) {
  changed = false;
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i - 1][0] === pts[i + 1][0] && pts[i - 1][1] === pts[i + 1][1]) { pts.splice(i, 2); changed = true; break; }
  }
}
let total = 0; const cum = [0];
for (let i = 1; i < pts.length; i++) { total += metres(pts[i - 1], pts[i]); cum.push(total); }
const at = km => { const d = km * 1000; let i = cum.findIndex(c => c >= d); if (i < 1) i = 1; const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])]; };
const spurs = [];
for (let i = 1; i < pts.length - 1; i++) if (pts[i - 1][0] === pts[i + 1][0] && pts[i - 1][1] === pts[i + 1][1]) spurs.push(i);
if (spurs.length) console.log('WARNING: route doubles back on itself at points', spurs.join(', '));
const cps = CHECKPOINTS.filter(c => c.km * 1000 < total).map(c => ({ ...c, at: at(c.km) }));

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Nyanga Trail Map tools" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>Harare Prep</name><desc>Practice loop around Greendale and Highlands. Route planned along OpenStreetMap streets (© OpenStreetMap contributors).</desc></metadata>
${cps.map(c => `<wpt lat="${c.at[0].toFixed(6)}" lon="${c.at[1].toFixed(6)}"><name>${c.name}</name><type>${c.kind}</type></wpt>`).join('\n')}
<trk><name>Harare Prep</name><trkseg>
${pts.map(p => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"></trkpt>`).join('\n')}
</trkseg></trk>
</gpx>
`;
writeFileSync('races/harare-prep.gpx', gpx);
console.log(`Harare Prep: ${(total / 1000).toFixed(2)} km, ${pts.length} points, start-finish gap ${Math.round(metres(pts[0], pts[pts.length - 1]))} m, checkpoints ${cps.map(c => c.name).join(', ')}`);
