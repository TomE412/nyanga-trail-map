import { fromFile } from 'geotiff';
for (const n of ['S19_00_E032_00','S18_00_E032_00']) {
  const t = await fromFile(`tools/data/${n}.tif`); const im = await t.getImage();
  console.log(n, im.getWidth(), im.getHeight(), im.getBoundingBox());
}
