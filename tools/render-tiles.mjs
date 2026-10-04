// Draws the topo map (shaded relief + contour lines) from Copernicus 30 m
// elevation data and saves it as 256px WebP tiles in tiles/{z}/{x}/{y}.webp.
import { fromFile } from 'geotiff';
import { contours } from 'd3-contour';
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BBOX, MIN_ZOOM, MAX_ZOOM } from './area.mjs';

const MARGIN = 0.03; // degrees of extra elevation data around the map area
const tiff = await fromFile('tools/data/S19_00_E032_00.tif');
const img = await tiff.getImage();
const [ox, , , oy] = img.getBoundingBox(); // west, north
const res = 1 / 3600;
const win = [
  Math.floor((BBOX.west - MARGIN - ox) / res), Math.floor((oy - BBOX.north - MARGIN) / res),
  Math.ceil((BBOX.east + MARGIN - ox) / res), Math.ceil((oy - BBOX.south + MARGIN) / res),
];
const W = win[2] - win[0], H = win[3] - win[1];
let dem = (await img.readRasters({ window: win, samples: [0] }))[0];
const west0 = ox + win[0] * res, north0 = oy - win[1] * res;

// Light smoothing so 30 m data gives clean contour lines.
function blur(src) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += src[yy * W + xx]; n++; }
    }
    out[y * W + x] = s / n;
  }
  return out;
}
dem = blur(blur(Float32Array.from(dem)));

// Hillshade on the elevation grid (sun from the north-west).
const cellX = res * 111320 * Math.cos(18.25 * Math.PI / 180), cellY = res * 110574;
const shade = new Float32Array(W * H);
const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x;
  const dzdx = (dem[i + 1] - dem[i - 1]) / (2 * cellX);
  const dzdy = (dem[i + W] - dem[i - W]) / (2 * cellY); // + is south
  const slope = Math.atan(Math.hypot(dzdx, dzdy));
  const aspect = Math.atan2(dzdy, -dzdx);
  shade[i] = Math.max(0, Math.sin(alt) * Math.cos(slope) +
    Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect));
}

function sample(grid, lon, lat) {
  const fx = (lon - west0) / res - 0.5, fy = (north0 - lat) / res - 0.5;
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
  const tx = fx - x0, ty = fy - y0, i = y0 * W + x0;
  return (grid[i] * (1 - tx) + grid[i + 1] * tx) * (1 - ty) + (grid[i + W] * (1 - tx) + grid[i + W + 1] * tx) * ty;
}

// Gentle colour by height: green valleys -> tan -> pale grey summit.
const RAMP = [[1200, [196, 219, 178]], [1700, [216, 228, 186]], [2000, [232, 226, 196]], [2300, [228, 214, 190]], [2600, [240, 236, 230]]];
function tint(e) {
  if (e <= RAMP[0][0]) return RAMP[0][1];
  for (let k = 1; k < RAMP.length; k++) if (e <= RAMP[k][0]) {
    const [e0, c0] = RAMP[k - 1], [e1, c1] = RAMP[k], t = (e - e0) / (e1 - e0);
    return c0.map((c, j) => c + (c1[j] - c) * t);
  }
  return RAMP[RAMP.length - 1][1];
}

const INTERVAL = { 11: 100, 12: 50, 13: 50, 14: 20, 15: 20, 16: 20 };
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };

const P = 8, S = 256 + 2 * P; // padding so contours join cleanly across tiles
const list = [];
let bytes = 0;
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
  const xa = Math.floor(lon2x(BBOX.west, z)), xb = Math.floor(lon2x(BBOX.east, z));
  const ya = Math.floor(lat2y(BBOX.north, z)), yb = Math.floor(lat2y(BBOX.south, z));
  const step = INTERVAL[z];
  for (let tx = xa; tx <= xb; tx++) for (let ty = ya; ty <= yb; ty++) {
    const elev = new Float64Array(S * S), hs = new Float32Array(S * S);
    for (let py = 0; py < S; py++) {
      const lat = y2lat(ty + (py - P + 0.5) / 256, z);
      for (let px = 0; px < S; px++) {
        const lon = x2lon(tx + (px - P + 0.5) / 256, z);
        elev[py * S + px] = sample(dem, lon, lat);
        hs[py * S + px] = sample(shade, lon, lat);
      }
    }
    const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d');
    const id = ctx.createImageData(256, 256);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const i = (py + P) * S + px + P, o = (py * 256 + px) * 4;
      const c = tint(elev[i]), k = 0.55 + 0.6 * hs[i];
      id.data[o] = Math.min(255, c[0] * k); id.data[o + 1] = Math.min(255, c[1] * k);
      id.data[o + 2] = Math.min(255, c[2] * k); id.data[o + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);

    let lo = Infinity, hi = -Infinity;
    for (const e of elev) { if (e < lo) lo = e; if (e > hi) hi = e; }
    const levels = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) levels.push(v);
    ctx.save(); ctx.translate(-P, -P);
    for (const c of contours().size([S, S]).thresholds(levels)(elev)) {
      const index = c.value % 100 === 0 && step < 100;
      ctx.strokeStyle = index ? 'rgba(120,70,30,0.85)' : 'rgba(140,90,50,0.55)';
      ctx.lineWidth = index ? 1.4 : 0.7;
      ctx.beginPath();
      for (const poly of c.coordinates) for (const ring of poly) {
        ring.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      }
      ctx.stroke();
    }
    ctx.restore();
    // Clear everything outside the map area, so the edges are clean.
    const ex0 = (lon2x(BBOX.west, z) - tx) * 256, ex1 = (lon2x(BBOX.east, z) - tx) * 256;
    const ey0 = (lat2y(BBOX.north, z) - ty) * 256, ey1 = (lat2y(BBOX.south, z) - ty) * 256;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillRect(ex0, ey0, ex1 - ex0, ey1 - ey0);
    ctx.globalCompositeOperation = 'source-over';

    mkdirSync(`tiles/${z}/${tx}`, { recursive: true });
    const buf = await canvas.encode('webp', 88);
    writeFileSync(`tiles/${z}/${tx}/${ty}.webp`, buf);
    bytes += buf.length;
    list.push(`${z}/${tx}/${ty}`);
  }
  console.log(`zoom ${z}: ${list.length} tiles so far`);
}
writeFileSync('tiles/index.json', JSON.stringify({ bbox: BBOX, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, bytes, tiles: list }));
console.log(`done: ${list.length} tiles, ${(bytes / 1e6).toFixed(1)} MB`);
