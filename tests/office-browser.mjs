// Synthetic office only; no real location or external bot calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('nivetha-becoming-v1')) localStorage.setItem('nivetha-becoming-v1', JSON.stringify({ version: 1, entries: [], custom: [], purchases: [], rewards: [], equipped: 'sage', mode: 'normal', position: { x: 555, y: 380 }, seenIntro: true }));
    if (!localStorage.getItem('becoming-life-sync-device-v1')) localStorage.setItem('becoming-life-sync-device-v1', JSON.stringify({ office: { latitude: 11, longitude: 79, radius: 250 }, enabled: true, presetVersion: 'old-office' }));
    Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'granted' }) } });
    window.__watched = 0;
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition() { window.__watched++; return 42; }, clearWatch() {},
    } });
  });
  let preset = { id: 'synthetic-office-v1', name: 'Test office', office: { latitude: 13, longitude: 80, radius: 250 } };
  await page.route('**/api/office', async r => { await new Promise(resolve => setTimeout(resolve, 200)); await r.fulfill({ json: { preset } }); });
  await page.route('**/api/chat**', r => r.fulfill({ json: { messages: [], local: true } }));
  const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('becoming-life-sync-device-v1')));
  await page.goto('http://127.0.0.1:3000/api/game');
  await page.waitForFunction(() => document.querySelector('#lifePlace')?.textContent.includes('Test office'));
  assert.equal(await page.evaluate(() => window.__watched), 0);
  assert.deepEqual((await settings()).office, preset.office);
  await page.locator('#lifeSettings').click();
  assert.equal(await page.locator('#toggleLife').isEnabled(), true);
  await page.locator('#toggleLife').click();
  assert.equal(await page.evaluate(() => window.__watched), 1);
  await page.locator('#forgetOffice').click();
  await page.reload();
  await page.waitForFunction(() => window.LifeSync);
  await page.locator('#lifeSettings').click();
  await page.locator('#savedOffice').waitFor({ state: 'visible' });
  assert.equal((await settings()).office, null);
  assert.equal(await page.locator('#toggleLife').isEnabled(), false);
  assert.equal(await page.evaluate(() => window.__watched), 0);
  await page.locator('#savedOffice').click();
  assert.deepEqual((await settings()).office, preset.office);
  await page.locator('.office-coordinate-entry summary').click();
  await page.locator('#officeLat').fill('14'); await page.locator('#officeLon').fill('81');
  await page.locator('#officeCoordinates button').click();
  await page.reload();
  await page.waitForFunction(() => window.LifeSync);
  await page.locator('#lifeSettings').click(); await page.locator('#savedOffice').waitFor({ state: 'visible' });
  assert.equal((await settings()).office.latitude, 14);
  // A newly supplied private pin replaces an old pin once, without starting GPS.
  preset = { ...preset, id: 'synthetic-office-v2', office: { latitude: 15, longitude: 82, radius: 250 } };
  await page.reload();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('becoming-life-sync-device-v1'))?.presetVersion === 'synthetic-office-v2');
  assert.deepEqual((await settings()).office, preset.office);
  assert.equal((await settings()).enabled, false);
  assert.equal(await page.evaluate(() => window.__watched), 0);
  assert.deepEqual(errors, []);
  console.log('Saved office: automatic pin, explicit GPS consent, forget, restore and manual override passed.');
} finally { await browser.close(); }
