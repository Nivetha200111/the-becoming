// A fixed-step kinematic character motor. All distances are metres, time is seconds.
// Terrain and obstacles are supplied by the scene; this module also runs in Node tests.
export const MOTOR = Object.freeze({ step: 1 / 120, walk: 4.2, run: 6.8, acceleration: 24, braking: 32, radius: .24, gravity: 24, jump: 7.2, maxSlope: .95 });
export function footprintClear(x, z, clear, radius = MOTOR.radius) {
  if (!clear(x, z)) return false;
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; if (!clear(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return false; }
  return true;
}
export class CharacterMotor {
  constructor({ clear, ground, radius = MOTOR.radius, slope = MOTOR.maxSlope }) { this.clear = clear; this.ground = ground; this.radius = radius; this.slope = slope; this.reset(0, 0); }
  reset(x, z) { this.x = x; this.z = z; this.y = this.ground(x, z); this.vx = this.vz = this.vy = this.accumulator = this.speed = 0; this.grounded = true; this.jumpHeld = false; }
  fits(x, z) { return footprintClear(x, z, this.clear, this.radius); }
  pathClear(ax, az, bx, bz) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / .08));
    let x = ax, z = az, height = this.ground(x, z);
    for (let i = 1; i <= steps; i++) {
      const nx = ax + (bx - ax) * i / steps, nz = az + (bz - az) * i / steps;
      const nextHeight = this.ground(nx, nz), distance = Math.hypot(nx - x, nz - z);
      if (!this.fits(nx, nz) || (distance > 1e-8 && nextHeight - height > distance * (this.slope + .01))) return false;
      x = nx; z = nz; height = nextHeight;
    }
    return true;
  }
  canMove(x, z) {
    const d = Math.hypot(x - this.x, z - this.z), rise = this.ground(x, z) - this.ground(this.x, this.z);
    return this.fits(x, z) && (d < 1e-8 || rise <= d * (this.slope + .01));
  }
  move(dx, dz) {
    // Sweep at most 8 cm per slice so even thin fence cells cannot be skipped.
    const slices = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .08)); dx /= slices; dz /= slices;
    const startX = this.x, startZ = this.z;
    for (let i = 0; i < slices; i++) {
      if (this.canMove(this.x + dx, this.z + dz)) { this.x += dx; this.z += dz; continue; }
      // Resolve the largest axis first; tangent motion survives a blocked normal.
      const axes = Math.abs(dx) > Math.abs(dz) ? ['x', 'z'] : ['z', 'x'];
      for (const axis of axes) {
        const nx = this.x + (axis === 'x' ? dx : 0), nz = this.z + (axis === 'z' ? dz : 0);
        if (this.canMove(nx, nz)) { this.x = nx; this.z = nz; }
        else if (axis === 'x') this.vx = 0; else this.vz = 0;
      }
    }
    return Math.hypot(this.x - startX, this.z - startZ);
  }
  update(dt, input = {}) {
    this.accumulator += Math.max(0, Math.min(dt, .1));
    const jump = !!input.jump && !this.jumpHeld; this.jumpHeld = !!input.jump;
    if (jump && this.grounded) { this.vy = MOTOR.jump; this.grounded = false; }
    let moved = 0, elapsed = 0;
    while (this.accumulator + 1e-10 >= MOTOR.step) {
      const h = MOTOR.step; this.accumulator -= h; elapsed += h;
      let ix = input.x || 0, iz = input.z || 0, len = Math.hypot(ix, iz);
      if (len > 1) { ix /= len; iz /= len; }
      const max = input.speed ?? (input.run ? MOTOR.run : MOTOR.walk);
      let speed = max;
      if (len && this.grounded) {
        const d = .2, nx = this.x + ix / len * d, nz = this.z + iz / len * d;
        const rise = (this.ground(nx, nz) - this.ground(this.x, this.z)) / d;
        speed *= 1 / Math.sqrt(1 + rise * rise); // constant speed over the surface
      }
      const tx = ix * speed, tz = iz * speed, dvx = tx - this.vx, dvz = tz - this.vz, change = Math.hypot(dvx, dvz);
      const force = len ? MOTOR.acceleration : MOTOR.braking, k = change ? Math.min(1, force * h / change) : 1;
      this.vx += dvx * k; this.vz += dvz * k;
      const limit = input.distance == null ? Infinity : Math.max(0, input.distance - moved);
      const distance = Math.hypot(this.vx, this.vz) * h, ratio = distance ? Math.min(1, limit / distance) : 1;
      moved += this.move(this.vx * h * ratio, this.vz * h * ratio);
      const floor = this.ground(this.x, this.z);
      if (this.grounded && this.y - floor > .24) { this.grounded = false; this.vy = 0; }
      if (this.grounded) this.y = floor;
      else { this.vy -= MOTOR.gravity * h; this.y += this.vy * h; if (this.y <= floor) { this.y = floor; this.vy = 0; this.grounded = true; } }
    }
    if (elapsed) this.speed = moved / elapsed;
    return this;
  }
}
