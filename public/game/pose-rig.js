import { Vector3, Quaternion, Euler } from 'three';

const down = new Vector3(0, -1, 0);
const rotation = q => new Euler().setFromQuaternion(q);

// Knees open outwards; each shin crosses towards the opposite ankle.
// Targets are in character space, so both feet remain above the floor.
export function crossLegPose() {
  const pose = { by: -.67, bx: 0, a0x: -.48, a1x: -.48, a0z: -.36, a1z: .36, e0x: -.35, e1x: -.35, cx: .12, cy: .67, skirt: 1 };
  for (const [i, sign] of [-1, 1].entries()) {
    const hip = new Vector3(sign * .085, .19, 0);
    const knee = new Vector3(sign * .35, .14, .23);
    const ankle = new Vector3(-sign * .055, i ? .14 : .18, i ? .06 : .16);
    const upper = new Quaternion().setFromUnitVectors(down, knee.clone().sub(hip).normalize());
    const lower = new Quaternion().setFromUnitVectors(down, ankle.sub(knee).normalize().applyQuaternion(upper.clone().invert()));
    const foot = upper.clone().multiply(lower).invert();
    for (const [prefix, q] of [['l', upper], ['k', lower], ['f', foot]]) {
      const r = rotation(q);
      for (const axis of ['x', 'y', 'z']) pose[`${prefix}${i}${axis}`] = r[axis];
    }
  }
  return pose;
}

// A two-segment arm reaches a real surface instead of waving near the animal.
// An outward elbow hint keeps the bend away from the chest.
export function armReach(shoulder, target, hint, upperLength = .23, lowerLength = .22) {
  const line = target.clone().sub(shoulder), distance = line.length();
  if (distance < .001) return null;
  const reach = Math.min(upperLength + lowerLength - .002, Math.max(Math.abs(upperLength - lowerLength) + .002, distance));
  line.normalize();
  const bend = hint.clone().sub(shoulder).addScaledVector(line, -hint.clone().sub(shoulder).dot(line));
  if (bend.lengthSq() < .00001) {
    bend.set(0, Math.abs(line.y) < .9 ? 1 : 0, Math.abs(line.y) < .9 ? 0 : 1);
    bend.addScaledVector(line, -bend.dot(line));
  }
  bend.normalize();
  const along = (upperLength ** 2 + reach ** 2 - lowerLength ** 2) / (2 * reach);
  const elbow = shoulder.clone().addScaledVector(line, along).addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
  const end = shoulder.clone().addScaledVector(line, reach);
  const upper = new Quaternion().setFromUnitVectors(down, elbow.clone().sub(shoulder).normalize());
  const lower = new Quaternion().setFromUnitVectors(down, end.sub(elbow).normalize().applyQuaternion(upper.clone().invert()));
  return { upper, lower, gap: Math.max(0, distance - reach) };
}
