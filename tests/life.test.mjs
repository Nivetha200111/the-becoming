import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url), E = require('../lib/engine.cjs');
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../public/game/life-core.js', import.meta.url), 'utf8'), context);
const { presence, distance, validOffice, milestones } = context.module.exports;
const now = 1800000000000, office = { latitude: 13, longitude: 80, radius: 250 };
const fix = (overrides = {}) => ({ ...office, accuracy: 20, timestamp: now, ...overrides });

test('office entry requires a recent accurate fix and exit has hysteresis', () => {
  assert.equal(presence(office, fix(), 'unknown', now), 'office');
  assert.equal(presence(office, fix({ latitude: 13.004 }), 'office', now), 'away');
  assert.equal(presence(office, fix({ latitude: 13.002, accuracy: 60 }), 'office', now), 'office');
  assert.equal(presence(office, fix({ latitude: 13.002, accuracy: 60 }), 'away', now), 'away');
  assert.equal(presence(office, fix({ accuracy: 1500 }), 'unknown', now), 'unknown');
  assert.equal(presence(office, fix({ timestamp: now - 120001 }), 'office', now), 'unknown');
  assert.equal(presence(office, fix({ timestamp: now + 60000 }), 'office', now), 'unknown');
});
test('invalid office coordinates or fixes cannot confirm presence', () => {
  for (const bad of [null, {}, { ...office, latitude: 91 }, { ...office, longitude: 181 }, { ...office, radius: 5 }]) assert.equal(validOffice(bad), false);
  for (const bad of [{ accuracy: NaN }, { accuracy: -1 }, { latitude: Infinity }, { longitude: -181 }, { timestamp: undefined }]) assert.equal(presence(office, fix(bad), 'unknown', now), 'unknown');
  assert.equal(distance(office, office), 0);
  assert.ok(distance(office, { latitude: 14, longitude: 80 }) > 110000);
});
const claim = (s, id, xp, stat = 'BUILD') => E.award(s, { id, xp, stat, title: id, region: 'forge', unlock: 1 }, 'Finished with evidence.', '2026-10-10');
test('new claims celebrate XP, crossed stats and exact level/area/reward thresholds', () => {
  const before = E.fresh(); claim(before, 'one', 250); claim(before, 'two', 230);
  const after = structuredClone(before); claim(after, 'third', 20);
  const events = milestones(before, after, E, [{ id: 'new', name: 'New area', unlock: 2 }]);
  assert.equal(events[0].title, '+20 XP');
  assert.ok(events.some(e => e.kind === 'level' && e.title === 'Level 2 reached'));
  assert.ok(events.some(e => e.kind === 'area' && e.area === 'new'));
  assert.ok(events.some(e => e.kind === 'treasury' && e.title.startsWith('Rare')));
  assert.equal(events.some(e => e.kind === 'skill'), false); // 300 BUILD was already crossed
  const next = structuredClone(after); claim(next, 'fourth', 250);
  assert.ok(milestones(after, next, E, []).some(e => e.kind === 'skill' && e.detail.startsWith('750')));
});
test('refreshing, undoing and unchanged progress do not issue new rewards or mutate saves', () => {
  const before = E.fresh(); claim(before, 'one', 100);
  const original = JSON.stringify(before);
  assert.equal(milestones(before, structuredClone(before), E, []).length, 0);
  assert.equal(milestones(before, E.fresh(), E, []).length, 0);
  assert.equal(JSON.stringify(before), original);
});
