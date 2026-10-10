import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  await mkdir('outputs', { recursive: true });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('nivetha-becoming-v1', JSON.stringify({ version: 1, entries: [], custom: [], purchases: [], rewards: [], equipped: 'sage', mode: 'normal', position: { x: 555, y: 380 }, seenIntro: true })));
    await page.goto('http://127.0.0.1:3000/api/game');
    await page.waitForFunction(() => window.world3d);
    await page.evaluate(() => { world3d.setHour(12); world3d.cam.dist = 4.5; world3d.cam.pitch = .3; world3d.cam.intro = 0; world3d.doEmote('sit'); });
    await page.waitForTimeout(1700);
    const seated = await page.evaluate(() => {
      const w = world3d, p = w.player; p.root.updateMatrixWorld(true);
      const local = bone => p.root.worldToLocal(bone.getWorldPosition(new w.THREE.Vector3())).toArray();
      return { knees: p.knees.map(local), feet: p.ankles.map(local), by: p.body.position.y };
    });
    assert.ok(seated.knees[0][0] < -.3 && seated.knees[1][0] > .3, 'knees open outward');
    assert.ok(seated.feet[0][0] > 0 && seated.feet[1][0] < 0, 'ankles cross');
    assert.ok(seated.feet.every(f => f[1] > .12), 'boots stay above the floor');
    await page.screenshot({ path: `outputs/cross-legged-${reducedMotion}.png` });
    await page.evaluate(() => world3d.doEmote('pet'));
    await page.waitForFunction(() => world3d.activity()?.contact > .95, null, { timeout: 15000 });
    await page.waitForTimeout(2000);
    const cuddling = await page.evaluate(() => {
      const w = world3d, a = w.activity(), p = w.player, v = w.veer;
      p.root.updateMatrixWorld(true); v.root.updateMatrixWorld(true);
      return { contact: a.contact, gaps: a.handGaps, heading: a.heading, playerYaw: p.yaw, veerYaw: v.yaw,
        hands: p.hands.map((h, i) => h.getWorldPosition(new w.THREE.Vector3()).distanceTo(new w.THREE.Vector3().fromArray(a.contactTargets[i]))),
        separation: p.root.position.distanceTo(v.root.position), playerPosition: p.root.position.toArray() };
    });
    console.log(reducedMotion, JSON.stringify({ seated, cuddling }));
    assert.ok(cuddling.gaps.every(g => g < .04), 'both hands can reach Veer');
    assert.ok(cuddling.hands.every(g => g < .075), 'hands actually contact the head');
    assert.ok(cuddling.separation >= 1.14 && cuddling.separation < 1.5, 'bodies stay apart while within reach');
    const yaw = cuddling.playerYaw;
    await page.waitForTimeout(1600);
    assert.ok(Math.abs(await page.evaluate(() => world3d.player.yaw) - yaw) < .02, 'cuddling does not spin');
    await page.screenshot({ path: `outputs/cuddling-veer-${reducedMotion}.png` });
    await page.evaluate(() => world3d.doEmote('pet', 'mochi'));
    await page.waitForFunction(() => world3d.activity()?.contact > .95, null, { timeout: 15000 });
    await page.waitForTimeout(2000);
    const mochi = await page.evaluate(() => {
      const w = world3d, p = w.player, a = w.activity(); p.root.updateMatrixWorld(true);
      return { gaps: a.handGaps, feet: p.ankles.map(ankle => { const s = ankle.localToWorld(new w.THREE.Vector3(0, -.128, .03)); return s.y - w.motor.ground(s.x, s.z); }) };
    });
    assert.ok(mochi.gaps.every(g => g < .05), 'Mochi stays within reach too');
    assert.ok(mochi.feet.every(h => h > -.005), 'leaning towards Mochi keeps boots above the ground');
    await page.screenshot({ path: `outputs/petting-mochi-${reducedMotion}.png` });
    await page.locator('#map').focus(); await page.keyboard.down('ArrowDown'); await page.waitForTimeout(1000); await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => world3d.activity()?.id === 'pet'), false, 'walking releases the cuddle');
    assert.ok(await page.evaluate(() => world3d.player.body.position.y > -.05), 'standing restores the rig');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: crossed legs, grounded boots, Veer and Mochi contact, stable cuddle, walk-away, and both motion preferences.');
} finally { await browser.close(); }
