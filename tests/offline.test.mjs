// End-to-end check in a real browser: GPS dot, course, offline download,
// then a full reload with the internet switched off.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2] || '.';
const server = spawn(process.execPath, ['tools/serve.mjs', '8091']);
await new Promise(r => server.stdout.once('data', r));
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ['geolocation'], geolocation: { latitude: -18.2935, longitude: 32.8335, accuracy: 8 },
});
const page = await ctx.newPage();
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`); if (!ok) process.exitCode = 1; };
const text = id => page.locator('#' + id).innerText();

await page.goto('http://localhost:8091/');
await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready);
await page.click('#locateBtn');
await page.waitForFunction(() => document.getElementById('gpsSub').textContent.includes('±'));
check('GPS dot shows position', true, await text('gpsSub'));

await page.click('#menuBtn');
await page.setInputFiles('#gpxInput', 'tests/test-course.gpx');
await page.waitForSelector('#courseInfo:not([hidden])');
await page.waitForTimeout(500);
const status = await text('courseStatus');
check('On course near CP1', status.includes('On course'), `${status} | ${await text('courseDone')} | ${await text('courseLeft')} | ${await text('courseNext')}`);

await ctx.setGeolocation({ latitude: -18.2900, longitude: 32.8400, accuracy: 8 });
await page.waitForFunction(() => document.getElementById('courseStatus').textContent.includes('off course'));
check('Off-course warning', true, `${await text('courseStatus')} | ${await text('courseDir')}`);
await ctx.setGeolocation({ latitude: -18.2935, longitude: 32.8335, accuracy: 8 });

await page.click('#menuBtn');
await page.click('#dlBtn');
await page.waitForFunction(() => document.getElementById('dlText').textContent.includes('saved on this phone') ||
  document.getElementById('dlText').textContent.includes('did not'), null, { timeout: 120000 });
check('Map download', (await text('dlText')).includes('saved on this phone'), await text('dlText'));
await page.click('#closeSheet');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/online.png` });

// Internet off, fully reload, and zoom around.
await ctx.setOffline(true);
await page.reload();
await page.waitForTimeout(2500);
const tilesOk = await page.evaluate(() => [...document.querySelectorAll('.leaflet-tile')].filter(i => i.complete && i.naturalWidth > 0).length);
check('Offline reload shows map tiles', tilesOk > 4, `${tilesOk} tiles drawn`);
check('Offline: course still loaded', (await text('courseStatus')).length > 1, await text('courseStatus'));
check('Offline: saved chip', (await text('offlineChip')).includes('Saved'), await text('offlineChip'));
await page.evaluate(() => { map.setView([-18.395, 32.835], 17); });
await page.waitForTimeout(1500);
const broken = await page.evaluate(() => [...document.querySelectorAll('.leaflet-tile')].filter(i => i.complete && i.naturalWidth === 0).length);
check('Offline zoomed-in tiles all present', broken === 0, `${broken} missing`);
await page.screenshot({ path: `${out}/offline-z17.png` });
await page.evaluate(() => { map.setView([-18.27, 32.80], 13); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/offline-z13.png` });
check('No console errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.kill();
