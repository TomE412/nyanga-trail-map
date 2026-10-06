// Cuts the Far and Wide "Turaco Trail" GeoTIFF (EPSG:4326, ~2 m/px) into
// 256px WebP web-map tiles in <output folder>/{z}/{x}/{y}.webp.
// The white paper margin around the printed map is detected and left out, and
// pixels outside the map are transparent so the contour map shows through.
// Usage: node --max-old-space-size=6144 tools/render-turaco.mjs "path/to/TuracoTrail 2026 geo.tiff" tiles-turaco26
import { fromFile } from 'geotiff';
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';

const MIN_ZOOM = 11, MAX_ZOOM = 16, OUT = process.argv[3] || 'tiles-turaco';
const img = await (await fromFile(process.argv[2])).getImage();
const W = img.getWidth(), H = img.getHeight();
const [west, south, east, north] = img.getBoundingBox();
const rx = (east - west) / W, ry = (north - south) / H;
console.log(`reading ${W}x${H} image…`);
const px = await img.readRasters({ interleave: true });

// Find the printed map's edge on each side: the first line, coming in from the
// paper edge, where most pixels in a sample band are not white. Several bands
// are tried per side and the outermost edge wins, because the printed map is
// not always a rectangle (corners can be cut away).
const isInk = i => !(px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 220);
function edge(fromEnd, vertical, bandStart, bandLen) {
  const n = vertical ? W : H;
  for (let k = 40; k < n / 4; k++) { // skip the thin outer frame
    const p = fromEnd ? n - 1 - k : k;
    let ink = 0;
    for (let b = bandStart; b < bandStart + bandLen; b++) ink += isInk(vertical ? (b * W + p) * 3 : (p * W + b) * 3);
    if (ink / bandLen > 0.3) return p;
  }
  return fromEnd ? n - 1 : 0;
}
const BANDS = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
const outer = (fromEnd, vertical) => {
  const n = vertical ? H : W;
  const found = BANDS.map(f => edge(fromEnd, vertical, Math.floor(n * f), 400));
  return fromEnd ? Math.max(...found) : Math.min(...found);
};
const left = outer(false, true), right = outer(true, true);
const top = outer(false, false), bottom = outer(true, false);
console.log(`printed map area: x ${left}-${right}, y ${top}-${bottom}`);

function sample(lon, lat, out, o) {
  const fx = (lon - west) / rx - 0.5, fy = (north - lat) / ry - 0.5;
  if (fx < left || fy < top || fx > right || fy > bottom) { out[o + 3] = 0; return; }
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
  const i00 = (y0 * W + x0) * 3, i10 = i00 + 3, i01 = i00 + W * 3, i11 = i01 + 3;
  for (let b = 0; b < 3; b++) {
    out[o + b] = (px[i00 + b] * (1 - tx) + px[i10 + b] * tx) * (1 - ty) + (px[i01 + b] * (1 - tx) + px[i11 + b] * tx) * ty;
  }
  out[o + 3] = 255;
}

const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => 180 / Math.PI * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / 2 ** z));

// Lower zooms average several source pixels per tile pixel, so labels and
// fine lines stay smooth rather than shimmering.
const list = []; let bytes = 0;
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
  const ss = Math.max(1, Math.min(4, 2 ** (MAX_ZOOM - z)));
  const xa = Math.floor(lon2x(west, z)), xb = Math.floor(lon2x(east, z));
  const ya = Math.floor(lat2y(north, z)), yb = Math.floor(lat2y(south, z));
  for (let tx = xa; tx <= xb; tx++) for (let ty = ya; ty <= yb; ty++) {
    const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d');
    const id = ctx.createImageData(256, 256), d = id.data, tmp = new Uint8ClampedArray(4);

    for (let py = 0; py < 256; py++) for (let pxl = 0; pxl < 256; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        sample(x2lon(tx + (pxl + (sx + 0.5) / ss) / 256, z), y2lat(ty + (py + (sy + 0.5) / ss) / 256, z), tmp, 0);
        if (tmp[3]) { r += tmp[0]; g += tmp[1]; b += tmp[2]; a++; }
      }
      const o = (py * 256 + pxl) * 4;
      if (a) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; d[o + 3] = 255 * a / (ss * ss); }
    }
    // Blank pieces are still written so the app never asks for a missing one.
    ctx.putImageData(id, 0, 0);
    mkdirSync(`${OUT}/${z}/${tx}`, { recursive: true });
    const buf = await canvas.encode('webp', 85);
    writeFileSync(`${OUT}/${z}/${tx}/${ty}.webp`, buf);
    bytes += buf.length; list.push(`${z}/${tx}/${ty}`);
  }
  console.log(`zoom ${z}: ${list.length} tiles so far, ${(bytes / 1e6).toFixed(1)} MB`);
}
writeFileSync(`${OUT}/index.json`, JSON.stringify({ bbox: { west, south, east, north }, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, bytes, tiles: list }));
console.log(`done: ${list.length} tiles, ${(bytes / 1e6).toFixed(1)} MB`);
