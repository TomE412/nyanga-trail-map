// Draws the Harare practice street map from the OpenStreetMap data in
// tools/data/harare/ (fetched by fetch-harare.mjs) into 256px WebP tiles in
// tiles-harare/{z}/{x}/{y}.webp. Roads, water, parks, rail and place names.
// Map data © OpenStreetMap contributors (ODbL).
// Usage: node tools/render-harare.mjs [minZoom] [maxZoom]
//        node tools/render-harare.mjs sample   (a few test tiles only)
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { BBOX, HUB } from './harare-area.mjs';

const OUT = 'tiles-harare';
// The most detailed zoom (16) is only drawn within 15 km of the hub, to keep
// the download near 40 MB; further out the app enlarges zoom 15 instead.
const DETAIL_KM = 15;
const DETAIL = { south: +(HUB.lat - DETAIL_KM / 110.574).toFixed(4), north: +(HUB.lat + DETAIL_KM / 110.574).toFixed(4),
  west: +(HUB.lon - DETAIL_KM / (111.32 * Math.cos(HUB.lat * Math.PI / 180))).toFixed(4),
  east: +(HUB.lon + DETAIL_KM / (111.32 * Math.cos(HUB.lat * Math.PI / 180))).toFixed(4) };
const SAMPLE = process.argv[2] === 'sample';
const MIN_Z = SAMPLE ? 13 : +(process.argv[2] || 11), MAX_Z = SAMPLE ? 16 : +(process.argv[3] || 16);

// ---------- Load and merge the downloaded pieces ----------
const ways = new Map(), places = new Map();
for (const f of readdirSync('tools/data/harare').filter(f => f.startsWith('part-'))) {
  for (const e of JSON.parse(readFileSync(`tools/data/harare/${f}`, 'utf8')).elements) {
    if (e.type === 'way' && e.geometry) ways.set(e.id, e);
    else if (e.type === 'node' && e.tags && e.tags.name) places.set(e.id, e);
  }
}

// ---------- Style ----------
const ROAD = { // rank (draw order), fill, casing, width at z16, lowest zoom shown
  motorway: [9, '#e892a2', '#c24e6b', 11, 11], trunk: [8, '#f9b29c', '#c84e2f', 10, 11],
  primary: [7, '#fcd6a4', '#a06b00', 9, 11], secondary: [6, '#f7fabf', '#707d05', 8, 12],
  tertiary: [5, '#ffffff', '#8f8f8f', 7, 13], unclassified: [4, '#ffffff', '#999999', 5.5, 14],
  residential: [4, '#ffffff', '#999999', 5.5, 14], living_street: [4, '#ededed', '#999999', 5, 15],
  service: [2, '#ffffff', '#aaaaaa', 3, 15], pedestrian: [2, '#dddde8', '#999999', 3, 15],
  track: [1, '#996600', null, 1.6, 14], path: [0, '#fa8072', null, 1.3, 15], footway: [0, '#fa8072', null, 1.3, 15], cycleway: [0, '#0000ff', null, 1.3, 15],
};
const roadClass = t => t.highway && (ROAD[t.highway.replace('_link', '')] ? t.highway.replace('_link', '') : null);
const AREA = { // fill, lowest zoom shown, draw order
  residential: ['#e8e6e1', 12, 0], industrial: ['#ebdbe8', 12, 0], commercial: ['#f2dad9', 12, 0], retail: ['#ffd6d1', 12, 0],
  cemetery: ['#aacbaf', 13, 1], wood: ['#add19e', 11, 1], park: ['#c8facc', 12, 1], golf: ['#b5e3b5', 12, 1], sports: ['#dffce2', 14, 1],
  aerodrome: ['#e9e7e2', 11, 1], water: ['#aad3df', 11, 2],
};
function areaClass(t) {
  if (t.natural === 'water' || t.leisure === 'water_park') return 'water';
  if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest') return 'wood';
  if (t.leisure === 'park' || t.leisure === 'nature_reserve' || t.landuse === 'recreation_ground' || t.landuse === 'grass') return 'park';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.leisure === 'pitch' || t.leisure === 'sports_centre' || t.leisure === 'stadium') return 'sports';
  if (t.aeroway === 'aerodrome') return 'aerodrome';
  return AREA[t.landuse] ? t.landuse : null;
}
const FONT = 'Segoe UI';

// ---------- Projection ----------
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z * 256;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z * 256; };

// ---------- Features with a coarse spatial index (z14 tiles) ----------
const features = [];
for (const w of ways.values()) {
  const t = w.tags || {}, g = w.geometry;
  const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  let f = null;
  if (roadClass(t)) f = { kind: 'road', cls: roadClass(t), name: t.name || t.ref || '' };
  else if (t.waterway) f = { kind: 'waterway', cls: t.waterway, name: t.name || '' };
  else if (t.railway === 'rail') f = { kind: 'rail' };
  else if (t.aeroway === 'runway') f = { kind: 'runway' };
  else if (closed && areaClass(t)) f = { kind: 'area', cls: areaClass(t) };
  if (!f) continue;
  f.g = g.map(p => [p.lat, p.lon]);
  f.minLat = Math.min(...f.g.map(p => p[0])); f.maxLat = Math.max(...f.g.map(p => p[0]));
  f.minLon = Math.min(...f.g.map(p => p[1])); f.maxLon = Math.max(...f.g.map(p => p[1]));
  features.push(f);
}
const IZ = 14, index = new Map();
features.forEach((f, k) => {
  const x0 = Math.floor(lon2x(f.minLon, IZ) / 256), x1 = Math.floor(lon2x(f.maxLon, IZ) / 256);
  const y0 = Math.floor(lat2y(f.maxLat, IZ) / 256), y1 = Math.floor(lat2y(f.minLat, IZ) / 256);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const key = x * 100000 + y; if (!index.has(key)) index.set(key, []); index.get(key).push(k);
  }
});
function featuresIn(z, tx, ty) {
  const s = 2 ** (IZ - z), found = new Set();
  const a = Math.floor(tx * s) - 1, b = Math.floor((tx + 1) * s), c = Math.floor(ty * s) - 1, d = Math.floor((ty + 1) * s);
  for (let x = a; x <= b; x++) for (let y = c; y <= d; y++) for (const k of index.get(x * 100000 + y) || []) found.add(k);
  return [...found].map(k => features[k]);
}
console.log(`${features.length} features, ${places.size} places`);

// ---------- Labels, placed once per zoom so they line up across tiles ----------
const measure = createCanvas(10, 10).getContext('2d');
function textWidth(text, size, weight = '') { measure.font = `${weight} ${size}px "${FONT}"`; return measure.measureText(text).width; }

function placeLabels(z) {
  const labels = [], grid = new Map(), cell = 64;
  const rectFree = r => {
    for (let gx = Math.floor(r.x0 / cell); gx <= Math.floor(r.x1 / cell); gx++) for (let gy = Math.floor(r.y0 / cell); gy <= Math.floor(r.y1 / cell); gy++)
      for (const o of grid.get(gx * 1e6 + gy) || []) if (!(r.x1 < o.x0 || r.x0 > o.x1 || r.y1 < o.y0 || r.y0 > o.y1)) return false;
    return true;
  };
  const take = (r, label) => {
    for (let gx = Math.floor(r.x0 / cell); gx <= Math.floor(r.x1 / cell); gx++) for (let gy = Math.floor(r.y0 / cell); gy <= Math.floor(r.y1 / cell); gy++) {
      const key = gx * 1e6 + gy; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(r);
    }
    labels.push({ ...label, box: r });
  };
  // Place names first: city, then suburbs.
  const prank = { city: 0, town: 1, suburb: 2, quarter: 3, village: 3, neighbourhood: 4 };
  const pminz = { city: 11, town: 11, suburb: 12, quarter: 13, village: 13, neighbourhood: 15 };
  for (const p of [...places.values()].sort((a, b) => prank[a.tags.place] - prank[b.tags.place])) {
    if (z < (pminz[p.tags.place] ?? 99)) continue;
    const size = p.tags.place === 'city' ? 18 : p.tags.place === 'town' ? 15 : z >= 15 ? 14 : 12.5;
    const weight = p.tags.place === 'city' || p.tags.place === 'town' ? 'bold' : '600';
    const w = textWidth(p.tags.name, size, weight), x = lon2x(p.lon, z), y = lat2y(p.lat, z);
    const r = { x0: x - w / 2 - 4, x1: x + w / 2 + 4, y0: y - size / 2 - 4, y1: y + size / 2 + 4 };
    if (rectFree(r)) take(r, { type: 'place', text: p.tags.name, x, y, angle: 0, size, weight, color: '#333', upper: p.tags.place !== 'neighbourhood' });
  }
  // Road names along the straightest stretch of each road.
  const shown = { 12: 7, 13: 6, 14: 5, 15: 4, 16: 2 }; // lowest road rank named at each zoom
  const roads = features.filter(f => f.kind === 'road' && f.name && ROAD[f.cls][0] >= (shown[z] ?? 99) && z >= ROAD[f.cls][4])
    .sort((a, b) => ROAD[b.cls][0] - ROAD[a.cls][0]);
  const lastByName = new Map();
  const size = z >= 16 ? 12 : 11;
  for (const f of roads) {
    const pts = f.g.map(([lat, lon]) => [lon2x(lon, z), lat2y(lat, z)]);
    const w = textWidth(f.name, size, '600') + 14;
    // Find the longest run with little bending.
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      let len = 0, j = i;
      const a0 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      while (j < pts.length - 1) {
        const a = Math.atan2(pts[j + 1][1] - pts[j][1], pts[j + 1][0] - pts[j][0]);
        let d = Math.abs(a - a0); if (d > Math.PI) d = 2 * Math.PI - d;
        if (d > 0.35) break;
        len += Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]); j++;
      }
      if (!best || len > best.len) best = { i, j, len };
    }
    if (!best || best.len < w) continue;
    const A = pts[best.i], B = pts[best.j];
    const x = (A[0] + B[0]) / 2, y = (A[1] + B[1]) / 2;
    let angle = Math.atan2(B[1] - A[1], B[0] - A[0]);
    if (angle > Math.PI / 2) angle -= Math.PI; if (angle < -Math.PI / 2) angle += Math.PI; // keep text upright
    const prev = lastByName.get(f.name) || [];
    if (prev.some(p => Math.hypot(p[0] - x, p[1] - y) < 400)) continue; // one label per street nearby
    const hw = Math.abs(Math.cos(angle)) * w / 2 + Math.abs(Math.sin(angle)) * size / 2 + 2;
    const hh = Math.abs(Math.sin(angle)) * w / 2 + Math.abs(Math.cos(angle)) * size / 2 + 2;
    const r = { x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh };
    if (!rectFree(r)) continue;
    take(r, { type: 'road', text: f.name, x, y, angle, size, weight: '600', color: '#222' });
    lastByName.set(f.name, [...prev, [x, y]]);
  }
  // Index labels by 256px tile for drawing.
  const byTile = new Map();
  for (const l of labels) {
    for (let tx = Math.floor((l.box.x0 - 2) / 256); tx <= Math.floor((l.box.x1 + 2) / 256); tx++)
      for (let ty = Math.floor((l.box.y0 - 2) / 256); ty <= Math.floor((l.box.y1 + 2) / 256); ty++) {
        const key = tx * 1e6 + ty; if (!byTile.has(key)) byTile.set(key, []); byTile.get(key).push(l);
      }
  }
  return byTile;
}

// ---------- Draw one tile ----------
function drawTile(z, tx, ty, labels) {
  const c = createCanvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#f2efe9'; ctx.fillRect(0, 0, 256, 256);
  const ox = tx * 256, oy = ty * 256, k = 2 ** (z - 16);
  const P = ([lat, lon]) => [lon2x(lon, z) - ox, lat2y(lat, z) - oy];
  const path = g => { ctx.beginPath(); g.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
  const list = featuresIn(z, tx, ty);

  for (const order of [0, 1, 2]) for (const f of list) {
    if (f.kind !== 'area' || AREA[f.cls][2] !== order || z < AREA[f.cls][1]) continue;
    path(f.g); ctx.fillStyle = AREA[f.cls][0]; ctx.fill();
  }
  for (const f of list) if (f.kind === 'waterway') {
    const w = f.cls === 'river' ? Math.max(1.5, 5 * k) : Math.max(0.8, 2 * k);
    if (f.cls !== 'river' && z < 13) continue;
    path(f.g); ctx.strokeStyle = '#7fb6d1'; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
  for (const f of list) if (f.kind === 'runway') { path(f.g); ctx.strokeStyle = '#bbbbcc'; ctx.lineWidth = Math.max(2, 30 * k); ctx.stroke(); }
  for (const f of list) if (f.kind === 'rail' && z >= 12) {
    path(f.g); ctx.strokeStyle = '#999'; ctx.lineWidth = Math.max(1, 3 * k); ctx.setLineDash([]); ctx.stroke();
    if (z >= 14) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(0.6, 1.5 * k); ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]); }
  }
  const roads = list.filter(f => f.kind === 'road' && z >= ROAD[f.cls][4]).sort((a, b) => ROAD[a.cls][0] - ROAD[b.cls][0]);
  const width = f => { const [, , , w16] = ROAD[f.cls]; return Math.max(ROAD[f.cls][0] >= 5 ? 1.6 : 1, w16 * Math.max(k, z >= 14 ? 0.45 : 0.3)); };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const f of roads) { // casings (outlines) under the fills
    const cas = ROAD[f.cls][2]; if (!cas || z < 13) continue;
    path(f.g); ctx.strokeStyle = cas; ctx.lineWidth = width(f) + 1.6; ctx.stroke();
  }
  for (const f of roads) {
    path(f.g); ctx.strokeStyle = ROAD[f.cls][1]; ctx.lineWidth = width(f);
    ctx.setLineDash(ROAD[f.cls][2] ? [] : f.cls === 'track' ? [5, 3] : [3, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  // Labels with a white halo.
  for (const l of labels.get(tx * 1e6 + ty) || []) {
    ctx.save(); ctx.translate(l.x - ox, l.y - oy); ctx.rotate(l.angle);
    ctx.font = `${l.weight} ${l.size}px "${FONT}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = l.upper ? l.text.toUpperCase() : l.text;
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = l.color; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  return c;
}

// ---------- Render ----------
const list = []; let bytes = 0;
const tiles = z => {
  const B = z >= 16 ? DETAIL : BBOX;
  const x0 = Math.floor(lon2x(B.west, z) / 256), x1 = Math.floor(lon2x(B.east, z) / 256);
  const y0 = Math.floor(lat2y(B.north, z) / 256), y1 = Math.floor(lat2y(B.south, z) / 256);
  const out = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]); return out;
};
for (let z = MIN_Z; z <= MAX_Z; z++) {
  const labels = placeLabels(z);
  let todo = tiles(z);
  if (SAMPLE) { // a few tiles around the hub and the city centre
    const pick = (lat, lon) => [Math.floor(lon2x(lon, z) / 256), Math.floor(lat2y(lat, z) / 256)];
    const want = [pick(HUB.lat, HUB.lon), pick(-17.8292, 31.0522), pick(-17.98, 30.95)]
      .flatMap(([x, y]) => [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => [x + dx, y + dy]))).map(p => p.join());
    todo = todo.filter(t => want.includes(t.join()));
  }
  for (const [x, y] of todo) {
    const buf = await drawTile(z, x, y, labels).encode('webp', 80);
    mkdirSync(`${OUT}/${z}/${x}`, { recursive: true });
    writeFileSync(`${OUT}/${z}/${x}/${y}.webp`, buf);
    bytes += buf.length; list.push(`${z}/${x}/${y}`);
  }
  console.log(`zoom ${z}: ${list.length} tiles so far, ${(bytes / 1e6).toFixed(1)} MB`);
}
if (!SAMPLE) writeFileSync(`${OUT}/index.json`, JSON.stringify({ bbox: BBOX, detailBbox: DETAIL, minZoom: MIN_Z, maxZoom: MAX_Z, bytes, tiles: list }));
