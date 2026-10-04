// Downloads paths, roads, streams, peaks and place names from OpenStreetMap
// for the map area and saves them as data/osm.geojson.
import { writeFileSync } from 'node:fs';
import { BBOX } from './area.mjs';

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:120];
(
  way["highway"](${b});
  way["waterway"~"river|stream"](${b});
  node["natural"~"peak|saddle"](${b});
  node["waterway"="waterfall"](${b});
  node["place"~"village|hamlet|town|locality"](${b});
  node["tourism"~"hotel|camp_site|viewpoint|chalet"](${b});
);
out geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'nyanga-trail-map/0.1' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error('Overpass ' + res.status + ' ' + (await res.text()).slice(0, 300));
const json = await res.json();

const r5 = n => Math.round(n * 1e5) / 1e5;
const ROAD = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'trunk', 'service']);
const features = [];
for (const el of json.elements) {
  const t = el.tags || {};
  if (el.type === 'way' && el.geometry) {
    let kind;
    if (t.waterway) kind = t.waterway === 'river' ? 'river' : 'stream';
    else if (['path', 'footway', 'bridleway', 'steps'].includes(t.highway)) kind = 'path';
    else if (t.highway === 'track') kind = 'track';
    else if (ROAD.has(t.highway)) kind = 'road';
    else continue;
    features.push({ type: 'Feature', properties: { kind, name: t.name || '' },
      geometry: { type: 'LineString', coordinates: el.geometry.map(p => [r5(p.lon), r5(p.lat)]) } });
  } else if (el.type === 'node') {
    const kind = t.natural || (t.waterway ? 'waterfall' : t.place ? 'place' : t.tourism);
    features.push({ type: 'Feature', properties: { kind, name: t.name || '', ele: t.ele || '' },
      geometry: { type: 'Point', coordinates: [r5(el.lon), r5(el.lat)] } });
  }
}
writeFileSync('data/osm.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
const count = {}; features.forEach(f => count[f.properties.kind] = (count[f.properties.kind] || 0) + 1);
console.log(count);
console.log(features.filter(f => f.properties.kind === 'peak').map(f => `${f.properties.name} ${f.properties.ele}`).join(' | '));
