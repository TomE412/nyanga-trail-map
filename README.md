# Nyanga Trail Map

An offline topo map for trail running in Nyanga National Park, Zimbabwe. It shows
contour lines, paths and your GPS position with no phone signal, and can load a
race course (GPX file) to show distance done, distance to go and an off-course warning.

## How runners use it
1. Open the site on wifi and tap **☰ → Download map for offline** (about 55 MB).
2. Optionally load the course with **Load course (GPX file)**.
3. Add it to the home screen. It then works in airplane mode.

## Rebuilding the map (computer only)
- `npm run osm`: refresh paths and place names from OpenStreetMap
- `npm run tiles`: redraw the contour map. This needs the Copernicus elevation file in
  `tools/data/` (see `tools/render-tiles.mjs`)
- `npm test`: browser test: GPS, course, download, offline reload

When releasing changes, bump `APP_VERSION` in `app.js` and `SHELL` in `sw.js`.
If the tiles change, also bump `TILE_CACHE` (app.js) and `TILES` (sw.js).

## Credits
Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
2014-2018, provided under COPERNICUS by the European Union and ESA.
Paths and names © OpenStreetMap contributors (ODbL). Map library: Leaflet.
