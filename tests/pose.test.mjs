import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Euler } from 'three';
import { crossLegPose, armReach } from '../public/game/pose-rig.js';

test('crossed legs open knees and put both level boots above ground', () => {
  const pose = crossLegPose();
  for (const [i, sign] of [-1, 1].entries()) {
    const q = prefix => new Quaternion().setFromEuler(new Euler(...['x', 'y', 'z'].map(a => pose[`${prefix}${i}${a}`])));
    const hip = new Vector3(sign * .085, .86 + pose.by, 0), thigh = q('l');
    const knee = hip.clone().add(new Vector3(0, -.36, 0).applyQuaternion(thigh));
    const shin = thigh.clone().multiply(q('k'));
    const ankle = knee.clone().add(new Vector3(0, -.4, 0).applyQuaternion(shin));
    assert.ok(knee.x * sign > .3);
    assert.ok(ankle.x * sign < 0);
    assert.ok(ankle.y > .128, 'boot sole clears the ground');
    assert.ok(shin.multiply(q('f')).angleTo(new Quaternion()) < 1e-6, 'sole is level');
  }
});
test('arm reach places a hand on a reachable target without changing limb lengths', () => {
  for (const target of [new Vector3(.08, -.25, .25), new Vector3(.4, 0, 0), new Vector3(0, -.4, 0)]) {
    const r = armReach(new Vector3(), target, new Vector3(1, 0, 0));
    const elbow = new Vector3(0, -.23, 0).applyQuaternion(r.upper);
    const hand = elbow.clone().add(new Vector3(0, -.22, 0).applyQuaternion(r.upper.clone().multiply(r.lower)));
    assert.ok(hand.distanceTo(target) < 1e-6);
    assert.ok(Math.abs(elbow.length() - .23) < 1e-6);
    assert.ok(Math.abs(hand.distanceTo(elbow) - .22) < 1e-6);
  }
});
test('unreachable hand targets report a gap and zero-distance targets are harmless', () => {
  const r = armReach(new Vector3(), new Vector3(0, 0, 2), new Vector3(1, 0, 0));
  assert.ok(r.gap > 1.5);
  assert.equal(armReach(new Vector3(), new Vector3(), new Vector3(1, 0, 0)), null);
});
