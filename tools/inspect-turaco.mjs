import { fromFile } from 'geotiff';
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
const src = process.argv[2], out = process.argv[3];
const t = await fromFile(src); const im = await t.getImage();
console.log('size', im.getWidth(), im.getHeight(), 'bands', im.getSamplesPerPixel(), 'bbox', im.getBoundingBox());
console.log('geokeys', JSON.stringify(im.getGeoKeys()));
console.log('compression', im.fileDirectory.Compression, 'tiled', im.isTiled, 'images', await t.getImageCount());
const W = 1100, H = Math.round(W * im.getHeight() / im.getWidth());
const ras = await im.readRasters({ width: W, height: H, interleave: true, resampleMethod: 'bilinear' });
const c = createCanvas(W, H), ctx = c.getContext('2d'), id = ctx.createImageData(W, H);
for (let i = 0, j = 0; i < W * H; i++) { id.data[j++] = ras[i*3]; id.data[j++] = ras[i*3+1]; id.data[j++] = ras[i*3+2]; id.data[j++] = 255; }
ctx.putImageData(id, 0, 0); writeFileSync(out, await c.encode('png'));
