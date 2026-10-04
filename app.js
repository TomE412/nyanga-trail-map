// Nyanga Trail Map: offline topo map with GPS position and race course.
// Keep APP_VERSION in step with CACHE in sw.js.
const APP_VERSION = 'v2 (4 Oct 2026)';
const TILE_CACHE = 'tiles-v1';
// Bump when a tile set is added or redrawn, so phones know to download again.
const TILES_TAG = 'contours1+turaco1';
const TILE_SETS = ['tiles', 'tiles-turaco'];
const BBOX = { west: 32.62, east: 32.98, south: -18.42, north: -18.08 };
// Far and Wide "Turaco Trail" race map (from its GeoTIFF).
const RACE_BBOX = { west: 32.770237886116384, east: 32.99270592722873, south: -18.476174967869852, north: -18.264234107572427 };

const $ = id => document.getElementById(id);
$('version').textContent = 'Version ' + APP_VERSION;

// ---------- Map ----------
const contourBounds = L.latLngBounds([BBOX.south, BBOX.west], [BBOX.north, BBOX.east]);
const raceBounds = L.latLngBounds([RACE_BBOX.south, RACE_BBOX.west], [RACE_BBOX.north, RACE_BBOX.east]);
const bounds = L.latLngBounds(contourBounds.getSouthWest(), contourBounds.getNorthEast()).extend(raceBounds);
const map = L.map('map', {
  preferCanvas: true, zoomControl: false, minZoom: 11, maxZoom: 18,
  maxBounds: bounds.pad(0.3), maxBoundsViscosity: 0.8,
});
map.fitBounds(raceBounds);
try {
  const v = JSON.parse(localStorage.getItem('view'));
  if (v) map.setView(v.c, v.z);
} catch {}
map.on('moveend', () => {
  try { localStorage.setItem('view', JSON.stringify({ c: map.getCenter(), z: map.getZoom() })); } catch {}
});

L.tileLayer('tiles/{z}/{x}/{y}.webp', {
  minZoom: 11, maxZoom: 18, maxNativeZoom: 16, bounds: contourBounds,
  attribution: '© OpenStreetMap contributors · Copernicus DEM',
}).addTo(map);
const raceLayer = L.tileLayer('tiles-turaco/{z}/{x}/{y}.webp', {
  minZoom: 11, maxZoom: 18, maxNativeZoom: 16, bounds: raceBounds,
  attribution: 'Race map © Far and Wide',
});
L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
// The GPS dot sits in its own layer above every label so it is never hidden.
map.createPane('gps').style.zIndex = 650;

function setZoomClass() { map.getContainer().classList.toggle('zoom-lo', map.getZoom() < 13); }
map.on('zoomend', setZoomClass); setZoomClass();

// Paths, roads, streams and named places from OpenStreetMap.
const STYLE = {
  river: { color: '#3d85c6', weight: 2.2 },
  stream: { color: '#6aaee8', weight: 1.2 },
  road: { color: '#7a6a55', weight: 2.6 },
  track: { color: '#6d4c41', weight: 1.8, dashArray: '6 4' },
  path: { color: '#c62828', weight: 1.8, dashArray: '3 4' },
};
const label = (text, cls) => L.divIcon({ className: '', html: `<div class="lbl ${cls}">${text}</div>`, iconSize: [0, 0] });
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The race map already shows paths and names, so these only appear when it is off.
const osmLayer = L.layerGroup();
function setRaceMap(on) {
  if (on) { raceLayer.addTo(map); osmLayer.remove(); } else { raceLayer.remove(); osmLayer.addTo(map); }
  $('raceToggle').checked = on;
  try { localStorage.setItem('raceMap', on ? '1' : '0'); } catch {}
}
let raceOn = true;
try { raceOn = localStorage.getItem('raceMap') !== '0'; } catch {}
setRaceMap(raceOn);
$('raceToggle').onchange = e => setRaceMap(e.target.checked);

fetch('data/osm.geojson').then(r => r.json()).then(gj => {
  const order = ['stream', 'river', 'road', 'track', 'path'];
  gj.features.sort((a, b) => order.indexOf(a.properties.kind) - order.indexOf(b.properties.kind));
  L.geoJSON(gj, {
    filter: f => f.geometry.type === 'LineString',
    style: f => ({ opacity: 0.9, ...STYLE[f.properties.kind] }),
    interactive: false,
  }).addTo(osmLayer);
  for (const f of gj.features) {
    if (f.geometry.type !== 'Point' || !f.properties.name) continue;
    const { kind, name, ele } = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const text = escapeHtml(name) + (ele ? ` ${escapeHtml(ele)}m` : '');
    L.marker([lat, lon], { icon: label(text, kind === 'peak' ? 'peak' : 'minor'), interactive: false }).addTo(osmLayer);
  }
}).catch(err => console.warn('Could not load paths', err));

// ---------- Offline download ----------
async function allTileUrls() {
  const urls = []; let bytes = 0;
  for (const dir of TILE_SETS) {
    const idx = await (await fetchWithTimeout(`${dir}/index.json`, 15000)).json();
    idx.tiles.forEach(t => urls.push(`${dir}/${t}.webp`));
    bytes += idx.bytes;
  }
  return { urls, bytes };
}

async function refreshOfflineStatus() {
  const chip = $('offlineChip');
  try {
    const saved = localStorage.getItem('tilesSaved');
    if (saved === TILES_TAG) {
      chip.textContent = 'Saved offline ✓'; chip.className = 'chip good';
      $('dlText').textContent = 'The map is saved on this phone. It works with no signal.';
      $('dlBtn').textContent = 'Check / re-download map';
      return;
    }
  } catch {}
  chip.textContent = 'Map not saved offline'; chip.className = 'chip warn';
}

$('dlBtn').onclick = async () => {
  const btn = $('dlBtn'), bar = $('dlProgress'), text = $('dlText');
  btn.disabled = true; bar.style.display = 'block';
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const { urls, bytes } = await allTileUrls();
    const cache = await caches.open(TILE_CACHE);
    let done = 0, failed = 0, next = 0;
    const mb = (bytes / 1e6).toFixed(0);
    async function worker() {
      while (next < urls.length) {
        const url = urls[next++];
        try {
          if (!(await cache.match(url))) {
            const res = await fetchWithTimeout(url, 15000);
            if (!res.ok) throw new Error(res.status);
            await cache.put(url, res);
          }
        } catch { failed++; }
        done++;
        if (done % 10 === 0 || done === urls.length) {
          bar.firstElementChild.style.width = (100 * done / urls.length) + '%';
          text.textContent = `Downloading… ${done} of ${urls.length} pieces (about ${mb} MB in total)`;
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    if (failed) {
      text.textContent = `${failed} pieces did not download. Check your connection and tap the button again; it carries on where it stopped.`;
    } else {
      localStorage.setItem('tilesSaved', TILES_TAG);
      text.textContent = 'Done. The map is saved on this phone.';
    }
  } catch (err) {
    text.textContent = 'Download failed: ' + (err.message || err) + '. Connect to the internet and try again.';
  }
  btn.disabled = false;
  refreshOfflineStatus();
};

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ---------- GPS ----------
let watchId = null, follow = false, lastFix = null;
const gpsRenderer = L.svg({ pane: 'gps' });
const dot = L.circleMarker([0, 0], { pane: 'gps', renderer: gpsRenderer, radius: 8, color: '#fff', weight: 3, fillColor: '#1e88e5', fillOpacity: 1, interactive: false });
const ring = L.circle([0, 0], { pane: 'gps', renderer: gpsRenderer, radius: 1, color: '#1e88e5', weight: 1, fillOpacity: 0.12, interactive: false });

function startGps() {
  if (!('geolocation' in navigator)) { $('gpsMain').textContent = 'No GPS on this device'; return; }
  if (watchId !== null) return;
  $('gpsMain').textContent = 'Finding GPS…';
  $('gpsSub').textContent = 'Can take up to a minute in valleys';
  watchId = navigator.geolocation.watchPosition(onFix, onGpsError,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 60000 });
  try { localStorage.setItem('gpsOn', '1'); } catch {}
}

function onFix(pos) {
  const { latitude: lat, longitude: lon, accuracy, altitude } = pos.coords;
  const first = !lastFix;
  lastFix = { lat, lon, accuracy, altitude, t: pos.timestamp };
  dot.setLatLng([lat, lon]).addTo(map);
  ring.setLatLng([lat, lon]).setRadius(accuracy).addTo(map);
  dot.bringToFront();

  const inside = bounds.contains([lat, lon]);
  $('gpsMain').textContent = altitude != null ? `${Math.round(altitude)} m altitude` : 'Location found';
  $('gpsSub').textContent = inside
    ? `±${Math.round(accuracy)} m · ${lat.toFixed(5)}, ${lon.toFixed(5)}`
    : `Outside map area (${(distanceTo(lat, lon) / 1000).toFixed(0)} km away)`;

  if (inside && (follow || first)) map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: !first });
  updateCourse();
}

function onGpsError(err) {
  if (err.code === 1) {
    $('gpsMain').textContent = 'Location blocked';
    $('gpsSub').textContent = 'Allow location for this site in your phone settings';
    stopGps();
  } else {
    $('gpsSub').textContent = err.code === 3 ? 'Still searching for GPS…' : 'GPS error: ' + err.message;
  }
}

function stopGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

// Rough distance from a point to the map area, for the "outside" message.
function distanceTo(lat, lon) {
  const c = bounds.getCenter();
  return map.distance([lat, lon], c);
}

$('locateBtn').onclick = () => {
  startGps();
  follow = true;
  $('locateBtn').classList.add('active');
  if (lastFix && bounds.contains([lastFix.lat, lastFix.lon])) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 15));
};
map.on('dragstart', () => { follow = false; $('locateBtn').classList.remove('active'); });

// ---------- Course (GPX) ----------
// Course points are projected to flat metres; fine at this scale (~40 km).
const LAT0 = -18.25, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
let course = null, courseLayer = null, lastAlong = null;

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This is not a valid GPX file');
  let pts = [...doc.getElementsByTagName('trkpt')];
  if (!pts.length) pts = [...doc.getElementsByTagName('rtept')];
  if (pts.length < 2) throw new Error('No route found in this file');
  const num = (el, tag) => { const e = el.getElementsByTagName(tag)[0]; return e ? parseFloat(e.textContent) : null; };
  const name = (doc.getElementsByTagName('name')[0] || {}).textContent || 'Course';
  return {
    name: name.trim(),
    pts: pts.map(p => [+(+p.getAttribute('lat')).toFixed(6), +(+p.getAttribute('lon')).toFixed(6), num(p, 'ele')]),
    wpts: [...doc.getElementsByTagName('wpt')].map(w => ({
      lat: +w.getAttribute('lat'), lon: +w.getAttribute('lon'),
      name: ((w.getElementsByTagName('name')[0] || {}).textContent || 'Point').trim(),
    })),
  };
}

function prepareCourse(c) {
  const xy = c.pts.map(([lat, lon]) => [lon * KX, lat * KY]);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  // Climb still to come from each point to the finish. Height changes under
  // 5 m are ignored so GPS wobble in the recorded file doesn't inflate it.
  const climbLeft = new Array(c.pts.length).fill(0);
  const hasEle = c.pts.every(p => p[2] != null);
  if (hasEle) {
    let ref = c.pts[c.pts.length - 1][2], acc = 0;
    for (let i = c.pts.length - 2; i >= 0; i--) {
      const e = c.pts[i][2];
      if (ref - e >= 5) { acc += ref - e; ref = e; } else if (e > ref) ref = e;
      climbLeft[i] = acc;
    }
  }
  const prepared = { ...c, xy, cum, total: cum[cum.length - 1], climbLeft, hasEle };
  prepared.wpts = c.wpts.map(w => ({ ...w, along: nearestOnCourse(prepared, w.lat, w.lon).along }))
    .sort((a, b) => a.along - b.along);
  return prepared;
}

// Finds the closest point on the course. Where the course passes the same
// spot twice, prefer the pass closest to where the runner was last seen.
function nearestOnCourse(c, lat, lon, prevAlong = null) {
  const px = lon * KX, py = lat * KY;
  const hits = [];
  for (let i = 0; i < c.xy.length - 1; i++) {
    const [ax, ay] = c.xy[i], [bx, by] = c.xy[i + 1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy;
    hits.push({ i, t, d: Math.hypot(px - qx, py - qy), along: c.cum[i] + t * Math.sqrt(len2), qx, qy });
  }
  let best = hits.reduce((a, b) => (b.d < a.d ? b : a));
  if (prevAlong != null) {
    const near = hits.filter(h => h.d < best.d + 40);
    best = near.reduce((a, b) => (Math.abs(b.along - prevAlong) < Math.abs(a.along - prevAlong) ? b : a));
  }
  best.bearing = (Math.atan2(best.qx - px, best.qy - py) * 180 / Math.PI + 360) % 360;
  return best;
}

const km = m => (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
const compass = b => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];

function drawCourse() {
  if (courseLayer) courseLayer.remove();
  if (!course) return;
  const ll = course.pts.map(p => [p[0], p[1]]);
  courseLayer = L.layerGroup([
    L.polyline(ll, { color: '#fff', weight: 7, opacity: 0.9, interactive: false }),
    L.polyline(ll, { color: '#e65100', weight: 4, interactive: false }),
  ]);
  // Kilometre markers.
  for (let k = 1000, i = 0; k < course.total; k += 1000) {
    while (course.cum[i + 1] < k) i++;
    const t = (k - course.cum[i]) / (course.cum[i + 1] - course.cum[i]);
    const lat = ll[i][0] + t * (ll[i + 1][0] - ll[i][0]), lon = ll[i][1] + t * (ll[i + 1][1] - ll[i][1]);
    courseLayer.addLayer(L.marker([lat, lon], { icon: label(String(k / 1000), 'km'), interactive: false }));
  }
  courseLayer.addLayer(L.marker(ll[0], { icon: label('START', 'wpt'), interactive: false }));
  courseLayer.addLayer(L.marker(ll[ll.length - 1], { icon: label('FINISH', 'wpt'), interactive: false }));
  for (const w of course.wpts) courseLayer.addLayer(L.marker([w.lat, w.lon], { icon: label(escapeHtml(w.name), 'wpt'), interactive: false }));
  courseLayer.addTo(map);
  dot.bringToFront();

  $('courseText').textContent = `${course.name}: ${km(course.total)}` +
    (course.hasEle ? `, ${Math.round(course.climbLeft[0])} m of climbing` : '') +
    (course.wpts.length ? `, ${course.wpts.length} checkpoints` : '');
  $('gpxClear').hidden = false;
  $('courseInfo').hidden = false;
  updateCourse();
}

function updateCourse() {
  if (!course) return;
  if (!lastFix) {
    $('courseStatus').textContent = 'Course loaded'; $('courseStatus').className = 'course-status';
    $('courseDone').textContent = `Total ${km(course.total)}`;
    $('courseLeft').textContent = ''; $('courseDir').textContent = ''; $('courseNext').textContent = '';
    return;
  }
  const n = nearestOnCourse(course, lastFix.lat, lastFix.lon, lastAlong);
  const tolerance = Math.max(40, lastFix.accuracy + 15);
  const onCourse = n.d <= tolerance;
  if (onCourse) lastAlong = n.along;
  const st = $('courseStatus');
  st.textContent = onCourse ? 'On course ✓' : `⚠ ${Math.round(n.d)} m off course`;
  st.className = 'course-status ' + (onCourse ? 'ok' : 'off');
  $('courseDir').textContent = onCourse ? '' : `Course is ${compass(n.bearing)} of you`;
  $('courseDone').textContent = `${km(n.along)} done`;
  const climb = course.hasEle ? ` · ${Math.round(course.climbLeft[n.i])} m climb left` : '';
  $('courseLeft').textContent = `${km(course.total - n.along)} to go${climb}`;
  const next = course.wpts.find(w => w.along > n.along + 20);
  $('courseNext').textContent = next ? `Next: ${next.name} in ${km(next.along - n.along)}` : '';
}

$('gpxBtn').onclick = () => $('gpxInput').click();
$('gpxInput').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const raw = parseGpx(await file.text());
    course = prepareCourse(raw); lastAlong = null;
    localStorage.setItem('course', JSON.stringify(raw));
    drawCourse();
    map.fitBounds(L.latLngBounds(course.pts.map(p => [p[0], p[1]])), { padding: [30, 30] });
    closeSheet();
  } catch (err) {
    alert('Could not load course: ' + (err.message || err));
  }
  e.target.value = '';
};
$('gpxClear').onclick = () => {
  course = null; lastAlong = null; drawCourse();
  try { localStorage.removeItem('course'); } catch {}
  $('courseText').textContent = 'No course loaded. Load the GPX file of the route.';
  $('gpxClear').hidden = true; $('courseInfo').hidden = true;
};

// ---------- Screen wake lock ----------
let wakeLock = null;
async function setWake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
$('wakeToggle').onchange = e => setWake(e.target.checked);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('wakeToggle').checked) setWake(true);
});
if (!('wakeLock' in navigator)) $('wakeToggle').disabled = true;

// ---------- Menu sheet ----------
function openSheet() { $('sheetBg').style.display = 'block'; requestAnimationFrame(() => $('sheet').classList.add('open')); }
function closeSheet() { $('sheet').classList.remove('open'); setTimeout(() => ($('sheetBg').style.display = 'none'), 200); }
$('menuBtn').onclick = openSheet;
$('closeSheet').onclick = closeSheet;
$('sheetBg').onclick = closeSheet;

// ---------- Start up (local data only, never waits on the network) ----------
try {
  const saved = localStorage.getItem('course');
  if (saved) { course = prepareCourse(JSON.parse(saved)); drawCourse(); }
} catch (err) { console.warn('Saved course unreadable', err); }
refreshOfflineStatus();
try { if (localStorage.getItem('gpsOn') === '1') startGps(); } catch {}

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) $('updateBanner').style.display = 'block';
      });
    });
  }).catch(err => console.warn('Service worker failed', err));
  $('updateBanner').onclick = () => location.reload();
}
