// Run with PLAYWRIGHT_MODULE_PATH set to a local Playwright package; uses isolated synthetic data only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
await mkdir('outputs', { recursive: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('nivetha-becoming-v1', JSON.stringify({ version: 1, entries: [], custom: [], purchases: [], rewards: [], equipped: 'sage', mode: 'normal', position: { x: 555, y: 380 }, seenIntro: true }));
  window.__gps = { success: null, cleared: 0 };
  Object.defineProperty(navigator, 'geolocation', { value: {
    watchPosition(success) { window.__gps.success = success; return 42; },
    clearWatch() { window.__gps.cleared++; window.__gps.success = null; },
    getCurrentPosition(success) { success({ coords: { latitude: 13, longitude: 80, accuracy: 10 }, timestamp: Date.now() }); },
  } });
});
const mailbox = new Map(); let failOnce = false, posts = [];
await page.route('**/api/chat**', async route => {
  const req = route.request(), url = new URL(req.url());
  if (req.method() === 'POST') {
    const body = req.postDataJSON(); posts.push(body);
    if (failOnce) { failOnce = false; await route.fulfill({ status: 502, json: { error: 'Synthetic delivery failure' } }); return; }
    const key = `chat:${body.bot}:${body.id}`, rows = mailbox.get(body.bot) || [];
    if (!rows.some(r => r.key === key)) rows.push({ key, role: 'user', content: body.text });
    mailbox.set(body.bot, rows);
    await new Promise(r => setTimeout(r, 300));
    await route.fulfill({ json: { key, delivered: true } });
  } else if (url.searchParams.has('bot')) await route.fulfill({ json: { messages: mailbox.get(url.searchParams.get('bot')) || [] } });
  else await route.fulfill({ json: { relay: true, local: false } });
});
await page.goto('http://127.0.0.1:3000/api/game');
await page.waitForFunction(() => window.WorldTravel && window.world3d);
await page.locator('#chatText').fill('Help me choose one thing.');
await page.locator('.chat-compose button').click();
await page.locator('.chat-message.user').filter({ hasText: 'Help me choose' }).waitFor();
await page.locator('.chat-thinking').waitFor();
assert.equal(await page.locator('dialog.bot-chat').count(), 0);
await page.locator('#chatText').fill('A draft for Grok.');
await page.locator('#chatBot').selectOption('jane');
await page.locator('#chatText').fill('Jane draft.');
await page.locator('#chatBot').selectOption('grok');
assert.equal(await page.locator('#chatText').inputValue(), 'A draft for Grok.');
const first = posts[0];
mailbox.get('grok').push({ key: `chat:grok:${first.id}`, role: 'assistant', content: '<script>not executable</script> Focus on one meaningful thing.' });
await page.locator('.chat-message.assistant').waitFor({ timeout: 20000 });
assert.equal(await page.locator('.chat-thinking').count(), 0);
assert.equal(await page.locator('.chat-message.assistant script').count(), 0);
// Expanded history no longer pauses movement.
await page.locator('#map').focus();
const before = await page.evaluate(() => ({ ...state.position }));
await page.keyboard.down('ArrowDown'); await page.waitForTimeout(500); await page.keyboard.up('ArrowDown');
assert.notDeepEqual(await page.evaluate(() => ({ ...state.position })), before);
// Safe retry reuses the UUID and does not swallow a newer draft.
failOnce = true;
await page.locator('#chatText').fill('Retry this safely.'); await page.locator('.chat-compose button').click();
await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
await page.locator('#chatText').fill('A newer draft.');
await page.getByRole('button', { name: 'Retry', exact: true }).click();
await page.waitForFunction(() => document.querySelector('.chat-status').textContent.includes('Delivered'));
assert.equal(posts.at(-1).id, posts.at(-2).id);
assert.equal(await page.locator('#chatText').inputValue(), 'A newer draft.');
// Inline claims retain all evidence requirements and reject duplicate rewards.
await page.locator('#chatQuests').click();
await page.locator('.chat-quests summary').first().click();
const claim = page.locator('.chat-quests form').first();
await claim.locator('textarea').fill('Finished a synthetic focus block and recorded its output.');
for (const c of await claim.locator('[type=checkbox]').all()) await c.check();
await claim.locator('[type=submit]').click();
assert.equal(await page.evaluate(() => state.entries.length), 1);
await page.locator('.reward-float.xp').waitFor();
// Pin + explicit consent + GPS entry. Updates must not pull her back after she explores.
await page.locator('#lifeSettings').click();
await page.locator('#pinOffice').click();
await page.locator('#toggleLife').click();
await page.evaluate(() => window.__gps.success({ coords: { latitude: 13, longitude: 80, accuracy: 10 }, timestamp: Date.now() }));
assert.equal(await page.evaluate(() => WorldTravel.current()), 'office');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'outputs/office-desktop.png' });
assert.equal(await page.evaluate(() => world3d.motor.fits(...world3d.toW(state.position.x, state.position.y).map((x, i) => x + world3d.currentRealm().R.at[i]))), true);
await page.evaluate(() => WorldTravel.to('hollow'));
assert.equal(await page.evaluate(() => WorldTravel.current()), 'hollow');
await page.evaluate(() => window.__gps.success({ coords: { latitude: 13, longitude: 80, accuracy: 10 }, timestamp: Date.now() }));
assert.equal(await page.evaluate(() => WorldTravel.current()), 'hollow');
assert.equal(await page.evaluate(() => Object.keys(state).includes('office')), false);
await page.locator('#lifeSettings').click(); await page.locator('#forgetOffice').click();
assert.equal(await page.evaluate(() => window.__gps.success), null);
// Late callbacks after opt-out cannot re-pin or move her.
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('becoming-life-sync-device-v1')).enabled), false);
await page.locator('#closeModal').click();
// Fullscreen fallback keeps the dock and rewards in-frame, then restores it.
await page.evaluate(() => { document.querySelector('.world-frame').classList.add('immersive'); syncFull(); });
assert.equal(await page.locator('.world-frame > .companion-dock').count(), 1);
await page.evaluate(() => { document.querySelector('.world-frame').classList.remove('immersive'); syncFull(); });
assert.equal(await page.locator('#worldScreen > .companion-dock').count(), 1);
await mkdir('outputs', { recursive: true });
await page.locator('#chatQuests').click(); await page.locator('.chat-close').click();
await page.screenshot({ path: 'outputs/companion-desktop.png', fullPage: false });
await page.setViewportSize({ width: 360, height: 800 });
await page.locator('.companion-dock').scrollIntoViewIfNeeded();
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
assert.equal(await page.locator('.companion-dock').evaluate(e => getComputedStyle(e).position), 'relative');
await page.screenshot({ path: 'outputs/companion-mobile.png' });
// Pending delivery and drafts survive a reload. The mailbox remains the source of truth.
await page.reload(); await page.waitForFunction(() => window.WorldTravel);
assert.equal(await page.locator('#chatText').inputValue(), 'A newer draft.');
await page.locator('.chat-close').click();
await page.locator('.chat-thinking').waitFor();
await page.locator('#chatBot').selectOption('jane');
assert.equal(await page.locator('#chatText').inputValue(), 'Jane draft.');
await page.locator('#chatBot').selectOption('grok');
// A guide is one interaction away; it does not open a card or relocate from an overseas realm.
await page.evaluate(() => { WorldTravel.to('hollow'); botTalk(partyMember('jane')); });
assert.equal(await page.evaluate(() => WorldTravel.current()), 'hollow');
assert.equal(await page.locator('#chatBot').inputValue(), 'jane');
assert.equal(await page.locator('#modal').evaluate(e => e.open), false);
// 768px, mobile fullscreen, and normal-motion ferry travel remain usable.
await page.setViewportSize({ width: 768, height: 1024 });
await page.screenshot({ path: 'outputs/companion-tablet.png' });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
await page.setViewportSize({ width: 360, height: 800 });
await page.evaluate(() => { document.querySelector('.world-frame').classList.add('immersive'); syncFull(); });
const box = await page.locator('.companion-dock').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 360);
await page.evaluate(() => { document.querySelector('.world-frame').classList.remove('immersive'); syncFull(); });
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.evaluate(() => WorldTravel.to('office'));
await page.waitForFunction(() => WorldTravel.current() === 'office', null, { timeout: 30000 });
await page.evaluate(() => { WorldTravel.to('hollow'); });
await page.waitForFunction(() => WorldTravel.current() === 'hollow', null, { timeout: 30000 });
assert.deepEqual(errors, []);
console.log('PASS: persistent chat, real-reply matching, plain text, per-bot drafts, movement, safe retry, inline proof claims, floating XP, GPS arrival, free Hush Hollow travel, stop tracking, fullscreen and 360px layout.');
await browser.close();
