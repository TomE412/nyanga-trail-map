// Downloads OpenStreetMap data for the Harare practice map (roads, water,
// parks, railways, place names) in pieces, into tools/data/harare/.
import { writeFileSync, existsSync } from 'node:fs';
import { BBOX } from './harare-area.mjs';

const N = 3; // split the area into 3 x 3 pieces so each request stays small
const parts = [];
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const s = BBOX.south + (BBOX.north - BBOX.south) * i / N, n = BBOX.south + (BBOX.north - BBOX.south) * (i + 1) / N;
  const w = BBOX.west + (BBOX.east - BBOX.west) * j / N, e = BBOX.west + (BBOX.east - BBOX.west) * (j + 1) / N;
  parts.push({ name: `part-${i}-${j}`, b: `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}` });
}
for (const p of parts) {
  const file = `tools/data/harare/${p.name}.json`;
  if (existsSync(file)) { console.log('have', p.name); continue; }
  const q = `[out:json][timeout:300];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|path|footway|pedestrian|cycleway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"](${p.b});
  way["waterway"~"river|stream|canal"](${p.b});
  way["natural"="water"](${p.b});
  way["landuse"~"residential|industrial|commercial|retail|cemetery|forest"](${p.b});
  way["leisure"~"park|golf_course|nature_reserve|sports_centre|pitch|stadium"](${p.b});
  way["natural"~"wood|scrub"](${p.b});
  way["railway"="rail"](${p.b});
  way["aeroway"~"runway|aerodrome"](${p.b});
  node["place"~"city|town|suburb|neighbourhood|village|quarter"](${p.b});
);
out geom qt;`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      // The public servers are often busy; take turns between two of them.
      const server = attempt % 2 ? 'https://overpass-api.de/api/interpreter' : 'https://overpass.private.coffee/api/interpreter';
      const res = await fetch(server, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'nyanga-trail-map/0.1 (practice map build)' },
        body: 'data=' + encodeURIComponent(q) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      writeFileSync(file, txt);
      console.log(p.name, (txt.length / 1e6).toFixed(1), 'MB');
      break;
    } catch (err) {
      console.log(p.name, 'attempt', attempt, 'failed:', err.message);
      await new Promise(r => setTimeout(r, 15000 * attempt));
    }
  }
}
