import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CharacterMotor, footprintClear } from '../public/game/physics.js';
const make = (clear = () => true, ground = () => 0) => new CharacterMotor({ clear, ground });
test('movement covers the same distance at 30, 60 and 144 FPS', () => {
  const positions = [30, 60, 144].map(fps => { const m = make(); for (let i = 0; i < fps * 3; i++) m.update(1 / fps, { x: 1 }); return m.x; });
  assert.ok(Math.max(...positions) - Math.min(...positions) < .00001);
});
test('starts with acceleration, brakes promptly and normalises diagonals', () => {
  const a = make(), b = make(); a.update(1 / 60, { x: 1 }); assert.ok(a.vx > 0 && a.vx < 4.2);
  a.reset(0, 0); for (let i = 0; i < 120; i++) { a.update(1 / 120, { x: 1 }); b.update(1 / 120, { x: 1, z: 1 }); }
  assert.ok(Math.abs(a.x - Math.hypot(b.x, b.z)) < .001);
  const start = a.x; for (let i = 0; i < 30; i++) a.update(1 / 120); assert.equal(a.vx, 0); assert.ok(a.x - start < .3);
});
test('sweeps thin walls without tunnelling and slides along their tangent', () => {
  const m = make((x) => x < 1 || x > 1.05); m.vx = 100; m.move(5, 1);
  assert.ok(m.x < .77); assert.ok(m.z > .5); assert.equal(m.vx, 0);
});
test('the whole body footprint keeps its distance from furniture and shorelines', () => {
  assert.equal(footprintClear(.8, 0, x => x < 1, .3), false);
  assert.equal(footprintClear(.6, 0, x => x < 1, .3), true);
});
test('steep climbs are blocked; ordinary slopes stay grounded', () => {
  const cliff = make(() => true, x => Math.max(0, x) * 2);
  for (let i = 0; i < 120; i++) cliff.update(1 / 120, { x: 1 }); assert.ok(cliff.x < .1);
  const hill = make(() => true, x => x * .3);
  for (let i = 0; i < 120; i++) hill.update(1 / 120, { x: 1 }); assert.ok(hill.x > 3); assert.equal(hill.y, hill.x * .3);
});
test('jump follows gravity, lands on terrain, and holding jump does not repeat', () => {
  const m = make(); let peak = 0;
  for (let i = 0; i < 180; i++) { m.update(1 / 120, { jump: true }); peak = Math.max(peak, m.y); }
  assert.ok(peak > .9 && peak < 1.2); assert.equal(m.grounded, true); assert.equal(m.y, 0);
  m.update(1 / 120, { jump: false }); m.update(1 / 120, { jump: true }); assert.equal(m.grounded, false);
});
