# Nyanga Trail Map

An offline race map for trail running in Nyanga, Zimbabwe, built around the
Far and Wide "Turaco Trail 2026" map.

Features: live GPS position with accuracy circle and heading arrow; clear
warnings for old (stale) readings, poor accuracy and being off the map; run
recording that survives restarts, with GPX and GeoJSON export; optional race
course (GPX) with distance done/to go and an off-course warning; works in
airplane mode once downloaded.

## How runners use it
1. Open the site on wifi and tap **☰ → Download map for offline** (about 42 MB).
2. Optionally load the course with **Load course (GPX file)**.
3. Add it to the home screen. It then works in airplane mode.

## Rebuilding the map (computer only)
- `npm run osm` and `npm run tiles`: OpenStreetMap paths and a generated contour map. No longer used by the app since v6 (the 2026 race map covers the whole area); kept in case they are needed again
- `node --max-old-space-size=6144 tools/render-turaco.mjs "path/TuracoTrail 2026 geo.tiff" tiles-turaco26`: re-cut the race map. For a new map version use a new folder name, then update `TILE_SETS`, the race layer URL and `RACE_BBOX` in `app.js` and the index path in `sw.js`
- `node tools/build-medical.mjs "path/SkyRun 2026 Athlete Medical Guide.docx"`: rebuild the emergency and medical guide (`data/medical.html` + diagrams). If the number of diagrams changes, update the list in `sw.js`
- `npm test`: browser tests: GPS states, recording and recovery, export, course, offline
- Before race day, do the phone tests in `docs/field-test-checklist.md`

When releasing changes, bump `APP_VERSION` in `app.js` and `SHELL` in `sw.js`.
If map pieces change, bump `TILES_TAG` (app.js) so phones download again; if
existing pieces were redrawn, also bump `TILE_CACHE` (app.js) and `TILES` (sw.js).
Warning thresholds (stale seconds, poor accuracy and so on) are in `CONFIG` at the top of `app.js`.

## Credits
Race map: Wild Nyanga Map, The Turaco Trail 2026 © Far and Wide.
Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
2014-2018, provided under COPERNICUS by the European Union and ESA.
Paths and names © OpenStreetMap contributors (ODbL). Map library: Leaflet.
