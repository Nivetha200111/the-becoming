// Isolated synthetic progress. No real bot messages or GPS.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
await mkdir('outputs', { recursive: true });
async function setup(options) {
  const page = await browser.newPage(options), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('nivetha-becoming-v1', JSON.stringify({ version: 1, entries: [], custom: [], purchases: [], rewards: [], equipped: 'sage', mode: 'normal', position: { x: 555, y: 380 }, seenIntro: true })));
  await page.route('**/api/office', r => r.fulfill({ json: { preset: null } }));
  await page.route('**/api/chat**', r => r.fulfill({ json: { relay: true, local: false, messages: [] } }));
  await page.goto('http://127.0.0.1:3000/api/game');
  await page.waitForFunction(() => window.world3d && !document.querySelector('#touchJump').disabled);
  await page.evaluate(() => { world3d.cam.yaw = 0; world3d.cam.pitch = .3; world3d.cam.dist = 6; world3d.cam.intro = 0; world3d.setHour(12); });
  return { page, errors };
}
async function clearLane(page) {
  await page.evaluate(() => {
    const w = world3d, m = w.motor;
    for (let ly = 100; ly < 620; ly += 12) for (let lx = 100; lx < 930; lx += 12) {
      const [x, z] = w.toW(lx, ly);
      if (m.pathClear(x, z, x + 10, z) && Math.abs(m.ground(x, z) - m.ground(x + 10, z)) < .2) {
        state.position = { x: lx, y: ly }; w.cam.yaw = 0; return;
      }
    }
    throw Error('No clear test lane');
  });
  await page.waitForTimeout(100);
}
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const { page, errors } = await setup({ viewport: { width: 1440, height: 960 }, reducedMotion });
    await clearLane(page); await page.locator('#map').focus();
    await page.keyboard.down('d'); await page.waitForTimeout(450);
    const walk = await page.evaluate(() => world3d.motor.speed);
    await page.keyboard.up('d'); await page.waitForTimeout(250);
    await clearLane(page); await page.locator('#map').focus();
    await page.keyboard.down('Shift'); await page.keyboard.down('d'); await page.waitForTimeout(500);
    const run = await page.evaluate(() => ({ speed: world3d.motor.speed, blend: world3d.player.runBlend, elbow: world3d.player.elbows[1].rotation.x }));
    assert.ok(run.speed > walk * 1.3, JSON.stringify({ walk, run }));
    assert.ok(run.blend > .65 && run.elbow < -.6, 'running bends elbows and has a distinct stride: ' + JSON.stringify(run));
    await page.screenshot({ path: `outputs/running-${reducedMotion}.png` });
    await page.keyboard.down(' ');
    await page.waitForFunction(() => !world3d.motor.grounded && world3d.motor.y - world3d.motor.ground(world3d.motor.x, world3d.motor.z) > .75 && world3d.player.airBlend > .85);
    const air = await page.evaluate(() => ({ blend: world3d.player.airBlend, knee: world3d.player.knees[0].rotation.x }));
    assert.ok(air.blend > .8 && air.knee > .7, 'jump folds the legs, rather than walking in midair');
    await page.screenshot({ path: `outputs/jumping-${reducedMotion}.png` });
    await page.keyboard.up('d'); await page.keyboard.up('Shift');
    await page.waitForFunction(() => world3d.motor.grounded && world3d.player.landing > .1);
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => world3d.motor.grounded), true, 'held Space does not repeat jumps');
    await page.keyboard.up(' ');
    const feet = await page.evaluate(() => {
      const w = world3d; w.player.root.updateMatrixWorld(true);
      return w.player.ankles.map(ankle => { const sole = ankle.localToWorld(new w.THREE.Vector3(0, -.128, .03)); return sole.y - w.motor.ground(sole.x, sole.z); });
    });
    assert.ok(feet.every(h => h >= -.006), 'landing keeps boots above terrain');
    // Typing movement keys in chat must not move the avatar.
    await page.locator('#chatText').fill('wasd running jump ');
    const before = await page.evaluate(() => ({ ...state.position }));
    await page.locator('#chatText').press('Space'); await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => state.position), before);
    assert.deepEqual(errors, []); await page.close();
  }
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    const { page, errors } = await setup({ viewport, hasTouch: true, isMobile: viewport.width < 600, reducedMotion: 'reduce' });
    await clearLane(page); await page.locator('.world-frame').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#touchJoystick').isVisible(), true);
    const frame = await page.locator('.world-frame').boundingBox();
    for (const id of ['touchJoystick', 'touchRun', 'touchJump', 'touchEnter']) {
      const b = await page.locator('#' + id).boundingBox();
      assert.ok(b.width >= 52 && b.height >= 52, 'thumb targets are large');
      assert.ok(b.x >= frame.x && b.x + b.width <= frame.x + frame.width && b.y >= frame.y && b.y + b.height <= frame.y + frame.height, `${id} stays within the world`);
    }
    const cdp = await page.context().newCDPSession(page);
    const stick = await page.locator('#touchJoystick').boundingBox(), run = await page.locator('#touchRun').boundingBox(), jump = await page.locator('#touchJump').boundingBox();
    const point = (id, x, y) => ({ id, x, y, radiusX: 8, radiusY: 8, force: 1 });
    const centre = point(1, stick.x + stick.width / 2, stick.y + stick.height / 2);
    const steer = { ...centre, x: centre.x + stick.width * .4 };
    const tapRun = point(2, run.x + run.width / 2, run.y + run.height / 2);
    const tapJump = point(2, jump.x + jump.width / 2, jump.y + jump.height / 2);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await touch('touchStart', [centre]); await touch('touchMove', [steer]); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => MovementInput.x > .9 && world3d.motor.speed > 2), 'drag steers');
    await touch('touchStart', [steer, tapRun]); await touch('touchEnd', [tapRun]); await page.waitForTimeout(500);
    assert.equal(await page.locator('#touchRun').getAttribute('aria-pressed'), 'true');
    assert.ok(await page.evaluate(() => world3d.motor.speed > 5), 'a second thumb toggles running while steering');
    await touch('touchStart', [steer, tapJump]);
    await page.waitForFunction(() => !world3d.motor.grounded);
    assert.ok(await page.evaluate(() => MovementInput.x > .9), 'jump does not release steering');
    await page.screenshot({ path: `outputs/touch-jump-${viewport.width}.png` });
    await touch('touchEnd', [tapJump]); await touch('touchEnd', []); await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => MovementInput.x), 0);
    assert.ok(await page.evaluate(() => world3d.motor.speed < .1), 'finger release brakes');
    await page.waitForFunction(() => world3d.motor.grounded);
    await touch('touchStart', [tapJump]); await touch('touchEnd', []);
    await page.waitForFunction(() => !world3d.motor.grounded);
    await page.waitForFunction(() => world3d.motor.grounded);
    await touch('touchStart', [centre]); await touch('touchMove', [steer]); await touch('touchCancel', []); await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => MovementInput.x), 0);
    await touch('touchStart', [centre]); await touch('touchMove', [steer]);
    await page.evaluate(() => LifeSync.open()); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => MovementInput.x), 0);
    assert.equal(await page.locator('#touchRun').getAttribute('aria-pressed'), 'false');
    await touch('touchEnd', []); await page.locator('#closeModal').click();
    await page.screenshot({ path: `outputs/touch-controls-${viewport.width}.png` });
    await page.locator('#fullscreen').click(); await page.waitForTimeout(250);
    assert.equal(await page.locator('.companion-dock').evaluate(el => el.classList.contains('minimized')), true);
    const immersive = await page.locator('.world-frame').boundingBox(), jb = await page.locator('#touchJoystick').boundingBox();
    assert.ok(jb.y >= immersive.y && jb.y + jb.height <= immersive.y + immersive.height, 'fullscreen keeps the joystick reachable');
    await page.screenshot({ path: `outputs/touch-fullscreen-${viewport.width}.png` });
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS: keyboard running/jumping, distinct poses, landing, both motion preferences, multitouch running jumps, release/cancel/menu reset, phone/tablet/fullscreen layout.');
} finally { await browser.close(); }
