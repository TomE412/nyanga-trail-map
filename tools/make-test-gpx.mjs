// Makes a pretend course (Nyangani car park -> summit -> back) for testing,
// with heights taken from the elevation data.
import { fromFile } from 'geotiff';
import { writeFileSync } from 'node:fs';
const img = await (await fromFile('tools/data/S19_00_E032_00.tif')).getImage();
const ras = (await img.readRasters({ samples: [0] }))[0];
const ele = (lat, lon) => ras[Math.floor((-18 - lat) * 3600) * 3600 + Math.floor((lon - 32) * 3600)];
const legs = [[-18.2700, 32.8050], [-18.2820, 32.8200], [-18.2930, 32.8330], [-18.30137, 32.84191], [-18.3080, 32.8320], [-18.2950, 32.8150], [-18.2700, 32.8050]];
const pts = [];
for (let i = 0; i < legs.length - 1; i++) {
  const [a, b] = [legs[i], legs[i + 1]];
  const n = Math.ceil(Math.hypot((b[0] - a[0]) * 110574, (b[1] - a[1]) * 105700) / 40);
  for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
}
pts.push(legs[legs.length - 1]);
const trk = pts.map(([la, lo]) => `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"><ele>${ele(la, lo).toFixed(1)}</ele></trkpt>`).join('\n');
writeFileSync('tests/test-course.gpx', `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
<wpt lat="-18.2930" lon="32.8330"><name>CP1</name></wpt>
<wpt lat="-18.30137" lon="32.84191"><name>Summit</name></wpt>
<wpt lat="-18.2950" lon="32.8150"><name>CP3</name></wpt>
<trk><name>Test loop - Nyangani</name><trkseg>
${trk}
</trkseg></trk></gpx>`);
console.log(pts.length, 'points');
