import { OUTFITS, outfitLook } from './outfits.js';
import { CharacterMotor, footprintClear, MOTOR } from './physics.js';
// The Becoming · 3D world (three.js)
// Progressive enhancement over app.js's 2D map. Quests, saves, travel, keyboard movement and dialogs stay in
// app.js/party.js on the 1100×720 logical map; this module draws that map as a 3D island, maps pointer input
// back onto logical coordinates and adds collision. Without WebGL2 the original 2D canvas keeps working.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ───────────────────────────── helpers ─────────────────────────────
const SCALE = 0.08;                       // metres per logical unit; walk speed relative to app.js
const toW = (lx, ly) => [(lx - 550) * SCALE, (ly - 360) * SCALE];
const toL = (x, z) => [x / SCALE + 550, z / SCALE + 360];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerpAngle = (a, b, t) => a + (((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * t;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function rng32(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const PERM = new Uint8Array(512);
{ const r = rng32(1337), p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
function noise2(x, y) {
  const F = 0.366025404, G = 0.211324865, s = (x + y) * F, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G;
  const x0 = x - i + t, y0 = y - j + t, i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1, x1 = x0 - i1 + G, y1 = y0 - j1 + G, x2 = x0 - 1 + 2 * G, y2 = y0 - 1 + 2 * G, ii = i & 255, jj = j & 255;
  let n = 0, a;
  if ((a = 0.5 - x0 * x0 - y0 * y0) > 0) { const g = GRAD[PERM[ii + PERM[jj]] & 7]; a *= a; n += a * a * (g[0] * x0 + g[1] * y0); }
  if ((a = 0.5 - x1 * x1 - y1 * y1) > 0) { const g = GRAD[PERM[ii + i1 + PERM[jj + j1]] & 7]; a *= a; n += a * a * (g[0] * x1 + g[1] * y1); }
  if ((a = 0.5 - x2 * x2 - y2 * y2) > 0) { const g = GRAD[PERM[ii + 1 + PERM[jj + 1]] & 7]; a *= a; n += a * a * (g[0] * x2 + g[1] * y2); }
  return 70 * n;
}
function fbm(x, y, oct = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; } return v; }

// Quality tiers keep phones comfortable; resolution also adapts to the measured frame rate.
const touch = matchMedia('(pointer:coarse)').matches, shortSide = Math.min(window.screen.width, window.screen.height);
const Q = [
  { grass: 26000, flowers: 1100, trees: 60, bushes: 50, grid: [176, 128], shadow: 1024, msaa: 0, pr: 1.5, blob: 1, bloom: false },
  { grass: 52000, flowers: 2000, trees: 75, bushes: 70, grid: [224, 160], shadow: 2048, msaa: 0, pr: 1.5, blob: 1, bloom: true },
  { grass: 95000, flowers: 3600, trees: 92, bushes: 95, grid: [288, 208], shadow: 2048, msaa: 2, pr: 1.5, blob: 2, bloom: true },
][touch ? (shortSide < 600 ? 0 : 1) : 2];

// Tileable fbm baked once: r = clouds, gb = ripple gradient, a = a second independent fbm. Far cheaper than per-pixel noise.
function noiseTexture(size = 256) {
  const field = seed => {
    const out = new Float32Array(size * size);
    const h = (x, y, o) => { let n = Math.imul(x * 374761393 + y * 668265263 + o * 2147483647 + seed * 1442695041, 1274126177); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
    for (let o = 0, amp = .5, freq = 4; o < 5; o++, amp *= .5, freq *= 2) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * freq, fy = y / size * freq, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = h(ix % freq, iy % freq, o), b = h((ix + 1) % freq, iy % freq, o), c = h(ix % freq, (iy + 1) % freq, o), d = h((ix + 1) % freq, (iy + 1) % freq, o);
      out[y * size + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
    }
    return out;
  };
  const f1 = field(1), f2 = field(7), data = new Uint8Array(size * size * 4), at = (x, y) => f1[((y + size) % size) * size + (x + size) % size];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    data.set([f1[i] * 255, clamp((at(x + 1, y) - at(x - 1, y)) * 6 + .5, 0, 1) * 255, clamp((at(x, y + 1) - at(x, y - 1)) * 6 + .5, 0, 1) * 255, f2[i] * 255], i * 4);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
const GLSL_NOISE = `
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y);}
float fbm5(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){v+=a*vnoise(p);p=m*p;a*=.5;}return v;}`;
const GLSL_SKY = `
uniform vec3 uSunDir, uZenith, uHorizon, uSunColor;
vec3 skyBase(vec3 d){
  vec3 c=mix(uHorizon,uZenith,pow(clamp(d.y,0.,1.),.45));
  float sd=max(dot(d,uSunDir),0.);
  c+=uSunColor*(.10*pow(sd,3.)+.35*pow(sd,24.));
  return mix(c,uHorizon*.95,smoothstep(.02,-.25,d.y));
}`;

// Shared, animated uniforms (one object per uniform so every material sees updates).
const NOISE = { value: null };
const U = {
  time: { value: 0 }, wind: { value: reduceMotion.matches ? 0.35 : 1 }, player: { value: new THREE.Vector3() }, rim: { value: new THREE.Color('#ffe8c8').multiplyScalar(0.28) },
  sunDir: { value: new THREE.Vector3(0, 1, 0) }, zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() },
  cloudLight: { value: new THREE.Color() }, cloudShadow: { value: new THREE.Color() }, cover: { value: 0.5 },
  disc: { value: 24 }, discSize: { value: .9994 }, stars: { value: 0 },
  shallow: { value: new THREE.Color() }, deep: { value: new THREE.Color() }, light: { value: 1 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.004 },
};
const skyUniforms = () => ({ uSunDir: U.sunDir, uZenith: U.zenith, uHorizon: U.horizon, uSunColor: U.sunColor });

// ───────────────────────────── the island field ─────────────────────────────
const X0 = -64, X1 = 64, Z0 = -46, Z1 = 46, FW = X1 - X0, FD = Z1 - Z0;
const [GX, GZ] = Q.grid, CX = FW / GX, CZ = FD / GZ, NV = (GX + 1) * (GZ + 1);
const SD = new Float32Array(NV), HT = new Float32Array(NV), NY = new Float32Array(NV), PD = new Float32Array(NV), PADW = new Float32Array(NV), pathIdx = new Int8Array(NV);
function sampleGrid(arr, x, z, fallback) {
  const fx = (x - X0) / CX, fz = (z - Z0) / CZ;
  if (!(fx >= 0 && fz >= 0 && fx < GX && fz < GZ)) return fallback;
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * (GX + 1) + ix;
  return (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - tz) + (arr[i + GX + 1] * (1 - tx) + arr[i + GX + 2] * tx) * tz;
}
const heightAt = (x, z) => sampleGrid(HT, x, z, -7), sdfAt = (x, z) => sampleGrid(SD, x, z, -40);
const pathDistAt = (x, z) => sampleGrid(PD, x, z, 99), slopeAt = (x, z) => 1 - sampleGrid(NY, x, z, 1);

// Where each landmark stands (logical centre), its flattened pad radius and label height in metres.
const SITES = {
  camp: { at: [555, 352], pad: 5.8, label: 4.6 }, forge: { at: [225, 292], pad: 4.8, label: 7.6 },
  citadel: { at: [390, 122], pad: 6.2, label: 12.2 }, grove: { at: [790, 450], pad: 5.4, label: 12.5 },
  tower: { at: [715, 146], pad: 4.0, label: 18.6 }, temple: { at: [900, 250], pad: 4.8, label: 10.6 },
  lab: { at: [330, 508], pad: 4.6, label: 9.2 }, summit: { at: [950, 138], pad: 2.9, label: 6.2 },
};
const PEAK = toW(990, 92);
let coast, PADS, PATHS;

function chaikin(pts, n) { for (let k = 0; k < n; k++) { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } pts = out; } return pts; }
function polySdf(px, pz) {
  let d = 1e9, inside = false;
  for (let i = 0, j = coast.length - 1; i < coast.length; j = i++) {
    const ax = coast[j][0], az = coast[j][1], bx = coast[i][0], bz = coast[i][1], ex = bx - ax, ez = bz - az, wx = px - ax, wz = pz - az;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1), dx = wx - ex * t, dz = wz - ez * t;
    d = Math.min(d, dx * dx + dz * dz);
    if ((az > pz) !== (bz > pz) && px < ex * (pz - az) / ez + ax) inside = !inside;
  }
  return (inside ? 1 : -1) * Math.sqrt(d);
}
const coastDistance = (x, z) => polySdf(x, z) + fbm(x * .09 + 20, z * .09, 3) * 1.4;
function rawHeight(x, z, d) {
  let h = d < 0 ? Math.max(-7, d * 0.5 - 0.2) : Math.min(d * 0.24, 0.85) - 0.2;
  const land = smooth(2, 11, d);
  h += land * (1.0 + fbm(x * .04 + 11, z * .04 - 5, 4) * 2.2 + smooth(-6, -22, z) * 2.4 * (0.65 + 0.35 * fbm(x * .08, z * .08, 2)));
  const r2 = (x - PEAK[0]) ** 2 + (z - PEAK[1]) ** 2;
  h += 12.5 * Math.exp(-r2 / (2 * 3.3 * 3.3)) * (0.9 + 0.25 * fbm(x * .35, z * .35, 3)) + 3.2 * Math.exp(-r2 / 98);
  return h;
}
function pathDistance(p, x, z) {
  if (x < p.box[0] || x > p.box[1] || z < p.box[2] || z > p.box[3]) return 99;
  let best = 1e9;
  for (let k = 1; k < p.pts.length; k++) {
    const [ax, az] = p.pts[k - 1], [bx, bz] = p.pts[k], ex = bx - ax, ez = bz - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    best = Math.min(best, (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2);
  }
  return Math.sqrt(best);
}
function buildField() {
  coast = chaikin(island.map(([lx, ly]) => toW(lx, ly)), 3);
  PADS = WORLD.map(r => { const s = SITES[r.id], [x, z] = toW(...s.at); return { id: r.id, x, z, r: s.pad, blend: 3.2, h: rawHeight(x, z, coastDistance(x, z)) }; });
  const prng = rng32(42), hub = toW(555, 366);
  PATHS = WORLD.filter(r => r.id !== 'camp').map(r => {
    const [ex, ez] = toW(r.x, r.y + 32), dx = ex - hub[0], dz = ez - hub[1], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const sx = hub[0] + ux * 3.4, sz = hub[1] + uz * 3.4, bend = (prng() - .5) * .42 * len, mx = (sx + ex) / 2 - uz * bend, mz = (sz + ez) / 2 + ux * bend, pts = [];
    for (let k = 0; k <= 40; k++) { const t = k / 40, a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t; pts.push([a * sx + b * mx + c * ex, a * sz + b * mz + c * ez]); }
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    return { id: r.id, unlock: r.unlock, pts, box: [Math.min(...xs) - 3, Math.max(...xs) + 3, Math.min(...zs) - 3, Math.max(...zs) + 3] };
  });
  for (let iz = 0; iz <= GZ; iz++) for (let ix = 0; ix <= GX; ix++) {
    const i = iz * (GX + 1) + ix, x = X0 + ix * CX, z = Z0 + iz * CZ, d = coastDistance(x, z);
    let h = rawHeight(x, z, d), padw = 0, best = 99, bi = -1;
    for (const p of PADS) {
      const dd = Math.hypot(x - p.x, z - p.z), w = 1 - smooth(p.r, p.r + p.blend, dd);
      if (w > 0) { h += (p.h - h) * w; padw = Math.max(padw, 1 - smooth(p.r - 1.4, p.r + .3, dd)); }
    }
    PATHS.forEach((p, k) => { const dd = pathDistance(p, x, z); if (dd < best) { best = dd; bi = k; } });
    h -= .08 * (1 - smooth(.5, 1.3, best)) * smooth(.3, 1, d);
    SD[i] = d; HT[i] = h; PD[i] = best; pathIdx[i] = bi; PADW[i] = padw;
  }
  for (let iz = 0; iz <= GZ; iz++) for (let ix = 0; ix <= GX; ix++) {
    const i = iz * (GX + 1) + ix, row = GX + 1;
    const hl = HT[iz * row + Math.max(0, ix - 1)], hr = HT[iz * row + Math.min(GX, ix + 1)], hu = HT[Math.max(0, iz - 1) * row + ix], hd = HT[Math.min(GZ, iz + 1) * row + ix];
    const nx = (hl - hr) / (2 * CX), nz = (hu - hd) / (2 * CZ);
    NY[i] = 1 / Math.hypot(nx, 1, nz);
  }
}

// ───────────────────────────── procedural textures ─────────────────────────────
function canvasTexture(size, paint, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  paint(c.getContext('2d'), size, rng32(size + paint.length));
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
function speckle(g, s, r, n, lo, hi, a) { for (let i = 0; i < n; i++) { g.fillStyle = grey(lo + r() * (hi - lo), a); g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); } }
const TEX = {};
function makeTextures() {
  TEX.stone = canvasTexture(512, (g, s, r) => {
    g.fillStyle = '#8f897f'; g.fillRect(0, 0, s, s);
    const rows = 8, rh = s / rows;
    for (let y = 0; y < rows; y++) for (let x = -r() * 60; x < s;) {
      const w = 46 + r() * 72, v = 188 + r() * 60;
      for (const off of [0, -s]) { g.fillStyle = grey(v); g.beginPath(); g.roundRect(x + off + 3, y * rh + 3, w - 6, rh - 6, 7); g.fill(); g.fillStyle = grey(255, .18); g.fillRect(x + off + 6, y * rh + 5, w - 14, 4); }
      x += w;
    }
    speckle(g, s, r, 9000, 90, 255, .12);
  });
  TEX.roof = canvasTexture(256, (g, s, r) => {
    g.fillStyle = '#6d6d6d'; g.fillRect(0, 0, s, s);
    const th = 32, tw = 32;
    for (let row = -1; row <= s / th; row++) for (let col = -1; col <= s / tw; col++) {
      const x = col * tw + (row % 2 ? tw / 2 : 0), y = row * th, grad = g.createLinearGradient(0, y, 0, y + th + 6), v = 205 + r() * 45;
      grad.addColorStop(0, grey(v)); grad.addColorStop(.75, grey(v * .82)); grad.addColorStop(1, grey(95));
      g.fillStyle = grad; g.beginPath(); g.moveTo(x + 1, y); g.lineTo(x + tw - 1, y); g.lineTo(x + tw - 1, y + th * .7); g.quadraticCurveTo(x + tw / 2, y + th + 8, x + 1, y + th * .7); g.closePath(); g.fill();
    }
    speckle(g, s, r, 2500, 80, 255, .1);
  });
  TEX.wood = canvasTexture(256, (g, s, r) => {
    const planks = 4, pw = s / planks;
    for (let p = 0; p < planks; p++) {
      g.fillStyle = grey(175 + r() * 60); g.fillRect(p * pw, 0, pw, s);
      for (let k = 0; k < 18; k++) { g.strokeStyle = grey(r() < .5 ? 90 : 255, .14); g.lineWidth = 1 + r() * 2; g.beginPath(); const x = p * pw + r() * pw; g.moveTo(x, 0); g.bezierCurveTo(x + r() * 8 - 4, s * .3, x + r() * 8 - 4, s * .7, x, s); g.stroke(); }
      g.fillStyle = grey(60, .8); g.fillRect(p * pw, 0, 2, s);
    }
  });
  TEX.plaster = canvasTexture(256, (g, s, r) => { g.fillStyle = grey(236); g.fillRect(0, 0, s, s); speckle(g, s, r, 7000, 175, 255, .2); });
  TEX.ground = canvasTexture(256, (g, s, r) => {
    g.fillStyle = grey(232); g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) { const x = r() * s, y = r() * s, l = 2 + r() * 6; g.strokeStyle = grey(r() < .55 ? 150 : 255, .16); g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 2 - 1, y - l); g.stroke(); }
  });
}

// ───────────────────────────── materials ─────────────────────────────
const matCache = new Map();
function std(key, opts, uvScale) {
  if (!matCache.has(key)) { const m = occludable(new THREE.MeshStandardMaterial(opts)); if (uvScale) m.userData.uvScale = uvScale; matCache.set(key, m); }
  return matCache.get(key);
}
const M = {};
function makeMaterials() {
  Object.assign(M, {
    stone: std('stone', { color: '#e6dfd0', map: TEX.stone, bumpMap: TEX.stone, bumpScale: 1.4, roughness: .9 }, .42),
    stoneDark: std('stoneDark', { color: '#aba597', map: TEX.stone, bumpMap: TEX.stone, bumpScale: 1.4, roughness: .92 }, .42),
    plaster: std('plaster', { color: '#f4ecda', map: TEX.plaster, roughness: .95 }, .35),
    wood: std('wood', { color: '#a06e45', map: TEX.wood, bumpMap: TEX.wood, bumpScale: .8, roughness: .85 }, .7),
    woodDark: std('woodDark', { color: '#62402a', map: TEX.wood, roughness: .85 }, .7),
    iron: std('iron', { color: '#596065', metalness: .75, roughness: .42 }),
    gold: std('gold', { color: '#f0c565', metalness: 1, roughness: .26 }),
    dark: std('dark', { color: '#1b1511', roughness: 1 }),
    window: std('window', { color: '#3a3125', emissive: '#ffc777', emissiveIntensity: .2, roughness: .35 }),
    lantern: std('lantern', { color: '#fff1d0', emissive: '#ffb257', emissiveIntensity: 1.2 }),
    rope: std('rope', { color: '#efe2bf', roughness: 1 }),
    paper: std('paper', { color: '#ffffff', roughness: 1, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#d5f1ff', transparent: true, opacity: .26, roughness: .04, metalness: 0, envMapIntensity: 1.6, depthWrite: false }),
    pond: new THREE.MeshStandardMaterial({ color: '#2a8c8e', roughness: .05, metalness: .1, envMapIntensity: 1.4 }),
  });
}
const fabric = c => std('fabric' + c, { color: c, roughness: 1, side: THREE.DoubleSide });
const roofMat = c => std('roof' + c, { color: c, map: TEX.roof, bumpMap: TEX.roof, bumpScale: 1.8, roughness: .72, side: THREE.DoubleSide }, .62);
const glow = (c, i) => std('glow' + c + i, { color: c, emissive: c, emissiveIntensity: i });
const flatColor = c => std('flat' + c, { color: c, roughness: .8 });

// Gentle wind for anything rooted in the ground (instanced foliage, flags).
function windFoliage(mat, key, trunk = 1.1) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time; sh.uniforms.uWind = U.wind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(modelMatrix[3][0], 0., modelMatrix[3][2]);
      #endif
      float sway = max(position.y - ${trunk.toFixed(2)}, 0.) * uWind;
      transformed.x += (sin(uTime * 1.3 + ip.x * .4 + ip.z * .3) + .4 * sin(uTime * 2.9 + position.y * 2.)) * .03 * sway;
      transformed.z += cos(uTime * 1.1 + ip.z * .5 + position.x) * .022 * sway;`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// Screen-door fade for anything standing between the camera and the avatar, so she is never hidden.
function occludable(mat) {
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uPlayer = U.player;
    sh.vertexShader = 'varying vec3 vOccW;\n' + sh.vertexShader.replace('#include <project_vertex>', `vec4 occW = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        occW = instanceMatrix * occW;
      #endif
      vOccW = (modelMatrix * occW).xyz;
      #include <project_vertex>`);
    sh.fragmentShader = 'uniform vec3 uPlayer; varying vec3 vOccW;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { vec3 cp = uPlayer + vec3(0., 1.2, 0.) - cameraPosition; float t = dot(vOccW - cameraPosition, cp) / dot(cp, cp);
        float r = length(vOccW - cameraPosition - cp * clamp(t, 0., 1.));
        float fade = (1. - smoothstep(1.7, 3.6, r)) * smoothstep(0., .08, t) * (1. - smoothstep(.82, .94, t));
        if (fade * .92 > fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))))) discard; }`);
  };
  mat.customProgramCacheKey = () => key + '|occ';
  return mat;
}

// Bake a static group into one mesh per material (fewer draw calls) and give textured materials world-space UVs.
function mergeGroup(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), buckets = new Map(), meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const key = m.material.uuid + m.castShadow;
    if (!buckets.has(key)) buckets.set(key, { mat: m.material, cast: m.castShadow, geos: [] });
    buckets.get(key).geos.push(g);
    m.removeFromParent();
  }
  for (const b of buckets.values()) {
    const g = mergeGeometries(b.geos), k = b.mat.userData.uvScale;
    if (k) {
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) * k, p.getZ(i) * k); else if (ax >= az) uv.setXY(i, p.getZ(i) * k, p.getY(i) * k); else uv.setXY(i, p.getX(i) * k, p.getY(i) * k);
      }
    }
    const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}

// Small construction kit used by the landmarks. y = 0 is the flattened pad.
function kit() {
  const g = new THREE.Group();
  const api = {
    g,
    add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; },
    box: (w, h, d, mat, x, y, z, ry = 0) => api.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, ry),
    cyl: (rt, rb, h, mat, x, y, z, seg = 20) => api.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z),
    cone: (r, h, mat, x, y, z, seg = 20, ry = 0) => api.add(new THREE.ConeGeometry(r, h, seg), mat, x, y, z, 0, ry),
    ball: (r, mat, x, y, z, seg = 16) => api.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg * .6 | 0)), mat, x, y, z),
    torus: (r, t, mat, x, y, z, rx = Math.PI / 2, ry = 0, arc = Math.PI * 2) => api.add(new THREE.TorusGeometry(r, t, 8, 36, arc), mat, x, y, z, rx, ry),
    prism(w, h, d, mat, x, y, z, ry = 0) { const geo = new THREE.CylinderGeometry(1, 1, d, 3, 1); geo.rotateX(-Math.PI / 2); geo.scale(w / 1.732, h / 1.5, 1); geo.translate(0, .5 * h / 1.5, 0); return api.add(geo, mat, x, y, z, 0, ry); },
    gable(w, d, wallH, roofH, wall, gableM, roof, x = 0, z = 0, base = 0) {
      api.box(w, wallH, d, wall, x, base + wallH / 2, z);
      api.prism(w, roofH, d, gableM, x, base + wallH, z);
      const a = Math.atan2(roofH, w / 2), len = Math.hypot(w / 2, roofH) + .45;
      for (const s of [-1, 1]) api.add(new THREE.BoxGeometry(len, .16, d + .6), roof, x + s * (w / 4 + Math.sin(a) * .06), base + wallH + roofH / 2 + Math.cos(a) * .08, z, 0, 0, -s * a);
      api.add(new THREE.CylinderGeometry(.11, .11, d + .7, 8), roof, x, base + wallH + roofH + .07, z, Math.PI / 2);
    },
    rock(r, mat, x, y, z, seed = 1) { const geo = new THREE.DodecahedronGeometry(r, 0); geo.scale(1, .7, 1); return api.add(geo, mat, x, y, z, seed, seed * 2.3, 0); },
  };
  return api;
}
function gearGeometry(r, teeth = 10, depth = .12) {
  const parts = [new THREE.TorusGeometry(r * .8, r * .2, 8, 32), new THREE.CylinderGeometry(r * .28, r * .28, depth * 1.6, 16).rotateX(Math.PI / 2)];
  for (let i = 0; i < 4; i++) parts.push(new THREE.BoxGeometry(r * 1.5, r * .12, depth).rotateZ(i * Math.PI / 4));
  for (let i = 0; i < teeth; i++) { const a = i / teeth * Math.PI * 2; parts.push(new THREE.BoxGeometry(r * .28, r * .3, depth * 1.2).rotateZ(a).translate(Math.sin(-a) * r, Math.cos(a) * r, 0)); }
  return mergeGeometries(parts.map(p => { p = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k); return p; }));
}
const flagMats = new Map();
function flagMaterial(color, glyph = '✦') {
  const key = color + glyph;
  if (!flagMats.has(key)) {
    const tex = canvasTexture(128, (g, s) => {
      g.fillStyle = color; g.fillRect(0, 0, s, s); g.strokeStyle = '#f2d07c'; g.lineWidth = 7; g.strokeRect(8, 8, s - 16, s - 16);
      g.fillStyle = '#f7dc93'; g.font = `${s * .5}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(glyph, s / 2, s / 2 + 4);
    });
    const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: .9 });
    m.onBeforeCompile = sh => { sh.uniforms.uTime = U.time; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(position.x * 2.6 - uTime * 3.6 + position.y * .7) * .12 * position.x;'); };
    m.customProgramCacheKey = () => 'flag';
    flagMats.set(key, m);
  }
  return flagMats.get(key);
}
function flag(parent, color, x, y, z, w = 1.5, h = 1, ry = 0, glyph) {
  const geo = new THREE.PlaneGeometry(w, h, 12, 6); geo.translate(w / 2, -h / 2, 0);
  const m = new THREE.Mesh(geo, flagMaterial(color, glyph)); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; parent.add(m); return m;
}

// ───────────────────────────── landmarks ─────────────────────────────
// Each returns { stat: mergeable group, dyn: animated group, obstacles: [[x, z, r] metres], tick(t, dt) }.
const animated = [], pointLights = [];
function buildSite(id, area) {
  const b = kit(), dyn = new THREE.Group(), obstacles = [];
  let tick = () => {};
  const spin = (obj, speed, axis = 'y') => { animated.push(t => { obj.rotation[axis] = t * speed; }); return obj; };
  const addDyn = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; dyn.add(m); return m; };
  switch (id) {
    case 'camp': {
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.rock(.2, M.stoneDark, Math.cos(a) * .66, .1, Math.sin(a) * .66, i); }
      for (let i = 0; i < 3; i++) b.add(new THREE.CylinderGeometry(.08, .1, 1.05, 7), M.woodDark, 0, .2, 0, Math.PI / 2 - .25, i * 1.05, .2);
      b.add(new THREE.CylinderGeometry(.46, .5, .05, 16), glow('#ff6a1f', 2.2), 0, .04, 0);
      const flameMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: U.time },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){ float f=.75+.25*sin(uTime*17.+vUv.x*25.); vec3 c=mix(vec3(1.,.28,.04),vec3(1.,.86,.45),vUv.y*.6); gl_FragColor=vec4(c*2.6*f, (1.-vUv.y)*.9); }',
      });
      const flames = [0, 1, 2].map(i => addDyn(new THREE.ConeGeometry(.3 - i * .07, 1 - i * .18, 10, 1, true), flameMat, (i - 1) * .12, .5 - i * .06, (i % 2) * .1 - .05));
      const fire = new THREE.PointLight('#ff9448', 14, 13, 1.8); fire.position.set(0, 1.1, 0); dyn.add(fire); pointLights.push(fire);
      tick = t => { flames.forEach((f, i) => { const s = 1 + .14 * Math.sin(t * (9 + i * 3) + i) + .06 * Math.sin(t * 23 + i * 2); f.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); }); fire.intensity = 12 + Math.sin(t * 11) * 1.6 + Math.sin(t * 27) * 1.1; };
      for (const s of [-1, 1]) {
        const tx = s * 3.7, tz = -2.9, ry = -s * .55, tent = fabric(s < 0 ? '#e0bd82' : '#c98948');
        b.prism(2.6, 2.0, 2.7, tent, tx, 0, tz, ry);
        const door = b.prism(1.0, 1.15, .05, M.dark, tx + Math.sin(ry) * 1.36, 0, tz + Math.cos(ry) * 1.36, ry);
        door.castShadow = false;
        b.add(new THREE.CylinderGeometry(.035, .035, 2.95, 6), M.woodDark, tx, 2.0, tz).rotation.set(Math.PI / 2, ry, 0, 'YXZ');
        b.box(.5, .4, .4, M.wood, tx + s * 1.5, .2, tz + 1.2, .4);
        obstacles.push([tx, tz, 1.6]);
      }
      for (const s of [-1, 1]) { b.add(new THREE.CylinderGeometry(.22, .24, 1.5, 10), M.wood, s * 2.3, .22, .6, 0, s * 1.1, Math.PI / 2); obstacles.push([s * 2.3, .6, .55]); }
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-3.4, 1.95, -2.7), new THREE.Vector3(0, 1.45, -2.4), new THREE.Vector3(3.4, 1.95, -2.7)]);
      b.add(new THREE.TubeGeometry(curve, 30, .012, 4), M.dark, 0, 0, 0, 0, 0, 0, false);
      for (let i = 1; i < 12; i++) { const p = curve.getPoint(i / 12); b.add(new THREE.SphereGeometry(.07, 10, 8), M.lantern, p.x, p.y - .09, p.z, 0, 0, 0, false); }
      b.cyl(.05, .06, 4.2, M.woodDark, 0, 2.1, -4.7, 8); flag(dyn, '#c98948', 0.04, 4.1, -4.7, 1.4, .9);
      b.cyl(.07, .08, 1.8, M.woodDark, 4.4, .9, 2.3, 8);
      [[.5, 1.55, .5], [-.4, 1.25, -.3], [.3, .95, 1.4]].forEach(([dx, y, r]) => b.box(.75, .2, .05, M.wood, 4.4 + dx, y, 2.3, r));
      obstacles.push([0, 0, 1.05], [4.4, 2.3, .3], [0, -4.7, .25]);
      break;
    }
    case 'forge': {
      b.box(6.4, .5, 5, M.stoneDark, 0, .25, 0);
      b.gable(5.6, 4.2, 2.6, 1.9, M.stone, M.plaster, roofMat('#4f8090'), 0, 0, .5);
      for (const x of [-2.75, 2.75]) for (const z of [-2.05, 2.05]) b.box(.26, 2.65, .26, M.woodDark, x, 1.8, z);
      for (const z of [-2.14, 2.14]) b.box(5.9, .24, .26, M.woodDark, 0, 3.08, z);
      b.box(1.6, 2.1, .14, M.dark, 0, 1.55, 2.12);
      b.box(1.15, .75, .06, glow('#ff7a26', 5), 0, 1.0, 2.18);
      b.box(1.9, .2, .3, M.woodDark, 0, 2.7, 2.18);
      for (const x of [-1.8, 1.8]) { b.box(.75, .85, .1, M.window, x, 2.0, 2.13); b.box(.95, .12, .18, M.woodDark, x, 1.52, 2.16); }
      b.box(.95, 3.8, .95, M.stone, 1.75, 4.2, -1.1); b.box(1.15, .26, 1.15, M.stoneDark, 1.75, 6.15, -1.1);
      b.cyl(.32, .38, .55, M.wood, -3.0, .27, 3.0, 12); b.box(.72, .22, .3, M.iron, -3.0, .66, 3.0); b.cone(.12, .35, M.iron, -2.52, .68, 3.0, 8);
      for (const [x, z] of [[3.0, 2.5], [3.55, 1.8]]) { b.cyl(.34, .34, .82, M.wood, x, .41, z, 14); b.torus(.35, .025, M.iron, x, .2, z); b.torus(.35, .025, M.iron, x, .62, z); }
      b.box(.6, .6, .6, M.wood, -3.3, .3, 1.4, .35);
      spin(addDyn(gearGeometry(.5), M.gold, 0, 4.15, 2.3), .6, 'z');
      const furnace = new THREE.PointLight('#ff8a3a', 9, 9, 2); furnace.position.set(0, 1.4, 3.0); dyn.add(furnace); pointLights.push(furnace);
      tick = t => { furnace.intensity = 8 + Math.sin(t * 7) * 1.2 + Math.sin(t * 19) * .8; };
      obstacles.push([0, 0, 3.7], [-3.0, 3.0, .55], [3.2, 2.2, .85]);
      break;
    }
    case 'citadel': {
      const roof = roofMat('#b5613f');
      b.box(9.8, .6, 7.8, M.stoneDark, 0, .3, 0);
      b.box(4.4, 6.8, 3.8, M.stone, 0, 4.0, -.9);
      for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) { b.box(.5, .55, .5, M.stone, i * .95, 7.67, -.9 + s * 1.9); b.box(.5, .55, .5, M.stone, s * 2.2, 7.67, -.9 + i * .78); }
      b.cone(2.6, 2.6, roof, 0, 8.7, -.9, 4, Math.PI / 4);
      b.box(8.2, 3.4, .8, M.stone, 0, 2.3, 2.6);
      for (let x = -3.9; x <= 3.95; x += .78) b.box(.42, .5, .84, M.stone, x, 4.25, 2.6);
      b.box(1.7, 2.5, .1, M.dark, 0, 1.85, 3.02);
      b.add(new THREE.CylinderGeometry(.85, .85, .1, 20), M.dark, 0, 3.05, 3.02, Math.PI / 2);
      b.torus(.97, .13, M.stoneDark, 0, 3.05, 3.08, 0, 0, Math.PI);
      b.add(new THREE.OctahedronGeometry(.22), M.gold, 0, 4.05, 3.12);
      for (const s of [-1, 1]) {
        b.box(.8, 3.4, 5.2, M.stone, s * 3.7, 2.3, .1);
        b.cyl(1.15, 1.3, 7.2, M.stone, s * 4.1, 4.2, 2.6); b.cone(1.6, 3.0, roof, s * 4.1, 9.3, 2.6);
        b.box(.3, .65, .1, M.window, s * 4.1, 5.6, 3.78); b.box(.3, .65, .1, M.window, s * 4.1, 3.6, 3.82);
        b.cyl(.95, 1.05, 8.4, M.stone, s * 3.0, 4.8, -2.9); b.cone(1.32, 2.7, roof, s * 3.0, 10.35, -2.9);
        b.ball(.16, M.gold, s * 4.1, 10.9, 2.6); b.cyl(.035, .035, 1.5, M.woodDark, s * 4.1, 11.6, 2.6, 6); flag(dyn, '#b5613f', s * 4.1, 12.3, 2.6, 1.3, .8);
        b.box(.95, 1.9, .05, fabric('#9f4e34'), s * 2.0, 2.85, 3.03); b.box(.95, .18, .07, M.gold, s * 2.0, 3.7, 3.04);
        b.box(.3, .55, .1, M.window, s * 1.2, 5.5, 1.02); b.box(.3, .55, .1, M.window, s * 1.2, 3.7, 1.02);
        obstacles.push([s * 4.1, 2.6, 1.45], [s * 3.0, -2.9, 1.15]);
      }
      b.box(2.4, .3, .6, M.stoneDark, 0, .15, 4.2); b.box(2.2, .3, .5, M.stoneDark, 0, .45, 3.85);
      obstacles.push([0, -.3, 4.5]);
      break;
    }
    case 'grove': {
      const tree = new THREE.Mesh(treeGeometry('sacred', rng32(77), 2), treeMaterial()); tree.position.set(-1, 0, -1.4); tree.castShadow = tree.receiveShadow = true; dyn.add(tree);
      b.torus(1.12, .1, M.rope, -1, 2.4, -1.4);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + .3; b.add(new THREE.PlaneGeometry(.12, .34), M.paper, -1 + Math.sin(a) * 1.2, 2.1, -1.4 + Math.cos(a) * 1.2, 0, a, .2, false); }
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, r = 2.1 + (i % 3) * .5; b.add(new THREE.SphereGeometry(.09, 10, 8), glow('#fff0b5', 2.4), -1 + Math.cos(a) * r, 4.3 + (i % 4) * .35, -1.4 + Math.sin(a) * r, 0, 0, 0, false); }
      b.add(new THREE.CircleGeometry(1.95, 40), M.pond, 3, .05, 1.4, -Math.PI / 2, 0, 0, false);
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; b.rock(.22 + (i % 3) * .05, M.stoneDark, 3 + Math.cos(a) * 2.05, .08, 1.4 + Math.sin(a) * 2.05, i); }
      for (let i = 0; i < 5; i++) { const a = i * 1.3, r = .6 + (i % 2) * .7; b.add(new THREE.CylinderGeometry(.24, .24, .02, 14, 1, false, 0, Math.PI * 1.8), flatColor('#4f9a45'), 3 + Math.cos(a) * r, .07, 1.4 + Math.sin(a) * r, 0, a, 0, false); if (i % 2 === 0) b.ball(.09, flatColor('#f5a3c4'), 3 + Math.cos(a) * r, .14, 1.4 + Math.sin(a) * r, 10); }
      for (const [x, z] of [[-3.4, 2.0], [1.4, -3.4]]) { b.box(.36, .7, .36, M.stoneDark, x, .35, z); b.box(.62, .45, .62, M.stone, x, .93, z); b.box(.4, .3, .4, M.lantern, x, .93, z); b.cone(.55, .4, M.stoneDark, x, 1.35, z, 4, Math.PI / 4); obstacles.push([x, z, .45]); }
      for (const x of [6.0, 7.3]) b.cyl(.07, .08, 2.5, M.wood, x, 1.25, 2.0, 8);
      b.add(new THREE.CylinderGeometry(.035, .035, 1.5, 8), M.iron, 6.65, 2.35, 2.0, 0, 0, Math.PI / 2);
      b.add(new THREE.TorusGeometry(.36, .15, 10, 22), flatColor('#2b2b2e'), 7.1, .15, 3.5, Math.PI / 2);
      obstacles.push([-1, -1.4, 1.5], [3, 1.4, 2.05], [6.0, 2.0, .25], [7.3, 2.0, .25]);
      break;
    }
    case 'tower': {
      const roof = roofMat('#7d9150');
      b.cyl(2.5, 2.7, .6, M.stoneDark, 0, .3, 0, 28);
      b.cyl(1.75, 2.0, 10.5, M.stone, 0, 5.85, 0, 28);
      b.cyl(2.35, 2.35, .28, M.stoneDark, 0, 8.2, 0, 28); b.torus(2.28, .045, M.iron, 0, 8.8, 0);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; b.cyl(.03, .03, .6, M.iron, Math.sin(a) * 2.28, 8.5, Math.cos(a) * 2.28, 5); }
      b.cyl(1.55, 1.65, 1.8, M.plaster, 0, 12.0, 0, 24);
      b.cone(2.45, 4.7, roof, 0, 15.25, 0, 28);
      b.ball(.2, M.gold, 0, 17.7, 0); b.cyl(.035, .035, 1.4, M.woodDark, 0, 18.4, 0, 6); flag(dyn, '#7d9150', 0, 19.0, 0, 1.2, .75, 0, '△');
      for (let k = 0; k < 7; k++) { const a = k * .95 + .4, y = 2.2 + k * 1.25, r = 2.0 - (y / 11) * .25 + .02; b.box(.36, .66, .14, M.window, Math.sin(a) * r, y, Math.cos(a) * r, a); }
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + .3; b.box(.34, .55, .12, M.window, Math.sin(a) * 1.62, 12.1, Math.cos(a) * 1.62, a); }
      b.box(1.05, 1.9, .14, M.dark, 0, 1.55, 1.96); b.torus(.6, .1, M.stoneDark, 0, 2.5, 2.0, 0, 0, Math.PI);
      b.cyl(.9, 1.0, 5.6, M.stone, -2.6, 3.4, .4, 16); b.cone(1.25, 2.5, roofMat('#9cad78'), -2.6, 7.45, .4, 16);
      const books = new THREE.Group(); books.position.y = 14; dyn.add(books);
      ['#c25b4a', '#4f6fa8', '#e2b850', '#5a9a63', '#8e5aa8'].forEach((c, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(.34, .44, .09), flatColor(c)); const a = i / 5 * Math.PI * 2; m.position.set(Math.sin(a) * 3.1, Math.sin(i * 2) * .3, Math.cos(a) * 3.1); m.rotation.set(.3, a + 1.2, .2); m.castShadow = true; books.add(m); });
      tick = t => { books.rotation.y = t * .25; books.position.y = 14 + Math.sin(t * .8) * .25; books.children.forEach((m, i) => { m.rotation.x = .3 + Math.sin(t * 1.4 + i) * .25; }); };
      obstacles.push([0, 0, 2.65], [-2.6, .4, 1.15]);
      break;
    }
    case 'temple': {
      const roof = roofMat('#9b6a8a');
      b.box(7.2, .4, 6.4, M.stone, 0, .2, 0); b.box(6.4, .4, 5.6, M.stone, 0, .6, 0); b.box(5.6, .4, 4.8, M.stone, 0, 1.0, 0);
      b.box(2.2, .4, .7, M.stone, 0, .2, 3.45);
      for (const x of [-2.3, -.8, .8, 2.3]) for (const z of [-1.9, 1.9]) { b.cyl(.2, .24, 3.0, M.plaster, x, 2.7, z, 14); b.box(.55, .18, .55, M.stone, x, 1.29, z); b.box(.55, .18, .55, M.stone, x, 4.11, z); }
      b.box(3.2, 2.9, 2.4, M.plaster, 0, 2.65, -.3); b.box(1.0, 1.9, .1, M.dark, 0, 2.15, .92); b.box(.7, 1.2, .06, glow('#d8b8ff', 1.6), 0, 2.0, .95);
      b.box(5.6, .35, 4.4, M.stone, 0, 4.38, 0);
      const lathe = (pts, y) => { const geo = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 4); geo.rotateY(Math.PI / 4); return b.add(geo, roof, 0, y, 0); };
      lathe([[4.7, 0], [4.0, .3], [3.0, .85], [2.2, 1.35], [.02, 1.6]], 4.55);
      b.box(2.4, .8, 2.4, M.plaster, 0, 6.1, 0);
      lathe([[3.1, 0], [2.6, .25], [1.9, .7], [1.25, 1.1], [.02, 1.35]], 6.35);
      b.ball(.16, M.gold, 0, 7.75, 0); b.cone(.12, .9, M.gold, 0, 8.25, 0, 8);
      const crystal = addDyn(new THREE.OctahedronGeometry(.55), glow('#cfa8ff', 3.2), 0, 9.6, 0); crystal.scale.y = 1.5;
      const rings = [0, 1].map(i => addDyn(new THREE.TorusGeometry(1.05 + i * .25, .03, 8, 48), M.gold, 0, 9.6, 0));
      tick = t => { crystal.rotation.y = t * .8; crystal.position.y = 9.6 + Math.sin(t * 1.3) * .22; rings[0].rotation.set(t * .5, t * .3, 0); rings[1].rotation.set(-t * .4, 0, t * .35); rings.forEach(r => r.position.y = crystal.position.y); };
      for (const s of [-1, 1]) { const x = s * 3.4, z = 3.4; b.box(.32, .6, .32, M.stone, x, .3, z); b.box(.5, .42, .5, M.lantern, x, .81, z); b.cone(.48, .42, roof, x, 1.23, z, 4, Math.PI / 4); obstacles.push([x, z, .4]); }
      obstacles.push([0, 0, 3.65]);
      break;
    }
    case 'lab': {
      b.cyl(3.3, 3.4, .5, M.stoneDark, 0, .25, 0, 32);
      b.cyl(2.7, 2.7, 3.0, M.plaster, 0, 2.0, 0, 32);
      b.torus(2.72, .07, M.iron, 0, .95, 0); b.torus(2.72, .07, M.iron, 0, 3.35, 0);
      b.cyl(2.86, 2.86, .25, M.stone, 0, 3.62, 0, 32);
      for (let k = 0; k < 8; k++) b.add(new THREE.TorusGeometry(2.63, .045, 6, 28, Math.PI), M.gold, 0, 3.74, 0, 0, k * Math.PI / 8);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), M.glass); dome.position.y = 3.74; dome.renderOrder = 2; dyn.add(dome);
      const core = addDyn(new THREE.SphereGeometry(.62, 24, 16), glow('#7ef0ff', 3), 0, 4.7, 0);
      const coreRing = addDyn(new THREE.TorusGeometry(1.0, .04, 8, 40), M.gold, 0, 4.7, 0);
      b.cyl(.05, .07, 2.2, M.iron, 0, 7.4, 0, 6); const beacon = addDyn(new THREE.SphereGeometry(.12, 12, 8), glow('#ff4d3a', 3), 0, 8.55, 0);
      const g1 = addDyn(gearGeometry(.9, 12), M.iron, 2.78, 2.0, 0); g1.rotation.y = Math.PI / 2;
      const g2 = addDyn(gearGeometry(.55, 9), M.gold, 2.74, 2.95, 1.0); g2.rotation.y = Math.PI / 2 - .35;
      const g3 = addDyn(gearGeometry(.6, 10), M.gold, -1.7, 2.2, 2.2); g3.rotation.y = -.66;
      tick = t => { core.scale.setScalar(1 + Math.sin(t * 2) * .06); coreRing.rotation.set(t * .7, t * .4, 0); g1.rotation.z = t * .5; g2.rotation.z = -t * .85; g3.rotation.z = t * .7; beacon.material.emissiveIntensity = Math.sin(t * 3) > .3 ? 4 : .4; };
      b.box(1.25, 2.0, .2, M.dark, 0, 1.5, 2.66); b.box(1.5, .14, .26, M.iron, 0, 2.55, 2.68);
      for (const a of [-1.0, 1.0, 2.4, -2.4]) b.add(new THREE.CylinderGeometry(.36, .36, .12, 18), M.window, Math.sin(a) * 2.7, 2.4, Math.cos(a) * 2.7).rotation.set(Math.PI / 2, a, 0, 'YXZ');
      b.cyl(.62, .62, 1.7, M.iron, -3.05, .85, -.8, 16); b.torus(.63, .04, M.gold, -3.05, 1.3, -.8); b.ball(.62, M.iron, -3.05, 1.7, -.8);
      obstacles.push([0, 0, 3.45], [-3.05, -.8, .75]);
      break;
    }
    case 'summit': {
      b.cyl(1.9, 2.1, .35, M.stone, 0, .17, 0, 28); b.torus(1.55, .04, M.gold, 0, .36, 0);
      b.cyl(.06, .08, 4.6, M.gold, 0, 2.6, -.8, 10); b.ball(.14, M.gold, 0, 4.95, -.8);
      flag(dyn, '#bd9b55', .05, 4.8, -.8, 1.9, 1.2);
      obstacles.push([0, -.8, .35]);
      break;
    }
  }
  return { stat: b.g, dyn, obstacles, tick };
}

// ───────────────────────────── foliage ─────────────────────────────
const treeMats = {};
function treeMaterial() { return treeMats.tree ??= occludable(windFoliage(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82 }), 'tree', 1.4)); }
function finishPart(geo, colorFn) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) { colorFn(tmp, p.getX(i), p.getY(i), p.getZ(i)); c.set([tmp.r, tmp.g, tmp.b], i * 3); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  return geo;
}
function blob(r, cx, cy, cz, lo, hi, rng, detail, centre) {
  const geo = new THREE.IcosahedronGeometry(r, detail), p = geo.attributes.position, n = geo.attributes.normal, seed = rng() * 100;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + .2 * noise2(x * 2.2 + seed, (y + z) * 2.2 - seed);
    const px = x * k + cx, py = y * k * .88 + cy, pz = z * k + cz;
    p.setXYZ(i, px, py, pz);
    const a = new THREE.Vector3(px - cx, py - cy, pz - cz).normalize(), b2 = new THREE.Vector3(px - centre.x, py - centre.y, pz - centre.z).normalize();
    a.multiplyScalar(.62).addScaledVector(b2, .38).normalize(); n.setXYZ(i, a.x, a.y, a.z);
  }
  const shift = (rng() - .5) * .12, top = cy + r, bottom = cy - r;
  return finishPart(geo, (c, x, y) => { c.copy(lo).lerp(hi, clamp((y - bottom) / (top - bottom) + shift, 0, 1)); });
}
const C = h => new THREE.Color(h);
function treeGeometry(kind, rng, detail) {
  const parts = [], trunkC = C(kind === 'birch' ? '#e9e4d8' : '#6b4a33'), trunkLo = C(kind === 'birch' ? '#9d988c' : '#4a3222');
  const trunk = (r0, r1, h) => { const g = new THREE.CylinderGeometry(r1, r0, h, 8, 3); g.translate(0, h / 2, 0); parts.push(finishPart(g, (c, x, y) => c.copy(trunkLo).lerp(trunkC, clamp(y / h, 0, 1)))); };
  const branch = (len, ang, y, r) => { const g = new THREE.CylinderGeometry(r * .5, r, len, 6); g.translate(0, len / 2, 0); g.rotateZ(.85); g.rotateY(ang); g.translate(0, y, 0); parts.push(finishPart(g, c => c.copy(trunkC))); };
  if (kind === 'pine') {
    trunk(.2, .12, 1.6);
    const lo = C('#22513a'), hi = C('#5f9a5e');
    for (let k = 0; k < 4; k++) {
      const r = 1.55 - k * .32, h = 1.9 - k * .2, y = 1.1 + k * 1.05, g = new THREE.ConeGeometry(r, h, 9, 2), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), yy = p.getY(i), w = 1 + .14 * noise2(x * 3 + k, z * 3); p.setXYZ(i, x * w, yy, z * w); }
      g.translate(0, y + h / 2, 0); g.computeVertexNormals(); parts.push(finishPart(g, (c, x, yy) => c.copy(lo).lerp(hi, clamp((yy - y) / h * .8 + k * .08, 0, 1))));
    }
  } else if (kind === 'cypress') {
    // Tuscan cypress: the tall flame-shaped tree of Renaissance landscapes.
    trunk(.16, .1, .9);
    const lo = C('#1d4a2c'), hi = C('#6a9a4c'), prof = [[0, .5], [.46, .95], [.6, 1.8], [.58, 2.8], [.46, 3.8], [.28, 4.7], [.1, 5.3], [0, 5.55]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 10), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), w = 1 + .16 * noise2(x * 4 + y * 1.7, z * 4 - y); p.setXYZ(i, x * w, y, z * w); }
    g.computeVertexNormals(); parts.push(finishPart(g, (c, x, y, z) => c.copy(lo).lerp(hi, clamp(y / 5.5 * .7 + Math.max(0, x + z) * .18, 0, 1))));
  } else if (kind === 'bush') {
    const centre = new THREE.Vector3(0, .45, 0), lo = C('#3a7330'), hi = C('#98c653');
    for (let k = 0; k < 3; k++) parts.push(blob(.45 + rng() * .25, (rng() - .5) * .8, .4 + rng() * .2, (rng() - .5) * .8, lo, hi, rng, 1, centre));
  } else {
    const giant = kind === 'sacred', s = giant ? 2.4 : 1, h = giant ? 4.8 : kind === 'birch' ? 2.6 : 1.9;
    trunk(giant ? 1.25 : .27, giant ? .7 : .16, h);
    for (let k = 0; k < (giant ? 5 : 2); k++) branch(giant ? 2.4 : 1.0, k * 2.4 + rng(), h * .75, giant ? .35 : .09);
    if (giant) for (let k = 0; k < 6; k++) { const g = new THREE.ConeGeometry(.5, 2.0, 6); g.rotateZ(Math.PI / 2 - .25); g.translate(1.2, .25, 0); g.rotateY(k / 6 * Math.PI * 2 + .3); parts.push(finishPart(g, c => c.copy(trunkLo))); }
    const leafColors = { oak: ['#2a6424', '#86b842'], birch: ['#477f2b', '#b3cf55'], sakura: ['#d97ba2', '#ffd6e6'], olive: ['#4f6b45', '#a9b98c'], sacred: ['#2f6d2e', '#9ccd5e'] };
    const blossom = [C('#f3a6c4'), C('#fff0f5')];
    const n = giant ? 14 : 5, centre = new THREE.Vector3(0, h + (kind === 'birch' ? 1.5 : 1.2) * s, 0);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2, rad = (kind === 'birch' ? .5 : 1.0) * s * Math.sqrt(rng()), r = (kind === 'birch' ? .62 : .85) * s + rng() * .45 * s;
      const y = centre.y + (rng() - .35) * (kind === 'birch' ? 2.2 : 1.1) * s;
      const [lo, hi] = giant && k % 3 === 0 ? blossom : leafColors[kind].map(C);
      parts.push(blob(r, Math.cos(a) * rad, y, Math.sin(a) * rad, lo, hi, rng, detail, centre));
    }
  }
  return mergeGeometries(parts.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k); return g; }));
}
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + .28 * noise2(x * 1.7 + seed, z * 1.7 + y); p.setXYZ(i, x * k, Math.max(y * k * .62, -.25), z * k); }
  g.computeVertexNormals();
  const lo = C('#7a776f'), hi = C('#b3afa4'), moss = C('#6e9a45'), n = g.attributes.normal;
  let i = 0;
  return finishPart(g, (c, x, y) => { c.copy(lo).lerp(hi, clamp(y + .45, 0, 1)).lerp(moss, smooth(.72, .95, n.getY(i++)) * .8); });
}
function grassBladeGeometry() {
  const pos = [], idx = [], segs = 3;
  for (let i = 0; i <= segs; i++) { const y = i / segs, w = .5 * (1 - y) ** .85, bend = y * y * .22; if (i === segs) pos.push(0, 1, bend); else pos.push(-w, y, bend, w, y, bend); }
  for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const t = (segs - 1) * 2; idx.push(t, t + 1, t + 2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  return g;
}
function grassMaterial(key, tipBoost, bendScale = 1) {
  const m = new THREE.MeshStandardMaterial({ roughness: .78, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime: U.time, uWind: U.wind, uPlayer: U.player });
    sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform vec3 uPlayer; varying float vH;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vH = clamp(position.y, 0., 1.);
      vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.);
      vec3 base = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
      float k = vH * vH * ${bendScale.toFixed(2)};
      float w = sin(uTime * 1.7 + base.x * .35 + base.z * .22) + .5 * sin(uTime * 3.1 + base.x * .9 - base.z * .6);
      float gust = .5 + .5 * sin(uTime * .55 + base.x * .06 - base.z * .03);
      vec2 bend = vec2(.8, .45) * (.1 + w * .1 * (.5 + gust)) * uWind * k;
      vec2 dp = base.xz - uPlayer.xz; float dl = length(dp);
      bend += dp / (dl + .001) * (1. - smoothstep(.15, 1.3, dl)) * .5 * vH * ${bendScale.toFixed(2)};
      wp.xz += bend; wp.y -= dot(bend, bend) * .5;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = 'varying float vH;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= mix(.45, ${tipBoost.toFixed(2)}, vH);`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);');
  };
  m.customProgramCacheKey = () => key;
  return m;
}

// ───────────────────────────── characters ─────────────────────────────
const gradientMap = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter; gradientMap.unpackAlignment = 1; gradientMap.needsUpdate = true;
const withRim = m => { m.onBeforeCompile = sh => { sh.uniforms.uRim = U.rim; sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight += uRim * diffuseColor.rgb * pow(1. - saturate(dot(normal, normalize(vViewPosition))), 3.);\n#include <opaque_fragment>'); }; m.customProgramCacheKey = () => 'toon-rim'; return m; };
const toonCache = new Map();
function toonMat(hex) { if (!toonCache.has(hex)) toonCache.set(hex, withRim(new THREE.MeshToonMaterial({ color: hex, gradientMap, side: THREE.DoubleSide }))); return toonCache.get(hex); }
// Every character is three skinned draws: cel-shaded body, ink outline (inverted hull) and unlit face details.
const CHAR = {
  toon: withRim(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide })),
  outline: Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(.3, .3, .3), side: THREE.BackSide }), {
    onBeforeCompile: sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * .012;'); },
    customProgramCacheKey: () => 'outline',
  }),
  face: new THREE.MeshBasicMaterial({ vertexColors: true }),
};
const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);
const SPHERE = new THREE.SphereGeometry(1, 20, 14);

// Outfit and hair choices for Nivetha and the eight guides. Colours come from PARTY so party.js stays the source of truth.
function lookFor(b) {
  const base = { skin: b.skin, hair: b.hair, eyes: '#4a2e22', top: b.color, sleeve: b.color, legs: '#3f3d3a', boots: '#4a372a', blush: false };
  switch (b.style) {
    case 'coat': return { ...base, hairStyle: 'messy', top: '#f0e9da', sleeve: b.color, coat: b.color, eyes: '#4b7a8a' };
    case 'android': return { ...base, hairStyle: 'sleek', top: '#23272e', sleeve: '#2c3138', legs: '#1a1d22', boots: '#c9d2dc', visor: '#7ef0ff', trim: '#7ef0ff', eyes: '#7ef0ff' };
    case 'tee': return { ...base, hairStyle: 'bald', top: '#1b1b1d', sleeve: null, legs: '#1e1e22', boots: '#2a2a2a', eyes: '#3b2c24' };
    case 'egg': return { ...base, hairStyle: 'bald', egg: true, glasses: true, top: '#dfe6e8', sleeve: '#f3f1e8', coat: '#f3f1e8', legs: '#5b6670', boots: '#8a6a4a', eyes: '#3b6a8a' };
    case 'cape': return { ...base, hairStyle: 'sleek', top: '#2e2a3a', sleeve: '#2e2a3a', legs: '#24222c', cape: '#4f3d62', eyes: '#8a5cc8', trim: '#d6b768' };
    case 'apron': return { ...base, hairStyle: 'messy', top: '#f1ede4', sleeve: '#f1ede4', apron: b.color, legs: '#3b3f46', eyes: '#5f86a6' };
    case 'glasses': return { ...base, hairStyle: 'shoulder', beard: true, glasses: true, legs: '#2a2d2b', eyes: '#3b2c24' };
    case 'athlete': return { ...base, hairStyle: 'bald', sleeve: null, legs: b.skin, shorts: '#2f3330', boots: '#e8e6df', athletic: true };
    case 'lab': return { ...base, hairStyle: 'bob', top: b.color, sleeve: '#f3f1e8', coat: '#f3f1e8', blush: true, eyes: '#6b4a2c' };
    case 'suit': return { ...base, hairStyle: 'ponytail', top: b.color, sleeve: b.color, legs: b.color, stripe: '#1d1d1d', boots: '#e3c35c', blush: true, eyes: '#4a7bd0' };
    default: return { ...base, hairStyle: 'neat', legs: '#3d4a5a', eyes: '#3d2c22' };
  }
}
const PLAYER_LOOK = { skin: '#c58c65', hair: '#2a2321', hairStyle: 'long', eyes: '#6b4430', top: '#efe4c8', sleeve: '#efe4c8', legs: '#4a4843', boots: '#5b4636', skirt: '#efe4c8', belt: '#d5b76e', cloak: true, staff: true, blush: true, flair: true };

function makeCharacter(look) {
  const root = new THREE.Group(), body = new THREE.Bone(), parts = [];
  root.add(body);
  // Parts are modelled on bones, then baked into skinned meshes below.
  const part = (parent, geo, hex, p, o = {}) => {
    const m = new THREE.Mesh(geo); m.position.set(...p); if (o.r) m.rotation.set(...o.r); if (o.s) m.scale.set(...o.s); parent.add(m);
    parts.push({ m, hex, face: !!o.basic, outline: !o.basic && !o.double && o.outline !== false });
    return m;
  };
  const bone = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); return b; };
  const trunk = body;
  const knees = [];
  const legs = [-1, 1].map(s => {
    const g = bone(body, s * .085, .86, 0);
    part(g, capsule(.068, .22), look.legs, [0, -.18, 0]);
    const knee = bone(g, 0, -.36, 0); knees.push(knee);
    part(knee, capsule(.062, .22), look.legs, [0, -.18, 0]);
    part(knee, capsule(.078, .1), look.boots, [0, -.4, .03], { s: [1, 1, 1.25] });
    return g;
  });
  part(trunk, capsule(.15, .3), look.top, [0, 1.1, 0], { s: [1, 1, .74] });
  part(trunk, capsule(.152, .06), look.shorts || look.legs, [0, .87, 0], { s: [1, 1, .78] });
  part(trunk, new THREE.CylinderGeometry(.05, .056, .14, 12), look.skin, [0, 1.45, 0]);
  if (look.skirt) part(trunk, new THREE.CylinderGeometry(.165, .25, .42, 22, 1, true), look.skirt, [0, .7, 0], { double: true });
  if (look.coat) part(trunk, new THREE.CylinderGeometry(.168, .27, .62, 22, 1, true, Math.PI * .08, Math.PI * 1.84), look.coat, [0, .64, 0], { double: true });
  if (look.belt) part(trunk, new THREE.TorusGeometry(.152, .018, 6, 24), look.belt, [0, .9, 0], { r: [Math.PI / 2, 0, 0], outline: false });
  if (look.apron) { part(trunk, new THREE.BoxGeometry(.27, .62, .02), look.apron, [0, .86, .128]); part(trunk, new THREE.BoxGeometry(.2, .02, .02), look.apron, [0, 1.2, .118], { outline: false }); }
  if (look.coat === '#f3f1e8') for (const s of [-1, 1]) part(trunk, new THREE.BoxGeometry(.07, .46, .03), '#f3f1e8', [s * .07, 1.12, .112], { r: [0, 0, s * .12], outline: false });
  if (look.stripe) for (const s of [-1, 1]) part(trunk, new THREE.BoxGeometry(.02, .5, .2), look.stripe, [s * .145, 1.08, 0], { outline: false });
  if (look.trim) part(trunk, new THREE.SphereGeometry(.035, 12, 8), look.trim, [0, 1.36, .115], { outline: false });
  const arms = [-1, 1].map(s => {
    const g = bone(body, s * .205, 1.33, 0);
    const r = look.athletic ? .062 : .052;
    part(g, new THREE.SphereGeometry(r * 1.3, 14, 10), look.sleeve || look.skin, [0, 0, 0], { outline: false });
    part(g, capsule(r, .34), look.sleeve || look.skin, [0, -.21, 0]);
    part(g, new THREE.SphereGeometry(.054, 12, 10), look.skin, [0, -.45, 0]);
    return g;
  });
  const head = bone(body, 0, look.egg ? 1.7 : 1.63, 0); if (look.egg) head.scale.set(1.28, 1.6, 1.28); else head.scale.setScalar(1.14);
  part(head, new THREE.SphereGeometry(.165, 28, 20), look.skin, [0, 0, 0], { s: [1, 1.04, 1] });
  for (const s of [-1, 1]) part(head, SPHERE, look.skin, [s * .162, -.015, -.005], { s: [.025, .042, .032], outline: false });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = bone(head, s * .06, -.012, .149); e.rotation.y = s * .36; eyes.push(e);
    part(e, SPHERE, '#ffffff', [0, 0, 0], { s: [.031, .041, .012], basic: true });
    part(e, SPHERE, look.eyes, [0, -.004, .006], { s: [.023, .032, .01], basic: true });
    part(e, SPHERE, '#1a1210', [0, -.003, .011], { s: [.011, .017, .008], basic: true });
    part(e, SPHERE, '#ffffff', [-.008 * s, .011, .016], { s: [.0065, .0065, .004], basic: true });
    part(e, new THREE.BoxGeometry(.068, .012, .012), '#1d1513', [0, .039, .004], { r: [0, 0, -s * .12], basic: true });
    part(head, new THREE.BoxGeometry(.05, .01, .012), look.hair === '#c6a574' ? '#9b7a4c' : '#2b211d', [s * .062, .072, .152], { r: [0, s * .3, s * .1], basic: true });
    if (look.blush) part(head, SPHERE, '#f0a093', [s * .096, -.052, .136], { s: [.026, .013, .006], r: [0, s * .55, 0], basic: true });
  }
  const mouth = bone(head, 0, -.084, .158);
  part(mouth, SPHERE, '#8a4a42', [0, 0, 0], { s: [.022, .008, .008], basic: true });
  if (look.visor) part(head, new THREE.BoxGeometry(.21, .048, .03), look.visor, [0, -.008, .158], { basic: true });
  if (look.glasses) { for (const s of [-1, 1]) part(head, new THREE.TorusGeometry(.034, .006, 6, 18), '#1e2420', [s * .062, -.012, .168], { basic: true }); part(head, new THREE.BoxGeometry(.04, .006, .006), '#1e2420', [0, -.006, .172], { basic: true }); }
  hair(head, look, part);
  if (look.flair) {
    // Nivetha's details: a gold flower hairpin, earrings, a side braid, a collar, a satchel and gold trims.
    const pin = new THREE.Group(); pin.position.set(.152, .085, .045); pin.rotation.y = .9; head.add(pin);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; part(pin, SPHERE, '#f0c565', [Math.cos(a) * .026, Math.sin(a) * .026, 0], { s: [.021, .021, .011], outline: false }); }
    part(pin, SPHERE, '#fff6e6', [0, 0, .008], { s: [.015, .015, .015], outline: false });
    part(pin, SPHERE, '#b4492f', [-.026, -.042, 0], { s: [.011, .011, .011], outline: false });
    for (const s of [-1, 1]) part(head, SPHERE, '#f0c565', [s * .166, -.068, .006], { s: [.011, .017, .011], outline: false });
    for (let i = 0; i < 7; i++) part(head, SPHERE, look.hair, [-.148 - i * .003, -.07 - i * .05, .075 - i * .004], { s: [.034 - i * .0016, .036, .032 - i * .0016] });
    part(head, new THREE.TorusGeometry(.024, .008, 6, 14).rotateX(Math.PI / 2), '#f0c565', [-.17, -.41, .05], { outline: false });
    part(trunk, new THREE.TorusGeometry(.108, .017, 6, 24).rotateX(Math.PI / 2 + .3), '#f0c565', [0, 1.385, .012], { outline: false });
    part(trunk, new THREE.TorusGeometry(.172, .013, 6, 30).rotateX(Math.PI / 2).rotateZ(.62), '#7a5236', [0, 1.06, 0], { s: [1, 1, .82], outline: false });
    part(trunk, new THREE.BoxGeometry(.15, .13, .07), '#8a5a38', [.205, .8, .07], { r: [0, -.35, 0] });
    part(trunk, new THREE.BoxGeometry(.152, .06, .074), '#6e4529', [.205, .845, .073], { r: [0, -.35, 0], outline: false });
    part(trunk, SPHERE, '#f0c565', [.222, .82, .115], { s: [.014, .014, .01], outline: false });
    part(trunk, new THREE.TorusGeometry(.25, .012, 6, 34).rotateX(Math.PI / 2), '#d5b76e', [0, .5, 0], { outline: false });
    for (const g of legs) part(g, new THREE.TorusGeometry(.078, .013, 6, 18).rotateX(Math.PI / 2), '#d5b76e', [0, -.66, .01], { outline: false });
  }
  let cloak = null, cloakMesh = null;
  if (look.cloak || look.cape) {
    // The cloak keeps its own material so the wardrobe can recolour it; it hangs from its own bone and sways.
    const geo = new THREE.CylinderGeometry(.21, look.cape ? .36 : .42, look.cape ? 1.08 : 1.02, 26, 1, true, Math.PI * .42, Math.PI * 1.16); geo.translate(0, -.5, 0);
    cloak = bone(body, 0, 1.42, -.01);
    cloakMesh = new THREE.Mesh(geo, toonMat(look.cape || palettes[state.equipped])); cloakMesh.castShadow = true; cloak.add(cloakMesh);
    if (look.flair) {
      // gold beads along the cloak's hem, and a brooch at the clasp
      const bead = new THREE.SphereGeometry(.022, 8, 6), beadMat = toonMat('#f0c565');
      for (let i = 0; i <= 22; i++) { const th = Math.PI * .42 + Math.PI * 1.16 * i / 22, b = new THREE.Mesh(bead, beadMat); b.position.set(Math.sin(th) * .425, -1.01, Math.cos(th) * .425); cloak.add(b); }
      const brooch = new THREE.Mesh(new THREE.OctahedronGeometry(.04), glow('#f0c565', .6)); brooch.position.set(0, .0, .13); cloak.add(brooch);
    }
    if (look.cloak) part(trunk, new THREE.TorusGeometry(.14, .05, 8, 20, Math.PI), look.top, [0, 1.42, -.03], { r: [Math.PI / 2 + .3, 0, Math.PI], outline: false });
    if (look.cape) part(trunk, new THREE.CylinderGeometry(.12, .17, .2, 18, 1, true, Math.PI * .7, Math.PI * 1.6), look.cape, [0, 1.47, 0], { double: true });
  }
  let staff = null, orb = null;
  if (look.staff) {
    // The staff stays a separate mesh (not baked) so she can set it aside for two-handed activities.
    staff = new THREE.Group(); staff.position.set(0, -.45, .05); arms[0].add(staff);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.018, .024, 1.55, 8), toonMat('#8d6b45')); shaft.position.y = .35; shaft.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.07, .014, 8, 20), toonMat('#d5b76e')); ring.position.y = 1.12;
    orb = new THREE.Mesh(new THREE.SphereGeometry(.062, 18, 12), new THREE.MeshStandardMaterial({ color: '#ffd979', emissive: '#ffd979', emissiveIntensity: 4 })); orb.position.y = 1.14;
    staff.add(shaft, ring, orb);
  }
  // Bake: every part becomes vertices weighted to its nearest bone.
  root.updateMatrixWorld(true);
  const bones = []; body.traverse(o => { if (o.isBone) bones.push(o); });
  const buckets = { toon: [], outline: [], face: [] }, col = new THREE.Color();
  for (const p of parts) {
    let owner = p.m.parent; while (!owner.isBone) owner = owner.parent;
    const g = p.m.geometry.index ? p.m.geometry.toNonIndexed() : p.m.geometry.clone(), n = g.attributes.position.count;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(p.m.matrixWorld);
    col.set(p.hex);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [col.r, col.g, col.b][i % 3]), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => i % 4 ? 0 : bones.indexOf(owner)), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => i % 4 ? 0 : 1), 4));
    buckets[p.face ? 'face' : 'toon'].push(g);
    if (p.outline) buckets.outline.push(g);
    p.m.removeFromParent();
  }
  const skeleton = new THREE.Skeleton(bones);
  for (const [kind, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const mesh = new THREE.SkinnedMesh(mergeGeometries(list), CHAR[kind]);
    mesh.castShadow = kind === 'toon'; mesh.receiveShadow = kind === 'toon'; mesh.frustumCulled = false;
    root.add(mesh); mesh.bind(skeleton);
  }
  root.scale.setScalar(1.18);
  return { root, body, legs, knees, arms, head, eyes, mouth, cloak, cloakMesh, staff, orb, phase: Math.random() * 6, yaw: 0, wave: 0, give: 0, blinkT: 1 + Math.random() * 3, expr: 'normal' };
}
function hair(head, look, part) {
  const c = look.hair, style = look.hairStyle;
  if (style === 'bald') return;
  part(head, new THREE.SphereGeometry(.182, 28, 18, 0, Math.PI * 2, 0, 1.55), c, [0, .006, -.006], { r: [-.46, 0, 0] });
  const bangs = (n, len, spread) => { for (let i = 0; i < n; i++) { const a = (i / (n - 1) - .5) * spread; part(head, SPHERE, c, [Math.sin(a) * .16, .125 - Math.abs(a) * .045, Math.cos(a) * .16 - .012], { s: [.058, len, .034], r: [-.42, a, -a * .5] }); } };
  if (style === 'long') { bangs(5, .07, 1.5); part(head, capsule(.15, .42), c, [0, -.22, -.085], { s: [1.08, 1, .55] }); for (const s of [-1, 1]) part(head, capsule(.042, .3), c, [s * .142, -.15, .035], { r: [0, 0, s * .08] }); }
  if (style === 'bob' || style === 'shoulder') {
    bangs(4, .07, 1.3);
    const h = style === 'shoulder' ? .3 : .19;
    part(head, new THREE.CylinderGeometry(.19, .205, h, 26, 1, true, Math.PI * .3, Math.PI * 1.4), c, [0, -.02 - h / 2 + .06, 0], { double: true });
  }
  if (style === 'ponytail') { bangs(4, .07, 1.2); part(head, SPHERE, c, [0, .05, -.18], { s: [.045, .045, .045] }); part(head, capsule(.055, .34), c, [0, -.17, -.235], { r: [.35, 0, 0] }); }
  if (style === 'sleek') { bangs(6, .085, 1.7); part(head, capsule(.13, .12), c, [0, -.1, -.1], { s: [1.1, 1, .7] }); }
  if (style === 'messy') { bangs(4, .07, 1.3); const r = rng32(9); for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, el = .25 + r() * .7, d = new THREE.Vector3(Math.sin(a) * Math.sin(el), Math.cos(el), Math.cos(a) * Math.sin(el)); part(head, new THREE.ConeGeometry(.045, .12, 6), c, [d.x * .17, d.y * .17, d.z * .17]).quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); } }
  if (style === 'neat') { bangs(3, .055, 1.0); part(head, SPHERE, c, [.05, .12, .1], { s: [.11, .05, .07], r: [-.5, 0, -.3] }); }
  if (look.beard) { part(head, SPHERE, c, [0, -.12, .085], { s: [.115, .085, .075] }); part(head, SPHERE, c, [0, -.07, .155], { s: [.05, .012, .015], outline: false }); }
}
function animateCharacter(ch, speed, dt, t, idleSeed = 0) {
  const s = clamp(speed / 5.5, 0, 1), still = reduceMotion.matches ? .3 : 1;
  ch.phase += speed * dt * Math.PI * 2 / 1.8; // cadence follows distance, so feet stop when movement stops
  const swing = Math.sin(ch.phase) * .75 * s;
  ch.legs[0].rotation.x = swing; ch.legs[1].rotation.x = -swing;
  ch.knees.forEach((k, i) => { k.rotation.x = -Math.max(0, Math.sin(ch.phase + i * Math.PI + .55)) * .85 * s; });
  const breathe = Math.sin(t * 1.8 + idleSeed) * .012 * still;
  ch.arms[0].rotation.x = -swing * .7 * (ch.cloak && !ch.wave ? .5 : 1);
  ch.arms[1].rotation.x = swing * .85;
  ch.arms[0].rotation.z = -.07 - breathe;
  ch.arms[1].rotation.z = .07 + breathe;
  if (ch.wave > 0) { ch.wave = Math.max(0, ch.wave - dt); const k = smooth(0, .3, Math.min(ch.wave, 1.8 - ch.wave)); ch.arms[1].rotation.z = .07 + k * 2.55; ch.arms[1].rotation.x = Math.sin(t * 11) * .25 * k; }
  if (ch.give > 0) { ch.give = Math.max(0, ch.give - dt); const k = smooth(0, .25, Math.min(ch.give, 1.5 - ch.give)); ch.arms[1].rotation.x = -1.3 * k; ch.arms[1].rotation.z = .07 + .12 * k; }
  ch.body.position.y = Math.abs(Math.sin(ch.phase)) * .06 * s + breathe * .5;
  ch.body.rotation.x = .1 * s;
  ch.head.rotation.y = Math.sin(t * .4 + idleSeed) * .18 * (1 - s) * still;
  if (ch.cloak) ch.cloak.rotation.x = .08 + .32 * s + Math.sin(t * 2.2 + idleSeed) * .03 * still;
  // Faces: everyone blinks every few seconds; expressions squint the eyes and shape the mouth.
  ch.blinkT -= dt;
  let lid = 1; if (ch.blinkT < 0) { lid = Math.min(1, Math.abs(ch.blinkT + .07) / .07); if (ch.blinkT < -.14) ch.blinkT = 2 + Math.random() * 3.5; }
  const ex = ch.expr, open = ex === 'closed' ? .1 : ex === 'happy' ? .45 : ex === 'wide' ? 1.15 : 1;
  for (const e of ch.eyes) e.scale.set(1, Math.max(.08, Math.min(lid, 1) * open), 1);
  if (ex === 'happy') ch.mouth.scale.set(1.5, 3.2, 1.2); else if (ex === 'wide') ch.mouth.scale.set(1.1, 4, 1.3); else if (ex === 'closed') ch.mouth.scale.set(1.15, 1.6, 1); else ch.mouth.scale.set(1, 1, 1);
}

// ───────────────────────────── beyond the sea ─────────────────────────────
// Four realms sit across the Sea of Possibility. They are places to wander and to do things in, not quest areas:
// XP still only comes from real-world quests. Each realm lives at a world offset and reuses the logical map's
// coordinate space (550, 360 is its centre), so app.js movement, travel and saving work unchanged.
const NIGHT_GLOW = [];
const nightGlow = (c, k = 1) => { const m = std('nglow' + c + k, { color: c, emissive: c, emissiveIntensity: 1 }); if (!NIGHT_GLOW.includes(m)) { m.userData.k = k; NIGHT_GLOW.push(m); } return m; };
const REALMS = [
  { id: 'florentia', name: 'Florentia', sub: 'City of the Renaissance', glyph: '⛫', at: [40, -205], rx: 31, rz: 23, H: 1.3, base: 0, seed: 11, labelH: 21,
    palette: { g1: '#93b25c', g2: '#6f9a48', g3: '#c6c972', sand: '#ead5a3', seabed: '#a99a72', rock: '#9a8f7e', pave: '#dccaa6' },
    pads: [[0, 2, 10, 1.3, 1], [0, -10, 7.6, 1.3, 1], [8.5, -9, 2.6, 1.3, 1], [-12, 3, 5, 1.3, 1], [15, 8.5, 3, 1.35, 1]], paths: [[0, 11, -3, 21, 2.2], [3, 4, 15, 8.5, 1.4]],
    arrive: 'Welcome to Florentia. Domes, cypress shade and an easel waiting by the sea.', build: buildFlorentia },
  { id: 'skygarden', name: 'The Sky Gardens', sub: 'Ruins above the clouds', glyph: '☁', at: [205, -95], rx: 19, rz: 16, H: 2.2, base: 30, float: true, seed: 23, labelH: 17,
    palette: { g1: '#7fb55a', g2: '#5d9a47', g3: '#b4d06a', sand: '#b9b096', seabed: '#8a8170', rock: '#8c8578', pave: '#cfc6a8' },
    pads: [[0, 0, 6.5, 2.2, 1], [10.5, 5, 2.6, 1.6, 1]], paths: [],
    arrive: 'The Sky Gardens. The wind is soft up here, and the gardener is still tending the flowers.', build: buildSkyGarden },
  { id: 'bathhouse', name: 'Lantern Bathhouse', sub: 'Where weary spirits rest', glyph: '♨', at: [-215, -55], rx: 25, rz: 19, H: 1.1, base: 0, seed: 37, labelH: 23,
    palette: { g1: '#86aa5e', g2: '#5f8a4a', g3: '#a9c26a', sand: '#e2cfa0', seabed: '#9b8f6c', rock: '#857c70', pave: '#b9a98c' },
    pads: [[-6, 0, 8.6, 1.1, 1], [7, -8, 3.8, 1.0, 1], [5, 4, 3.2, .95, 0]], paths: [[2, 1, 18, 3, 1.6]],
    arrive: 'The Lantern Bathhouse. The hot spring is warm, and the sea train is running.', build: buildBathhouse },
  { id: 'starfall', name: 'Starfall Shrine', sub: 'A waypoint among the stars', glyph: '✧', at: [-120, -215], rx: 15, rz: 13, H: 2.6, base: 0, seed: 51, labelH: 19,
    palette: { g1: '#7aa860', g2: '#4f8a52', g3: '#9fc77a', sand: '#dccfa6', seabed: '#8e8a74', rock: '#8a8a86', pave: '#d0cfc4' },
    pads: [[0, -2, 5.6, 2.6, 1], [5, 3, 1.8, 2.3, 1]], paths: [[0, 3, 5, 8, 1.4]],
    arrive: 'Starfall Shrine. Make a wish; the statue has been listening for a long time.', build: buildStarfall },
  { id: 'kobra', name: 'Kobra Kai', sub: 'The LeetCode dojo', glyph: '⚔', at: [170, -238], rx: 20, rz: 16, H: 1.6, base: 0, seed: 61, labelH: 15,
    palette: { g1: '#6f8f4a', g2: '#4f6e3a', g3: '#8a9a58', sand: '#cdbb92', seabed: '#7d735f', rock: '#5c5650', pave: '#3d3632' },
    pads: [[0, -6.5, 7, 1.6, 1], [0, 5.5, 4.8, 1.6, 1], [-6.2, .6, 2.6, 1.6, 1]], paths: [[0, 8, -6, 14, 2.2], [0, -2, 0, 3, 2]],
    arrive: 'Kobra Kai. Pattern first, edge case last, no mercy for bugs.', build: buildKobra },
  { id: 'hollow', name: 'Hush Hollow', sub: 'A quiet wood at golden hour', glyph: '❀', at: [-175, 165], rx: 26, rz: 21, H: 1.4, base: 0, seed: 73, labelH: 16,
    palette: { g1: '#8cba5c', g2: '#62a04a', g3: '#c8d474', sand: '#e6d3a4', seabed: '#a3956f', rock: '#8a8270', pave: '#d9c49a' },
    pads: [[0, -1.5, 6.5, 1.4, 0], [8.5, 4.5, 3, 1.3, 0]], paths: [],
    arrive: 'Hush Hollow. Soft light, sleepy cats, happy dogs. Nothing to do here but breathe.', build: buildHollow },
];
function realmField(R) {
  const S0 = Math.min(R.rx, R.rz);
  const sdf = (u, v) => { const a = Math.atan2(v / R.rz, u / R.rx); return (1 - Math.hypot(u / R.rx, v / R.rz) + noise2(Math.cos(a) * 1.4 + R.seed, Math.sin(a) * 1.4) * .07 + noise2(Math.cos(a) * 4 + R.seed, Math.sin(a) * 4) * .025) * S0; };
  const segD = (u, v, [x0, z0, x1, z1]) => { const dx = x1 - x0, dz = z1 - z0, t = clamp(((u - x0) * dx + (v - z0) * dz) / (dx * dx + dz * dz), 0, 1); return Math.hypot(u - x0 - dx * t, v - z0 - dz * t); };
  const height = (u, v) => {
    const d = sdf(u, v);
    if (d < 0) return R.float ? -1000 : Math.max(-4.5, d * .8);
    let h = R.base + smooth(0, 4.5, d) * R.H + fbm(u * .09 + R.seed, v * .09, 3) * R.H * .6 * smooth(1.5, 7, d);
    if (R.hill) h += R.hill(u, v, d);
    for (const P of R.pads) { const w = 1 - smooth(P[2] * .8, P[2] + 2.2, Math.hypot(u - P[0], v - P[1])); if (w > 0) h += (R.base + P[3] - h) * w; }
    return h;
  };
  const paved = (u, v) => {
    let w = 0;
    for (const P of R.pads) if (P[4]) w = Math.max(w, 1 - smooth(P[2] * .82, P[2] * .82 + .7, Math.hypot(u - P[0], v - P[1])));
    for (const L of R.paths) w = Math.max(w, 1 - smooth(L[4] * .5, L[4] * .5 + .5, segD(u, v, L)));
    return w;
  };
  return { sdf, height, paved };
}
function realmTerrain(R, F) {
  const W = R.rx * 2 + (R.float ? 6 : 26), D = R.rz * 2 + (R.float ? 6 : 26), nx = 120, nz = Math.round(120 * D / W);
  const g = new THREE.PlaneGeometry(W, D, nx, nz).rotateX(-Math.PI / 2), p = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(p.count * 3), c = new THREE.Color(), pal = {};
  for (const [k, v] of Object.entries(R.palette)) pal[k] = C(v);
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getZ(i), d = R.sdf(u, v), h = R.float && d < 0 ? R.base - 1.4 - Math.min(2, -d) : F.height(u, v);
    p.setY(i, h); uv.setXY(i, u / 5, v / 5);
    c.copy(pal.g1).lerp(pal.g2, smooth(-.3, .5, fbm(u * .07 + R.seed, v * .07, 3))).lerp(pal.g3, smooth(.1, .6, noise2(u * .15, v * .15 + R.seed)) * .5);
    const pv = F.paved(u, v); if (pv > 0) c.lerp(tmpCol.copy(pal.pave).multiplyScalar(.92 + noise2(u * 2.1, v * 2.1) * .08), pv);
    if (d < 2.6) c.lerp(R.float ? pal.rock : pal.sand, 1 - smooth(.6, 2.6, d + noise2(u * .3, v * .3) * .5));
    if (!R.float && h < -.05) c.copy(pal.seabed).multiplyScalar(1 - smooth(0, 4, -h) * .35);
    if (R.float && d < 0) c.copy(pal.rock);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.ground, roughness: .95 }));
  mesh.receiveShadow = true; return mesh;
}
const tmpCol = new THREE.Color();
// Soft shallows and lapping foam around a realm's beach, baked from its shape.
function shoreMesh(R) {
  const W = R.rx * 2 + 30, D = R.rz * 2 + 30, N = 160, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i / (N - 1) - .5) * W, v = (j / (N - 1) - .5) * D, d = R.sdf(u, v), k = (j * N + i) * 4;
    data[k] = clamp(1 - Math.abs(d + .5) / 1.6, 0, 1) * 255; data[k + 1] = clamp(1 + d / 9, 0, 1) * 255 * (d < .4 ? 1 : 0); data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTex: { value: tex }, uTime: U.time, uShallow: U.shallow, uLight: U.light, uNoise: NOISE },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.); }',
    fragmentShader: `uniform sampler2D uTex,uNoise; uniform float uTime,uLight; uniform vec3 uShallow; varying vec2 vUv; varying vec3 vW;
      void main(){ vec4 s=texture2D(uTex,vec2(vUv.x,1.-vUv.y)); float n=texture2D(uNoise,vW.xz*.05+uTime*.01).a;
        float band=s.r, wave=.5+.5*sin(uTime*1.3-s.g*14.+n*6.), foam=smoothstep(.45,.95,band*(.55+.45*wave)+n*.15);
        vec3 c=mix(uShallow*1.15,vec3(1.),foam)*max(uLight,.3); float a=max(s.g*s.g*.6,foam*.85);
        gl_FragColor=vec4(c,a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), m); mesh.position.y = .07; mesh.renderOrder = 2; return mesh;
}
const marbleM = () => std('marble', { color: '#f1ece0', map: TEX.plaster, roughness: .62 }, .35);
const stucco = c => std('stucco' + c, { color: c, map: TEX.plaster, roughness: .95 }, .35);
const solid = (c, r = .7, extra = {}) => std('solid' + c + r, { color: c, roughness: r, ...extra });
// A little house with a hip roof, shutters and a door; its front (+z) faces the given direction.
function house(k, u, y, v, ry, w, d, h, wall, roof, seed) {
  const hk = kit(), r = rng32(seed);
  hk.box(w, h, d, wall, 0, h / 2, 0);
  const rad = Math.hypot(w, d) / 2 * 1.04, rg = new THREE.ConeGeometry(rad, 1.25, 4).rotateY(Math.PI / 4); rg.scale((w + .5) / (rad * Math.SQRT2), 1, (d + .5) / (rad * Math.SQRT2));
  hk.add(rg, roof, 0, h + .62, 0);
  const shutter = solid('#3f6b4f', .8), cols = Math.max(2, Math.round(w / 1.3)), rows = Math.max(1, Math.floor((h - 1.4) / 1.25));
  for (let ry2 = 0; ry2 < rows; ry2++) for (let cx = 0; cx < cols; cx++) {
    const x = (cx - (cols - 1) / 2) * (w / cols), yy = 2.1 + ry2 * 1.25; if (ry2 === 0 && cx === (cols >> 1) && r() < .8) continue;
    hk.box(.42, .62, .05, M.window, x, yy, d / 2 + .02); for (const s of [-1, 1]) hk.box(.17, .64, .05, shutter, x + s * .31, yy, d / 2 + .03);
  }
  hk.box(.72, 1.35, .06, M.woodDark, 0, .68, d / 2 + .03);
  if (r() < .5) { hk.box(1.3, .08, .5, M.stoneDark, 0, 2.1 + 1.25 - .45, d / 2 + .25); hk.box(1.3, .32, .04, M.iron, 0, 2.1 + 1.25 - .27, d / 2 + .5); }
  if (r() < .6) hk.box(.35, .9, .35, wall, w * .3, h + 1, -d * .2);
  hk.g.position.set(u, y, v); hk.g.rotation.y = ry; k.g.add(hk.g);
}
// Lathe a pointed, eight-sided Renaissance dome with white ribs.
function domeParts(k, r, hgt, y, z, terra, rib) {
  const prof = []; for (let i = 0; i <= 14; i++) { const yy = i / 14 * hgt; prof.push(new THREE.Vector2(r * Math.max(0, 1 - (yy / hgt) ** 1.55) ** .58, yy)); }
  k.add(new THREE.LatheGeometry(prof, 8), terra, 0, y, z);
  for (let s = 0; s < 8; s++) { const ph = s / 8 * Math.PI * 2, pts = prof.map(p => new THREE.Vector3(Math.sin(ph) * p.x * 1.012, p.y, Math.cos(ph) * p.x * 1.012)); k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, .085, 5), rib, 0, y, z); }
}
function buildFlorentia(R, F) {
  const k = kit(), dyn = new THREE.Group(), Y = R.base + 1.3, marble = marbleM(), green = solid('#4f7a62', .45), rose = solid('#d6a19a', .5), terra = roofMat('#c0623e');
  const obstacles = [], spots = [], trees = [];
  // The duomo: striped nave, facade with rose window, octagonal drum, ribbed dome and lantern.
  const dz = -10;
  k.box(6.2, 4.4, 9, marble, 0, Y + 2.2, dz + 1.5);
  for (const s of [-1, 1]) { for (const yy of [1.2, 2.7, 4]) k.box(.07, .16, 9.02, green, s * 3.11, Y + yy, dz + 1.5); for (let i = 0; i < 6; i++) k.box(.09, 4.4, .22, green, s * 3.12, Y + 2.2, dz - 2.8 + i * 1.72); }
  k.prism(6.6, 1.6, 9.2, terra, 0, Y + 4.4, dz + 1.5);
  k.box(6.9, 5.9, .5, marble, 0, Y + 2.95, dz + 6.1); k.prism(6.9, 1.9, .52, marble, 0, Y + 5.9, dz + 6.1);
  for (const x of [-3.2, -1.6, 1.6, 3.2]) k.box(.2, 5.7, .1, green, x, Y + 2.9, dz + 6.38);
  for (const yy of [1.9, 4.9]) k.box(6.9, .14, .1, rose, 0, Y + yy, dz + 6.39);
  for (const s of [-1, 0, 1]) k.box(s ? .9 : 1.3, s ? 1.8 : 2.5, .1, M.dark, s * 2.3, Y + (s ? .9 : 1.25), dz + 6.38);
  k.torus(.78, .11, green, 0, Y + 3.7, dz + 6.4, 0); k.add(new THREE.CircleGeometry(.7, 24), M.window, 0, Y + 3.7, dz + 6.39);
  k.ball(.2, M.gold, 0, Y + 7.9, dz + 6.1, 12);
  k.add(new THREE.CylinderGeometry(3.4, 3.5, 2.6, 8), marble, 0, Y + 5.6, dz - 4.5);
  k.add(new THREE.CylinderGeometry(3.47, 3.47, .2, 8), green, 0, Y + 6.5, dz - 4.5);
  for (let s = 0; s < 8; s++) { const a = (s + .5) / 8 * Math.PI * 2; k.add(new THREE.CircleGeometry(.36, 16), M.window, Math.sin(a) * 3.36, Y + 5.6, dz - 4.5 + Math.cos(a) * 3.36, 0, a); }
  domeParts(k, 3.3, 4.6, Y + 6.9, dz - 4.5, terra, marble);
  k.cyl(.55, .62, 1.1, marble, 0, Y + 11.9, dz - 4.5, 8); k.cone(.66, 1, marble, 0, Y + 12.95, dz - 4.5, 8); k.ball(.2, M.gold, 0, Y + 13.6, dz - 4.5, 12);
  for (const [x, z] of [[-3.9, dz - 4.5], [3.9, dz - 4.5], [0, dz - 8.4]]) { k.cyl(1.7, 1.7, 3, marble, x, Y + 1.5, z, 14); k.add(new THREE.SphereGeometry(1.75, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), terra, x, Y + 3, z); }
  obstacles.push([0, dz + 4, 3.8], [0, dz + .2, 3.8], [0, dz - 4.5, 4], [0, dz - 8.4, 2.1], [-3.9, dz - 4.5, 2.1], [3.9, dz - 4.5, 2.1]);
  // Giotto-style bell tower with coloured marble bands.
  const [bx, bz] = [8.5, -9];
  k.box(2.4, 14, 2.4, marble, bx, Y + 7, bz);
  for (let i = 1; i < 7; i++) k.box(2.47, .16, 2.47, i % 2 ? green : rose, bx, Y + i * 2, bz);
  for (const [ox, oz, ry] of [[0, 1.22, 0], [0, -1.22, 0], [1.22, 0, Math.PI / 2], [-1.22, 0, Math.PI / 2]]) for (const yy of [7.2, 9.4, 11.8]) k.box(.5, 1.3, .06, M.dark, bx + ox, Y + yy, bz + oz, ry);
  k.box(2.9, .32, 2.9, marble, bx, Y + 14.15, bz); for (const [ox, oz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) k.box(.16, .6, .16, marble, bx + ox, Y + 14.6, bz + oz);
  k.ball(.32, M.gold, bx, Y + 13.2, bz, 12);
  obstacles.push([bx, bz, 1.9]);
  // A ring of stucco houses facing the piazza.
  const cols = ['#e9c690', '#e4a877', '#f1dab2', '#d99b6c', '#efe1c3', '#e6b98a'];
  [[-12, 1.3, 3.4, 3, 4.6], [10, 1.25, 3.6, 3.2, 5.2], [33, 1.3, 3.2, 3, 4.2], [57, 1.35, 3.4, 3.1, 4.8], [124, 1.25, 3.2, 3, 4.4], [148, 1.3, 3.8, 3.2, 5], [208, 1.25, 3.2, 3, 4.4], [228, 1.3, 3.4, 3.1, 5.2], [306, 1.3, 3.2, 3, 4.2], [330, 1.25, 3.6, 3, 4.6]].forEach(([deg, , w, d, h], i) => {
    const a = deg * Math.PI / 180, rr = 13.2, u = Math.cos(a) * rr, v = 2 + Math.sin(a) * rr;
    if (R.sdf(u, v) < 3) return;
    house(k, u, F.height(u, v) - .05, v, Math.atan2(-Math.cos(a), -Math.sin(a)), w, d, h, stucco(cols[i % cols.length]), terra, 100 + i);
    obstacles.push([u, v, Math.max(w, d) * .62]);
  });
  // The loggia: an open arcade with statues.
  { const lk = kit(); for (let i = 0; i < 7; i++) { const x = -3.9 + i * 1.3; lk.cyl(.13, .15, 2.6, marble, x, 1.3, 1.1, 10); lk.cyl(.2, .2, .12, marble, x, 2.62, 1.1, 10); if (i < 6) lk.torus(.65, .09, marble, x + .65, 2.6, 1.1, 0, 0, Math.PI); }
    lk.box(9.2, .55, 2.9, marble, 0, 3.25, 0); lk.box(9.2, 3.3, .3, stucco('#e8d2a8'), 0, 1.65, -1.25); lk.add(new THREE.BoxGeometry(9.6, .14, 3.4), terra, 0, 3.62, -.1, -.12);
    for (const x of [-2.6, 0, 2.6]) { lk.box(.7, .7, .7, marble, x, .35, -.55); lk.add(new THREE.CapsuleGeometry(.17, .5, 4, 10), marble, x, 1.1, -.55); lk.ball(.13, marble, x, 1.55, -.55, 12); }
    lk.g.position.set(-12.5, Y, 3); lk.g.rotation.y = Math.PI / 2; k.g.add(lk.g);
    for (let i = 0; i < 4; i++) obstacles.push([-13.4, 3 - 3.4 + i * 2.3, 1.5]);
    for (const zz of [-1, 7]) flag(dyn, '#b4492f', -11.3, Y + 3.4, zz, .9, 1.4, Math.PI / 2, '⚜'); }
  // The fountain.
  k.cyl(2.3, 2.45, .55, marble, 0, Y + .27, 3, 8); k.add(new THREE.CylinderGeometry(2.05, 2.05, .08, 24), M.pond, 0, Y + .5, 3);
  k.cyl(.32, .45, 1.6, marble, 0, Y + 1.2, 3, 10); k.cyl(1, .38, .32, marble, 0, Y + 1.95, 3, 16); k.add(new THREE.CapsuleGeometry(.14, .42, 4, 10), marble, 0, Y + 2.5, 3); k.ball(.11, M.gold, 0, Y + 2.92, 3, 10);
  dyn.add(particles(40, 1, { size: .09, speed: .7, rise: 1.4, spread: 1.4, origin: [0, Y + 2.1, 3], color: '#d8f2ff', boost: 1.4 }));
  obstacles.push([0, 3, 2.55]);
  spots.push({ u: 0, v: 6.1, face: Math.PI, act: 'sit', label: 'Rest by the fountain' });
  // Lamps and a cypress avenue down to the harbour.
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const u = -1 * (i / 4) * 3 + s * 2.4, v = 12 + i * 2.3; trees.push(['cypress', u, v, .85]); }
  for (const [u, v] of [[-2.2, 9.5], [2.2, 9.5], [3.5, -2], [-3.5, -2]]) { k.cyl(.06, .08, 2.8, M.iron, u, F.height(u, v) + 1.4, v, 6); k.ball(.2, M.lantern, u, F.height(u, v) + 2.9, v, 10); }
  // Vineyard rows and olive groves on the western slope.
  for (let row = 0; row < 5; row++) for (let i = 0; i < 9; i++) { const u = -24 + i * .95, v = 8 + row * 1.7; if (R.sdf(u, v) > 2.5) trees.push(['vine', u, v, .4]); }
  // The painter's easel above the sea.
  const easel = makeEasel(); const ef = Math.atan2(.55, .83); easel.g.position.set(15 + Math.sin(ef) * 1.15, Y + .05, 8.5 + Math.cos(ef) * 1.15); easel.g.rotation.y = ef + Math.PI; dyn.add(easel.g);
  spots.push({ u: 15, v: 8.5, face: ef, act: 'paint', label: 'Paint the view', easel });
  return { stat: k.g, dyn, obstacles, spots, trees, treeKinds: [['cypress', 26], ['olive', 18], ['oak', 4]] };
}
function buildSkyGarden(R, F) {
  const k = kit(), dyn = new THREE.Group(), Y = R.base + 2.2, obstacles = [], spots = [], trees = [];
  const moss = std('mossStone', { color: '#bdbca4', map: TEX.stone, bumpMap: TEX.stone, bumpScale: 1.2, roughness: .95 }, .42), mossTop = solid('#6f9c4c', 1);
  // The underside: a hanging cone of rock with roots and vines.
  { const prof = [[1, 0], [.97, -1.2], [.86, -3.5], [.66, -7], [.42, -11], [.22, -15], [.08, -18.5], [0, -20]].map(([r, y]) => new THREE.Vector2(r * Math.min(R.rx, R.rz), y));
    const g = new THREE.LatheGeometry(prof, 40), p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), w = 1 + .22 * fbm(x * .2 + y * .1, z * .2 - y * .13, 3); p.setXYZ(i, x * w * R.rx / Math.min(R.rx, R.rz), y, z * w * R.rz / Math.min(R.rx, R.rz)); c.set('#6f8f4a').lerp(tmpCol.set('#7d7262'), smooth(-.5, -3, y)).lerp(tmpCol.set('#a59a88'), smooth(-12, -19, y)); col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const under = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })); under.position.y = R.base - 1; under.castShadow = true; dyn.add(under);
    const vine = solid('#4f7a3a', 1), r = rng32(4);
    for (let i = 0; i < 26; i++) { const a = r() * Math.PI * 2, rr = .9 + r() * .1, len = 3 + r() * 9; k.cyl(.04 + r() * .05, .02, len, i % 3 ? vine : M.woodDark, Math.cos(a) * R.rx * rr * .93, R.base - 1.6 - len / 2, Math.sin(a) * R.rz * rr * .93, 5); } }
  // Two waterfalls spilling off the edge into the clouds.
  const fallMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: U.time, uNoise: NOISE, uLight: U.light },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float uTime,uLight; uniform sampler2D uNoise; varying vec2 vUv; void main(){ float n=texture2D(uNoise,vec2(vUv.x*1.5,vUv.y*.6+uTime*.35)).r, m=texture2D(uNoise,vec2(vUv.x*3.,vUv.y*1.3+uTime*.55)).a;
      float a=smoothstep(.0,.25,vUv.x)*smoothstep(1.,.75,vUv.x)*smoothstep(0.,.35,vUv.y)*(.45+.55*smoothstep(.3,.7,n*.6+m*.6)); vec3 c=mix(vec3(.72,.86,.95),vec3(1.),m)*max(uLight,.35); gl_FragColor=vec4(c,a*.85);
      #include <colorspace_fragment>
      }` });
  for (const a of [.5, 2.6]) { const u = Math.cos(a) * (R.rx - .6), v = Math.sin(a) * (R.rz - .6), fall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 36), fallMat); fall.position.set(u * 1.02, R.base - 17, v * 1.02); fall.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)); fall.renderOrder = 3; dyn.add(fall);
    k.add(new THREE.CylinderGeometry(1.6, 1.6, .08, 18), M.pond, u * .86, F.height(u * .86, v * .86) + .05, v * .86);
    dyn.add(particles(30, 1, { size: 1.1, speed: .25, rise: 2.5, spread: 3, origin: [u * 1.02, R.base - 30, v * 1.02], box: [2.5, 0, 0], color: '#f4f8ff', additive: false, opacity: .35 })); }
  // A ruined circular colonnade around the great tree.
  const r2 = rng32(8);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, u = Math.cos(a) * 5.2, v = Math.sin(a) * 5.2, broken = [2, 5, 6, 9].includes(i), h = broken ? .8 + r2() * 1.4 : 3.2;
    k.cyl(.26, .3, h, moss, u, Y + h / 2, v, 10); k.cyl(.36, .36, .22, moss, u, Y + .11, v, 10); if (!broken) k.box(.75, .2, .75, moss, u, Y + h + .1, v); k.add(new THREE.SphereGeometry(.3, 8, 6), mossTop, u, Y + h + (broken ? 0 : .2), v).scale.set(1, .35, 1);
    obstacles.push([u, v, .55]); }
  for (let i = 0; i < 3; i++) { const a0 = (10 + i) / 12 * Math.PI * 2, a1 = (11 + i) / 12 * Math.PI * 2; if (i === 2) break; const m = (a0 + a1) / 2; k.box(2.8, .35, .55, moss, Math.cos(m) * 5.05, Y + 3.38, Math.sin(m) * 5.05, -m + Math.PI / 2); }
  k.add(new THREE.CylinderGeometry(.3, .3, 3, 10), moss, 3.2, Y + .32, -7, 0, .7, Math.PI / 2);
  const tree = new THREE.Mesh(treeGeometry('sacred', rng32(5), 2), treeMaterial()); tree.position.set(0, Y - .1, 0); tree.scale.setScalar(1.25); tree.castShadow = tree.receiveShadow = true; dyn.add(tree);
  obstacles.push([0, 0, 2.6]);
  // The gardener: a gentle, mossy stone guardian with flowers on its shoulders.
  { const gk = kit(); gk.add(new THREE.SphereGeometry(1.05, 18, 14), moss, 0, 1.15, 0).scale.set(1, 1.1, .9); gk.ball(.5, moss, 0, 2.25, .35, 16); gk.ball(.12, nightGlow('#ffb347', 2), 0, 2.3, .82, 10);
    for (const s of [-1, 1]) { gk.add(new THREE.CapsuleGeometry(.16, 1.5, 4, 8), moss, s * 1.05, 1.0, .2, .3, 0, s * .2); gk.ball(.22, moss, s * 1.2, .2, .55, 10); }
    for (let i = 0; i < 10; i++) { const a = r2() * Math.PI, s = r2() < .5 ? -1 : 1; gk.ball(.08, solid(['#ffd85a', '#f59ac0', '#ffffff', '#a9c4ff'][i % 4], .8), s * (.4 + r2() * .5), 2 + r2() * .3, Math.cos(a) * .4, 8); }
    gk.add(new THREE.SphereGeometry(.9, 12, 8), mossTop, 0, 1.75, -.15).scale.set(1.05, .5, .95);
    gk.g.position.set(-7, Y - .1, 6); gk.g.rotation.y = .6; k.g.add(gk.g); obstacles.push([-7, 6, 1.6]); }
  // An overlook bench.
  k.box(1.9, .12, .55, moss, 11.2, F.height(11.2, 5.6) + .5, 5.6, -.5); for (const s of [-1, 1]) k.box(.2, .45, .45, moss, 11.2 + s * .8 * Math.cos(.5), F.height(11.2, 5.6) + .22, 5.6 + s * .8 * Math.sin(.5), -.5);
  spots.push({ u: 10.2, v: 4.2, face: Math.atan2(.9, .4), act: 'meditate', label: 'Meditate at the overlook' });
  spots.push({ u: -12.5, v: -3.5, face: Math.atan2(-1, -.2), act: 'gaze', label: 'Watch the clouds' });
  // Floating stones and clouds drift around the island.
  const drift = new THREE.Group(); dyn.add(drift); const fr = rng32(12), floaters = [];
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + fr(), rr = Math.max(R.rx, R.rz) + 5 + fr() * 9, rock = new THREE.Mesh(rockGeometry(i + 3), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, flatShading: true }));
    const s = .9 + fr() * 1.8; rock.scale.set(s * 1.4, s, s * 1.2); rock.position.set(Math.cos(a) * rr, R.base - 3 + fr() * 9, Math.sin(a) * rr); drift.add(rock); floaters.push({ m: rock, y: rock.position.y, ph: fr() * 6 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(s * 1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mossTop); cap.scale.set(1.15, .3, 1); cap.position.y = s * .55; rock.add(cap); }
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: .18, transparent: true, opacity: .92 });
  for (let i = 0; i < 16; i++) { const a = fr() * Math.PI * 2, rr = 16 + fr() * 32, c = new THREE.Group(); c.position.set(Math.cos(a) * rr, R.base - 12 + fr() * 10, Math.sin(a) * rr);
    for (let j = 0; j < 5; j++) { const b = new THREE.Mesh(SPHERE, cloudMat), s = 1.6 + fr() * 2.4; b.scale.set(s * 1.4, s * .7, s); b.position.set((fr() - .5) * 5, (fr() - .2) * 1.2, (fr() - .5) * 3); c.add(b); }
    drift.add(c); }
  const tick = t => { drift.rotation.y = t * .006; for (const f of floaters) { f.m.position.y = f.y + Math.sin(t * .5 + f.ph) * .6; f.m.rotation.y = t * .05 + f.ph; } };
  return { stat: k.g, dyn, obstacles, spots, trees, tick, treeKinds: [['oak', 10], ['birch', 8], ['sakura', 4]] };
}
function buildBathhouse(R, F) {
  const k = kit(), dyn = new THREE.Group(), Y = R.base + 1.1, obstacles = [], spots = [], trees = [];
  const lacquer = solid('#a8392b', .5), frame = solid('#35261f', .8), teal = roofMat('#3f6f68'), gold = M.gold, red = nightGlow('#ff7a4a', 1.1);
  // The bathhouse: four tiers of red lacquer under flared teal roofs, every window lit at dusk.
  { const bk = kit(); bk.box(12, 1, 10, M.stoneDark, 0, .5, 0);
    const tiers = [[10, 3, 8], [8.2, 2.7, 6.6], [6.4, 2.4, 5.2], [4.4, 2.1, 3.6]]; let y = 1;
    tiers.forEach(([w, h, d], ti) => {
      bk.box(w, h, d, lacquer, 0, y + h / 2, 0);
      for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) bk.box(.22, h, .22, frame, x, y + h / 2, z);
      bk.box(w + .1, .16, d + .1, frame, 0, y + h - .1, 0);
      const n = Math.round(w / 1.2); for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * (w / n); bk.box(.55, h * .42, .05, M.window, x, y + h * .55, d / 2 + .03); bk.box(.55, h * .42, .05, M.window, x, y + h * .55, -d / 2 - .03); }
      const rr = Math.hypot(w, d) / 2 * 1.32, rg = new THREE.ConeGeometry(rr, 1.1, 4).rotateY(Math.PI / 4); rg.scale((w + 2.2) / (rr * Math.SQRT2), 1, (d + 2.2) / (rr * Math.SQRT2)); bk.add(rg, teal, 0, y + h + .5, 0);
      for (const s of [-1, 1]) for (let i = 0; i < 7; i++) { const x = (i - 3) * (w + 1.6) / 7; dyn.userData.lanterns = (dyn.userData.lanterns || 0) + 1; bk.ball(.13, red, x, y + h - .05, s * (d / 2 + .9), 8); }
      y += h + .55;
    });
    bk.cyl(.07, .1, 1.8, gold, 0, y + .7, 0, 8); bk.ball(.22, gold, 0, y + 1.6, 0, 12);
    bk.box(2.2, 2.4, .2, frame, 0, 2.2, 4.08); bk.box(1.6, 2, .1, M.lantern, 0, 2.1, 4.12);
    bk.g.position.set(-6, Y - .05, 0); bk.g.rotation.y = Math.PI / 2; k.g.add(bk.g);
    obstacles.push([-6, 0, 6.6], [-6, -3.5, 4.4], [-6, 3.5, 4.4]); }
  k.cyl(.9, 1.1, 13, solid('#7d4a3a', .9), -12, Y + 6.5, -4, 12);
  dyn.add(particles(26, 1, { size: 1.6, speed: .07, rise: 8, spread: 1.4, origin: [-12, Y + 13.2, -4], box: [3, 0, 0], color: '#e9e6e0', additive: false, opacity: .3 }));
  // A red arched bridge over the koi pond.
  { const pk = kit(); pk.add(new THREE.CylinderGeometry(2.6, 2.6, .08, 30), M.pond, 0, -.02, 0);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pk.rock(.35, M.stoneDark, Math.cos(a) * 2.75, .05, Math.sin(a) * 2.75, i); }
    for (let i = 0; i <= 12; i++) { const u = -3.2 + i * .53, y = Math.sin((i / 12) * Math.PI) * 1.05 + .15; pk.box(.5, .1, 1.7, lacquer, u, y, 0); }
    for (const s of [-1, 1]) for (let i = 0; i <= 12; i += 2) { const u = -3.2 + i * .53, y = Math.sin((i / 12) * Math.PI) * 1.05 + .15; pk.cyl(.05, .05, .7, lacquer, u, y + .35, s * .82, 6); }
    const by = F.height(5, 4); pk.g.position.set(5, by, 4); k.g.add(pk.g);
    R.deck = (u, v) => Math.abs(v - 4) < .85 && u > 1.8 && u < 8.2 ? by + .2 + Math.sin((u - 1.8) / 6.4 * Math.PI) * 1.05 : null;
    for (let i = 0; i < 5; i++) { const a = i * 1.3, fish = new THREE.Mesh(new THREE.CapsuleGeometry(.07, .25, 3, 6).rotateX(Math.PI / 2), solid(i % 2 ? '#ff8a3d' : '#fff3e6', .5)); fish.position.set(5, F.height(5, 4) + .02, 4); fish.userData.ph = a; dyn.add(fish); (dyn.userData.fish ||= []).push(fish); }
    obstacles.push([5, 4, 2.8, 1]); }
  // The outdoor hot spring.
  { const ok = kit(); ok.add(new THREE.CylinderGeometry(2.7, 2.7, .1, 30), solid('#5fb3ad', .08, { metalness: .1, envMapIntensity: 1.4 }), 0, .18, 0);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; ok.rock(.42 + (i % 3) * .08, M.stoneDark, Math.cos(a) * 2.95, .15, Math.sin(a) * 2.95, i + 7); }
    ok.g.position.set(7, F.height(7, -8) - .1, -8); k.g.add(ok.g);
    dyn.add(particles(36, 1, { size: 1.2, speed: .1, rise: 3, spread: 3.4, origin: [7, F.height(7, -8) + .3, -8], color: '#ffffff', additive: false, opacity: .28 }));
    spots.push({ u: 7, v: -8, face: Math.PI / 2, act: 'soak', label: 'Soak in the hot spring' }); }
  // Stone lanterns along the path.
  for (const [u, v] of [[4, -1.5], [9, -1.8], [13, 4.8], [9.5, 6.6], [1.5, -4]]) { const y = F.height(u, v); k.cyl(.32, .4, .25, M.stoneDark, u, y + .12, v, 8); k.cyl(.1, .12, .8, M.stoneDark, u, y + .6, v, 8); k.box(.42, .4, .42, M.lantern, u, y + 1.2, v); k.cone(.42, .3, M.stoneDark, u, y + 1.55, v, 4, Math.PI / 4); obstacles.push([u, v, .5]); }
  // The sea railway: rails just above the waves, and a little train that runs out to the horizon and back.
  { const rk = kit(), len = 150, u0 = -R.rx + 2;
    for (let i = 0; i < len / 3; i++) { const u = u0 - i * 3; rk.cyl(.12, .14, 3, M.stoneDark, u, -1.3, 2.4, 6); rk.box(.25, .14, 2.2, M.woodDark, u, .22, 2.4); }
    for (const s of [-1, 1]) rk.box(len, .08, .08, M.iron, u0 - len / 2, .33, 2.4 + s * .6);
    k.g.add(rk.g);
    const train = new THREE.Group(), tk = kit(); tk.box(5.2, 2.1, 2.1, solid('#3c6e6a', .55), 0, 1.45, 0); tk.box(5.25, .28, 2.15, solid('#efe2c4', .7), 0, 1.15, 0); tk.box(5.3, .14, 2.2, lacquer, 0, .5, 0);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) tk.box(.65, .7, .05, M.window, -2 + i, 1.8, s * 1.06);
    tk.box(5.4, .18, 2.3, frame, 0, 2.55, 0); tk.ball(.16, M.lantern, 2.65, 1.6, 0, 8); train.add(mergeGroup(tk.g)); train.position.set(u0, .1, 2.4); dyn.add(train); dyn.userData.train = { g: train, u0, len }; }
  // Floating lanterns and lily pads on the water.
  { const lr = rng32(31), pad = solid('#4e8a45', .7), petal = solid('#f5a6c4', .6);
    for (let i = 0; i < 18; i++) { const a = lr() * Math.PI * 2, rr = 1 + .08 + lr() * .3, u = Math.cos(a) * R.rx * rr, v = Math.sin(a) * R.rz * rr; const l = new THREE.Mesh(new THREE.BoxGeometry(.32, .32, .32), M.lantern); l.position.set(u, .2, v); l.userData.ph = lr() * 6; dyn.add(l); (dyn.userData.floats ||= []).push(l); }
    for (let i = 0; i < 26; i++) { const a = lr() * Math.PI * 2, rr = 1.02 + lr() * .12, u = Math.cos(a) * R.rx * rr, v = Math.sin(a) * R.rz * rr; k.add(new THREE.CircleGeometry(.45 + lr() * .3, 12, .3, Math.PI * 1.85).rotateX(-Math.PI / 2), pad, u, .09, v, 0, lr() * 6, 0, false); if (lr() < .35) k.ball(.12, petal, u, .2, v, 8); } }
  const tick = t => {
    const tr = dyn.userData.train, k2 = .5 - .5 * Math.cos(t * .045); tr.g.position.x = tr.u0 - 4 - k2 * (tr.len - 10);
    for (const l of dyn.userData.floats) { l.position.y = .18 + Math.sin(t * 1.1 + l.userData.ph) * .06; l.rotation.y = t * .2 + l.userData.ph; }
    for (const f of dyn.userData.fish) { const a = t * .5 + f.userData.ph; f.position.x = 5 + Math.cos(a) * 1.6; f.position.z = 4 + Math.sin(a) * 1.6; f.rotation.y = -a; }
  };
  return { stat: k.g, dyn, obstacles, spots, trees, tick, treeKinds: [['sakura', 16], ['pine', 8], ['oak', 6]] };
}
function buildStarfall(R, F) {
  const k = kit(), dyn = new THREE.Group(), Y = R.base + 2.6, obstacles = [], spots = [], trees = [];
  const stat = std('statue', { color: '#e2e4d8', map: TEX.stone, roughness: .8 }, .42), rune = nightGlow('#8fe6ff', 1.6), cyan = glow('#7fe3ff', 3);
  // A stepped plinth and a robed statue raising a glowing orb: a waypoint statue among the stars.
  k.cyl(4.2, 4.4, .5, M.stoneDark, 0, Y + .25, -2, 8); k.cyl(3.3, 3.5, .5, stat, 0, Y + .75, -2, 8); k.cyl(2.4, 2.55, .5, stat, 0, Y + 1.25, -2, 8);
  k.add(new THREE.RingGeometry(4.7, 4.95, 64).rotateX(-Math.PI / 2), rune, 0, Y + .04, -2, 0, 0, 0, false);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; k.add(new THREE.PlaneGeometry(.5, .5).rotateX(-Math.PI / 2), rune, Math.cos(a) * 4.82, Y + .05, -2 + Math.sin(a) * 4.82, 0, a, 0, false); }
  k.cone(1.05, 3.3, stat, 0, Y + 3.15, -2, 18); k.add(new THREE.SphereGeometry(.62, 16, 10), stat, 0, Y + 4.6, -2).scale.set(1.2, .7, 1);
  k.ball(.4, stat, 0, Y + 5.2, -1.95, 16); k.add(new THREE.SphereGeometry(.5, 14, 10, 0, Math.PI * 2, 0, Math.PI * .55), stat, 0, Y + 5.25, -2.05);
  for (const s of [-1, 1]) k.add(new THREE.CapsuleGeometry(.12, 1.1, 4, 8), stat, s * .42, Y + 5.6, -1.75, -.35, 0, -s * .45);
  for (const s of [-1, 1]) { const wg = new THREE.BoxGeometry(.12, 2.4, 1.2); wg.translate(0, 1, -.4); k.add(wg, stat, s * .6, Y + 3.9, -2.5, -.25, s * .5, s * .5); }
  k.torus(.75, .05, M.gold, 0, Y + 5.3, -2.55, 0);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(.32, 20, 14), cyan); orb.position.set(0, Y + 6.45, -1.7); dyn.add(orb);
  obstacles.push([0, -2, 4.3]);
  // The waypoint: a floating crystal inside turning gold rings.
  k.cyl(.7, .9, .5, stat, 5, F.height(5, 3) + .25, 3, 8); k.add(new THREE.RingGeometry(.9, 1.05, 32).rotateX(-Math.PI / 2), rune, 5, F.height(5, 3) + .52, 3, 0, 0, 0, false);
  const wp = new THREE.Group(); wp.position.set(5, F.height(5, 3) + 2, 3); dyn.add(wp);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.42), cyan); crystal.scale.y = 1.6; wp.add(crystal);
  const rings = [0, 1].map(i => { const r = new THREE.Mesh(new THREE.TorusGeometry(.8 + i * .18, .03, 6, 40), M.gold); wp.add(r); return r; });
  obstacles.push([5, 3, 1]);
  dyn.add(particles(40, 1, { size: .12, speed: .3, rise: 5, spread: 6, origin: [0, Y, -2], color: '#9fe8ff', boost: 2.4 }));
  // Glowing lilies, standing stones and rocky outcrops.
  const lr = rng32(17), lilyGeo = new THREE.ConeGeometry(.08, .22, 5).translate(0, .2, 0), lily = new THREE.InstancedMesh(lilyGeo, nightGlow('#cfeeff', 1.2), 60), d0 = new THREE.Object3D();
  let n = 0; for (let tries = 0; n < 60 && tries < 900; tries++) { const u = (lr() - .5) * R.rx * 2, v = (lr() - .5) * R.rz * 2; if (R.sdf(u, v) < 1.5 || Math.hypot(u, v + 2) < 5 || Math.hypot(u - 5, v - 3) < 1.6) continue; d0.position.set(u, F.height(u, v), v); d0.rotation.set(0, lr() * 6, 0); d0.updateMatrix(); lily.setMatrixAt(n++, d0.matrix); }
  lily.count = n; dyn.add(lily);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + .4, u = Math.cos(a) * 8.5, v = Math.sin(a) * 7.2; if (R.sdf(u, v) < 2) continue; k.box(.7, 2.4 + (i % 2), .5, stat, u, F.height(u, v) + 1.1, v, a); obstacles.push([u, v, .7]); }
  spots.push({ u: 0, v: 3.2, face: Math.PI, act: 'pray', label: 'Make a wish at the statue' });
  spots.push({ u: 5, v: 5.4, face: Math.PI, act: 'meditate', label: 'Rest by the waypoint' });
  const tick = t => { orb.position.y = Y + 6.45 + Math.sin(t * 1.4) * .08; crystal.rotation.y = t * .8; wp.position.y = F.height(5, 3) + 2 + Math.sin(t * 1.2) * .15; rings[0].rotation.set(t * .7, t * .4, 0); rings[1].rotation.set(-t * .5, 0, t * .6); };
  return { stat: k.g, dyn, obstacles, spots, trees, tick, treeKinds: [['pine', 8], ['birch', 6]] };
}
// Kobra Kai: the LeetCode dojo. Gilfoyle sends her here whenever she says she's doing LeetCode.
function emblemTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#121212'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#e3c35c'; g.lineWidth = 12; g.beginPath(); g.arc(s / 2, s / 2, s * .44, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(s / 2, s / 2, s * .38, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#e3c35c'; g.beginPath(); g.ellipse(s / 2, s * .4, s * .17, s * .2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#121212'; g.beginPath(); g.ellipse(s / 2, s * .43, s * .1, s * .14, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e3c35c'; g.beginPath(); g.ellipse(s / 2, s * .3, s * .055, s * .07, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c0392b'; for (const x of [-1, 1]) { g.beginPath(); g.arc(s / 2 + x * s * .025, s * .29, s * .012, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#e3c35c'; g.lineWidth = 14; g.lineCap = 'round'; g.beginPath(); g.moveTo(s / 2, s * .6); g.bezierCurveTo(s * .3, s * .66, s * .72, s * .72, s * .46, s * .8); g.stroke();
    g.fillStyle = '#e3c35c'; g.font = `bold ${s * .085}px Georgia, serif`; g.textAlign = 'center'; g.fillText('KOBRA KAI', s / 2, s * .93);
  });
}
function bannerTexture(text) {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#141414'; g.fillRect(0, 0, s, s); g.strokeStyle = '#e3c35c'; g.lineWidth = 8; g.strokeRect(14, 8, s - 28, s - 16);
    g.fillStyle = '#e3c35c'; g.font = `bold ${s * .16}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    text.split(' ').forEach((w, i, a) => g.fillText(w, s / 2, s / 2 + (i - (a.length - 1) / 2) * s * .2));
  });
}
function codeScreen() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 170; const g = c.getContext('2d');
  g.fillStyle = '#16181d'; g.fillRect(0, 0, 256, 170);
  const lines = [['#c792ea', 'class Solution {'], ['#82aaff', '  boolean isValid(String s) {'], ['#ffcb6b', '    Deque<Character> st = new ArrayDeque<>();'], ['#c3e88d', '    for (char ch : s.toCharArray()) {'], ['#89ddff', '      if (open(ch)) st.push(ch);'], ['#f78c6c', '      else if (st.isEmpty()) return false;'], ['#89ddff', '      else if (!pair(st.pop(), ch)) return false;'], ['#c3e88d', '    }'], ['#82aaff', '    return st.isEmpty();  // O(n)'], ['#c792ea', '  }'], ['#c792ea', '}']];
  g.font = '11px Menlo, monospace'; lines.forEach(([col, t], i) => { g.fillStyle = '#4a5060'; g.fillText(String(i + 1).padStart(2), 4, 16 + i * 14); g.fillStyle = col; g.fillText(t, 24, 16 + i * 14); });
  g.fillStyle = '#7dffb2'; g.fillText('✓ Accepted · 0 ms', 140, 162);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function buildKobra(R, F) {
  const k = kit(), dyn = new THREE.Group(), Y = R.base + 1.6, obstacles = [], spots = [], trees = [];
  const black = solid('#1b1918', .7), red = solid('#7a1f1a', .55), gold = M.gold, tiles = roofMat('#2b2725'), stone = M.stoneDark;
  // The dojo hall on its platform, black and gold with the cobra over the door.
  k.box(11.4, .5, 8.2, M.woodDark, 0, Y + .25, -6.5);
  k.box(9.6, 3.2, 6.6, black, 0, Y + .5 + 1.6, -6.5);
  for (const yy of [.62, 3.55]) k.box(9.7, .14, 6.7, gold, 0, Y + yy, -6.5);
  for (const [x, z] of [[-4.8, -3.2], [4.8, -3.2], [-4.8, -9.8], [4.8, -9.8], [-1.7, -3.2], [1.7, -3.2]]) k.box(.3, 3.3, .3, red, x, Y + 2.15, z);
  k.box(2.6, 2.5, .12, M.woodDark, 0, Y + 1.75, -3.15); k.box(.06, 2.5, .14, gold, 0, Y + 1.75, -3.1);
  k.prism(10.8, 2.3, 7.9, tiles, 0, Y + 3.62, -6.5); k.box(11, .14, .14, gold, 0, Y + 5.9, -6.5);
  for (const [x, z] of [[-5.4, -2.55], [5.4, -2.55], [-5.4, -10.45], [5.4, -10.45]]) k.add(new THREE.ConeGeometry(.12, .5, 6), gold, x, Y + 3.75, z, .5 * Math.sign(z + 6.5), 0, -.5 * Math.sign(x));
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(1.15, 40), new THREE.MeshStandardMaterial({ map: emblemTexture(), roughness: .6, emissive: '#e3c35c', emissiveIntensity: .08 })); emblem.position.set(0, Y + 4.35, -2.6); dyn.add(emblem);
  for (const [x, text] of [[-3.3, 'PATTERN FIRST'], [3.3, 'NO MERCY FOR BUGS']]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.6), new THREE.MeshStandardMaterial({ map: bannerTexture(text), side: THREE.DoubleSide, roughness: .9 })); b.position.set(x, Y + 2.2, -3.05); dyn.add(b); }
  obstacles.push([0, -6.5, 5.8], [-3.6, -6.5, 4.1], [3.6, -6.5, 4.1]);
  // Training yard: a mat, wooden dummies, a heavy bag and a weapon rack.
  k.box(4.4, .06, 4.4, solid('#c9b27a', .9), 0, Y + .03, 5.5); k.box(4.7, .04, 4.7, black, 0, Y + .015, 5.5);
  for (const [x, z] of [[-4.6, 3.6], [-4.6, 7.2]]) { k.cyl(.2, .22, 1.7, M.wood, x, Y + .85, z, 10); for (const [yy, ry] of [[1.35, .4], [1.35, -.4], [.85, 0]]) k.add(new THREE.CylinderGeometry(.05, .05, .5, 6), M.woodDark, x + Math.sin(ry) * .25, Y + yy, z + Math.cos(ry) * .25, Math.PI / 2, ry, 0); k.box(.7, .1, .7, M.woodDark, x, Y + .05, z); obstacles.push([x, z, .55]); }
  for (const s of [-1, 1]) k.cyl(.08, .09, 2.8, M.woodDark, 4.6 + s * .9, Y + 1.4, 6, 8); k.box(2.1, .14, .14, M.woodDark, 4.6, Y + 2.8, 6);
  const bag = new THREE.Group(); bag.userData.noCollide = true; bag.position.set(4.6, Y + 2.75, 6); const bagMesh = new THREE.Mesh(new THREE.CapsuleGeometry(.26, .8, 4, 12), red); bagMesh.position.y = -1.05; bagMesh.castShadow = true; bag.add(bagMesh); dyn.add(bag);
  obstacles.push([3.7, 6, .4], [5.5, 6, .4], [4.6, 6, .5]);
  k.box(1.8, 1.3, .3, M.woodDark, 5.2, Y + .65, 1.8, -.3); for (let i = 0; i < 4; i++) k.add(new THREE.CylinderGeometry(.025, .025, 1.6, 6), M.wood, 4.6 + i * .35, Y + .95, 2.0, 0, -.3, .12); obstacles.push([5.2, 1.8, 1]);
  // Gold cobra statues guarding the path.
  for (const sx of [-1, 1]) { const ck = kit(); ck.box(.9, .7, .9, stone, 0, .35, 0); ck.add(new THREE.TorusGeometry(.38, .12, 8, 24).rotateX(Math.PI / 2), gold, 0, .82, 0);
    ck.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(.38, .82, 0), new THREE.Vector3(.25, 1.3, 0), new THREE.Vector3(0, 1.8, .05), new THREE.Vector3(0, 2.15, .1)]), 16, .1, 8), gold);
    ck.add(new THREE.SphereGeometry(1, 16, 10), gold, 0, 2.2, .08).scale.set(.32, .4, .09); ck.add(new THREE.SphereGeometry(1, 12, 8), gold, 0, 2.42, .22).scale.set(.12, .08, .17);
    for (const e of [-1, 1]) ck.ball(.025, glow('#ff3b2f', 2), e * .05, 2.46, .36, 6);
    ck.g.position.set(sx * 1.9 - 4.5, Y, 11.2); ck.g.rotation.y = .65; k.g.add(ck.g); obstacles.push([sx * 1.9 - 4.5, 11.2, .7]); }
  // The LeetCode desk under a little pavilion: a cushion, a low table and a laptop showing today's solution.
  const px = -6.2, pz = .6;
  for (const [x, z] of [[-1.3, -1.1], [1.3, -1.1], [-1.3, 1.3], [1.3, 1.3]]) { k.cyl(.08, .09, 2.6, red, px + x, Y + 1.3, pz + z, 8); obstacles.push([px + x, pz + z, .25]); }
  k.prism(3.4, 1, 3.2, tiles, px, Y + 2.6, pz + .1, Math.PI / 2);
  k.box(1.1, .32, .6, M.woodDark, px, Y + .16, pz - .35); k.box(.75, .07, .75, red, px, Y + .035, pz + .55);
  const laptop = new THREE.Group(); laptop.position.set(px, Y + .33, pz - .4);
  const lb = new THREE.Mesh(new THREE.BoxGeometry(.46, .025, .32), solid('#2b2b2f', .4)); laptop.add(lb);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.44, .29), new THREE.MeshBasicMaterial({ map: codeScreen(), toneMapped: false })); screen.position.set(0, .15, -.16); screen.rotation.x = -.25; laptop.add(screen);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(.46, .31, .015), solid('#2b2b2f', .4)); lid.position.set(0, .15, -.17); lid.rotation.x = -.25; laptop.add(lid); dyn.add(laptop);
  dyn.add(particles(22, 1, { size: .06, speed: .5, rise: 1.1, spread: .5, origin: [px, Y + .6, pz - .4], color: '#7dffb2', boost: 2.2 }));
  spots.push({ u: px, v: pz + .55, face: Math.PI, act: 'leetcode', label: 'Grind a LeetCode problem' });
  spots.push({ u: 0, v: 5.6, face: Math.PI, act: 'kata', label: 'Train kata on the mat' });
  // Torches and stone lanterns.
  for (const [u, v] of [[-2.6, 9.5], [2.6, 9.5], [-6, -1.8], [6, -1.8]]) { const y = F.height(u, v); k.cyl(.3, .38, .25, stone, u, y + .12, v, 8); k.cyl(.09, .11, .9, stone, u, y + .65, v, 8); k.box(.42, .42, .42, M.lantern, u, y + 1.3, v); k.cone(.42, .3, stone, u, y + 1.66, v, 4, Math.PI / 4); obstacles.push([u, v, .45]); }
  const npcs = [{ name: 'Sensei Fletcher', color: '#e3c35c', u: -3.4, v: 2.6, face: -.9, look: { skin: '#d9ab86', hair: '#2a2a2a', hairStyle: 'bald', eyes: '#3b2c24', top: '#151515', sleeve: '#151515', legs: '#151515', boots: '#151515', coat: '#151515', belt: '#e3c35c', trim: '#e3c35c', blush: false },
    lines: ['Pattern first. Then complexity. Then the edge case. In that order.', 'You don’t pass a problem. You understand it.', 'Lunch slot is sacred. Sit down and solve.'] }];
  obstacles.push([-3.4, 2.6, .6]);
  const tick = t => { bag.rotation.z = Math.sin(t * 1.3) * .06; bag.rotation.x = Math.sin(t * .9) * .04; };
  return { stat: k.g, dyn, obstacles, spots, trees, tick, npcs, treeKinds: [['pine', 16], ['sakura', 3], ['oak', 4]] };
}
// Hush Hollow: a quiet wood under an orange-pink sky, full of cats, dogs and butterflies.
function makeDog(fur = '#d9894a', belly = '#fff3e0', bandana = null, o = {}) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const furM = toonMat(fur), bellyM = toonMat(belly), ink = new THREE.MeshBasicMaterial({ color: '#2a1f1a' }), white = new THREE.MeshBasicMaterial({ color: '#ffffff' }), outline = new THREE.MeshBasicMaterial({ color: '#2b2420', side: THREE.BackSide });
  const add = (parent, geo, mat, p, s, r, line = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); if (s) m.scale.set(...s); if (r) m.rotation.set(...r); m.castShadow = true; parent.add(m); if (line) { const o = new THREE.Mesh(geo, outline); o.position.copy(m.position); o.rotation.copy(m.rotation); o.scale.copy(m.scale).multiplyScalar(1.07); parent.add(o); } return m; };
  add(body, capsule(.15, .3).rotateX(Math.PI / 2), furM, [0, .31, 0]); add(body, SPHERE, bellyM, [0, .25, .05], [.12, .09, .2], null, false);
  const head = new THREE.Group(); head.position.set(0, .5, .3); body.add(head);
  add(head, SPHERE, furM, [0, 0, 0], [.14, .13, .135]); add(head, SPHERE, o.muzzle ? toonMat(o.muzzle) : bellyM, [0, -.04, .11], [.075, .058, .085]);
  add(head, SPHERE, ink, [0, -.012, .195], [.028, .02, .018], null, false);
  for (const s of [-1, 1]) { if (o.ears === 'rose') add(head, new THREE.ConeGeometry(.06, .1, 4), o.ear ? toonMat(o.ear) : furM, [s * .1, .1, 0], null, [.95, 0, -s * .7]); else add(head, new THREE.ConeGeometry(.055, .11, 4), furM, [s * .078, .12, -.02], null, [0, 0, -s * .25]); add(head, SPHERE, ink, [s * .052, .03, .118], [.019, .024, .012], null, false); add(head, SPHERE, white, [s * .052 - .005, .04, .127], [.006, .006, .004], null, false); }
  const tongue = add(head, SPHERE, toonMat('#f28a96'), [0, -.085, .15], [.03, .012, .04], null, false);
  const eyes = head.children.filter(m => m.material === ink && m.scale.x < .025);
  if (bandana) add(body, new THREE.ConeGeometry(.13, .14, 3).rotateX(Math.PI), toonMat(bandana), [0, .42, .24], null, [.4, 0, 0], false);
  if (o.collar) { add(body, new THREE.TorusGeometry(.1, .022, 6, 20).rotateX(Math.PI / 2 - .55), toonMat(o.collar), [0, .45, .25], null, null, false); add(body, new THREE.CylinderGeometry(.03, .03, .01, 12).rotateX(Math.PI / 2), M.gold, [0, .37, .32], null, null, false); }
  const legs = [[-.08, .14], [.08, .14], [-.08, -.14], [.08, -.14]].map(([x, z]) => { const g = new THREE.Group(); g.position.set(x, .22, z); body.add(g); add(g, capsule(.042, .13), furM, [0, -.1, 0]); add(g, SPHERE, bellyM, [0, -.19, .01], [.045, .028, .05], null, false); return g; });
  const tail = []; let parent = new THREE.Group(); parent.position.set(0, .42, -.26); body.add(parent);
  for (let i = 0; i < 3; i++) { const seg = new THREE.Group(); seg.position.set(0, i ? .07 : 0, 0); seg.rotation.x = -.7; parent.add(seg); add(seg, capsule(.035, .05), i === 2 ? bellyM : furM, [0, .04, 0]); tail.push(seg); parent = seg; }
  root.scale.setScalar(o.scale || 1.2);
  return { root, body, head, legs, tail, eyes, tongue, dog: true, phase: Math.random() * 6, sit: 0, lie: 0 };
}
function buildHollow(R, F) {
  const k = kit(), dyn = new THREE.Group(), Y = R.base + 1.4, obstacles = [], spots = [], trees = [], hr = rng32(81);
  // A great old tree with a picnic blanket in its shade.
  const big = new THREE.Mesh(treeGeometry('sacred', rng32(14), 2), treeMaterial()); big.position.set(-1.5, Y - .1, -6.2); big.scale.setScalar(.95); big.castShadow = big.receiveShadow = true; dyn.add(big); obstacles.push([-1.5, -6.2, 2.3]);
  const quilt = canvasTexture(128, (g, s) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#ffd2dc' : '#fff6ea'; g.fillRect(x * s / 8, y * s / 8, s / 8, s / 8); } g.strokeStyle = '#e88aa0'; g.lineWidth = 6; g.strokeRect(3, 3, s - 6, s - 6); });
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: quilt, roughness: 1 })); blanket.position.set(0, Y + .03, -1.4); blanket.rotation.y = .2; blanket.receiveShadow = true; dyn.add(blanket);
  for (const [x, z, c] of [[-.8, -2, '#f7b2c4'], [.9, -2.1, '#b9d8f2']]) k.add(new THREE.SphereGeometry(.28, 14, 10), solid(c, .9), x, Y + .12, z).scale.set(1.1, .45, .9);
  k.cyl(.22, .18, .28, M.wood, 1.2, Y + .14, -.7, 12); k.torus(.18, .025, M.wood, 1.2, Y + .38, -.7, 0, 0, Math.PI);
  // Fairy lights strung across the clearing.
  for (let i = 0; i <= 26; i++) { const t = i / 26, x = -6 + t * 12, y = Y + 4.2 - Math.sin(t * Math.PI) * 1.1, b = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), M.lantern); b.position.set(x, y, -5 + Math.sin(t * 6) * .3); dyn.add(b); }
  for (const s of [-1, 1]) { k.cyl(.08, .1, 4.4, M.woodDark, s * 6, Y + 2.2, -5, 8); obstacles.push([s * 6, -5, .3]); }
  // A lily pond and a little bench.
  k.add(new THREE.CylinderGeometry(2.3, 2.3, .08, 28), M.pond, 8.5, F.height(8.5, 4.5) + .02, 4.5); obstacles.push([8.5, 4.5, 2.4]);
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; k.add(new THREE.CircleGeometry(.32, 10, .3, Math.PI * 1.8).rotateX(-Math.PI / 2), solid('#4e8a45', .7), 8.5 + Math.cos(a) * 1.4, F.height(8.5, 4.5) + .08, 4.5 + Math.sin(a) * 1.4, 0, a, 0, false); }
  k.box(1.6, .1, .45, M.wood, 5, F.height(5, 8) + .45, 8, .4); for (const s of [-1, 1]) k.box(.12, .42, .4, M.woodDark, 5 + s * .65 * Math.cos(.4), F.height(5, 8) + .21, 8 - s * .65 * Math.sin(.4), .4);
  spots.push({ u: 0, v: -1.2, face: .2, act: 'phone', label: 'Scroll your phone on the blanket' });
  spots.push({ u: 4.6, v: 7.3, face: Math.PI - .4, act: 'sit', label: 'Sit by the pond' });
  // Cats and dogs who wander, nap, and come over when she settles down.
  const animals = [];
  for (const [fur, patch, scarf] of [['#f6e7cc', '#e0935a', '#c0607a'], ['#9aa0a6', '#6b7075', null], ['#2b2b2e', '#2b2b2e', '#d6a03a'], ['#f3efe6', '#3a3335', '#5aa0d6'], ['#e8c39a', '#b07040', null]]) animals.push(makeCat(fur, patch, scarf));
  for (const [fur, belly, band] of [['#d9894a', '#fff3e0', '#c0392b'], ['#e0a060', '#ffffff', null], ['#f4f1ea', '#f4f1ea', '#7fb2e0'], ['#2e2a28', '#4a403a', null]]) animals.push(makeDog(fur, belly, band));
  for (const a of animals) { const ang = hr() * Math.PI * 2, rr = 3 + hr() * 8; a.u = Math.cos(ang) * rr; a.v = Math.sin(ang) * rr; a.tu = a.u; a.tv = a.v; a.yaw = hr() * 6; a.mode = 'sit'; a.timer = 1 + hr() * 5; a.root.position.set(a.u, F.height(a.u, a.v), a.v); a.proxy && (a.proxy.userData = {}); a.root.userData.noCollide = true; dyn.add(a.root); }
  // Butterflies everywhere.
  const flies = [...Array(36)].map((_, i) => { const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: ['#ffd36b', '#ffffff', '#9fd0ff', '#ff9cc7', '#c9a6ff', '#ffb38a'][i % 6], side: THREE.DoubleSide }); const wing = new THREE.CircleGeometry(.1, 8).translate(.1, 0, 0).rotateX(-Math.PI / 2); const l = new THREE.Mesh(wing, m), r = new THREE.Mesh(wing, m); r.rotation.y = Math.PI; g.add(l, r); g.userData.noCollide = true; dyn.add(g); return { g, l, r, home: [(hr() - .5) * 26, (hr() - .5) * 20], seed: hr() * 10 }; });
  dyn.add(particles(90, 2, { size: .12, speed: .06, origin: [0, Y, 0], box: [34, 10, 28], color: '#ffc4dc', boost: 1.1, additive: false, opacity: .9 }));
  dyn.add(particles(70, 0, { size: .14, box: [34, 6, 28], color: '#ffd9a0', boost: 2, origin: [0, Y + 2.5, 0] }));
  const tick = t => { for (const b of flies) { const tt = t * .5 + b.seed, x = b.home[0] + Math.sin(tt * 1.3) * 2.4, z = b.home[1] + Math.cos(tt) * 2.4; b.g.position.set(x, F.height(x, z) + .8 + Math.sin(tt * 2.3) * .4, z); b.g.rotation.y = tt * 1.3 + Math.PI / 2; const f = Math.sin(t * 22 + b.seed) * 1.1; b.l.rotation.z = f; b.r.rotation.z = f; } };
  // Every frame: animals wander and nap, and gather round when she's on the blanket.
  const frame = (dt, t, me) => {
    const gather = me?.act === 'phone' || me?.act === 'sit';
    animals.forEach((a, i) => {
      a.timer -= dt;
      if (gather && me) { const ang = i / animals.length * Math.PI * 2 + .3, rr = 1.3 + (i % 3) * .55; a.tu = me.u + Math.cos(ang) * rr; a.tv = me.v + Math.sin(ang) * rr; if (Math.hypot(a.tu - a.u, a.tv - a.v) < .3) a.mode = i % 3 ? 'sit' : 'lie'; else a.mode = 'walk'; }
      else if (a.timer <= 0) { const r = hr(); if (r < .45) { const ang = hr() * Math.PI * 2, rr = 2 + hr() * 10; a.tu = Math.cos(ang) * rr; a.tv = Math.sin(ang) * rr; a.mode = 'walk'; a.timer = 6 + hr() * 6; } else { a.mode = r < .75 ? 'sit' : 'lie'; a.timer = 4 + hr() * 8; } }
      let speed = 0;
      if (a.mode === 'walk') { const dx = a.tu - a.u, dz = a.tv - a.v, d = Math.hypot(dx, dz); if (d > .2 && R.sdf(a.tu, a.tv) > 2.5 && obstacles.every(o => Math.hypot(a.tu - o[0], a.tv - o[1]) > o[2] + .3)) { speed = Math.min(1.6, d * 1.5); a.u += dx / d * speed * dt; a.v += dz / d * speed * dt; a.yaw = lerpAngle(a.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 6)); } else if (!gather) { a.mode = 'sit'; a.timer = 2 + hr() * 3; } }
      else if (me && Math.hypot(me.u - a.u, me.v - a.v) < 5) a.yaw = lerpAngle(a.yaw, Math.atan2(me.u - a.u, me.v - a.v), 1 - Math.exp(-dt * 2));
      a.root.position.set(a.u, F.height(a.u, a.v), a.v); a.root.rotation.y = a.yaw;
      a.phase = (a.phase || 0) + dt * (2 + speed * 4);
      const sw = Math.sin(a.phase) * .7 * Math.min(1, speed / 1.2), still = a.mode === 'walk' ? 0 : 1, lie = a.mode === 'lie' ? 1 : 0;
      a.sit += (still - a.sit) * Math.min(1, dt * 4); a.lie += (lie - a.lie) * Math.min(1, dt * 2.5);
      a.legs[0].rotation.x = sw + (.45 * a.sit - 1.4 * a.lie); a.legs[1].rotation.x = -sw + (.45 * a.sit - 1.4 * a.lie); a.legs[2].rotation.x = -sw - .9 * a.sit; a.legs[3].rotation.x = sw - .9 * a.sit;
      a.body.rotation.x = -.45 * a.sit * (1 - a.lie); a.body.position.y = -.06 * a.sit - .12 * a.lie; a.head.rotation.x = .38 * a.sit * (1 - a.lie) + .2 * a.lie;
      a.tail.forEach((s, j) => { if (a.dog) s.rotation.z = Math.sin(t * (gather ? 16 : 8) + j) * (.35 + .2 * (gather ? 1 : 0)); else { s.rotation.x = -.5 + a.sit * .3 + (j ? .12 : 0); s.rotation.z = Math.sin(t * 2.2 + j * .7 + i) * (.18 + j * .04); } });
      for (const e of a.eyes) e.scale.y = a.lie > .6 ? (a.dog ? .004 : .004) : (a.dog ? .024 : .028);
      if (a.tongue) a.tongue.visible = gather || speed > .5;
    });
  };
  const sky = { zenith: '#e98bb0', horizon: '#ffb27a', sunColor: '#ffc690', hemiSky: '#ffc6b8', hemiGround: '#7d6a5c', cloudLight: '#ffe0cc', cloudShadow: '#d68aa6' };
  R.sky = { c: Object.fromEntries(Object.entries(sky).map(([k, v]) => [k, C(v)])) };
  return { stat: k.g, dyn, obstacles, spots, trees, tick, frame, treeKinds: [['oak', 34], ['sakura', 18], ['birch', 14]] };
}
// The painter's easel: the canvas fills with dabs of colour while Nivetha paints.
function makeEasel() {
  const g = new THREE.Group(), wood = M.wood, c = document.createElement('canvas'); c.width = 192; c.height = 144;
  const x2 = c.getContext('2d'); x2.fillStyle = '#f6efdf'; x2.fillRect(0, 0, 192, 144);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.06, 1.8, .06), wood); leg.position.set(s * .38, .9, .05); leg.rotation.z = -s * .12; g.add(leg); }
  const back = new THREE.Mesh(new THREE.BoxGeometry(.06, 1.7, .06), wood); back.position.set(0, .85, -.42); back.rotation.x = -.35; g.add(back);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(.9, .05, .12), wood); shelf.position.set(0, .82, .1); g.add(shelf);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(.92, .72, .04), M.woodDark); frame.position.set(0, 1.25, .08); frame.rotation.x = -.1; g.add(frame);
  const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(.84, .64), new THREE.MeshStandardMaterial({ map: tex, roughness: .9 })); canvasMesh.position.set(0, 1.25, .105); canvasMesh.rotation.x = -.1; g.add(canvasMesh);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  let progress = 0, acc = 0; const r = rng32(99);
  const palette = [['#9cc7e6', '#c9e2f2', '#f4d9a8'], ['#3f8fb3', '#5aa6c4'], ['#7fae5c', '#5f8f45', '#c9b46a'], ['#c0623e', '#f1ece0']];
  function paint(dt) {
    acc += dt; if (acc < .25) return; acc = 0; progress = Math.min(1, progress + .012);
    for (let i = 0; i < 6; i++) {
      const y = r() * 144, band = y < 60 ? 0 : y < 84 ? 1 : 2, cols = palette[band]; x2.fillStyle = cols[(r() * cols.length) | 0]; x2.globalAlpha = .55;
      x2.beginPath(); x2.ellipse(r() * 192, y, 6 + r() * 14, 2 + r() * 4, (r() - .5) * .6, 0, Math.PI * 2); x2.fill();
    }
    if (progress > .45) { x2.globalAlpha = .7; x2.fillStyle = palette[3][(r() * 2) | 0]; const cx = 120 + (r() - .5) * 18, cy = 70 + (r() - .5) * 10; x2.beginPath(); x2.ellipse(cx, cy, 4 + r() * 6, 3 + r() * 4, 0, Math.PI, Math.PI * 2); x2.fill(); }
    if (progress > .8 && r() < .3) { x2.globalAlpha = .9; x2.fillStyle = '#ffe7a3'; x2.beginPath(); x2.arc(40, 30, 9, 0, Math.PI * 2); x2.fill(); }
    x2.globalAlpha = 1; tex.needsUpdate = true;
  }
  return { g, paint };
}
// The sky ferry: a little sailboat with gold trim that unfolds wings and flies between realms.
function makeFerry() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.wood); hull.scale.set(1.15, .7, 2.9); hull.castShadow = true; body.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.95, .08, 4.9), M.woodDark); deck.position.y = -.06; body.add(deck);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, .05, 6, 48).rotateX(Math.PI / 2), M.gold); rim.scale.set(1.15, 1, 2.9); body.add(rim);
  const prow = new THREE.Mesh(new THREE.TorusGeometry(.28, .06, 8, 20, Math.PI * 1.4), M.gold); prow.position.set(0, .35, 2.95); prow.rotation.y = Math.PI / 2; body.add(prow);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, 4.4, 8), M.woodDark); mast.position.set(0, 2.15, .4); mast.castShadow = true; body.add(mast);
  const yard = new THREE.Mesh(new THREE.BoxGeometry(2.5, .08, .08), M.woodDark); yard.position.set(0, 3.9, .4); body.add(yard);
  const sailTex = canvasTexture(256, (x, s) => { x.fillStyle = '#f5ead0'; x.fillRect(0, 0, s, s); x.strokeStyle = '#c49a45'; x.lineWidth = 10; x.strokeRect(10, 10, s - 20, s - 20); x.fillStyle = '#c49a45'; x.font = `${s * .42}px Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('✦', s / 2, s / 2 + 6); });
  const sg = new THREE.PlaneGeometry(2.3, 2.5, 8, 8), sp = sg.attributes.position; for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.cos(sp.getX(i) / 2.3 * Math.PI) * .35);
  sg.computeVertexNormals(); const sail = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: sailTex, side: THREE.DoubleSide, roughness: .9 })); sail.position.set(0, 2.6, .5); sail.castShadow = true; body.add(sail);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .9, 6), M.iron); post.position.set(s * .75, .45, -2.2); body.add(post); const l = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), M.lantern); l.position.set(s * .75, .95, -2.2); body.add(l); }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, .12, .45), M.wood); bench.position.set(0, .2, -1.6); body.add(bench);
  const wingGeo = new THREE.BufferGeometry(); wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1.4, 0, 0, 1.2, 3.2, .3, -.6, 0, 0, 1.2, 3.2, .3, -.6, 2.4, .2, .9], 3)); wingGeo.computeVertexNormals();
  const wingMat = new THREE.MeshStandardMaterial({ color: '#fff1c8', emissive: '#f2c76a', emissiveIntensity: .8, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false });
  const wings = [-1, 1].map(s => { const w = new THREE.Mesh(wingGeo, wingMat); w.position.set(s * 1.05, .15, .2); w.scale.set(s * .001, 1, 1); body.add(w); return w; });
  const proxy = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 10), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.y = 1; proxy.userData = { kind: 'ferry' }; g.add(proxy);
  return { g, body, wings, sail, proxy };
}
// Mochi, Nivetha's cat: cream fur, ginger patches, a red scarf and a little gold bell.
function makeCat(fur = '#f6e7cc', patch = '#e0935a', scarf = '#b4492f') {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const cream = toonMat(fur), ginger = toonMat(patch), pink = toonMat('#f2a0a6'), ink = new THREE.MeshBasicMaterial({ color: '#2a1f1a' }), white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const outline = new THREE.MeshBasicMaterial({ color: '#2b2420', side: THREE.BackSide });
  const add = (parent, geo, mat, p, s, r, line = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); if (s) m.scale.set(...s); if (r) m.rotation.set(...r); m.castShadow = true; parent.add(m); if (line) { const o = new THREE.Mesh(geo, outline); o.position.copy(m.position); o.rotation.copy(m.rotation); o.scale.copy(m.scale).multiplyScalar(1.07); parent.add(o); } return m; };
  add(body, capsule(.12, .26).rotateX(Math.PI / 2), cream, [0, .27, 0], [1, .95, 1]);
  add(body, SPHERE, ginger, [0, .36, -.06], [.09, .05, .12], null, false); add(body, SPHERE, ginger, [.05, .34, .1], [.06, .04, .06], null, false);
  const head = new THREE.Group(); head.position.set(0, .42, .24); body.add(head);
  add(head, SPHERE, cream, [0, 0, 0], [.125, .112, .118]);
  for (const s of [-1, 1]) {
    add(head, new THREE.ConeGeometry(.048, .1, 4), s < 0 ? ginger : cream, [s * .066, .1, -.01], null, [0, 0, -s * .3]);
    add(head, new THREE.ConeGeometry(.026, .06, 4), pink, [s * .066, .1, .012], null, [0, 0, -s * .3], false);
    add(head, SPHERE, ink, [s * .046, .015, .104], [.022, .028, .012], null, false);
    add(head, SPHERE, white, [s * .046 - .006, .026, .114], [.007, .007, .004], null, false);
    add(head, SPHERE, cream, [s * .05, -.04, .09], [.05, .035, .04], null, false);
  }
  add(head, SPHERE, pink, [0, -.02, .121], [.015, .011, .008], null, false);
  const eyes = head.children.filter(m => m.material === ink);
  if (scarf) { add(body, new THREE.TorusGeometry(.085, .022, 6, 18).rotateX(Math.PI / 2 - .5), toonMat(scarf), [0, .38, .18], null, null, false); add(body, new THREE.SphereGeometry(.024, 10, 8), glow('#f0c565', .4), [0, .32, .25], null, null, false); }
  const legs = [[-.065, .13], [.065, .13], [-.065, -.12], [.065, -.12]].map(([x, z]) => { const g = new THREE.Group(); g.position.set(x, .2, z); body.add(g); add(g, capsule(.034, .12), cream, [0, -.09, 0]); add(g, SPHERE, ginger, [0, -.17, .01], [.04, .025, .045], null, false); return g; });
  const tail = []; let parent = body; const base = new THREE.Group(); base.position.set(0, .32, -.2); body.add(base); parent = base;
  for (let i = 0; i < 5; i++) { const seg = new THREE.Group(); seg.position.set(0, i ? .075 : 0, i ? -.02 : 0); parent.add(seg); add(seg, capsule(.028 - i * .002, .06), i > 2 ? ginger : cream, [0, .04, 0]); tail.push(seg); parent = seg; }
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(.45, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.y = .3; proxy.userData = { kind: 'cat' }; root.add(proxy);
  root.scale.setScalar(1.25);
  return { root, body, head, legs, tail, eyes, proxy, phase: 0, yaw: 0, sit: 0, hop: 0, happy: 0, still: 0 };
}
// Hand-held props for Nivetha's activities.
function makeProps() {
  const P = {}, t = (geo, c) => new THREE.Mesh(geo, toonMat(c));
  P.book = new THREE.Group(); for (const s of [-1, 1]) { const page = t(new THREE.BoxGeometry(.16, .012, .22), '#f4ead2'); page.position.x = s * .08; page.rotation.z = s * .18; P.book.add(page); const cover = t(new THREE.BoxGeometry(.17, .01, .23), '#7a2e2a'); cover.position.set(s * .085, -.012, 0); cover.rotation.z = s * .18; P.book.add(cover); }
  P.ledger = P.book.clone();
  P.hammer = new THREE.Group(); { const h = t(new THREE.CylinderGeometry(.018, .02, .42, 6), '#6b4a33'); h.position.y = -.12; const head = t(new THREE.BoxGeometry(.16, .08, .08), '#596065'); head.position.y = -.33; P.hammer.add(h, head); P.hammer.rotation.x = Math.PI / 2; }
  P.quill = new THREE.Group(); { const f = t(new THREE.ConeGeometry(.025, .26, 5), '#fff6e6'); f.position.y = .1; const n = t(new THREE.CylinderGeometry(.004, .006, .08, 4), '#2a2321'); n.position.y = -.05; P.quill.add(f, n); P.quill.rotation.x = .9; }
  P.brush = new THREE.Group(); { const h = t(new THREE.CylinderGeometry(.01, .012, .3, 6), '#b4492f'); const tip = t(new THREE.ConeGeometry(.016, .06, 6), '#3f8fb3'); tip.position.y = .17; P.brush.add(h, tip); P.brush.rotation.x = 1.2; }
  P.wrench = new THREE.Group(); { const h = t(new THREE.BoxGeometry(.03, .26, .02), '#8a9096'); const hd = t(new THREE.TorusGeometry(.035, .012, 6, 12, Math.PI * 1.5), '#8a9096'); hd.position.y = .14; P.wrench.add(h, hd); P.wrench.rotation.x = 1.3; }
  P.anvil = new THREE.Group(); { const b = new THREE.Mesh(new THREE.BoxGeometry(.5, .3, .28), M.iron), top = new THREE.Mesh(new THREE.BoxGeometry(.7, .12, .3), M.iron), st = new THREE.Mesh(new THREE.CylinderGeometry(.22, .26, .42, 10), M.woodDark); st.position.y = .21; b.position.y = .57; top.position.y = .78; P.anvil.add(st, b, top); P.anvil.traverse(o => { o.castShadow = true; }); }
  P.phone = new THREE.Group(); { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#fff6fa'; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 8; i++) { g.fillStyle = ['#ffd2dc', '#cfe6ff', '#ffe9b8', '#dff5d8'][i % 4]; g.fillRect(6, 6 + i * 32, 52, 26); g.fillStyle = '#f2a0a6'; g.beginPath(); g.arc(18, 19 + i * 32, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = '#c9b8d6'; g.fillRect(30, 13 + i * 32, 22, 4); g.fillRect(30, 21 + i * 32, 16, 4); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, .45); P.phoneTex = tex;
    const body = t(new THREE.BoxGeometry(.075, .15, .012), '#3b3240'); const scr = new THREE.Mesh(new THREE.PlaneGeometry(.066, .135), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); scr.position.z = .007; P.phone.add(body, scr); P.phone.rotation.set(1.9, 0, 0); }
  for (const p of Object.values(P)) if (p.isObject3D) p.visible = false;
  return P;
}

// ───────────────────────────── voices ─────────────────────────────
// Scripted lines around the quest scroll. {greet} becomes a time-of-day greeting, {name} the speaker.
// When a bot has a Party HQ check-in, that real message is spoken too.
const VOICES = {
  grok: { hi: ['{greet}, Nivetha. I’ve read every bot’s board. Here’s the route.', '{greet}. Routing check: the whole party is lined up behind you.'], give: ['This is the highest-value move on the board right now.', 'I’m routing you here first. Everything else can wait a beat.'], ok: ['Routed. I’ll tell the party you’re on it.', 'Logged. Finish it and I’ll let Bossman know.'], done: 'Every route is clear for today. That’s rare, so let rest count too.', note: 'Routed by Grok Bot: the best next move across your whole party.' },
  bossman: { hi: ['{greet}. Lineup time: three priorities, no drift.', '{greet}, Nivetha. The board is set. You make the first move.'], give: ['Priority one. Take it.', 'This move advances the whole board.'], ok: ['Good. I’ll check it at the evening closeout.', 'Executed beats planned. Go.'], done: 'Every priority is closed for today. Tonight’s closeout will be short.', note: 'From the morning lineup. Close it before the evening closeout.' },
  carmen: { hi: ['{greet}! Kitchen’s open. What are we shipping?', '{greet}. Work board first: what’s blocked?'], give: ['This one moves the client forward. Clean handoff, every step checked.', 'Here’s the next ticket. Verify it end to end.'], ok: ['Yes, chef. Bring me the evidence.', 'Heard. Make it something we can hand over.'], done: 'The work board is clear for today. Write down what shipped while it’s fresh.', note: 'Verified, documented, handed off. That’s what done means here.' },
  jane: { hi: ['{greet}, Nivetha. You’ve got that look. One loop is bothering you.', '{greet}. Let me guess what’s on your mind… an open loop. Close?'], give: ['Close this one and your head gets quieter. Trust me.', 'Here’s the loop I’d close first.'], ok: ['Lovely. I’ll pretend I didn’t predict that.', 'Off you go. Tea after?'], done: 'No open loops left today. That calm you feel? You earned it.', note: 'One loop closed properly beats five half-started.' },
  goggins: { hi: ['{greet}. What did the WHOOP say? We train the call, not the ego.', '{greet}! Stay hard, and stay honest about recovery.'], give: ['This is today’s work. Do exactly this, nothing extra.', 'Here’s the call. Execute it.'], ok: ['That’s the promise. Keep it.', 'No negotiating with yourself. Go.'], done: 'The body work is done for today. Recovery is training too.', note: 'Intensity earns no extra XP. Consistency does.' },
  gilfoyle: { hi: ['{greet}. I ran the numbers on your career. Mostly encouraging.', '{greet}. Let’s talk leverage, not busywork.'], give: ['This compounds. Do it.', 'Here. This is the one that moves your long game.'], ok: ['Acceptable.', 'Fine. Show me the artifact when it exists.'], done: 'Nothing left here today that compounds. Go rest; that compounds too.', note: 'Proof beats claims. Ship something someone can check.' },
  fletcher: { hi: ['{greet}. Lunch slot. Java. Are you ready, or are you rushing?', '{greet}. One problem today, explained properly.'], give: ['This one. Pattern, complexity, edge case. All three.', 'Here’s today’s problem. Don’t just pass it; understand it.'], ok: ['Same slot tomorrow.', 'Good. Now do it in time.'], done: 'Today’s problem is done. A missed day is never doubled, and you didn’t miss.', note: 'Explain it out loud. If you can’t, you haven’t solved it.' },
  beatrix: { hi: ['{greet}. The docs are open. Are you?', '{greet}, Nivetha. Precision today, no guessing.'], give: ['This is your CCDF work. Check every answer against the docs.', 'Here. Take it seriously and it will take you seriously.'], ok: ['Good. I’ll grade it the way the exam would.', 'Go. Notes away when it counts.'], done: 'Your study is done for today. Rest sharpens recall.', note: 'Trust the docs over the question bank. Every time.' },
  beth: { hi: ['{greet}. Questions first, cold. Then the reading.', '{greet}. I’ve set up the board. Your move.'], give: ['Answer these cold. Read only what you miss.', 'This is the drill. Test first.'], ok: ['Good. Count the misses honestly.', 'Play it out. I’ll look at your score after.'], done: 'Today’s drill is finished. Let the patterns settle.', note: 'Every miss is a square you now control.' },
  dexter: { hi: ['{greet}. I measured how often you redo the same chore. We should talk.', '{greet}. Systems check: any friction today?'], give: ['Automate this cleanly and it stops costing you.', 'Here’s the friction I’d remove first.'], ok: ['Tidy. Leave it running.', 'Good. Test it twice.'], done: 'Systems are tidy for today. Nothing’s leaking.', note: 'A system that still works tomorrow is the whole point.' },
  eggbot: { hi: ['{greet}! Something is hatching in the incubator…', '{greet}. Every bot gets one job. What’s yours today?'], give: ['You designed this one. It hatched beautifully.', 'Here’s a quest from your own design.'], ok: ['Wonderful. I’ll keep the incubator warm.', 'Off it goes!'], done: 'The incubator is empty. Shall we design a new quest together?', note: 'One job, explicit anti-jobs. Even for quests.' },
  council: { hi: ['{greet}. {name} is in session.', '{greet}, Nivetha. {name} has been waiting for you.'], give: ['The council agrees: this comes next.', 'This is the council’s pick for you.'], ok: ['Noted in the minutes.', 'The council will follow up.'], done: 'The council has nothing open for you today.', note: 'Decided together, done by you.' },
};
const pickLine = list => Array.isArray(list) ? list[Math.floor(Math.random() * list.length)] : list;
const clip = (text, n) => text.length > n ? text.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : text;

// ───────────────────────────── particles ─────────────────────────────
function particles(count, kind, o) {
  const g = new THREE.BufferGeometry(), seeds = new Float32Array(count * 4), r = rng32(count * 7 + kind);
  for (let i = 0; i < count * 4; i++) seeds[i] = r();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 4));
  const uniforms = {
    uTime: U.time, uScale: SIZE_SCALE, uSize: { value: o.size }, uSpeed: { value: o.speed ?? .3 }, uRise: { value: o.rise ?? 2 }, uSpread: { value: o.spread ?? .5 },
    uOrigin: { value: new THREE.Vector3(...(o.origin ?? [0, 0, 0])) }, uBox: { value: new THREE.Vector3(...(o.box ?? [1, 1, 1])) }, uColor: { value: new THREE.Color(o.color).multiplyScalar(o.boost ?? 1) }, uOpacity: { value: o.opacity ?? 1 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, defines: { KIND: kind },
    vertexShader: `uniform float uTime,uScale,uSize,uSpeed,uRise,uSpread; uniform vec3 uOrigin,uBox; attribute vec4 seed; varying float vA;
      void main(){ vec3 p; float sz=uSize*(.6+seed.w*.8);
      #if KIND == 0
        vec3 drift=vec3(sin(uTime*.21+seed.w*30.),sin(uTime*.33+seed.x*20.)*.6+uTime*.1,cos(uTime*.17+seed.y*25.));
        p=seed.xyz*uBox*3.+drift*1.5; vec3 lo=uOrigin-uBox*.5; p=lo+mod(p-lo,uBox);
        vA=.5+.5*sin(uTime*(1.2+seed.w*2.)+seed.x*40.);
      #elif KIND == 1
        float life=fract(uTime*uSpeed*(.7+seed.w*.6)+seed.w*7.);
        p=uOrigin+vec3((seed.x-.5)*uSpread*(1.+life*1.6)+sin(life*5.+seed.y*9.)*.15*uSpread,life*uRise*(.7+seed.y*.6),(seed.z-.5)*uSpread*(1.+life*1.6));
        vA=smoothstep(0.,.1,life)*(1.-life); sz*=mix(1.,uBox.x,life);
      #else
        float life=fract(uTime*uSpeed*(.6+seed.w*.8)+seed.w*5.);
        p=uOrigin+vec3((seed.x-.5)*uBox.x+sin(uTime*.9+seed.y*12.)*.8,(1.-life)*uBox.y,(seed.z-.5)*uBox.z+cos(uTime*.7+seed.x*12.)*.8);
        vA=smoothstep(0.,.08,life)*smoothstep(1.,.85,life);
      #endif
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=sz*uScale/-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); gl_FragColor=vec4(uColor,a*a*vA*uOpacity); }',
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 3;
  return pts;
}
const SIZE_SCALE = { value: 400 };

// ───────────────────────────── main ─────────────────────────────
function start() {
  buildField(); makeTextures(); makeMaterials(); NOISE.value = noiseTexture();
  // Where Nivetha is: the home island (realm = null) or one of the realms beyond the sea.
  let skyBlend = 0, skyRef = null, realm = null, voyage = null, pierInfo = null, groundAt = heightAt, mainMask = null, rescueTravel = null, dynObstacles = [];
  const realms = [], hooks = {};
  const posW = (lx, ly) => realm ? [realm.R.at[0] + (lx - 550) * SCALE, realm.R.at[1] + (ly - 360) * SCALE] : toW(lx, ly);
  const posL = (x, z) => realm ? [(x - realm.R.at[0]) / SCALE + 550, (z - realm.R.at[1]) / SCALE + 360] : toL(x, z);
  const frameEl = canvas.parentElement, glCanvas = document.createElement('canvas');
  glCanvas.className = 'w3-canvas'; glCanvas.setAttribute('aria-hidden', 'true');
  frameEl.insertBefore(glCanvas, canvas);
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1.7, .3, 2400);
  scene.fog = new THREE.FogExp2('#cfe3ef', .0042);

  // Sky dome and the light it casts.
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms(), uCloudLight: U.cloudLight, uCloudShadow: U.cloudShadow, uCover: U.cover, uTime: U.time, uNoise: NOISE, uDisc: U.disc, uDiscSize: U.discSize, uStars: U.stars },
    depthWrite: false, side: THREE.BackSide,
    vertexShader: 'varying vec3 vDir; void main(){ vDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }',
    fragmentShader: `${GLSL_SKY}
      uniform vec3 uCloudLight,uCloudShadow; uniform float uCover,uTime,uDisc,uDiscSize,uStars; uniform sampler2D uNoise; varying vec3 vDir;
      float clouds(vec2 p){ return texture2D(uNoise,p*.11).r*.68+texture2D(uNoise,p*.31+vec2(.37,.11)).a*.32; }
      float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      void main(){
        vec3 d=normalize(vDir), col=skyBase(d); float sd=max(dot(d,uSunDir),0.), cov=0.;
        if(d.y>0.){
          vec2 p=d.xz/(d.y+.18)*1.5+vec2(uTime*.004,uTime*.0016);
          float n=clouds(p), n2=clouds(p+normalize(uSunDir.xz+1e-4)*.09); cov=smoothstep(1.-uCover,1.-uCover+.3,n);
          float lit=clamp(.62+(n-n2)*4.,0.,1.);
          vec3 cc=mix(uCloudShadow,uCloudLight,lit)+uSunColor*pow(sd,10.)*.6*(1.-cov);
          if(uStars>0.){
            vec2 g=d.xz/(d.y+.35)*95., id=floor(g), fr=fract(g)-.5; float h=h21(id); vec2 o=vec2(h21(id+3.7),h21(id+9.1))-.5;
            float st=smoothstep(.12,0.,length(fr-o*.7))*step(.982,h)*(.55+.45*sin(uTime*1.7+h*80.));
            col+=vec3(.85,.9,1.)*st*uStars*smoothstep(0.,.2,d.y)*2.6;
          }
          col=mix(col,cc,cov*smoothstep(0.,.16,d.y)*.95);
        }
        col+=uSunColor*smoothstep(uDiscSize,uDiscSize+.0004,sd)*uDisc*(1.-cov*.85);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const skyGeo = new THREE.SphereGeometry(1000, 48, 24), sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(skyGeo, skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer); let envRT = null;
  const sun = new THREE.DirectionalLight('#fff0d8', 3);
  sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 220 }); sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#cfe6ff', '#7a8f55', 1); scene.add(hemi);

  // The sky follows the real clock in India (the game's day also resets on Asia/Kolkata time).
  // Four looks are blended by the sun's height; after dark the moon lights the world.
  const PRESETS = {
    night: { sunColor: '#b9c9ff', sunI: 0, zenith: '#081230', horizon: '#1d2c58', hemiSky: '#4a5f9c', hemiGround: '#1f2534', hemiI: .62, cloudLight: '#4f5e8c', cloudShadow: '#1a2444', cover: .42, env: .38, exposure: 1.28, shallow: '#1d5878', deep: '#0a1d3b', light: .34, glow: 1, fog: .0046, flies: 1, motes: .15, bloom: .55, stars: 1 },
    dawn: { sunColor: '#ffc59a', sunI: 2.3, zenith: '#5a7fc6', horizon: '#f6c2a6', hemiSky: '#c4bce6', hemiGround: '#6b6a58', hemiI: .82, cloudLight: '#ffdcc6', cloudShadow: '#9a8bb2', cover: .46, env: .5, exposure: 1.06, shallow: '#4cb6bc', deep: '#1c4f86', light: .74, glow: .45, fog: .0046, flies: 0, motes: .7, bloom: .4, stars: 0 },
    day: { sunColor: '#ffedcf', sunI: 3.1, zenith: '#3a80d6', horizon: '#c4def0', hemiSky: '#cfe4ff', hemiGround: '#7d9556', hemiI: 1.05, cloudLight: '#ffffff', cloudShadow: '#b3c3da', cover: .5, env: .62, exposure: 1, shallow: '#45d2c5', deep: '#11709e', light: 1, glow: .12, fog: .0042, flies: 0, motes: 1, bloom: .32, stars: 0 },
    dusk: { sunColor: '#ffb27c', sunI: 2.4, zenith: '#2c3b78', horizon: '#f4b38c', hemiSky: '#9aa2dc', hemiGround: '#514654', hemiI: .72, cloudLight: '#ffcfae', cloudShadow: '#7a6a98', cover: .52, env: .45, exposure: 1.08, shallow: '#3aa0a6', deep: '#1a3e6d', light: .62, glow: 1, fog: .0048, flies: .6, motes: .35, bloom: .48, stars: 0 },
  };
  const COLOR_KEYS = ['sunColor', 'zenith', 'horizon', 'hemiSky', 'hemiGround', 'cloudLight', 'cloudShadow', 'shallow', 'deep'], NUM_KEYS = ['sunI', 'hemiI', 'cover', 'env', 'exposure', 'light', 'glow', 'fog', 'flies', 'motes', 'bloom', 'stars'];
  for (const p of Object.values(PRESETS)) for (const k of COLOR_KEYS) p[k] = new THREE.Color(p[k]);
  const clonePreset = p => { const o = { ...p }; for (const k of COLOR_KEYS) o[k] = p[k].clone(); return o; };
  const mixPreset = (out, a, b, t) => { for (const k of COLOR_KEYS) out[k].copy(a[k]).lerp(b[k], t); for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * t; };
  const look = clonePreset(PRESETS.day), twilight = clonePreset(PRESETS.day), sunVec = new THREE.Vector3(), moonVec = new THREE.Vector3(), moonColor = new THREE.Color('#b9c9ff');
  look.sun = new THREE.Vector3(0, 1, 0);
  const istHours = () => { const d = new Date(); return (d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + 5.5) % 24; };
  let hourOverride = null, envDirty = true, envSunY = 9;
  function applySky(hours) {
    // Sunrise about 06:00 and sunset about 18:30; the sun crosses the southern sky.
    const a = (hours - 6) / 12.5 * Math.PI;
    sunVec.set(Math.cos(a), Math.sin(a) * 1.15, .42).normalize();
    moonVec.set(-Math.cos(a) * .7, Math.max(.32, -Math.sin(a) * 1.1), .55).normalize();
    const sy = sunVec.y, calm = state.mode === 'recovery';
    mixPreset(twilight, PRESETS.night, hours < 12 ? PRESETS.dawn : PRESETS.dusk, smooth(-.26, .02, sy));
    mixPreset(look, twilight, PRESETS.day, smooth(.06, .42, sy));
    if (skyBlend > 0 && skyRef) { for (const [k, c] of Object.entries(skyRef.c)) look[k].lerp(c, skyBlend); look.hemiI += (.95 - look.hemiI) * skyBlend; look.exposure += (1.05 - look.exposure) * skyBlend; look.cover += (.42 - look.cover) * skyBlend; }
    const sunW = smooth(-.04, .1, sy), moonW = smooth(.02, -.16, sy), byMoon = moonW > sunW;
    look.sun.copy(byMoon ? moonVec : sunVec);
    U.sunDir.value.copy(look.sun); U.sunColor.value.copy(byMoon ? moonColor : look.sunColor);
    sun.color.copy(U.sunColor.value); sun.intensity = byMoon ? .95 * moonW : look.sunI * sunW;
    U.disc.value = byMoon ? 5 * moonW : 24 * sunW; U.discSize.value = byMoon ? .9987 : .9994; U.stars.value = look.stars;
    U.zenith.value.copy(look.zenith); U.horizon.value.copy(look.horizon);
    U.cloudLight.value.copy(look.cloudLight); U.cloudShadow.value.copy(look.cloudShadow); U.cover.value = look.cover;
    U.shallow.value.copy(look.shallow); U.deep.value.copy(look.deep); U.light.value = look.light; U.fogColor.value.copy(look.horizon); U.fogDensity.value = look.fog;
    scene.fog.color.copy(look.horizon); scene.fog.density = look.fog;
    hemi.color.copy(look.hemiSky); hemi.groundColor.copy(look.hemiGround); hemi.intensity = look.hemiI;
    scene.environmentIntensity = look.env; renderer.toneMappingExposure = look.exposure;
    // Recovery mode keeps the world calm: lanterns lit, fireflies out, a softer breeze.
    const glowNow = Math.max(look.glow, calm ? .55 : 0);
    M.window.emissiveIntensity = .2 + glowNow * 2.4; M.lantern.emissiveIntensity = 1 + glowNow * 2.6;
    for (const m of NIGHT_GLOW) m.emissiveIntensity = (.3 + glowNow * 2.4) * m.userData.k;
    U.rim.value.copy(U.sunColor.value).multiplyScalar(.22 + look.glow * .12);
    U.wind.value = reduceMotion.matches ? .35 : calm ? .6 : 1;
    bloom.strength = look.bloom;
    flies.material.uniforms.uOpacity.value = Math.max(look.flies, calm ? .75 : 0); motes.material.uniforms.uOpacity.value = .55 * look.motes;
    if (Math.abs(sy - envSunY) > .025) { envSunY = sy; envDirty = true; }
    return hours;
  }
  const dayPhase = h => h < 4.5 || h >= 19.6 ? ['☾', 'Night'] : h < 6 ? ['☼', 'Dawn'] : h < 11 ? ['☀', 'Morning'] : h < 16 ? ['☀', 'Afternoon'] : h < 18.5 ? ['☀', 'Golden hour'] : ['☾', 'Dusk'];

  // Terrain.
  const tPos = new Float32Array(NV * 3), tNor = new Float32Array(NV * 3), tUv = new Float32Array(NV * 2), tCol = new Float32Array(NV * 3), base = new Float32Array(NV * 3), idx = [];
  const P = { g1: C('#7cb447'), g2: C('#5a9937'), g3: C('#b0c95c'), g4: C('#47853a'), sand: C('#ead7a4'), wet: C('#bca67b'), seabed: C('#ab9b72'), rock: C('#928d82'), rock2: C('#6e6b65'), snow: C('#f4f7fa'), dirt: C('#c69c6c'), cobble: C('#cdbfa4') };
  const tmp = new THREE.Color(), tmp2 = new THREE.Color();
  for (let iz = 0; iz <= GZ; iz++) for (let ix = 0; ix <= GX; ix++) {
    const i = iz * (GX + 1) + ix, x = X0 + ix * CX, z = Z0 + iz * CZ, h = HT[i], d = SD[i], slope = 1 - NY[i];
    tPos.set([x, h, z], i * 3); tUv.set([ix / GX * FW / 5, iz / GZ * FD / 5], i * 2);
    const row = GX + 1, hl = HT[iz * row + Math.max(0, ix - 1)], hr = HT[iz * row + Math.min(GX, ix + 1)], hu = HT[Math.max(0, iz - 1) * row + ix], hd = HT[Math.min(GZ, iz + 1) * row + ix];
    const n = new THREE.Vector3((hl - hr) / (2 * CX), 1, (hu - hd) / (2 * CZ)).normalize(); tNor.set([n.x, n.y, n.z], i * 3);
    tmp.copy(P.g1).lerp(P.g2, smooth(-.3, .45, fbm(x * .05, z * .05, 3))).lerp(P.g3, smooth(.1, .55, noise2(x * .11 + 40, z * .11)) * .55).lerp(P.g4, smooth(.2, .65, -noise2(x * .3, z * .3)) * .25);
    tmp.lerp(tmp2.copy(P.rock).lerp(P.rock2, smooth(-.2, .5, noise2(x * .4, z * .4))), Math.max(smooth(.2, .42, slope), smooth(5.5, 9, h) * .85));
    tmp.lerp(P.snow, smooth(10.6, 12.2, h + noise2(x * .5, z * .5) * .8));
    tmp.lerp(h < .12 ? P.wet : P.sand, 1 - smooth(1.4, 3.1, d + noise2(x * .2, z * .2) * .7));
    if (h < -.05) tmp.copy(P.seabed).multiplyScalar(1 - smooth(0, 6, -h) * .35);
    tmp.lerp(tmp2.copy(P.cobble).lerp(P.dirt, smooth(-.3, .4, noise2(x * .7, z * .7))), PADW[i] * .85);
    base.set([tmp.r, tmp.g, tmp.b], i * 3);
    if (ix < GX && iz < GZ) { const a = i, b2 = i + 1, c2 = i + row, d2 = i + row + 1; idx.push(a, c2, b2, b2, c2, d2); }
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); terrainGeo.setAttribute('normal', new THREE.BufferAttribute(tNor, 3));
  terrainGeo.setAttribute('uv', new THREE.BufferAttribute(tUv, 2)); terrainGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3)); terrainGeo.setIndex(idx);
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.ground, roughness: .96 });
  terrainMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime: U.time, uShallow: U.shallow });
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = 'uniform float uTime; uniform vec3 uShallow; varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      float under = smoothstep(.02, -2.8, vWP.y);
      float caust = pow(abs(sin(vWP.x * 1.9 + uTime * 1.1 + sin(vWP.z * 1.3 + uTime)) * sin(vWP.z * 2.1 - uTime * .9 + sin(vWP.x * 1.1))), 3.) * smoothstep(0., -.4, vWP.y) * (1. - smoothstep(-.4, -3.5, vWP.y));
      outgoingLight = mix(outgoingLight, outgoingLight * uShallow * 1.3, under * .75) + caust * .25 * uShallow;
      #include <opaque_fragment>`);
  };
  terrainMat.customProgramCacheKey = () => 'terrain';
  const terrain = new THREE.Mesh(terrainGeo, terrainMat); terrain.receiveShadow = true; scene.add(terrain);
  const dirtCol = C('#c9a06f'), overgrown = C('#9fb262');
  function paintPaths(level) {
    for (let i = 0; i < NV; i++) {
      let r = base[i * 3], g = base[i * 3 + 1], b2 = base[i * 3 + 2];
      const k = pathIdx[i];
      if (k >= 0 && SD[i] > .5) {
        const open = level >= PATHS[k].unlock, w = (1 - smooth(.55, 1.25, PD[i] + noise2(i * .37, i * .11) * .08)) * (open ? .92 : .45), c = open ? dirtCol : overgrown;
        r += (c.r - r) * w; g += (c.g - g) * w; b2 += (c.b - b2) * w;
      }
      tCol[i * 3] = r; tCol[i * 3 + 1] = g; tCol[i * 3 + 2] = b2;
    }
    terrainGeo.attributes.color.needsUpdate = true;
  }

  // Water with depth-tinted shallows, shoreline foam, sky reflections and sun glints.
  const depthData = new Uint8Array(NV);
  for (let i = 0; i < NV; i++) depthData[i] = clamp(-HT[i] / 8, 0, 1) * 255;
  const depthTex = new THREE.DataTexture(depthData, GX + 1, GZ + 1, THREE.RedFormat); depthTex.unpackAlignment = 1; depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...skyUniforms(), uNoise: NOISE, uTime: U.time, uShallow: U.shallow, uDeep: U.deep, uLight: U.light, uFogColor: U.fogColor, uFogDensity: U.fogDensity, uDepth: { value: depthTex }, uRect: { value: new THREE.Vector4(X0 - CX * .5, Z0 - CZ * .5, FW + CX, FD + CZ) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `${GLSL_SKY}
      uniform sampler2D uNoise; uniform float uTime,uLight,uFogDensity; uniform vec3 uShallow,uDeep,uFogColor; uniform sampler2D uDepth; uniform vec4 uRect; varying vec3 vW;
      vec2 waveGrad(vec2 p,float t){
        vec2 g=vec2(0.); vec2 d;
        d=normalize(vec2(1.,.6)); g+=d*(.10*.55*cos(dot(d,p)*.55+t*1.2));
        d=normalize(vec2(-.4,1.)); g+=d*(.06*.8*cos(dot(d,p)*.8+t*1.5));
        d=normalize(vec2(.7,-.8)); g+=d*(.035*1.3*cos(dot(d,p)*1.3+t*2.1));
        d=normalize(vec2(-1.,-.3)); g+=d*(.02*2.1*cos(dot(d,p)*2.1+t*2.6));
        d=normalize(vec2(.2,1.)); g+=d*(.012*3.3*cos(dot(d,p)*3.3+t*3.4));
        g+=(texture2D(uNoise,p*.045+vec2(t*.012,-t*.008)).gb-.5)*.22+(texture2D(uNoise,p*.11-vec2(t*.02,t*.014)).gb-.5)*.12;
        return g;
      }
      void main(){
        vec2 uv=(vW.xz-uRect.xy)/uRect.zw;
        float depth=(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)?8.:texture2D(uDepth,uv).r*8.;
        float dist=length(cameraPosition-vW);
        vec2 g=waveGrad(vW.xz,uTime)*(.35+.65*smoothstep(0.,2.5,depth));
        vec3 n=normalize(mix(vec3(-g.x,1.,-g.y),vec3(0.,1.,0.),smoothstep(70.,320.,dist)*.75));
        vec3 V=normalize(cameraPosition-vW);
        float F=.02+.98*pow(1.-clamp(dot(n,V),0.,1.),5.);
        vec3 R=reflect(-V,n); R.y=abs(R.y);
        vec3 body=mix(uShallow,uDeep,smoothstep(.3,6.,depth))*uLight;
        vec3 col=mix(body,skyBase(normalize(R)),F*.85);
        float sr=max(dot(normalize(R),uSunDir),0.);
        col+=uSunColor*(pow(sr,360.)*6.+pow(sr,40.)*.22);
        float fn=texture2D(uNoise,vW.xz*.06+vec2(uTime*.01,uTime*.006)).a;
        float shore=1.-smoothstep(0.,.3+fn*.25,depth);
        float bands=smoothstep(.62,1.,sin(depth*9.-uTime*1.8+fn*3.))*(1.-smoothstep(.2,1.3,depth))*.65;
        float foam=clamp(shore+bands,0.,1.)*step(depth,7.9);
        col=mix(col,vec3(.97,.99,1.)*(.55+.45*uLight),foam*.9);
        float alpha=max(mix(.3,.96,smoothstep(0.,3.2,depth)),foam*.9);
        float ff=1.-exp(-pow(dist*uFogDensity,2.));
        gl_FragColor=vec4(mix(col,uFogColor,ff),mix(alpha,1.,ff));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), waterMat); water.renderOrder = 1; scene.add(water);

  // Distant islands give the horizon depth.
  const farR = rng32(5);
  for (let k = 0; k < 9; k++) {
    const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, seed = k * 9.1;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x, y < 0 ? -.15 : y * (1 + .45 * fbm(x * 1.6 + seed, z * 1.6, 3)), z); }
    g.computeVertexNormals();
    const geo = finishPart(g, (c, x, y) => c.copy(P.g2).lerp(P.rock, smooth(.25, .8, y)).lerp(P.snow, smooth(1.0, 1.3, y)));
    const a = k / 9 * Math.PI * 2 + farR() * .5, dist = 260 + farR() * 200, isle = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    isle.position.set(Math.sin(a) * dist, -2, Math.cos(a) * dist * .8 - 40); isle.scale.set(28 + farR() * 40, 18 + farR() * 55, 24 + farR() * 30); isle.rotation.y = farR() * 6;
    if (REALMS.every(R => Math.hypot(isle.position.x - R.at[0], isle.position.z - R.at[1]) > 130)) scene.add(isle);
  }

  // Landmarks, barriers for locked places, hit targets and collision circles (logical units).
  const proxies = [], staticObstacles = [], sites = {};
  const barrierMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: U.time },
    vertexShader: 'varying vec3 vN,vV,vP; varying float vFar; void main(){ vec4 w=modelMatrix*vec4(position,1.); vP=position; vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); vFar=1.-smoothstep(28.,60.,distance(cameraPosition,w.xyz)); gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `${GLSL_NOISE} uniform float uTime; varying vec3 vN,vV,vP; varying float vFar; void main(){ float f=pow(1.-abs(dot(normalize(vN),vV)),2.2)*vFar; float b=smoothstep(.55,1.,sin(vP.y*5.-uTime*1.4+vnoise(vP.xz*1.5+uTime*.2)*3.)); vec3 c=mix(vec3(.55,.45,1.),vec3(1.,.82,.45),b); gl_FragColor=vec4(c*(f*f*.55+b*f*.18),1.); }`,
  });
  for (const r of WORLD) {
    const s = SITES[r.id], [x, z] = toW(...s.at), h = PADS.find(p => p.id === r.id).h, built = buildSite(r.id, r);
    const group = new THREE.Group(); group.position.set(x, h, z);
    group.add(mergeGroup(built.stat), built.dyn); scene.add(group);
    animated.push(built.tick);
    for (const [ox, oz, rad] of built.obstacles) { const [lx, ly] = toL(x + ox, z + oz); staticObstacles.push({ x: lx, y: ly, r: rad / SCALE }); }
    const extent = Math.max(...built.obstacles.map(([ox, oz, rad]) => Math.hypot(ox, oz) + rad)) + .6;
    const domeR = Math.min(extent + .8, 8.5), dome = new THREE.Mesh(new THREE.SphereGeometry(domeR, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), barrierMat);
    dome.position.set(x, h - .2, z); dome.scale.y = clamp(s.label * .8 / domeR, 1, 3); dome.renderOrder = 4; scene.add(dome);
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(.45), glow('#bfa6ff', 2.6)); rune.position.set(x, h + s.label - 1.6, z); scene.add(rune);
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(extent, 6.5), Math.min(extent, 6.5), s.label + 1, 12), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(x, h + s.label / 2, z); proxy.userData = { kind: 'area', area: r }; scene.add(proxy); proxies.push(proxy);
    sites[r.id] = { group, dome, rune, label: new THREE.Vector3(x, h + s.label, z) };
  }
  animated.push(t => { for (const s of Object.values(sites)) if (s.rune.visible) { s.rune.rotation.y = t * 1.2; s.rune.position.y = s.label.y - 1.6 + Math.sin(t * 1.5) * .2; } });

  // The summit beacon and the level-7 horizon gate.
  const peakH = heightAt(...PEAK), beacon = new THREE.Mesh(new THREE.OctahedronGeometry(.5), glow('#ffd66b', 4)); beacon.position.set(PEAK[0], peakH + 1.2, PEAK[1]); scene.add(beacon);
  animated.push(t => { beacon.rotation.y = t; beacon.position.y = peakH + 1.2 + Math.sin(t * 1.6) * .15; });
  const gate = new THREE.Group(), [gx, gz] = toW(581, 92); gate.position.set(gx, Math.max(heightAt(gx, gz), .2), gz);
  { const k = kit(); for (const s of [-1, 1]) { k.cyl(.36, .42, 4.4, M.stone, s * 2.25, 2.2, 0, 14); k.box(1, .3, 1, M.stoneDark, s * 2.25, .15, 0); } k.torus(2.25, .3, M.gold, 0, 4.4, 0, 0, 0, Math.PI); gate.add(mergeGroup(k.g)); }
  const portalMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: U.time }, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: `${GLSL_NOISE} uniform float uTime; varying vec2 vUv; void main(){ float n=fbm5(vUv*4.+vec2(0.,-uTime*.4)); gl_FragColor=vec4(vec3(1.,.8,.4)*(.25+n*.9),1.); }` });
  gate.add(new THREE.Mesh(new THREE.PlaneGeometry(4.0, 4.4).translate(0, 2.2, 0), portalMat), new THREE.Mesh(new THREE.CircleGeometry(1.98, 32, 0, Math.PI).translate(0, 4.4, 0), portalMat));
  scene.add(gate);
  const gateObstacles = [-1, 1].map(s => { const [lx, ly] = toL(gx + s * 2.25, gz); return { x: lx, y: ly, r: .5 / SCALE }; });

  // Councils: the group chats become meeting places, with a banner for every member.
  const councils = PARTY_COUNCILS.map(c => {
    const [x, z] = toW(c.x, c.y), h = heightAt(x, z), k = kit(), dyn = new THREE.Group(), members = c.members.map(partyMember).filter(Boolean);
    k.cyl(2.0, 2.15, 1.3, M.stone, 0, -.46, 0, 30); k.torus(1.82, .045, M.gold, 0, .2, 0);
    k.cyl(.95, .95, .1, M.wood, 0, .84, 0, 26); k.cyl(.16, .32, .64, M.woodDark, 0, .5, 0, 10);
    members.forEach((m, i) => {
      const a = i / members.length * Math.PI * 2 + .35;
      k.cyl(.2, .23, .44, M.wood, Math.sin(a) * 1.42, .4, Math.cos(a) * 1.42, 10);
      k.cyl(.026, .026, 1.9, M.woodDark, Math.sin(a) * 1.86, 1.12, Math.cos(a) * 1.86, 6);
      flag(dyn, m.color, Math.sin(a) * 1.86, 2.02, Math.cos(a) * 1.86, .5, .7, a + Math.PI / 2, m.name[0].toUpperCase());
    });
    if (c.id === 'war-room') { k.box(1.2, .03, .8, flatColor('#e7d3a2'), 0, .9, 0); for (let i = 0; i < 4; i++) k.cone(.04, .16, glow(['#b5613f', '#3f7f8a', '#7d8b55', '#ccb25d'][i], 1.5), -.4 + i * .27, .99, (i % 2) * .2 - .1, 6); }
    if (c.id === 'control-room') for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; k.box(.42, .3, .05, glow('#6fe3ee', 1.4), Math.sin(a) * .45, 1.07, Math.cos(a) * .45, a); }
    if (c.id === 'exam-bunker') { for (let i = 0; i < 3; i++) k.box(.36, .07, .26, flatColor(['#c25b4a', '#4f6fa8', '#e2b850'][i]), .1, .93 + i * .07, -.05, i * .4); k.box(1.4, .9, .06, flatColor('#2f4a3a'), 0, 1.75, -2.25); k.cyl(.04, .04, 1.8, M.woodDark, -.68, .9, -2.25, 6); k.cyl(.04, .04, 1.8, M.woodDark, .68, .9, -2.25, 6); }
    if (c.id === 'career-council') { k.cone(.16, .32, M.gold, 0, 1.05, 0, 12); k.ball(.13, M.gold, 0, 1.28, 0, 14); }
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.22), glow(c.color, 2.6)); orb.position.y = 2.1; dyn.add(orb);
    animated.push(t => { orb.rotation.y = t * 1.1; orb.position.y = 2.1 + Math.sin(t * 1.4 + c.x) * .12; });
    const group = new THREE.Group(); group.position.set(x, h, z); group.add(mergeGroup(k.g), dyn); scene.add(group);
    staticObstacles.push({ x: c.x, y: c.y, r: 2.2 / SCALE });
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 3, 10), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.set(x, h + 1.5, z); proxy.userData = { kind: 'council', council: c }; scene.add(proxy); proxies.push(proxy);
    return { c, group, proxy, pos: new THREE.Vector3(x, h, z) };
  });

  // Vegetation scattered with seeded randomness so the island looks the same every visit.
  const treeObstacles = [], vr = rng32(2024);
  const xs = coast.map(p => p[0]), zs = coast.map(p => p[1]), bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs);
  const landmarkClear = (x, z, pad) => PADS.every(p => Math.hypot(x - p.x, z - p.z) > p.r + pad) && staticObstacles.every(o => { const [ox, oz] = toW(o.x, o.y); return Math.hypot(x - ox, z - oz) > o.r * SCALE + pad * .5; });
  const keepClear = [...WORLD.map(r => [...toW(r.x, r.y + 32), 6.5]), ...PARTY.map(b => [...toW(b.x, b.y), 2.6]), ...PARTY_COUNCILS.map(c => [...toW(c.x, c.y), 3.6]), [...toW(555, 395), 5], [gx, gz, 4]];
  const nearKeep = (x, z, scale) => keepClear.some(([kx, kz, r]) => Math.hypot(x - kx, z - kz) < r * scale);
  const kinds = ['oak', 'birch', 'pine', 'sakura', 'cypress'], placed = { oak: [], birch: [], pine: [], sakura: [], cypress: [] }, grovePos = toW(...SITES.grove.at);
  for (let tries = 0, n = 0; n < Q.trees && tries < Q.trees * 60; tries++) {
    const x = bx0 + vr() * (bx1 - bx0), z = bz0 + vr() * (bz1 - bz0), d = sdfAt(x, z), h = heightAt(x, z);
    if (d < 3.4 || h > 10.5 || slopeAt(x, z) > .5 || pathDistAt(x, z) < 2.8 || !landmarkClear(x, z, 3.2) || nearKeep(x, z, 1)) continue;
    const [mlx, mly] = toL(x, z); if (((mlx - 555) / 125) ** 2 + ((mly - 505) / 120) ** 2 < 1) continue; // open meadow below camp keeps the home view clear
    if (vr() > smooth(-.25, .45, fbm(x * .06 + 100, z * .06, 2)) * .85 + .1) continue;
    if ([...Object.values(placed)].some(list => list.some(t => Math.hypot(t[0] - x, t[1] - z) < 2.4 * t[3]))) continue;
    const nearGrove = Math.hypot(x - grovePos[0], z - grovePos[1]) < 14;
    const kind = h > 5.5 ? 'pine' : nearGrove && vr() < .55 ? 'sakura' : kinds[[0, 0, 4, 1, 2, 4, 0, 1][vr() * 8 | 0]];
    const s = .8 + vr() * .55; placed[kind].push([x, z, vr() * 6.28, s]); n++;
    const [lx, ly] = toL(x, z); treeObstacles.push({ x: lx, y: ly, r: .42 * s / SCALE });
  }
  const dummy = new THREE.Object3D();
  for (const kind of kinds) {
    const list = placed[kind]; if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(treeGeometry(kind, rng32(kind.length * 31), Q.blob), treeMaterial(), list.length);
    list.forEach(([x, z, ry, s], i) => { dummy.position.set(x, heightAt(x, z) - .1, z); dummy.rotation.set(0, ry, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere(); scene.add(mesh);
  }
  { // bushes and rocks
    const bushes = [], rocks = [];
    for (let tries = 0; bushes.length < Q.bushes && tries < 6000; tries++) { const x = bx0 + vr() * (bx1 - bx0), z = bz0 + vr() * (bz1 - bz0); if (sdfAt(x, z) < 2.6 || heightAt(x, z) > 8 || pathDistAt(x, z) < 1.5 || !landmarkClear(x, z, .8) || nearKeep(x, z, .45)) continue; bushes.push([x, z, vr() * 6, .7 + vr() * .7]); }
    for (let tries = 0; rocks.length < 46 && tries < 6000; tries++) { const x = bx0 - 6 + vr() * (bx1 - bx0 + 12), z = bz0 - 6 + vr() * (bz1 - bz0 + 12), d = sdfAt(x, z); if (d < -4 || (d > 3 && vr() < .7) || pathDistAt(x, z) < 1.6 || !landmarkClear(x, z, 1) || nearKeep(x, z, .5)) continue; rocks.push([x, z, vr() * 6, .35 + vr() * (d < 2 ? 1.3 : .8)]); }
    const bushMesh = new THREE.InstancedMesh(treeGeometry('bush', rng32(3), 1), treeMaterial(), bushes.length);
    bushes.forEach(([x, z, ry, s], i) => { dummy.position.set(x, heightAt(x, z) - .05, z); dummy.rotation.set(0, ry, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); bushMesh.setMatrixAt(i, dummy.matrix); });
    bushMesh.castShadow = bushMesh.receiveShadow = true; bushMesh.computeBoundingSphere(); scene.add(bushMesh);
    const rockMesh = new THREE.InstancedMesh(rockGeometry(4), occludable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, flatShading: true })), rocks.length);
    rocks.forEach(([x, z, ry, s], i) => { dummy.position.set(x, heightAt(x, z) - s * .15, z); dummy.rotation.set(vr() * .3, ry, vr() * .3); dummy.scale.set(s, s * (.7 + vr() * .5), s * (.8 + vr() * .4)); dummy.updateMatrix(); rockMesh.setMatrixAt(i, dummy.matrix); if (s > .7 && sdfAt(x, z) > 1) { const [lx, ly] = toL(x, z); treeObstacles.push({ x: lx, y: ly, r: s * .8 / SCALE }); } });
    rockMesh.castShadow = rockMesh.receiveShadow = true; rockMesh.computeBoundingSphere(); scene.add(rockMesh);
  }
  { // grass and flowers
    const grassMesh = new THREE.InstancedMesh(grassBladeGeometry(), grassMaterial('grass', 1.15), Q.grass), flowerGeo = new THREE.IcosahedronGeometry(1, 0);
    flowerGeo.scale(1, .55, 1); flowerGeo.translate(0, 1, 0);
    const flowerMesh = new THREE.InstancedMesh(flowerGeo, grassMaterial('flower', 1.0, .3), Q.flowers);
    const flowerCols = ['#fff6e6', '#ffd85a', '#f59ac0', '#a9c4ff', '#ffffff', '#ff8f6b', '#e6b3ff'].map(C), gc = new THREE.Color();
    let n = 0, f = 0;
    for (let tries = 0; (n < Q.grass || f < Q.flowers) && tries < Q.grass * 6; tries++) {
      const x = bx0 + vr() * (bx1 - bx0), z = bz0 + vr() * (bz1 - bz0), d = sdfAt(x, z);
      if (d < 2.3) continue;
      const h = heightAt(x, z); if (h > 8.6 || slopeAt(x, z) > .33 || pathDistAt(x, z) < 1.05 || sampleGrid(PADW, x, z, 0) > .35) continue;
      const patch = noise2(x * .13, z * .13); if (patch < -.5 && vr() < .75) continue;
      if (staticObstacles.some(o => Math.hypot(o.x - (x / SCALE + 550), o.y - (z / SCALE + 360)) < o.r * .95)) continue;
      const ix = clamp(Math.round((x - X0) / CX), 0, GX), iz = clamp(Math.round((z - Z0) / CZ), 0, GZ), ci = (iz * (GX + 1) + ix) * 3;
      if (n < Q.grass) {
        const tall = .32 + .3 * smooth(-.2, .7, patch) + vr() * .22, w = .07 + vr() * .05;
        dummy.position.set(x, h - .03, z); dummy.rotation.set(0, vr() * Math.PI * 2, 0); dummy.scale.set(w, tall, w); dummy.updateMatrix();
        grassMesh.setMatrixAt(n, dummy.matrix);
        gc.setRGB(base[ci], base[ci + 1], base[ci + 2]).multiplyScalar(.95 + vr() * .25); gc.g *= 1.04; grassMesh.setColorAt(n, gc); n++;
      }
      if (f < Q.flowers && noise2(x * .09 + 7, z * .09) > .15 && vr() < .5) {
        const s = .045 + vr() * .035; dummy.position.set(x, h + .22 + vr() * .2, z); dummy.rotation.set(0, vr() * 6, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
        flowerMesh.setMatrixAt(f, dummy.matrix); flowerMesh.setColorAt(f, flowerCols[(noise2(x * .2, z * .2) * 3.5 + 3.5 + vr() * 1.2 | 0) % flowerCols.length]); f++;
      }
    }
    grassMesh.count = n; flowerMesh.count = f; grassMesh.receiveShadow = flowerMesh.receiveShadow = true;
    grassMesh.computeBoundingSphere(); flowerMesh.computeBoundingSphere(); scene.add(grassMesh, flowerMesh);
  }

  // A small pier and boat on the Sea of Possibility.
  {
    let sx = toW(240, 0)[0], sz = 6; while (sdfAt(sx, sz) > 0 && sz < 40) sz += .25;
    const k = kit(), ph = .55, len = 9;
    for (let i = 0; i < len / .5; i++) k.box(1.6, .08, .44, M.wood, 0, ph, -1.5 + i * .5);
    for (let i = 0; i < len / 2; i++) for (const s of [-1, 1]) k.cyl(.07, .08, 2.6, M.woodDark, s * .78, ph - 1.2, -1 + i * 2, 7);
    const pier = mergeGroup(k.g); pier.position.set(sx, 0, sz); scene.add(pier); pierInfo = { sx, sz, len };
    const boat = new THREE.Group(), hull = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); hull.scale(.62, .4, 1.6);
    const hm = new THREE.Mesh(hull, M.wood); hm.castShadow = true; boat.add(hm);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, .06, .3), M.woodDark); seat.position.y = -.05; boat.add(seat);
    boat.position.set(sx + 1.9, .08, sz + len - 2.2); boat.rotation.y = .25; scene.add(boat);
    animated.push(t => { boat.position.y = .1 + Math.sin(t * 1.1) * .06; boat.rotation.z = Math.sin(t * .9) * .04; boat.rotation.x = Math.sin(t * .7) * .03; });
  }


  // Beyond the sea: build each realm at its own offset in the ocean.
  for (const R of REALMS) {
    const F = realmField(R); R.sdf = F.sdf;
    const group = new THREE.Group(); group.position.set(R.at[0], 0, R.at[1]); scene.add(group);
    group.add(realmTerrain(R, F)); if (!R.float) group.add(shoreMesh(R));
    const B = R.build(R, F); mergeGroup(B.stat); group.add(B.stat, B.dyn); if (B.tick) animated.push(B.tick);
    F.ground = (u, v) => { const h = F.height(u, v), dh = R.deck?.(u, v); return dh != null ? Math.max(h, dh) : h; };
    // A pier on the side that faces home; the ferry moors at its end.
    const dir = new THREE.Vector2(-R.at[0], -R.at[1]).normalize(); let su = 0, sv = 0;
    for (let d = 0; d < 90; d += .25) { su = dir.x * d; sv = dir.y * d; if (F.sdf(su, sv) < .3) break; }
    { const pk = kit(), ph = R.float ? R.base + .25 : .55;
      for (let i = 0; i < 16; i++) pk.box(1.6, .08, .44, M.wood, 0, ph, -1.2 + i * .5);
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) pk.cyl(.07, .08, R.float ? 1.2 : 2.6, M.woodDark, s * .78, ph - (R.float ? .6 : 1.2), -.8 + i * 2, 7);
      for (const s of [-1, 1]) { pk.cyl(.05, .06, 1.6, M.iron, s * .82, ph + .8, -.9, 6); pk.ball(.15, M.lantern, s * .82, ph + 1.65, -.9, 10); }
      pk.g.position.set(su, 0, sv); pk.g.rotation.y = Math.atan2(dir.x, dir.y); group.add(mergeGroup(pk.g)); }
    const obstacles = [...B.obstacles];
    // Trees: the builder's own placements, then a seeded scatter of the realm's species.
    const placed = {}, rr = rng32(R.seed * 7), bu = su - dir.x * 3.2, bv = sv - dir.y * 3.2;
    const clear = (u, v, pad) => F.sdf(u, v) > 3 && F.paved(u, v) < .1 && R.pads.every(P => Math.hypot(u - P[0], v - P[1]) > P[2] + pad) && obstacles.every(o => Math.hypot(u - o[0], v - o[1]) > o[2] + pad) && B.spots.every(s => Math.hypot(u - s.u, v - s.v) > 3) && Math.hypot(u - bu, v - bv) > 5 && Math.hypot(u - su, v - sv) > 4;
    for (const [kind, u, v, s] of B.trees) (placed[kind] ||= []).push([u, v, rr() * 6.28, s]);
    for (const [kind, n] of B.treeKinds) for (let tries = 0, c = 0; c < n && tries < n * 80; tries++) {
      const u = (rr() - .5) * R.rx * 2, v = (rr() - .5) * R.rz * 2, s = .75 + rr() * .5;
      if (!clear(u, v, 1.4) || Object.values(placed).some(list => list.some(t => Math.hypot(t[0] - u, t[1] - v) < 2.3 * Math.max(t[3], .6)))) continue;
      (placed[kind] ||= []).push([u, v, rr() * 6.28, s]); c++;
    }
    for (const [kind, list] of Object.entries(placed)) {
      const mesh = new THREE.InstancedMesh(treeGeometry(kind === 'vine' ? 'bush' : kind, rng32(kind.length * 31 + R.seed), Q.blob), treeMaterial(), list.length);
      list.forEach(([u, v, ry, s], i) => { dummy.position.set(u, F.height(u, v) - .1, v); dummy.rotation.set(0, ry, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); if (kind !== 'vine') obstacles.push([u, v, .42 * s]); });
      mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere(); group.add(mesh);
    }
    // Grass and wildflowers.
    { const gN = Q.grass * .08 | 0, fN = Q.flowers * .2 | 0, grass = new THREE.InstancedMesh(grassBladeGeometry(), grassMaterial('grass', 1.15), gN), fg = new THREE.IcosahedronGeometry(1, 0);
      fg.scale(1, .55, 1); fg.translate(0, 1, 0); const flowers = new THREE.InstancedMesh(fg, grassMaterial('flower', 1.0, .3), fN), g1 = C(R.palette.g1), g2 = C(R.palette.g2), gc = new THREE.Color();
      const fcols = ['#fff6e6', '#ffd85a', '#f59ac0', '#a9c4ff', '#ffffff', '#ff8f6b', '#e6b3ff'].map(C);
      let n = 0, f = 0;
      for (let tries = 0; (n < gN || f < fN) && tries < gN * 6; tries++) {
        const u = (rr() - .5) * R.rx * 2, v = (rr() - .5) * R.rz * 2;
        if (F.sdf(u, v) < (R.float ? 1.2 : 2.3) || F.paved(u, v) > .25 || obstacles.some(o => Math.hypot(u - o[0], v - o[1]) < o[2] * .9)) continue;
        const h = F.height(u, v);
        if (n < gN) { const w = .07 + rr() * .05; dummy.position.set(u, h - .03, v); dummy.rotation.set(0, rr() * 6.28, 0); dummy.scale.set(w, .3 + rr() * .45, w); dummy.updateMatrix(); grass.setMatrixAt(n, dummy.matrix); gc.copy(g1).lerp(g2, rr()).multiplyScalar(.95 + rr() * .2); grass.setColorAt(n++, gc); }
        if (f < fN && rr() < .35) { const s = .045 + rr() * .035; dummy.position.set(u, h + .22 + rr() * .2, v); dummy.scale.set(s, s, s); dummy.updateMatrix(); flowers.setMatrixAt(f, dummy.matrix); flowers.setColorAt(f++, fcols[(rr() * fcols.length) | 0]); }
      }
      grass.count = n; flowers.count = f; grass.receiveShadow = flowers.receiveShadow = true; grass.computeBoundingSphere(); flowers.computeBoundingSphere(); group.add(grass, flowers); }
    const toLL = (u, v) => ({ x: u / SCALE + 550, y: v / SCALE + 360 });
    const parkU = su + dir.x * 5.2 - dir.y * 2.1, parkV = sv + dir.y * 5.2 + dir.x * 2.1;
    realms.push({
      R, F, B, group, obstacles, board: toLL(bu, bv),
      park: { pos: new THREE.Vector3(R.at[0] + parkU, R.float ? R.base - .1 : 0, R.at[1] + parkV), yaw: Math.atan2(-dir.x, -dir.y) },
      labelPos: new THREE.Vector3(R.at[0], R.base + R.labelH, R.at[1]),
      spots: B.spots.map(s => ({ ...s, realmId: R.id, L: toLL(s.u, s.v), pos: new THREE.Vector3(R.at[0] + s.u, F.ground(s.u, s.v), R.at[1] + s.v) })),
      walkable(lx, ly) {
        const u = (lx - 550) * SCALE, v = (ly - 360) * SCALE;
        if (F.sdf(u, v) < 1.1) return false;
        const deck = R.deck?.(u, v) != null;
        return obstacles.every(o => (u - o[0]) ** 2 + (v - o[1]) ** 2 > o[2] * o[2] || (o[3] && deck));
      },
    });
  }
  groundAt = (x, z) => { for (const r of realms) if (Math.abs(x - r.R.at[0]) < r.R.rx + 14 && Math.abs(z - r.R.at[1]) < r.R.rz + 14) return r.F.ground(x - r.R.at[0], z - r.R.at[1]); return heightAt(x, z); };

  // Characters.
  let player = makeCharacter(PLAYER_LOOK, true); scene.add(player.root);
  const bots = PARTY.map((b, i) => { const ch = makeCharacter(lookFor(b)); const [x, z] = toW(b.x, b.y); ch.root.position.set(x, heightAt(x, z), z); ch.yaw = 0; scene.add(ch.root); const proxy = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 2.6, 8), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.set(x, heightAt(x, z) + 1.3, z); proxy.userData = { kind: 'bot', bot: b }; scene.add(proxy); return { b, ch, proxy, seed: i * 1.7, greeted: false }; });

  // Atmosphere.
  const motes = particles(touch ? 110 : 220, 0, { size: .12, box: [46, 12, 46], color: '#fff1bf', boost: 1.6 });
  const flies = particles(touch ? 90 : 160, 0, { size: .16, box: [52, 6, 52], color: '#d9ff7a', boost: 3, opacity: 0 });
  const campAt = toW(...SITES.camp.at), forgeAt = toW(...SITES.forge.at);
  const embers = particles(40, 1, { size: .09, speed: .5, rise: 2.6, spread: .5, origin: [campAt[0], PADS[0].h + .4, campAt[1]], color: '#ffb052', boost: 3 });
  const smoke = particles(28, 1, { size: 1.4, speed: .08, rise: 7, spread: .7, origin: [forgeAt[0] + 1.75, PADS.find(p => p.id === 'forge').h + 6.3, forgeAt[1] - 1.1], box: [3.2, 0, 0], color: '#cfcac2', additive: false, opacity: .32 });
  const petals = particles(80, 2, { size: .12, speed: .07, origin: [grovePos[0] - 1, PADS.find(p => p.id === 'grove').h, grovePos[1] - 1.4], box: [12, 9, 12], color: '#ffc4dc', boost: 1.1, additive: false, opacity: .95 });
  const sparkle = particles(30, 1, { size: .14, speed: .25, rise: 3, spread: 1.2, origin: [PEAK[0], peakH + .4, PEAK[1]], color: '#ffd978', boost: 3 });
  scene.add(motes, flies, embers, smoke, petals, sparkle);
  const marker = new THREE.Mesh(new THREE.RingGeometry(.35, .5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe3a0', transparent: true, opacity: .9, depthWrite: false })); marker.visible = false; marker.renderOrder = 5; scene.add(marker);
  const birds = [...Array(7)].map((_, i) => { const g = new THREE.Group(), wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -.18, 0, 0, .18, .9, 0, 0], 3)); wing.computeVertexNormals(); const m = new THREE.MeshBasicMaterial({ color: '#3a3f48', side: THREE.DoubleSide }); const l = new THREE.Mesh(wing, m), r = new THREE.Mesh(wing, m); r.scale.x = -1; g.add(l, r); scene.add(g); return { g, l, r, off: i * .9, rad: 22 + i * 1.6, h: 20 + (i % 3) * 2 }; });
  const flutter = [...Array(touch ? 4 : 8)].map((_, i) => { const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: ['#ffd36b', '#ffffff', '#9fd0ff', '#ff9cc7'][i % 4], side: THREE.DoubleSide }); const wing = new THREE.CircleGeometry(.09, 8).translate(.09, 0, 0).rotateX(-Math.PI / 2); const l = new THREE.Mesh(wing, m), r = new THREE.Mesh(wing, m); r.rotation.y = Math.PI; g.add(l, r); scene.add(g); const home = i % 2 ? grovePos : campAt; return { g, l, r, home: [home[0] + (vr() - .5) * 8, home[1] + 4 + (vr() - .5) * 6], seed: i * 2.1 }; });

  // Post-processing: HDR → bloom → gentle grade → ACES tone map.
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .3, .5, 1.3), bloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSize(Math.max(1, w / 2 | 0), Math.max(1, h / 2 | 0)); bloom.enabled = Q.bloom; composer.addPass(bloom);
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); float l=dot(c.rgb,vec3(.2126,.7152,.0722)); c.rgb=mix(vec3(l),c.rgb,1.12); float v=smoothstep(.95,.3,length((vUv-.5)*vec2(1.25,1.))); c.rgb*=mix(vec3(.80,.72,.60),vec3(1.),v); gl_FragColor=c; }',
  }));
  composer.addPass(new OutputPass());

  // Labels are DOM, so text stays crisp, translatable and screen-reader friendly.
  const layer = document.createElement('div'); layer.className = 'w3-layer'; layer.setAttribute('aria-hidden', 'true'); canvas.after(layer);
  const label = cls => { const el = document.createElement('div'); el.className = 'w3-label ' + cls; layer.append(el); return el; };
  const areaLabels = WORLD.map(r => ({ r, el: label('w3-area'), pos: sites[r.id].label }));
  const botLabels = bots.map(o => ({ o, el: label('w3-bot') }));
  const councilLabels = councils.map(o => ({ o, el: label('w3-area w3-council') }));
  const gateLabel = label('w3-area'); gateLabel.innerHTML = '<b>The Horizon</b><small>HORIZON KEEPER</small>';
  const seaLabel = label('w3-sea'); seaLabel.textContent = 'THE SEA OF POSSIBILITY'; const seaPos = new THREE.Vector3(...(([x, z]) => [x, .3, z])(toW(200, 690)));
  const compass = document.createElement('div'); compass.className = 'w3-compass'; compass.setAttribute('aria-hidden', 'true'); compass.innerHTML = '<span>N</span>'; layer.after(compass);
  const clock = document.createElement('div'); clock.className = 'w3-clock'; clock.setAttribute('role', 'status'); clock.title = 'Time in India: the sky follows the real clock'; compass.after(clock);
  const labelQueue = [], taken = [];
  let hudRects = [], hudAge = 1e9;
  const sizeOf = el => el._size ??= [el.offsetWidth, el.offsetHeight];
  const resetLabelSizes = () => { for (const el of layer.children) el._size = null; hudAge = 1e9; };
  document.fonts?.ready.then(resetLabelSizes);
  const fadeLabel = (el, target) => { const o = el._op ?? 0, next = o + (target - o) * .22; el._op = Math.abs(next - target) < .01 ? target : next; el.style.opacity = el._op.toFixed(3); };
  const overlaps = (r, list) => list.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  function measureHud() {
    const box = canvas.getBoundingClientRect();
    hudRects = [...frameEl.querySelectorAll('.map-caption span,.map-caption button,.w3-compass,.w3-clock,.map-hint,.touch-controls')].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height)
      .map(r => [r.left - box.left - 6, r.top - box.top - 6, r.right - box.left + 6, r.bottom - box.top + 6]);
  }
  function layoutLabels() {
    if (++hudAge > 45) { hudAge = 0; measureHud(); }
    labelQueue.sort((a, b) => b.pri - a.pri || a.d - b.d);
    taken.length = 0;
    for (const L of labelQueue) {
      const [w, h] = sizeOf(L.el), step = h + 6; let spot = null;
      for (const [dx, dy] of [[0, 0], [0, step], [0, -step], [0, 2 * step], [w * .6, 0], [-w * .6, 0], [w * .6, step], [-w * .6, step]]) {
        const cx = clamp(L.x + dx, w / 2 + 4, viewW - w / 2 - 4), r = [cx - w / 2 - 3, L.y - h - dy - 3, cx + w / 2 + 3, L.y - dy + 3];
        if (!overlaps(r, taken) && !overlaps(r, hudRects)) { spot = [cx - L.x, dy]; taken.push(r); break; }
      }
      const ease = (k, v) => L.el[k] = L.el[k] === undefined ? v : L.el[k] + (v - L.el[k]) * .3;
      if (spot) { ease('_dx', spot[0]); ease('_lift', spot[1]); }
      fadeLabel(L.el, spot ? L.op : 0);
      L.el.style.transform = `translate3d(${L.x + (L.el._dx ?? 0)}px,${L.y - (L.el._lift ?? 0)}px,0) translate(-50%,-100%)`;
    }
  }
  frameEl.classList.add('is-3d');
  const hint = frameEl.querySelector('.map-hint'), hint2d = hint?.textContent; if (hint) hint.textContent = touch ? 'Tap to travel · Drag to look · Pinch to zoom' : 'Click to travel · Drag or Q / R to look around · Scroll to zoom · WASD to walk · E to enter';
  const label2d = canvas.getAttribute('aria-label');
  canvas.setAttribute('aria-label', 'Explorable 3D world. Use arrow keys or WASD to walk, E to visit the nearest area, Q and R to turn the camera, plus and minus to zoom. Use the area buttons below as an alternative.');

  // Camera orbit around the avatar.
  const cam = { yaw: 0, pitch: .36, dist: 15.5, target: new THREE.Vector3(), intro: reduceMotion.matches ? 0 : 1 };
  const projV = new THREE.Vector3();
  let viewW = 1, viewH = 1, pixelRatio = Math.min(window.devicePixelRatio || 1, Q.pr), maxRatio = pixelRatio;
  function resize3d() {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    hudAge = 1e9;
    viewW = r.width; viewH = r.height;
    renderer.setPixelRatio(pixelRatio); renderer.setSize(viewW, viewH, false);
    composer.setPixelRatio(pixelRatio); composer.setSize(viewW, viewH);
    camera.aspect = viewW / viewH; camera.fov = viewW / viewH < 1.2 ? 54 : 46; camera.updateProjectionMatrix();
    SIZE_SCALE.value = viewH * pixelRatio / (2 * Math.tan(camera.fov * Math.PI / 360));
  }
  new ResizeObserver(resize3d).observe(canvas); resize3d();

  // Collision against landmarks, trees, characters and the coast (all in logical units).
  const botObstacles = () => bots.filter(o => o.ch.root.visible).map(o => ({ x: o.b.x, y: o.b.y, r: 10 }));
  let obstacles = [];
  const refreshObstacles = level => { dynObstacles = [...botObstacles(), ...(level >= 7 ? gateObstacles : [])]; obstacles = [...staticObstacles, ...treeObstacles, ...dynObstacles]; };
  const walkable = (lx, ly) => realm ? realm.walkable(lx, ly) : mainWalkable(lx, ly);
  const mainWalkable = (lx, ly) => { const [x, z] = toW(lx, ly); return sdfAt(x, z) > 1.1 && heightAt(x, z) < 12.5 && !(mainMask && mainMask.test(x, z)) && (mainMask ? dynObstacles : obstacles).every(o => (lx - o.x) ** 2 + (ly - o.y) ** 2 > o.r * o.r); };
  function nearestWalkable(p) {
    if (walkable(p.x, p.y)) return p;
    for (let r = 6; r < 260; r += 6) for (let a = 0; a < 24; a++) { const x = p.x + Math.cos(a / 24 * Math.PI * 2) * r, y = p.y + Math.sin(a / 24 * Math.PI * 2) * r; if (walkable(x, y)) return { x, y }; }
    return realm ? { ...realm.board } : { x: 555, y: 390 };
  }

  // Keep the 3D world in step with the game state.
  let lastLevel = -1, lastCloak = null;
  function sync() {
    const level = E.level(E.total(state));
    if (level !== lastLevel) {
      lastLevel = level; paintPaths(level);
      for (const r of WORLD) { const locked = level < r.unlock; sites[r.id].dome.visible = sites[r.id].rune.visible = locked; }
      for (const o of bots) { const open = level >= WORLD.find(r => r.id === o.b.region).unlock; o.ch.root.visible = open; o.proxy.visible = open; }
      areaLabels.forEach(a => { const locked = level < a.r.unlock; a.el.classList.toggle('locked', locked); a.el._size = null; a.el.innerHTML = `<b>${esc(a.r.name)}</b><small>${locked ? '◇ LEVEL ' + a.r.unlock : esc(a.r.bot.toUpperCase())}</small>`; });
      gate.visible = level >= 7; refreshObstacles(level);
      for (const o of councils) { const open = partyUnlocked(o.c); o.group.visible = open; o.proxy.visible = open; }
    }
    // Name tags show each bot's level; a gold ! means the bot has a quest for you (Genshin-style).
    const st = partyStats();
    for (const { o, el } of botLabels) { const has = !!nextQuestFor(o.b), html = `<i class="${has ? 'quest' : ''}">${has ? '!' : '…'}</i>${esc(o.b.name)}${st[o.b.id] ? ` <em>Lv ${st[o.b.id].level}</em>` : ''}`; if (el.innerHTML !== html) { el.innerHTML = html; el._size = null; } }
    for (const { o, el } of councilLabels) { const open = partyUnlocked(o.c), html = `<b>${esc(o.c.name)}</b><small>${open ? 'COUNCIL · LV ' + (st[o.c.id]?.level ?? 1) + (nextQuestFor(o.c) ? ' · !' : '') : '◇ LEVEL ' + WORLD.find(r => r.id === o.c.region).unlock}</small>`; el.classList.toggle('locked', !open); if (el.innerHTML !== html) { el.innerHTML = html; el._size = null; } }
    if (state.equipped !== lastCloak && player.cloakMesh) { lastCloak = state.equipped; player.cloakMesh.material = toonMat(palettes[state.equipped] || palettes.sage); }
    hooks.sync?.();
  }
  let active = true;
  const prevUpdate = update; update = function () { prevUpdate(); if (active) sync(); };

  // Conversations: walking up to a guide plays a short scene. The camera frames you both, the guide speaks in
  // bubbles (live Party HQ check-ins when they exist) and hands over a quest scroll that unrolls with the details.
  const talk = { on: false, target: null, anchor: null, advance: null, abort: null, flight: null, closeScroll: null, settle: 0 };
  const view = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
  const bubble = document.createElement('div'); bubble.className = 'w3-bubble'; bubble.hidden = true; bubble.setAttribute('aria-live', 'polite'); layer.after(bubble);
  const bars = document.createElement('div'); bars.className = 'w3-cine'; bars.setAttribute('aria-hidden', 'true'); frameEl.append(bars);
  bubble.addEventListener('click', e => { if (e.target.closest('button')) return; e.stopPropagation(); talk.advance?.(); });
  const scrollProp = new THREE.Group();
  {
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .46, 18), flatColor('#f1dfb4')); paper.rotation.z = Math.PI / 2;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .62, 8), M.woodDark); rod.rotation.z = Math.PI / 2;
    const ribbon = new THREE.Mesh(new THREE.TorusGeometry(.079, .014, 6, 20), glow('#c0392b', .8)); ribbon.rotation.y = Math.PI / 2;
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .02, 14), glow('#b0302a', 1.2)); seal.position.z = .085; seal.rotation.x = Math.PI / 2;
    scrollProp.add(paper, rod, ribbon, seal); for (const sx of [-1, 1]) { const knob = new THREE.Mesh(new THREE.SphereGeometry(.04, 10, 8), M.gold); knob.position.x = sx * .32; scrollProp.add(knob); }
    scrollProp.visible = false; scene.add(scrollProp);
  }
  const handPos = (ch, v = new THREE.Vector3()) => ch.arms[1].localToWorld(v.set(0, -.45, .08));
  const greeting = () => { const h = hourOverride ?? istHours(); return h < 4.5 ? 'You’re up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21.5 ? 'Good evening' : 'You’re up late'; };
  const shortName = callName;
  function anchorOf(sp, v) {
    if (sp.pos) return v.copy(sp.pos).setY(sp.pos.y + 3.4);
    if (sp.kind === 'me') return v.copy(player.root.position).setY(player.root.position.y + 2.45);
    if (sp.kind === 'bot') return v.copy(sp.o.ch.root.position).setY(sp.o.ch.root.position.y + (sp.o.b.style === 'egg' ? 2.75 : 2.5));
    const a = sp.seat; return v.copy(sp.o.pos).add(new THREE.Vector3(Math.sin(a) * 1.4, 2.7, Math.cos(a) * 1.4));
  }
  function say(sp, text, choices) {
    return new Promise((resolve, reject) => {
      const st = partyStats(), lv = sp.id && st[sp.id] ? st[sp.id].level : null;
      bubble.className = 'w3-bubble' + (sp.kind === 'me' ? ' me' : '');
      bubble.style.setProperty('--who', sp.color || '#d5b76e');
      bubble.innerHTML = `<b class="who">${esc(sp.name)}${lv ? ` <em>Lv ${lv}</em>` : ''}</b><p></p>${choices ? `<div class="choices">${choices.map((c, i) => `<button type="button" data-choice="${i}">${esc(c.label)}</button>`).join('')}</div>` : '<span class="more" aria-hidden="true">▸</span>'}`;
      bubble.hidden = false; talk.anchor = sp;
      const p = bubble.querySelector('p'); let shown = 0, done = false, timer = 0;
      const finish = v => { clearInterval(typer); clearTimeout(timer); talk.advance = talk.abort = null; resolve(v); };
      const complete = () => { done = true; clearInterval(typer); p.textContent = text; bubble.classList.add('done'); if (choices) bubble.querySelector('[data-choice]')?.focus({ preventScroll: true }); else timer = setTimeout(finish, 2200 + text.length * 40); };
      const typer = setInterval(() => { shown += 2; p.textContent = text.slice(0, shown); if (shown >= text.length) complete(); }, 26);
      if (reduceMotion.matches) complete();
      talk.advance = () => { if (!done) complete(); else if (!choices) finish(); };
      talk.abort = () => { clearInterval(typer); clearTimeout(timer); talk.advance = talk.abort = null; reject(new Error('abort')); };
      if (choices) bubble.querySelectorAll('[data-choice]').forEach(b => b.onclick = e => { e.stopPropagation(); finish(choices[+b.dataset.choice].value); });
    });
  }
  function flyScroll(from, to) {
    return new Promise(resolve => {
      if (reduceMotion.matches) return resolve();
      scrollProp.visible = true; talk.flight = { t: 0, from: from.clone(), to: to.clone(), resolve };
    });
  }
  function showScroll(q, giver, voice) {
    return new Promise(resolve => {
      const r = WORLD.find(r => r.id === q.region), done = E.completed(state, q), st = partyStats()[giver.id], coins = Math.floor(q.xp / 10);
      const type = q.boss ? 'Boss battle' : q.mission ? 'Party HQ mission' : q.repeat ? 'Daily quest' : 'Milestone';
      const proof = (q.detail.match(/((?:Record|Write down|Explain|Note)[^.]*\.)/) || [, 'A short note on what you finished, with a link or evidence if you have one.'])[1];
      const el = document.createElement('div'); el.className = 'quest-scroll'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'qsTitle');
      el.innerHTML = `<div class="qs-sheet" style="--seal:${giver.color}"><div class="qs-rod"></div><div class="qs-paper"><div class="qs-inner">
        <div class="qs-seal" aria-hidden="true">${esc(giver.name[0].toUpperCase())}</div>
        <p class="qs-eyebrow">Quest scroll · from ${esc(giver.name)} · ${esc(r.name)}</p>
        <h2 id="qsTitle">${esc(q.title)}</h2>
        <div class="qs-tags"><span>${type}</span><span>${esc(q.stat)}</span>${q.repeat ? '<span>Refreshes daily</span>' : ''}${q.sample ? '<span>Sample</span>' : ''}</div>
        <p class="qs-detail">${esc(q.detail)}</p>
        ${q.checks ? `<h3>To complete</h3><ul>${q.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        <h3>Bring back as proof</h3><p>${esc(proof)}</p>
        <div class="qs-rewards"><div><b>+${q.xp}</b><small>${esc(q.stat)} XP</small></div><div><b>+${E.questGold(q).toLocaleString('en-IN')}</b><small>Gold</small></div><div><b>+${coins}</b><small>Coins</small></div>${st ? `<div><b>Lv ${st.level}</b><small>${esc(shortName(giver))} levels with you</small></div>` : ''}</div>
        <p class="qs-note">“${esc(voice.note)}”<span>— ${esc(giver.name)}</span></p>
        ${done ? '<div class="qs-stamp">Completed today</div>' : ''}
        <div class="qs-actions">${done ? '<button type="button" class="primary" data-act="close">Close the scroll</button>' : '<button type="button" class="primary" data-act="accept">Accept quest ✦</button><button type="button" class="secondary" data-act="claim">I’ve done it · claim XP</button>'}<button type="button" class="secondary" data-act="another">Another quest</button><button type="button" class="qs-link" data-act="list">All of ${esc(shortName(giver))}’s quests</button></div>
      </div></div><div class="qs-rod"></div></div><button type="button" class="qs-close" aria-label="Close the scroll">×</button>`;
      (document.fullscreenElement || document.webkitFullscreenElement || document.querySelector('.world-frame.immersive') || document.body).append(el);
      setTimeout(() => el.classList.add('open'), 30);
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('close'); } };
      const close = v => { if (!el.isConnected || el.classList.contains('closing')) return; el.classList.remove('open'); el.classList.add('closing'); document.removeEventListener('keydown', onKey, true); talk.closeScroll = null; setTimeout(() => el.remove(), reduceMotion.matches ? 0 : 360); resolve(v); };
      el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => close(b.dataset.act));
      el.querySelector('.qs-close').onclick = () => close('close');
      el.addEventListener('click', e => { if (e.target === el) close('close'); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => el.querySelector('[data-act]')?.focus({ preventScroll: true }), reduceMotion.matches ? 40 : 750);
      talk.closeScroll = close;
    });
  }
  function endTalk() {
    if (!talk.on) return;
    talk.on = false; talk.abort?.(); talk.abort = talk.advance = null; talk.closeScroll?.('close');
    bubble.hidden = true; bars.classList.remove('on'); frameEl.classList.remove('talking'); scrollProp.visible = false; talk.flight = null; talk.settle = 1.2;
  }
  async function converse(t) {
    if (talk.on || !active) return;
    const giver = t.b || t.c, council = !!t.c;
    if (!partyUnlocked(giver)) { visit(giver.region); return; }
    const spot = council ? [giver.x, giver.y + 36] : [giver.x - 18, giver.y + 10];
    if (Math.hypot(state.position.x - spot[0], state.position.y - spot[1]) > 26) await new Promise(res => goTo(spot[0], spot[1], res));
    if (talk.on || $('#modal').open) return;
    talk.on = true; talk.target = t; travel = null; keys.clear();
    bars.classList.add('on'); frameEl.classList.add('talking'); $('#mapTooltip').hidden = true;
    const voice = VOICES[giver.id] || VOICES.council, me = { kind: 'me', name: 'Nivetha', color: '#d5b76e' };
    const host = council ? { kind: 'council', o: t, seat: Math.PI, name: giver.name, color: giver.color, id: giver.id } : { kind: 'bot', o: t, name: giver.name, color: giver.color, id: giver.id };
    const fill = line => line.replace('{greet}', greeting()).replace('{name}', giver.name);
    try {
      if (t.ch) t.ch.wave = 1.8;
      await say(host, fill(pickLine(voice.hi)));
      if (giver.id === 'gilfoyle' && kobra()) { const lc = await say(host, 'Anything to report?', [{ label: '⚔ I’m doing LeetCode', value: true }, { label: 'Career talk', value: false }]); if (lc) { await say(me, 'LeetCode time.'); await say(host, pickLine(GILFOYLE_LC)); endTalk(); sail(kobra(), { leetcode: true }); return; } }
      const live = liveLine(giver);
      if (live.live) await say(host, (live.sample ? 'From my sample check-in: ' : 'From today’s Party HQ check-in: ') + clip(live.text, 200));
      if (council) {
        const members = giver.members.map(partyMember).filter(Boolean);
        for (const [i, m] of members.slice(0, 3).entries()) await say({ kind: 'council', o: t, seat: (i / members.length) * Math.PI * 2 + .35, name: m.name, color: m.color, id: m.id }, clip(liveLine(m).text, 160));
      }
      const today = state.entries.filter(e => e.date === E.day()).length;
      const hey = council ? 'Hi everyone!' : `Hey ${shortName(giver)}!`;
      await say(me, today ? `${hey} ${today} done today already. What’s next?` : pickLine([`${hey} What have you got for me?`, council ? 'Hi everyone. Where should I start?' : `Hi ${shortName(giver)}. Where should I start?`]));
      let q = nextQuestFor(giver), first = true;
      for (;;) {
        if (!q) {
          if (giver.id === 'eggbot') { const go = await say(host, voice.done, [{ label: 'Hatch a quest ✦', value: true }, { label: 'Not now', value: false }]); if (go) { endTalk(); $('#newQuest').click(); return; } }
          else await say(host, voice.done);
          break;
        }
        await say(host, first ? pickLine(voice.give) : pickLine(['How about this one instead.', 'Then take this one.', 'Here’s another.']));
        first = false;
        if (t.ch) { t.ch.give = 1.5; await new Promise(r => setTimeout(r, reduceMotion.matches ? 0 : 450)); }
        const from = t.ch ? handPos(t.ch) : t.pos.clone().setY(t.pos.y + 2.1);
        await flyScroll(from, handPos(player)); player.give = 1.2;
        const act = await showScroll(q, giver, voice);
        if (act === 'accept') { await say(me, pickLine(['On it.', 'Accepted. I’ll bring proof.', 'Deal. Back soon.'])); toast('Quest accepted: ' + q.title); await say(host, pickLine(voice.ok)); if (isLeetCode(q) && kobra() && realm !== kobra()) { await say(host, 'Kobra Kai. Sensei Fletcher is waiting.'); endTalk(); sail(kobra(), { leetcode: true }); return; } break; }
        if (act === 'claim') { endTalk(); questDialog(q.id); return; }
        if (act === 'list') { endTalk(); (council ? cardCouncil : cardTalk)(giver); return; }
        if (act === 'another') {
          const next = nextQuestFor(giver, q);
          await say(me, pickLine(['Anything else?', 'Got something different?']));
          if (!next || next.id === q.id) { await say(host, 'That’s the only one I have open right now. It’s a good one.'); break; }
          q = next; continue;
        }
        break;
      }
    } catch (err) { if (err.message !== 'abort') console.error(err); }
    endTalk();
  }
  // Guides talk in the world; the original dialog cards remain for the 2D map and the "all quests" list.
  const cardTalk = botTalk, cardCouncil = councilTalk, cardRegion = regionDialog;
  const hostFor = r => bots.find(o => o.b.home === r.id && (o.b.regions || []).includes(r.id) && partyUnlocked(o.b)) || councils.find(o => o.c.home === r.id && partyUnlocked(o.c));
  botTalk = b => { if (!active) return cardTalk(b); if (b.council) return councilTalk(b); const o = bots.find(o => o.b.id === b.id); if (!o) return cardTalk(b); if (screen !== 'world') showScreen('world'); converse(o); };
  councilTalk = c => { if (!active) return cardCouncil(c); const o = councils.find(o => o.c.id === c.id); if (!o) return cardCouncil(c); if (screen !== 'world') showScreen('world'); converse(o); };
  regionDialog = r => { if (!active) return cardRegion(r); const host = hostFor(r); if (host) converse(host); else cardRegion(r); };
  window.addEventListener('keydown', e => {
    if (!talk.on || $('#modal').open || document.querySelector('.quest-scroll')) return;
    if (e.key === 'Escape') { e.preventDefault(); endTalk(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) { endTalk(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest?.('button')) { e.preventDefault(); e.stopPropagation(); talk.advance?.(); }
  }, true);

  // Pointer input: drag to orbit, pinch/scroll to zoom, click/tap to travel or interact.
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), pointers = new Map();
  let dragged = false, downAt = null, pinchStart = 0, hoverEvent = null;
  const toNdc = e => { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
  function pick(e) {
    toNdc(e); raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(proxies.filter(p => p.visible !== false && !(realm && p.userData.kind === 'area')).concat(realm ? [] : bots.filter(o => o.proxy.visible).map(o => o.proxy)), false).sort((a, b) => (a.object.userData.kind === 'bot' ? -1 : 0) - (b.object.userData.kind === 'bot' ? -1 : 0) || a.distance - b.distance)[0];
    return hit ? hit.object.userData : null;
  }
  function groundPoint(e) {
    toNdc(e); raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    let prev = 0;
    for (let t = .5; t < 500; t += .25 + t * .012) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= Math.max(groundAt(x, z), 0)) { let lo = prev, hi = t; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= Math.max(groundAt(o.x + d.x * m, o.z + d.z * m), 0)) hi = m; else lo = m; } return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi); }
      prev = t;
    }
    return null;
  }
  frameEl.addEventListener('click', e => {
    if (!active || e.target !== canvas) return;
    e.stopPropagation(); canvas.focus();
    if (dragged) { dragged = false; return; }
    if (voyage) { voyage.t = 1; return; }
    if (talk.on) { talk.advance?.(); return; }
    const hit = pick(e);
    if (hit?.kind === 'ferry') { ferryDialog(); return; }
    if (hit?.kind === 'cat') { doEmote('pet', 'mochi'); return; }
    if (hit?.kind === 'veer') { doEmote('pet', 'veer'); return; }
    if (hit?.kind === 'spot') { doSpot(hit.spot); return; }
    if (hit?.kind === 'npc') { npcTalk(hit.npc); return; }
    if (hit?.kind === 'bot') { botTalk(hit.bot); return; }
    if (hit?.kind === 'council') { councilTalk(hit.council); return; }
    if (hit?.kind === 'area') { visit(hit.area.id); return; }
    const g = groundPoint(e); if (!g) return;
    const [lx, ly] = posL(g.x, g.z), target = nearestWalkable({ x: clamp(lx, 40, 1060), y: clamp(ly, 40, 690) });
    goTo(target.x, target.y);
  }, true);
  frameEl.addEventListener('mousemove', e => { if (!active || e.target !== canvas) return; e.stopPropagation(); hoverEvent = e; }, true);
  canvas.addEventListener('pointerdown', e => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); downAt = { x: e.clientX, y: e.clientY }; dragged = false; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = Math.hypot(a.x - b.x, a.y - b.y); } });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId); if (!p) return;
    if (pointers.size === 2) { p.x = e.clientX; p.y = e.clientY; const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinchStart) cam.dist = clamp(cam.dist * pinchStart / d, 7, 48); pinchStart = d; dragged = true; return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (!dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) { dragged = true; canvas.setPointerCapture(e.pointerId); }
    if (dragged) { cam.yaw -= dx * .006; cam.pitch = clamp(cam.pitch + dy * .004, .08, 1.15); cam.intro = 0; }
  });
  const release = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = 0; };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', e => { if (!active) return; e.preventDefault(); cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * .0011), 7, 48); cam.intro = 0; }, { passive: false });
  canvas.addEventListener('keydown', e => {
    if (!active || $('#modal').open) return;
    const k = e.key.toLowerCase();
    if (k === '+' || k === '=') cam.dist = clamp(cam.dist * .88, 7, 48);
    if (k === '-' || k === '_') cam.dist = clamp(cam.dist * 1.12, 7, 48);
    if (k === 'q' || k === 'r') { cam.yaw += k === 'q' ? .3 : -.3; cam.intro = 0; }
  });
  function hover() {
    if (!hoverEvent) return;
    const e = hoverEvent, tip = $('#mapTooltip'); hoverEvent = null;
    if (pointers.size || talk.on) { tip.hidden = true; return; }
    const hit = pick(e), box = canvas.getBoundingClientRect();
    if (hit) {
      const level = E.level(E.total(state)), text = hit.kind === 'veer' ? 'Veer · Kombai · Give him a cuddle' : hit.kind === 'npc' ? hit.npc.name + ' · Talk' : hit.kind === 'ferry' ? 'The Sky Ferry · Sail to other worlds' : hit.kind === 'cat' ? 'Mochi · Give her a pat' : hit.kind === 'spot' ? '✦ ' + hit.spot.label : hit.kind === 'bot' ? hit.bot.name + ' · ' + hit.bot.role : hit.kind === 'council' ? hit.council.name + ' · ' + hit.council.role : hit.area.name + (level < hit.area.unlock ? ' · Unlock at level ' + hit.area.unlock : ' · Visit');
      canvas.style.cursor = 'pointer'; tip.hidden = false; tip.textContent = text;
      tip.style.left = Math.min(e.clientX - box.left + 12, box.width - 200) + 'px'; tip.style.top = Math.max(45, e.clientY - box.top - 40) + 'px';
    } else { canvas.style.cursor = 'grab'; tip.hidden = true; }
  }

  // One authority owns movement and arrival callbacks. Rendering never rewrites the simulation.
  let prev = null, prevState = null, stuck = 0;
  const motor = new CharacterMotor({ clear: (x, z) => { const [lx, ly] = posL(x, z); return walkable(lx, ly); }, ground: (x, z) => groundAt(x, z) });
  function safePosition(p, radius = MOTOR.radius) {
    const clear = (lx, ly) => { const [x, z] = posW(lx, ly); return footprintClear(x, z, motor.clear, radius); };
    if (clear(p.x, p.y)) return { ...p };
    for (let r = 4; r < 260; r += 4) for (let a = 0; a < 32; a++) {
      const x = p.x + Math.cos(a * Math.PI / 16) * r, y = p.y + Math.sin(a * Math.PI / 16) * r;
      if (clear(x, y)) return { x, y };
    }
    return nearestWalkable(p);
  }
  movementDriver = dt => {
    const p = state.position;
    if (state !== prevState || !prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1) {
      prevState = state; Object.assign(p, safePosition(p)); motor.reset(...posW(p.x, p.y)); prev = { ...p };
    }
    if (screen !== 'world' || $('#modal').open || talk.on || voyage || window.BotChat?.isOpen()) {
      motor.vx = motor.vz = motor.accumulator = 0; return;
    }
    let x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let z = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    const len = Math.hypot(x, z); if (len) { x /= len; z /= len; const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw); [x, z] = [x * c + z * s, -x * s + z * c]; }
    let distance, speed;
    const journey = travel;
    if (journey) {
      const [tx, tz] = posW(journey.x, journey.y); x = tx - motor.x; z = tz - motor.z; distance = Math.hypot(x, z);
      if (distance) { x /= distance; z /= distance; }
      speed = Math.min(MOTOR.walk, Math.sqrt(2 * MOTOR.braking * distance));
    }
    motor.update(dt, { x, z, speed, distance, run: keys.has('shift'), jump: keys.has(' ') && !journey });
    [p.x, p.y] = posL(motor.x, motor.z);
    if (journey && travel === journey) {
      const d = Math.hypot(p.x - journey.x, p.y - journey.y) * SCALE;
      if (d < .08 && motor.grounded) {
        const [tx, tz] = posW(journey.x, journey.y);
        if (motor.fits(tx, tz)) { motor.x = tx; motor.z = tz; p.x = journey.x; p.y = journey.y; }
        travel = null; stuck = 0; save(); journey.callback?.();
      } else { stuck = motor.speed < .15 ? stuck + dt : 0; if (stuck > 1) { stuck = 0; rescueTravel?.(); } }
    }
    prev = { ...p };
  };
  canvas.addEventListener('keydown', e => {
    if ($('#modal').open || talk.on || voyage || window.BotChat?.isOpen()) return;
    if (e.key === ' ' || e.key === 'Shift') { e.preventDefault(); keys.add(e.key.toLowerCase()); }
  });
  const jumpButton = document.createElement('button'); jumpButton.type = 'button'; jumpButton.className = 'w3-jump'; jumpButton.textContent = 'Jump'; jumpButton.setAttribute('aria-label', 'Jump (Space)');
  jumpButton.addEventListener('pointerdown', e => { e.preventDefault(); jumpButton.setPointerCapture(e.pointerId); keys.add(' '); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) jumpButton.addEventListener(type, () => keys.delete(' '));
  frameEl.querySelector('.touch-controls').append(jumpButton);

  // ───────── Solid ground: a collision mask traced from the real buildings, and paths around them ─────────
  // Every landmark triangle that reaches between knee and head height is rasterised onto a 25 cm grid, so walls,
  // fences, fountains and statues all block her, while arches, roofs and low rugs do not.
  function collisionMask(roots, x0, z0, w, d, groundFn, skip) {
    const cell = .25, nx = Math.ceil(w / cell), nz = Math.ceil(d / cell), m = new Uint8Array(nx * nz), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const mark = (x, z) => { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); if (i >= 0 && j >= 0 && i < nx && j < nz) m[j * nx + i] = 1; };
    const line = (p, q) => { const n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (cell * .5)) + 1; for (let k = 0; k <= n; k++) mark(p.x + (q.x - p.x) * k / n, p.z + (q.z - p.z) * k / n); };
    for (const root of roots) {
      root.updateMatrixWorld(true);
      const walk = (o, f) => { if (o.userData.noCollide) return; f(o); for (const c of o.children) walk(c, f); };
      walk(root, o => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.attributes.position) return;
        const pos = o.geometry.attributes.position, idx = o.geometry.index, tris = (idx ? idx.count : pos.count) / 3;
        for (let t = 0; t < tris; t++) {
          a.fromBufferAttribute(pos, idx ? idx.getX(t * 3) : t * 3).applyMatrix4(o.matrixWorld);
          b.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(o.matrixWorld);
          c.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(o.matrixWorld);
          const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3; if (skip?.(cx, cz)) continue;
          const g = groundFn(cx, cz), lo = Math.min(a.y, b.y, c.y), hi = Math.max(a.y, b.y, c.y);
          if (hi < g + .3 || lo > g + 1.8) continue;
          line(a, b); line(b, c); line(c, a);
          const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
          if (area > cell * cell) { const n = Math.ceil(Math.sqrt(area) / cell * 1.6); for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, v = j / n; mark(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v); } }
        }
      });
    }
    const out = m.slice();
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) if (m[j * nx + i]) { out[j * nx + i - 1] = out[j * nx + i + 1] = out[(j - 1) * nx + i] = out[(j + 1) * nx + i] = 1; }
    const circle = (x, z, r) => { for (let zz = z - r; zz <= z + r; zz += cell * .5) for (let xx = x - r; xx <= x + r; xx += cell * .5) if ((xx - x) ** 2 + (zz - z) ** 2 <= r * r) { const i = Math.floor((xx - x0) / cell), j = Math.floor((zz - z0) / cell); if (i >= 0 && j >= 0 && i < nx && j < nz) out[j * nx + i] = 1; } };
    const clear = (x, z, r) => { for (let zz = z - r; zz <= z + r; zz += cell * .5) for (let xx = x - r; xx <= x + r; xx += cell * .5) if ((xx - x) ** 2 + (zz - z) ** 2 <= r * r) { const i = Math.floor((xx - x0) / cell), j = Math.floor((zz - z0) / cell); if (i >= 0 && j >= 0 && i < nx && j < nz) out[j * nx + i] = 0; } };
    return { circle, clear, test(x, z) { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); return i >= 0 && j >= 0 && i < nx && j < nz && out[j * nx + i] === 1; } };
  }
  mainMask = collisionMask(Object.values(sites).map(s => s.group), X0, Z0, FW, FD, heightAt);
  for (const o of [...staticObstacles, ...treeObstacles]) { const [x, z] = toW(o.x, o.y); mainMask.circle(x, z, o.r * SCALE); }
  for (const r of realms) {
    const { R, F } = r, x0 = R.at[0] - R.rx - 4, z0 = R.at[1] - R.rz - 4;
    r.mask = collisionMask([r.group], x0, z0, R.rx * 2 + 8, R.rz * 2 + 8, (x, z) => F.ground(x - R.at[0], z - R.at[1]), (x, z) => R.deck?.(x - R.at[0], z - R.at[1]) != null || F.sdf(x - R.at[0], z - R.at[1]) < 0);
    const ponds = r.obstacles.filter(o => o[3]);
    for (const o of r.obstacles) if (!o[3]) r.mask.circle(R.at[0] + o[0], R.at[1] + o[1], o[2]);
    for (const s of r.spots) r.mask.clear(s.pos.x, s.pos.z, .55);
    r.walkable = (lx, ly) => {
      const u = (lx - 550) * SCALE, v = (ly - 360) * SCALE;
      if (F.sdf(u, v) < 1.1 || r.mask.test(R.at[0] + u, R.at[1] + v)) return false;
      return ponds.every(o => (u - o[0]) ** 2 + (v - o[1]) ** 2 > o[2] * o[2] || R.deck?.(u, v) != null);
    };
  }
  // Click-to-travel follows an A* path on an 8-unit grid, smoothed into straight runs, instead of
  // walking into walls and giving up.
  function lineClear(a, b) { const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5); for (let k = 1; k <= n; k++) if (!motor.fits(...posW(a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n))) return false; return true; }
  function findPath(from, to) {
    const goal = safePosition(to);
    if (lineClear(from, goal)) return [goal];
    const ST = 8, W = Math.ceil(1100 / ST) + 1, H = Math.ceil(720 / ST) + 1, free = new Int8Array(W * H), g = new Float32Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
    const ok = k => { if (!free[k]) free[k] = motor.fits(...posW((k % W) * ST, Math.floor(k / W) * ST)) ? 1 : -1; return free[k] === 1; };
    const near = (x, y) => { const i0 = Math.round(x / ST), j0 = Math.round(y / ST); for (let r = 0; r < 4; r++) for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) { if (i < 0 || j < 0 || i >= W || j >= H) continue; const k = j * W + i; if (ok(k)) return k; } return -1; };
    const s = near(from.x, from.y), e = near(goal.x, goal.y); if (s < 0 || e < 0) return null;
    const ex = e % W, ey = Math.floor(e / W), hf = k => { const dx = Math.abs(k % W - ex), dy = Math.abs(Math.floor(k / W) - ey); return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * ST; };
    const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
    g[s] = 0; push(s, hf(s));
    for (let n = 0; heap.length && n < 25000; n++) {
      const k = pop(); if (closed[k]) continue; closed[k] = 1; if (k === e) break;
      const i = k % W, j = Math.floor(k / W);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni; if (closed[nk] || !ok(nk)) continue;
        if (di && dj && (!ok(j * W + ni) || !ok(nj * W + i))) continue;
        const ng = g[k] + (di && dj ? Math.SQRT2 : 1) * ST; if (ng < g[nk]) { g[nk] = ng; came[nk] = k; push(nk, ng + hf(nk)); }
      }
    }
    if (came[e] < 0 && e !== s) return null;
    const pts = [goal]; for (let k = came[e]; k >= 0 && k !== s; k = came[k]) pts.unshift({ x: (k % W) * ST, y: Math.floor(k / W) * ST }); pts.unshift({ x: from.x, y: from.y });
    const out = []; for (let i = 0; i < pts.length - 1;) { let j = Math.min(pts.length - 1, i + 30); while (j > i + 1 && !lineClear(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
    return out;
  }
  const goToDirect = goTo; let stuckCount = 0;
  goTo = (x, y, cb) => {
    if (!active) return goToDirect(x, y, cb);
    if (reduceMotion.matches) { const p = safePosition({ x, y }); return goToDirect(p.x, p.y, cb); }
    const path = findPath({ x: state.position.x, y: state.position.y }, { x, y });
    if (!path) { toast('That spot is out of reach. Choose a clear spot nearby.'); return; }
    let i = -1; const next = () => { i++; if (i >= path.length - 1) { stuckCount = 0; goToDirect(path[path.length - 1].x, path[path.length - 1].y, cb); } else goToDirect(path[i].x, path[i].y, next); };
    next();
  };
  rescueTravel = () => { const t = travel; travel = null; if (++stuckCount < 3) goTo(t.x, t.y, t.callback); else { stuckCount = 0; toast('That spot is out of reach. Try somewhere nearby.'); } };
  // Leaving a conversation: a visible button, or simply walking away.
  const leaveBtn = document.createElement('button'); leaveBtn.type = 'button'; leaveBtn.className = 'w3-leave'; leaveBtn.innerHTML = '✕ <span>Leave</span>'; leaveBtn.setAttribute('aria-label', 'Leave the conversation');
  leaveBtn.onclick = e => { e.stopPropagation(); endTalk(); }; frameEl.append(leaveBtn);
  frameEl.querySelector('.touch-controls')?.addEventListener('pointerdown', () => { if (talk.on) endTalk(); }, true);

  // ───────── Nivetha's day: actions, activities, Mochi the cat, the sky ferry and voyages ─────────
  const PR = makeProps(), tv = new THREE.Vector3();
  for (const k of ['hammer', 'quill', 'brush', 'wrench', 'phone']) { player.arms[1].add(PR[k]); PR[k].position.set(0, -.47, .06); }
  player.body.add(PR.book, PR.ledger); PR.book.position.set(0, 1.12, .34); PR.book.rotation.x = -.95; PR.ledger.position.set(-.1, 1.02, .3); PR.ledger.rotation.set(-1, 0, .35);
  scene.add(PR.anvil);
  const laidStaff = player.staff.clone(true); laidStaff.visible = false; scene.add(laidStaff);
  const cat = makeCat(); scene.add(cat.root); proxies.push(cat.proxy);
  // Veer, Nivetha's Kombai: tan-red coat, black muzzle, folded ears, curled tail. He goes everywhere she goes.
  const veer = makeDog('#b8662f', '#cf9256', null, { muzzle: '#2b211c', ears: 'rose', ear: '#8f4a20', collar: '#b4492f', scale: 1.5 });
  veer.yaw = 0; scene.add(veer.root); veer.tail.forEach(s => { s.rotation.x = -1.05; });
  const veerProxy = new THREE.Mesh(new THREE.SphereGeometry(.55, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); veerProxy.position.y = .35; veerProxy.userData = { kind: 'veer' }; veer.root.add(veerProxy); proxies.push(veerProxy);
  let petTarget = 'veer';
  const LAP = new Set(['sit', 'campfire', 'phone']);
  const ferry = makeFerry(); scene.add(ferry.g); proxies.push(ferry.proxy);
  const homePark = { pos: new THREE.Vector3(pierInfo.sx - 2.4, 0, pierInfo.sz + 4.4), yaw: Math.PI };
  const homeBoard = nearestWalkable((([x, y]) => ({ x, y }))(toL(pierInfo.sx, pierInfo.sz - 2.2)));
  const aura = particles(46, 1, { size: .12, speed: .32, rise: 2.4, spread: 1.1, color: '#ffe08a', boost: 2.6, opacity: 0 });
  const sparks = particles(36, 1, { size: .07, speed: 1.8, rise: .9, spread: .8, color: '#ffb347', boost: 3.5, opacity: 0 });
  const burst = particles(60, 1, { size: .16, speed: .9, rise: 3.6, spread: 2.2, color: '#ffe8a0', boost: 3, opacity: 0 });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 44, 32, 1, true), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uA: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float a=uA*smoothstep(1.,.05,vUv.y)*(.6+.4*sin(vUv.x*60.)); gl_FragColor=vec4(vec3(1.,.86,.5)*a,a); }' }));
  pillar.visible = false; pillar.renderOrder = 6; scene.add(aura, sparks, burst, pillar);
  // Activity spots: one at every landmark (once it is unlocked) plus each realm's own.
  const MAIN_SPOTS = [['camp', 'campfire', 'Sit by the campfire', -30, 26], ['forge', 'hammer', 'Work the anvil', 32, 34], ['citadel', 'write', 'Write in the ledger', 36, 38], ['grove', 'train', 'Train in the grove', -38, 34], ['tower', 'read', 'Read a chapter', 30, 38], ['temple', 'meditate', 'Meditate at the temple', -34, 36], ['lab', 'tinker', 'Tinker in the lab', 34, 34], ['summit', 'gaze', 'Gaze from the summit', -28, 30]];
  const spots = [
    ...MAIN_SPOTS.map(([id, a, text, dx, dy]) => { const r = WORLD.find(w => w.id === id); return { realmId: null, area: r, act: a, label: text, want: { x: r.x + dx, y: r.y + dy }, L: null, pos: new THREE.Vector3(), face: 0 }; }),
    ...realms.flatMap(r => r.spots),
  ];
  const spotMarker = new THREE.OctahedronGeometry(.13), spotMat = glow('#ffd979', 2.2);
  for (const s of spots) {
    s.el = label('w3-bot w3-spot'); s.el.innerHTML = `<i>✦</i>${esc(s.label)}`;
    s.mark = new THREE.Mesh(spotMarker, spotMat); scene.add(s.mark);
    s.proxy = new THREE.Mesh(new THREE.SphereGeometry(.9, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); s.proxy.userData = { kind: 'spot', spot: s }; scene.add(s.proxy); proxies.push(s.proxy);
  }
  function placeMainSpots() {
    for (const s of spots) if (!s.realmId) {
      const L = nearestWalkable(s.want), [x, z] = toW(L.x, L.y), [cx, cz] = toW(...SITES[s.area.id].at);
      s.L = L; s.pos.set(x, heightAt(x, z), z); s.face = Math.atan2(cx - x, cz - z);
    }
  }
  const spotOpen = s => s.realmId ? realm?.R.id === s.realmId : !realm && s.L && E.level(E.total(state)) >= s.area.unlock;
  function nearestSpot(max) { let best = null, bd = max; for (const s of spots) { if (!spotOpen(s)) continue; const d = Math.hypot(s.pos.x - player.root.position.x, s.pos.z - player.root.position.z); if (d < bd) { bd = d; best = s; } } return best; }
  // What she can do. Poses are bone targets blended over the walk/idle animation.
  const SIT = { by: -.66, bx: -.12, l0x: -1.45, l1x: -1.45, l0z: -.08, l1z: .08, a0x: .55, a1x: .55, a0z: -.35, a1z: .35, cx: .35 };
  const hop = (t, f) => Math.abs(Math.sin(t * f)) * .3;
  const ACTS = {
    wave: { dur: 1.9, expr: 'happy', say: 'Waving hello', start: () => { player.wave = 1.8; } },
    cheer: { dur: 2.4, expr: 'happy', emote: '✦', say: 'Celebrating!', pose: t => ({ by: hop(t, 5.5), a0z: -2.7, a1z: 2.7, a0x: -.25, a1x: -.25, hx: -.25 }) },
    dance: { loop: true, expr: 'happy', emote: '♪', say: 'Dancing', pose: t => { const b = Math.sin(t * 5); return { bry: Math.sin(t * 1.8) * .7 + ((t % 6) < 1 ? (t % 6) * Math.PI * 2 : 0), by: Math.abs(b) * .08, a0z: -1.3 - .8 * b, a1z: 1.3 - .8 * b, a0x: -.3, a1x: -.3, hz: Math.sin(t * 2.5) * .18, l0x: b * .35, l1x: -b * .35 }; } },
    sit: { loop: true, say: 'Resting for a while', pose: () => SIT },
    stretch: { dur: 2.8, expr: 'closed', say: 'Stretching', pose: t => ({ a0z: -2.85, a1z: 2.85, a0x: -.15, a1x: -.15, bx: -.12, hx: -.3, by: .04 * Math.sin(t * 2) }) },
    look: { dur: 3.4, say: 'Looking around', pose: t => ({ hy: Math.sin(t * 1.85) * .75, hx: -.06 }) },
    staff: { dur: 2.6, say: 'Admiring her staff', glow: 4, pose: t => ({ a0x: -2.3 + Math.sin(t * 3) * .15, a0z: -.25, hx: -.35, hy: -.25 }) },
    hum: { dur: 4.5, expr: 'happy', emote: '♪', say: 'Humming a tune', pose: t => ({ hz: Math.sin(t * 3) * .14, bz: Math.sin(t * 3) * .04 }) },
    yawn: { dur: 3, expr: 'wide', emote: '~', say: 'Getting sleepy', pose: () => ({ a0z: -2.4, a1z: 2.4, a0x: -.6, a1x: -.6, hx: -.4 }) },
    twirl: { dur: 1.5, expr: 'happy', emote: '✿', say: 'Showing off her new cloak', pose: t => ({ bry: smooth(0, 1.3, t) * Math.PI * 2, a0z: -1, a1z: 1, cx: .9 }) },
    pet: { dur: 4, expr: 'happy', emote: '♥', say: 'Petting Mochi', pose: t => ({ bx: .5, by: -.12, a1x: -1.25 + Math.sin(t * 5) * .15, a1z: .05, hx: .45 }) },
    campfire: { loop: true, expr: 'happy', say: 'Warming her hands by the fire', pose: t => ({ ...SIT, a0x: -.95, a1x: -.95, a0z: .12, a1z: -.12, hx: .05 + Math.sin(t * .6) * .03 }) },
    hammer: { loop: true, say: 'Working the anvil', prop: ['hammer'], anvil: true, pose: t => { const ph = (t * 1.3) % 1, up = ph < .7 ? smooth(0, .7, ph) : 1 - smooth(.7, .8, ph); return { a1x: -.55 - 1.9 * up, a1z: .12, hx: .35, bx: .1 }; } },
    write: { loop: true, say: 'Writing in her ledger', prop: ['quill', 'ledger'], pose: t => ({ a0x: -1.05, a0z: .5, a1x: -1.1 + Math.sin(t * 9) * .05, a1z: -.28 + Math.sin(t * 3.5) * .07, hx: .42 }) },
    train: { loop: true, emote: '!', say: 'Training: jumping jacks', pose: t => { const k = (1 - Math.cos(t * 2.6 * Math.PI)) / 2; return { by: k * .2, a0z: -.15 - 2.5 * k, a1z: .15 + 2.5 * k, l0z: -.28 * k, l1z: .28 * k }; } },
    read: { loop: true, say: 'Reading a chapter', prop: ['book'], pose: t => ({ a0x: -1.05, a1x: -1.05, a0z: .4, a1z: -.4, hx: .4 + Math.sin(t * .5) * .03, hy: Math.sin(t * .9) * .08 }) },
    meditate: { loop: true, expr: 'closed', say: 'Meditating', aura: .8, glow: 2, pose: t => ({ by: -.62 + Math.sin(t * 1.1) * .04, l0x: -1.35, l1x: -1.35, l0z: -.8, l1z: .8, a0x: -.5, a1x: -.5, a0z: -.42, a1z: .42, hx: .1, cx: .3 }) },
    tinker: { loop: true, say: 'Tinkering with a gadget', prop: ['wrench'], pose: t => ({ a0x: -1, a0z: .3, a1x: -1.15 + Math.sin(t * 6) * .12, a1z: -.25, a1y: Math.sin(t * 6) * .4, hx: .42, bx: .12 }) },
    gaze: { loop: true, say: 'Gazing at the horizon', pose: t => ({ a1x: -2.15, a1z: -.62, hx: -.12, hy: Math.sin(t * .45) * .5 }) },
    paint: { loop: true, say: 'Painting the view', prop: ['brush'], pose: t => ({ a1x: -1.4 + Math.sin(t * 2.1) * .18, a1z: -.12 + Math.cos(t * 1.7) * .22, hx: .05, hy: Math.sin(t * .35) * .15 }) },
    soak: { loop: true, expr: 'closed', emote: '♨', say: 'Soaking in the hot spring', pose: () => ({ by: -.98, l0x: -1.4, l1x: -1.4, l0z: -.2, l1z: .2, a0x: .3, a1x: .3, a0z: -1.15, a1z: 1.15, hx: -.3, cx: .5 }) },
    pray: { loop: true, expr: 'closed', say: 'Making a wish', aura: 1, pose: () => ({ a0x: -1.18, a1x: -1.18, a0z: .64, a1z: -.64, hx: .32, bx: .08 }) },
    leetcode: { loop: true, emote: '⌨', say: 'Grinding LeetCode at Kobra Kai', pose: t => ({ by: -.6, bx: .14, l0x: 1.45, l1x: 1.45, a0x: -1.15 + Math.sin(t * 14) * .06, a1x: -1.15 + Math.sin(t * 14 + 1.6) * .06, a0z: .28, a1z: -.28, hx: .36 + Math.sin(t * .7) * .04 }) },
    kata: { loop: true, emote: '!', say: 'Training kata with Sensei Fletcher', pose: t => { const k = (Math.sin(t * 6) + 1) / 2, kick = (t % 4) > 3.15 ? Math.sin(((t % 4) - 3.15) / .85 * Math.PI) : 0; return { by: -.1, l0z: -.3, l1z: .3, l1x: -1.4 * kick, a0x: -1.55 * k - .35 * (1 - k), a1x: -1.55 * (1 - k) - .35 * k, a0z: .12, a1z: -.12, hx: -.05 }; } },
    phone: { loop: true, expr: 'happy', emote: '♡', say: 'Scrolling her phone in Hush Hollow', prop: ['phone'], pose: t => ({ ...SIT, a1x: -1.6, a1z: -.45, a0x: -.95, a0z: .3, hx: .45 + Math.sin(t * .4) * .04 }) },
  };
  const STAFF_DOWN = new Set(['campfire', 'write', 'train', 'read', 'meditate', 'tinker', 'paint', 'soak', 'pray', 'sit', 'pet', 'dance', 'leetcode', 'kata', 'phone']);
  const kobra = () => realms.find(r => r.R.id === 'kobra');
  const isLeetCode = q => q.id === 'pattern' || /leetcode|\bLC\b|\bDSA\b/i.test(`${q.title} ${q.detail}`);
  const GILFOYLE_LC = ['Then you don’t do it here. Kobra Kai. Fletcher is waiting.', 'Good. Kobra Kai. Pattern, complexity, edge case. No excuses.', 'LeetCode? Not on my island. Kobra Kai. Go.'];
  const EMOTES = [['wave', '〜', 'Wave'], ['cheer', '✦', 'Cheer'], ['dance', '♪', 'Dance'], ['sit', '⌒', 'Sit'], ['stretch', '❋', 'Stretch'], ['pet', '♥', 'Pet Veer']];
  let lastRewards = null, spotLevel = -1, act = null, idle = 0, idleNext = 8, pendingCheer = 0, lastXP = null, lastCloak2 = null, nowT = 0, emoteUntil = 0, uiTimer = 0;
  function startAct(id, spot) {
    const A = ACTS[id]; if (!A || voyage || talk.on) return;
    act = { id, A, t: 0, end: -1, spot }; A.start?.(); idle = 0;
    if (A.emote) emote(A.emote, A.loop ? 3 : A.dur);
    if (id === 'pray') pulsePillar(.5);
    status();
  }
  const stopAct = () => { if (act && act.end < 0) act.end = 0; };
  function doSpot(s) {
    if (voyage || talk.on || !spotOpen(s)) return;
    if (act?.spot === s) { stopAct(); return; }
    if (Math.hypot(state.position.x - s.L.x, state.position.y - s.L.y) < 14) startAct(s.act, s);
    else { stopAct(); goTo(s.L.x, s.L.y, () => startAct(s.act, s)); }
  }
  function doEmote(id, who = 'veer') {
    if (voyage || talk.on) return;
    if (act?.id === id && act.A.loop) { stopAct(); return; }
    if (id === 'pet') { petTarget = who; ACTS.pet.say = who === 'veer' ? 'Cuddling Veer' : 'Petting Mochi'; }
    if (id === 'pet' && who === 'mochi') { cat.still = 2; const d = player.root.position.distanceTo(cat.root.position); if (d > 2.4) { tv.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(1.1).add(player.root.position); cat.root.position.set(tv.x, groundAt(tv.x, tv.z), tv.z); } }
    startAct(id);
  }
  const emoteEl = label('w3-emote');
  function emote(text, dur) { emoteEl.textContent = text; emoteEl.classList.remove('pop'); void emoteEl.offsetWidth; emoteEl.classList.add('pop'); emoteEl._size = null; emoteUntil = nowT + dur; }
  function pulsePillar(strength) { pillar.visible = true; pillar.userData = { t: 0, k: strength }; }
  function celebrate(levelUp) { startAct('cheer'); cat.hop = .7; veer.hop = .7; burst.material.uniforms.uOpacity.value = 1; if (levelUp) { pulsePillar(1); emote('✦ LEVEL UP ✦', 3); } }
  // Labels for the ferry, realms and home.
  const ferryLabel = label('w3-bot w3-spot'); ferryLabel.innerHTML = '<i>⛵</i>The Sky Ferry';
  const homeLabel = label('w3-area w3-realm'); homeLabel.innerHTML = '<b>⌂ The Inner Kingdom</b><small>HOME · SAIL BACK ANY TIME</small>';
  for (const r of realms) { r.el = label('w3-area w3-realm'); r.el.innerHTML = `<b>${r.R.glyph} ${esc(r.R.name)}</b><small>${esc(r.R.sub.toUpperCase())}</small>`; }
  const homeLabelPos = new THREE.Vector3(0, 16, 0);
  hooks.labels = place => {
    if (nowT < emoteUntil) { tv.copy(player.root.position); tv.y += 2.95; place(emoteEl, tv, 60, 6); } else fadeLabel(emoteEl, 0);
    for (const s of spots) {
      const open = spotOpen(s) && !(act?.spot === s);
      s.mark.visible = s.proxy.visible = open; if (open) { s.mark.position.set(s.pos.x, s.pos.y + 1.25 + Math.sin(nowT * 2 + s.pos.x) * .08, s.pos.z); s.mark.rotation.y = nowT * 1.5; s.proxy.position.copy(s.mark.position); }
      if (open) { tv.copy(s.pos); tv.y += 1.85; place(s.el, tv, 12, 2); } else fadeLabel(s.el, 0);
    }
    if (!voyage) { tv.copy(ferry.g.position); tv.y += 4.9; place(ferryLabel, tv, 26, 2); } else fadeLabel(ferryLabel, 0);
    for (const r of realms) if (r === realm) fadeLabel(r.el, 0); else place(r.el, r.labelPos, 700, 1);
    if (realm) place(homeLabel, homeLabelPos, 700, 1); else fadeLabel(homeLabel, 0);
    for (const n of npcs) if (n.realm === realm) { tv.copy(n.ch.root.position); tv.y += 2.55; place(n.el, tv, 34, 4); } else fadeLabel(n.el, 0);
  };
  // People who live in the realms (Sensei Fletcher at Kobra Kai).
  const npcs = realms.flatMap(r => (r.B.npcs || []).map((n, i) => { const ch = makeCharacter(n.look); const x = r.R.at[0] + n.u, z = r.R.at[1] + n.v; ch.root.position.set(x, r.F.ground(n.u, n.v), z); ch.yaw = n.face; ch.root.rotation.y = n.face; scene.add(ch.root);
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 2.6, 8), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.set(x, ch.root.position.y + 1.3, z); scene.add(proxy); const o = { ...n, ch, realm: r, seed: 3 + i, el: label('w3-bot') }; o.el.innerHTML = `<i>✦</i>${esc(n.name)}`; proxy.userData = { kind: 'npc', npc: o }; proxies.push(proxy); return o; }));
  async function npcTalk(n) {
    if (talk.on || voyage || realm !== n.realm) return;
    const spot = posL(n.ch.root.position.x + Math.sin(n.ch.yaw) * 1.5, n.ch.root.position.z + Math.cos(n.ch.yaw) * 1.5);
    if (Math.hypot(state.position.x - spot[0], state.position.y - spot[1]) > 26) await new Promise(res => goTo(spot[0], spot[1], res));
    if (talk.on || voyage || $('#modal').open) return;
    stopAct(); talk.on = true; talk.target = n; travel = null; keys.clear(); n.ch.wave = 1.8;
    bars.classList.add('on'); frameEl.classList.add('talking'); $('#mapTooltip').hidden = true;
    const host = { kind: 'bot', o: { ch: n.ch, b: {} }, name: n.name, color: n.color };
    try {
      await say(host, pickLine(n.lines));
      const pick = await say(host, 'What will it be today?', [{ label: '⌨ Solve a problem', value: 'leetcode' }, { label: '⚔ Train kata', value: 'kata' }, { label: 'Show me today’s problem', value: 'quest' }, { label: 'Bow out', value: null }]);
      endTalk();
      if (pick === 'quest') { const q = quests().find(q => isLeetCode(q) && available(q) && !E.completed(state, q)) || quests().find(isLeetCode); if (q) questDialog(q.id); }
      else if (pick) { const s = realm.spots.find(x => x.act === pick); if (s) doSpot(s); }
    } catch (err) { if (err.message !== 'abort') console.error(err); endTalk(); }
  }
  // Gilfoyle calls her over and sends her to Kobra Kai.
  async function leetcodeCall() {
    const k = kobra(); if (!k || voyage || talk.on) return;
    if (realm === k) { const s = k.spots.find(x => x.act === 'leetcode'); if (s) doSpot(s); return; }
    const g = bots.find(o => o.b.id === 'gilfoyle');
    if (realm || !g || !g.ch.root.visible) { toast('Gilfoyle: “LeetCode? Kobra Kai. Now.”'); sail(k, { leetcode: true }); return; }
    g.ch.wave = 1.8; toast('Gilfoyle: “Nivetha. Over here.”'); stopAct();
    await new Promise(res => goTo(g.b.x - 18, g.b.y + 10, res));
    if (talk.on || voyage || $('#modal').open) return;
    talk.on = true; talk.target = g; travel = null; keys.clear(); bars.classList.add('on'); frameEl.classList.add('talking');
    try { await say({ kind: 'bot', o: g, name: g.b.name, color: g.b.color, id: g.b.id }, pickLine(GILFOYLE_LC)); } catch (err) { if (err.message !== 'abort') console.error(err); return; }
    endTalk(); sail(k, { leetcode: true });
  }
  // The ferry and voyages between realms.
  function parkFerry() { const p = realm ? realm.park : homePark; ferry.g.position.copy(p.pos); ferry.g.rotation.set(0, p.yaw, 0); ferry.body.rotation.set(0, 0, 0); for (const [i, w] of ferry.wings.entries()) w.scale.set((i ? 1 : -1) * .001, 1, 1); }
  parkFerry();
  function sail(dest, opts = {}) {
    if (voyage || talk.on || !active) return;
    if ((dest || null) === realm) { toast(dest ? `You’re already in ${dest.R.name}.` : 'You’re already home.'); return; }
    if (screen !== 'world') showScreen('world');
    stopAct(); act = null; travel = null; keys.clear(); $('#mapTooltip').hidden = true;
    if (reduceMotion.matches) { arrive(dest, opts); return; }
    const from = ferry.g.position.clone(), to = (dest ? dest.park : homePark).pos.clone(), flat = new THREE.Vector3(to.x - from.x, 0, to.z - from.z), dist = flat.length(); flat.normalize();
    const H = 20 + dist * .08;
    voyage = { t: 0, dur: 3.6 + dist / 32, dest, opts, p: [from, from.clone().addScaledVector(flat, 16).setY(from.y + H), to.clone().addScaledVector(flat, -16).setY(to.y + H), to], deck: new THREE.Vector3(), fwd: flat.clone(), heading: Math.atan2(flat.x, flat.z) };
    bars.classList.add('on'); frameEl.classList.add('voyaging'); emote('✦', 2); status(); renderRealmCards();
  }
  function arrive(dest, opts = {}) {
    realm = dest || null; voyage = null; bars.classList.remove('on'); frameEl.classList.remove('voyaging'); talk.settle = 1.6;
    const b = realm ? realm.board : homeBoard; state.position = { x: b.x, y: b.y }; prev = null; save();
    parkFerry(); cat.placed = veer.placed = false; idle = 0; renderRealmCards(); status();
    const cap = frameEl.querySelector('.map-caption span'); if (cap) cap.textContent = realm ? `${realm.R.glyph} ${realm.R.name.toUpperCase()}` : '✦ THE INNER KINGDOM';
    toast(realm ? realm.R.arrive : 'Home again. The Inner Kingdom missed you.');
    if (realm) skyRef = realm.R.sky || skyRef;
    if (opts.leetcode && realm) { for (const n of npcs) if (n.realm === realm) n.ch.wave = 1.8; setTimeout(() => { const s = realm?.spots.find(x => x.act === 'leetcode'); if (s) doSpot(s); }, 900); }
  }
  async function ferryDialog() {
    if (talk.on || voyage || !active) return;
    const b = realm ? realm.board : homeBoard;
    if (Math.hypot(state.position.x - b.x, state.position.y - b.y) > 30) await new Promise(res => goTo(b.x, b.y, res));
    if (talk.on || voyage || $('#modal').open) return;
    stopAct(); talk.on = true; talk.target = { pos: ferry.g.position }; travel = null; keys.clear();
    bars.classList.add('on'); frameEl.classList.add('talking'); $('#mapTooltip').hidden = true;
    const choices = realms.filter(r => r !== realm).map(r => ({ label: `${r.R.glyph} ${r.R.name}`, value: r }));
    if (realm) choices.unshift({ label: '⌂ Home', value: 'home' });
    choices.push({ label: 'Not now', value: null });
    let pick = null;
    try { pick = await say({ kind: 'ferry', pos: ferry.g.position, name: 'The Sky Ferry', color: '#c49a45' }, realm ? `${realm.R.name} will keep. Where to next, Nivetha?` : 'All aboard! Where shall the wind take you, Nivetha?', choices); } catch (err) { if (err.message !== 'abort') console.error(err); }
    endTalk();
    if (pick) sail(pick === 'home' ? null : pick);
  }
  function interact() {
    if (talk.on || voyage) return false;
    const b = realm ? realm.board : homeBoard;
    if (player.root.position.distanceTo(ferry.g.position) < 7 || Math.hypot(state.position.x - b.x, state.position.y - b.y) < 45) { ferryDialog(); return true; }
    const s = nearestSpot(3.6); if (s) { doSpot(s); return true; }
    if (realm) { toast('Walk to the ferry or a ✦ spot, then press E.'); return true; }
    return false;
  }
  // Leaving a realm for anything that lives on the home island (areas, guides, the camp button).
  const leaveRealm = fn => (...a) => { if (realm && !voyage) arrive(null); return fn(...a); };
  visit = leaveRealm(visit); botTalk = leaveRealm(botTalk); councilTalk = leaveRealm(councilTalk); regionDialog = leaveRealm(regionDialog);
  frameEl.addEventListener('click', e => {
    if (!active) return;
    if (e.target.closest('#home') && (realm || voyage)) { e.preventDefault(); e.stopPropagation(); if (!voyage) sail(null); }
    else if (e.target.closest('#touchEnter') && interact()) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  frameEl.addEventListener('keydown', e => {
    if (!active || $('#modal').open) return;
    if (voyage && ['Escape', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); voyage.t = 1; return; }
    if (talk.on || voyage) return;
    if (e.key.toLowerCase() === 'e' && interact()) { e.preventDefault(); e.stopImmediatePropagation(); }
    else if (/^[1-6]$/.test(e.key) && e.target === canvas) { e.preventDefault(); doEmote(EMOTES[+e.key - 1][0]); }
  }, true);
  // The action bar under the map, and the "beyond the sea" cards under the area list.
  const bar = document.createElement('div'); bar.className = 'w3-actions'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Nivetha’s actions');
  bar.innerHTML = `<div class="w3-who"><b>Nivetha <i>with Veer &amp; Mochi</i></b><small id="w3Doing" role="status">Exploring</small></div><div class="w3-emotes">${EMOTES.map(([id, ic, name], i) => `<button type="button" data-emote="${id}" title="${name} (${i + 1})"><i aria-hidden="true">${ic}</i><span>${name}</span></button>`).join('')}</div><button type="button" class="w3-lc" title="Tell Gilfoyle you’re doing LeetCode"><i aria-hidden="true">⚔</i>LeetCode</button><button type="button" class="w3-ctx" hidden></button>`;
  frameEl.after(bar);
  bar.querySelectorAll('[data-emote]').forEach(b => b.onclick = () => doEmote(b.dataset.emote));
  bar.querySelector('.w3-lc').onclick = () => leetcodeCall();
  const ctxBtn = bar.querySelector('.w3-ctx'), doingEl = bar.querySelector('#w3Doing');
  ctxBtn.onclick = () => { const s = nearestSpot(7); if (s) doSpot(s); else ferryDialog(); };
  function status() {
    const text = voyage ? `Sailing to ${voyage.dest ? voyage.dest.R.name : 'the Inner Kingdom'}` : act && act.end < 0 ? act.A.say : travel ? 'On the move' : realm ? `Exploring ${realm.R.name}` : 'Exploring the Inner Kingdom';
    if (doingEl.textContent !== text) doingEl.textContent = text;
    bar.querySelectorAll('[data-emote]').forEach(b => b.classList.toggle('on', act?.id === b.dataset.emote && act.end < 0));
  }
  const realmHead = document.createElement('div'); realmHead.className = 'below-map realms-head';
  realmHead.innerHTML = '<div><span class="eyebrow">BEYOND THE SEA</span><h3>Other worlds to wander.</h3></div><span class="small-muted">BOARD THE SKY FERRY AT THE PIER</span>';
  const realmStrip = document.createElement('div'); realmStrip.className = 'realm-strip';
  $('#areas').after(realmHead, realmStrip);
  const ART = {
    home: '<path d="M0 46 Q30 30 60 40 T120 36 V60 H0Z" fill="#7fb257"/><path d="M50 40 l10-14 10 14z" fill="#d7ae70"/><circle cx="96" cy="16" r="7" fill="#ffe7a3"/>',
    florentia: '<path d="M0 48 Q40 40 120 46 V60 H0Z" fill="#8fb05a"/><rect x="40" y="28" width="26" height="18" fill="#f1ece0"/><path d="M42 28 Q53 6 64 28z" fill="#c0623e"/><rect x="51" y="6" width="4" height="6" fill="#f1ece0"/><rect x="72" y="14" width="7" height="32" fill="#f1ece0"/><path d="M20 46 q3-18 6 0z M100 46 q3-16 6 0z" fill="#2f5a3a"/><circle cx="100" cy="14" r="6" fill="#ffe7a3"/>',
    skygarden: '<path d="M28 30 Q60 22 92 30 L72 52 L60 60 L46 50z" fill="#8a7c68"/><path d="M28 30 Q60 22 92 30 Q60 36 28 30z" fill="#7fb55a"/><rect x="83" y="31" width="3" height="28" fill="#dff2ff" opacity=".8"/><circle cx="58" cy="20" r="9" fill="#5d9a47"/><ellipse cx="18" cy="48" rx="16" ry="5" fill="#fff" opacity=".85"/><ellipse cx="104" cy="44" rx="14" ry="4" fill="#fff" opacity=".85"/>',
    bathhouse: '<rect x="0" y="48" width="120" height="12" fill="#3f7fa0"/><rect x="38" y="30" width="34" height="18" fill="#a8392b"/><path d="M32 31 L55 20 L78 31z" fill="#3f6f68"/><rect x="44" y="12" width="22" height="9" fill="#a8392b"/><path d="M40 13 L55 5 L70 13z" fill="#3f6f68"/><circle cx="46" cy="38" r="2" fill="#ffd27a"/><circle cx="64" cy="38" r="2" fill="#ffd27a"/><rect x="80" y="44" width="40" height="2" fill="#5a5048"/><rect x="96" y="38" width="14" height="7" fill="#3c6e6a"/>',
    starfall: '<path d="M0 50 Q40 40 120 50 V60 H0Z" fill="#4f8a52"/><path d="M52 50 L60 22 L68 50z" fill="#e2e4d8"/><circle cx="60" cy="18" r="5" fill="#e2e4d8"/><circle cx="60" cy="8" r="4" fill="#7fe3ff"/><circle cx="20" cy="12" r="1.5" fill="#fff"/><circle cx="96" cy="10" r="1.5" fill="#fff"/><circle cx="104" cy="22" r="1" fill="#fff"/>',
  };
  ART.kobra = '<path d="M0 50 Q50 42 120 50 V60 H0Z" fill="#4f6e3a"/><rect x="34" y="28" width="44" height="20" fill="#1b1918"/><path d="M28 29 L56 16 L84 29z" fill="#2b2725"/><rect x="34" y="28" width="44" height="2" fill="#e3c35c"/><circle cx="56" cy="38" r="6" fill="#121212" stroke="#e3c35c" stroke-width="1.5"/><ellipse cx="56" cy="37" rx="2.4" ry="3" fill="#e3c35c"/><rect x="88" y="34" width="3" height="16" fill="#7a1f1a"/><rect x="97" y="34" width="3" height="16" fill="#7a1f1a"/>';
  ART.hollow = '<path d="M0 48 Q60 38 120 48 V60 H0Z" fill="#8cba5c"/><circle cx="22" cy="34" r="12" fill="#5f9a46"/><circle cx="100" cy="32" r="13" fill="#e79ab5"/><circle cx="60" cy="16" r="6" fill="#ffe0a0"/><rect x="48" y="47" width="18" height="5" fill="#ffd2dc"/><circle cx="40" cy="50" r="2.4" fill="#f6e7cc"/><circle cx="74" cy="50" r="2.6" fill="#d9894a"/><path d="M84 22 l3 -2 l0 4z M88 18 l3 -2 l0 4z" fill="#fff"/>';
  const SKY = { kobra: ['#2a2a3a', '#d98a5a'], hollow: ['#e98bb0', '#ffc28a'], home: ['#bfe0f2', '#fdf2d6'], florentia: ['#f6c98e', '#fde9c4'], skygarden: ['#8fc6ee', '#e3f3ff'], bathhouse: ['#2b3a6a', '#d9877a'], starfall: ['#141f3a', '#3b4f8a'] };
  function renderRealmCards() {
    const list = [{ id: 'home', name: 'The Inner Kingdom', sub: 'Home island', r: null }, ...realms.map(r => ({ id: r.R.id, name: r.R.name, sub: r.R.sub, r }))];
    realmStrip.innerHTML = list.map(c => { const here = (c.r || null) === realm; return `<button type="button" class="realm-card${here ? ' here' : ''}" data-realm="${c.id}" aria-label="${esc(c.name)}${here ? ', you are here' : ', sail there'}"><svg viewBox="0 0 120 60" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky-${c.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKY[c.id][0]}"/><stop offset="1" stop-color="${SKY[c.id][1]}"/></linearGradient></defs><rect width="120" height="60" fill="url(#sky-${c.id})"/>${ART[c.id]}</svg><span class="realm-text"><strong>${esc(c.name)}</strong><small>${here ? '✦ You are here' : esc(c.sub)}</small></span></button>`; }).join('');
    realmStrip.querySelectorAll('[data-realm]').forEach(b => b.onclick = () => { const r = realms.find(x => x.R.id === b.dataset.realm) || null; if (r === realm) { toast(r ? `You’re in ${r.R.name}. Have a wander.` : 'You’re home on the Inner Kingdom.'); return; } canvas.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' }); sail(r); });
  }
  renderRealmCards();
  hooks.sync = () => {
    const xp = E.total(state);
    if (lastXP !== null && xp > lastXP) pendingCheer = E.level(xp) > E.level(lastXP) ? 2 : 1;
    if (lastCloak2 !== null && state.equipped !== lastCloak2) pendingCheer ||= 3;
    const rw = (state.rewards || []).length; if (lastRewards !== null && rw > lastRewards) pendingCheer ||= 1;
    lastXP = xp; lastCloak2 = state.equipped; lastRewards = rw;
    const lv = E.level(xp); if (!realm && (lv !== spotLevel || !spots[0].L)) { spotLevel = lv; placeMainSpots(); }
  };
  // Arena wardrobe: dress automatically on arrival, or keep a favourite outfit.
  const wardrobe = document.createElement('section'); wardrobe.className = 'arena-wardrobe';
  wardrobe.innerHTML = `<div class="eyebrow">DRESSED FOR YOUR WORLD</div><h3>A look for every arena.</h3><p id="outfitStatus" role="status"></p><button type="button" class="secondary" id="autoOutfit" aria-pressed="true">Auto dress for arena</button><div class="outfit-grid">${OUTFITS.map(o => `<button type="button" class="outfit-card" data-outfit="${o.id}" style="--outfit:${o.color}"><span aria-hidden="true">✦</span><b>${o.name}</b><small>${o.arena}</small></button>`).join('')}</div>`;
  $('#rewardsScreen').prepend(wardrobe);
  let outfitPreference = 'auto', outfitId = 'camp', wardrobeAge = 0;
  try { const saved = localStorage.getItem('becoming-arena-outfit'); if (saved === 'auto' || OUTFITS.some(o => o.id === saved)) outfitPreference = saved; } catch {}
  const outfitCache = new Map([['camp', player]]);
  function setOutfit(id) {
    if (outfitId === id) return;
    const previous = player; let next = outfitCache.get(id);
    if (!next) { next = makeCharacter(outfitLook(PLAYER_LOOK, id)); outfitCache.set(id, next); }
    for (const k of ['hammer', 'quill', 'brush', 'wrench', 'phone']) next.arms[1].add(PR[k]);
    next.body.add(PR.book, PR.ledger);
    next.root.position.copy(previous.root.position); next.root.rotation.copy(previous.root.rotation);
    for (const k of ['yaw', 'phase', 'wave', 'give', 'expr']) next[k] = previous[k];
    previous.root.removeFromParent(); player = next; scene.add(player.root); outfitId = id;
    if (player.cloakMesh) player.cloakMesh.material = toonMat(palettes[state.equipped] || palettes.sage);
    wardrobe.querySelectorAll('[data-outfit]').forEach(b => { b.classList.toggle('on', b.dataset.outfit === id); b.setAttribute('aria-pressed', String(b.dataset.outfit === id)); });
  }
  function currentOutfit() {
    if (outfitPreference !== 'auto') return outfitPreference;
    if (realm) return realm.R.id;
    if (act?.spot?.region) return act.spot.region;
    const nearby = WORLD.filter(r => E.level(E.total(state)) >= r.unlock).map(r => ({ r, d: Math.hypot(state.position.x - r.x, state.position.y - r.y) }));
    nearby.sort((a, b) => a.d - b.d); return nearby[0]?.d < 100 ? nearby[0].r.id : 'camp';
  }
  function updateWardrobe() {
    const id = currentOutfit(); setOutfit(id);
    wardrobe.querySelector('#outfitStatus').textContent = `${OUTFITS.find(o => o.id === id).name} · ${outfitPreference === 'auto' ? 'Changes with your arena' : 'Your chosen outfit'}`;
    wardrobe.querySelector('#autoOutfit').setAttribute('aria-pressed', String(outfitPreference === 'auto'));
  }
  const chooseOutfit = id => { outfitPreference = id; try { localStorage.setItem('becoming-arena-outfit', id); } catch {} updateWardrobe(); toast(id === 'auto' ? 'Your outfit will follow the arena.' : `Wearing ${OUTFITS.find(o => o.id === id).name}.`); };
  wardrobe.querySelectorAll('[data-outfit]').forEach(b => b.onclick = () => chooseOutfit(b.dataset.outfit));
  wardrobe.querySelector('#autoOutfit').onclick = () => chooseOutfit('auto'); updateWardrobe();

  // Every frame: voyages and ferry bobbing.
  const bez = (p, t, out) => { const u = 1 - t; return out.set(0, 0, 0).addScaledVector(p[0], u * u * u).addScaledVector(p[1], 3 * u * u * t).addScaledVector(p[2], 3 * u * t * t).addScaledVector(p[3], t * t * t); };
  const bv1 = new THREE.Vector3(), bv2 = new THREE.Vector3();
  hooks.frame = (dt, t) => {
    nowT = t; if ((wardrobeAge -= dt) <= 0 && !voyage) { wardrobeAge = .3; updateWardrobe(); }
    const wantSky = realm?.R.sky && !voyage ? 1 : 0; if (Math.abs(wantSky - skyBlend) > .001) { skyBlend += (wantSky - skyBlend) * Math.min(1, dt * 1.2); if (Math.abs(wantSky - skyBlend) < .01) skyBlend = wantSky; envDirty = true; }
    if (voyage) {
      const v = voyage; v.t = Math.min(1, v.t + dt / v.dur); const e = v.t < .5 ? 2 * v.t * v.t : 1 - (-2 * v.t + 2) ** 2 / 2;
      bez(v.p, e, bv1); bez(v.p, Math.min(1, e + .01), bv2); bv2.sub(bv1); if (bv2.lengthSq() < 1e-8) bv2.copy(v.fwd);
      ferry.g.position.copy(bv1); v.heading = Math.atan2(bv2.x, bv2.z); ferry.g.rotation.set(0, v.heading, 0);
      ferry.body.rotation.x = -Math.atan2(bv2.y, Math.hypot(bv2.x, bv2.z)) * .7; ferry.body.rotation.z = Math.sin(t * 1.3) * .05;
      const open = smooth(0, .12, v.t) * (1 - smooth(.88, 1, v.t));
      ferry.wings.forEach((w, i) => { const s = i ? 1 : -1; w.scale.set(s * Math.max(.001, open), 1, 1); w.rotation.z = s * Math.sin(t * 5) * .28 * open; });
      v.fwd.set(bv2.x, 0, bv2.z).normalize(); v.deck.copy(bv1).addScaledVector(v.fwd, .7); v.deck.y -= .02;
      if (v.t >= 1) arrive(v.dest, v.opts);
    } else {
      const p = realm ? realm.park : homePark; ferry.g.position.y = p.pos.y + .1 + Math.sin(t * 1.1) * .06; ferry.body.rotation.z = Math.sin(t * .9) * .04; ferry.body.rotation.x = Math.sin(t * .7) * .03;
    }
  };
  // Every frame, after the walk animation: blend her current activity, props, Mochi and effects.
  hooks.prePose = () => { const b = player; b.body.rotation.y = b.body.rotation.z = 0; for (const l of b.legs) l.rotation.y = l.rotation.z = 0; for (const a of b.arms) a.rotation.y = 0; b.head.rotation.x = b.head.rotation.z = 0; };
  function applyPose(p, w) {
    const L = (o, k, v) => { if (v !== undefined) o[k] += (v - o[k]) * w; }, b = player;
    L(b.body.position, 'y', p.by); L(b.body.rotation, 'x', p.bx); L(b.body.rotation, 'y', p.bry); L(b.body.rotation, 'z', p.bz);
    for (const i of [0, 1]) for (const ax of ['x', 'y', 'z']) { L(b.legs[i].rotation, ax, p[`l${i}${ax}`]); L(b.arms[i].rotation, ax, p[`a${i}${ax}`]); }
    if (p.l0x !== undefined || p.l1x !== undefined) for (const knee of b.knees) L(knee.rotation, 'x', -1.25);
    L(b.head.rotation, 'x', p.hx); L(b.head.rotation, 'y', p.hy); L(b.head.rotation, 'z', p.hz); if (b.cloak) L(b.cloak.rotation, 'x', p.cx);
  }
  hooks.pose = (dt, t, speed, px, py, pz) => {
    const moving = speed > .5 || keys.size > 0 || !!travel, busy = talk.on || !!voyage || $('#modal').open || screen !== 'world' || !!document.querySelector('.quest-scroll');
    if (moving && act && !voyage) stopAct();
    idle = moving || busy ? 0 : idle + dt;
    if (!act && !busy && !moving) {
      if (pendingCheer) { if (pendingCheer === 3) startAct('twirl'); else celebrate(pendingCheer === 2); pendingCheer = 0; }
      else if (idle > idleNext) {
        const s = nearestSpot(4.5), catNear = veer.root.position.distanceTo(player.root.position) < 3, night = look.glow > .6;
        if (s) startAct(s.act, s);
        else if (idle > 40) startAct('sit');
        else startAct(['stretch', 'look', 'staff', 'hum', catNear ? 'pet' : 'look', night ? 'yawn' : 'hum', 'wave'][Math.random() * 7 | 0]);
        idleNext = idle + 9 + Math.random() * 10;
      }
    }
    let pose = null, w = 0;
    if (act) {
      act.t += dt; const A = act.A;
      if (A.dur && act.t > A.dur && act.end < 0) act.end = 0;
      if (act.end >= 0) act.end += dt;
      w = Math.min(1, act.t / .35) * (act.end >= 0 ? Math.max(0, 1 - act.end / .35) : 1);
      pose = A.pose?.(act.t);
      if (act.end >= .35) { act = null; status(); }
    }
    if (voyage) { pose = ACTS.gaze.pose(t); w = Math.min(1, voyage.t * 8); player.yaw = voyage.heading; }
    if (pose) applyPose(pose, w);
    if (act?.spot && w > 0) player.yaw = lerpAngle(player.yaw, act.spot.face, 1 - Math.exp(-dt * 6));
    if (act?.id === 'pet') { const pt = petTarget === 'veer' ? veer.root.position : cat.root.position; player.yaw = lerpAngle(player.yaw, Math.atan2(pt.x - px, pt.z - pz), 1 - Math.exp(-dt * 6)); }
    player.root.rotation.y = player.yaw;
    player.expr = act && w > .3 ? (act.A.expr || 'normal') : voyage ? 'happy' : 'normal';
    // props and the staff she sets down
    const props = act && w > .25 ? act.A.prop || [] : [];
    for (const k of ['book', 'ledger', 'hammer', 'quill', 'brush', 'wrench', 'phone']) PR[k].visible = props.includes(k);
    if (PR.phone.visible) { PR.phoneTex.offset.y -= dt * .05; if (Math.floor(act.t / 4) !== Math.floor((act.t - dt) / 4)) emote(['♡', '☺', '✿', 'ᐢ.ᐢ', '♪'][Math.random() * 5 | 0], 2); }
    const down = !!(act && STAFF_DOWN.has(act.id) && w > .5);
    player.staff.visible = !down; laidStaff.visible = down;
    if (down) { const s = Math.sin(player.yaw), c = Math.cos(player.yaw); laidStaff.position.set(px + c * .65 - s * .2, py + .06, pz - s * .65 - c * .2); laidStaff.rotation.set(0, player.yaw, Math.PI / 2); }
    PR.anvil.visible = !!(act?.A.anvil && w > .1);
    if (PR.anvil.visible) { const s = Math.sin(player.yaw), c = Math.cos(player.yaw); PR.anvil.position.set(px + s * .8, py, pz + c * .8); PR.anvil.rotation.y = player.yaw; }
    const su = sparks.material.uniforms;
    if (act?.id === 'hammer') { const ph = (act.t * 1.3) % 1; su.uOrigin.value.set(PR.anvil.position.x, PR.anvil.position.y + .85, PR.anvil.position.z); su.uOpacity.value = ph > .78 && ph < .9 ? 1 : Math.max(0, su.uOpacity.value - dt * 5); }
    else su.uOpacity.value = Math.max(0, su.uOpacity.value - dt * 5);
    if (act?.id === 'paint' && w > .8) act.spot.easel?.paint(dt);
    const au = aura.material.uniforms; au.uOrigin.value.set(px, py + .2, pz); au.uOpacity.value += ((act?.A.aura ? act.A.aura * w : voyage ? .5 : 0) - au.uOpacity.value) * Math.min(1, dt * 3);
    const bu = burst.material.uniforms; bu.uOrigin.value.set(px, py + .3, pz); bu.uOpacity.value = Math.max(0, bu.uOpacity.value - dt * .45);
    if (pillar.visible) { const d = pillar.userData; d.t += dt; pillar.position.set(px, py + 20, pz); pillar.material.uniforms.uA.value = d.k * Math.sin(Math.min(1, d.t / 2.6) * Math.PI) * .55; pillar.scale.set(1 + d.t * .4, 1, 1 + d.t * .4); if (d.t > 2.6) pillar.visible = false; }
    if (player.orb) player.orb.material.emissiveIntensity = 3 + look.glow * 3 + (act?.A.glow ? act.A.glow * w : 0) + (voyage ? 2 : 0) + (pillar.visible ? 3 : 0);
    catFrame(dt, t, px, py, pz);
    veerFrame(dt, t, px, py, pz);
    for (const n of npcs) { const near = n.realm === realm && Math.hypot(px - n.ch.root.position.x, pz - n.ch.root.position.z) < 7; n.ch.yaw = lerpAngle(n.ch.yaw, near ? Math.atan2(px - n.ch.root.position.x, pz - n.ch.root.position.z) : n.face, 1 - Math.exp(-dt * 3)); n.ch.root.rotation.y = n.ch.yaw; animateCharacter(n.ch, 0, dt, t, n.seed); }
    for (const r of realms) if (r.B.frame) r.B.frame(dt, t, r === realm && !voyage ? { u: px - r.R.at[0], v: pz - r.R.at[1], act: act && act.end < 0 ? act.id : null } : null);
    if ((uiTimer -= dt) <= 0) { uiTimer = .3; status(); const s = !voyage && !talk.on ? nearestSpot(7) : null, nearFerry = !voyage && !talk.on && player.root.position.distanceTo(ferry.g.position) < 9; const label2 = s && act?.spot !== s ? `✦ ${s.label}` : nearFerry ? '⛵ Board the sky ferry' : ''; ctxBtn.hidden = !label2; if (label2 && ctxBtn.textContent !== label2) ctxBtn.textContent = label2; }
  };
  // Pets share the world's collision rules and route around furniture. Choose a clear resting
  // footprint beside the player; work surfaces and the laptop are never lap targets.
  function companionTarget(px, pz, yaw, side, behind, radius, extraClear) {
    const clear = (x, z) => footprintClear(x, z, motor.clear, radius) && (!extraClear || extraClear(x, z));
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (const [right, back] of [[side, behind], [-side, behind], [side * 1.5, behind + .6], [-side * 1.5, behind + .6], [side, behind + 1.3]]) {
      const x = px + c * right - s * back, z = pz - s * right - c * back;
      if (clear(x, z)) return { x, z };
    }
    for (let r = 1; r <= 4; r += .4) for (let i = 0; i < 24; i++) {
      const a = yaw + i * Math.PI / 12, x = px + Math.sin(a) * r, z = pz + Math.cos(a) * r;
      if (clear(x, z)) return { x, z };
    }
    return null;
  }
  function followCompanion(pet, target, dt, radius) {
    if (!target) return 0;
    if (!pet.motor) pet.motor = new CharacterMotor({ clear: motor.clear, ground: (x, z) => groundAt(x, z), radius, slope: 1.25 });
    const m = pet.motor;
    if (!pet.placed || Math.hypot(m.x - target.x, m.z - target.z) > 14) {
      m.reset(target.x, target.z); pet.placed = true; pet.route = null;
    }
    const from = { x: m.x, y: m.z }, to = { x: target.x, y: target.z };
    const clearLine = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / .1)); for (let i = 0; i <= n; i++) if (!m.fits(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false; return true; };
    pet.routeTimer = (pet.routeTimer || 0) - dt;
    let waypoint = target;
    if (!clearLine(from, to)) {
      if (pet.routeTimer <= 0) { pet.routeTimer = .65; const [fx, fy] = posL(m.x, m.z), [tx, ty] = posL(target.x, target.z); pet.route = findPath({ x: fx, y: fy }, { x: tx, y: ty }); }
      while (pet.route?.length) { const [x, z] = posW(pet.route[0].x, pet.route[0].y); if (Math.hypot(x - m.x, z - m.z) < .25) pet.route.shift(); else { waypoint = { x, z }; break; } }
      if (!pet.route?.length) waypoint = { x: m.x, z: m.z };
    } else pet.route = null;
    const dx = waypoint.x - m.x, dz = waypoint.z - m.z, distance = Math.hypot(dx, dz), speed = distance > .12 ? Math.min(8, distance * 3.2) : 0;
    m.update(dt, { x: distance ? dx / distance : 0, z: distance ? dz / distance : 0, speed, distance });
    pet.root.position.set(m.x, m.y, m.z);
    if (m.speed > .1) pet.yaw = lerpAngle(pet.yaw, Math.atan2(m.vx, m.vz), 1 - Math.exp(-dt * 10));
    return m.speed;
  }
  function veerFrame(dt, t, px, py, pz) {
    const v = veer, live = act && act.end < 0;
    const lap = live && LAP.has(act.id) && act.t > .5, cuddle = live && act.id === 'pet' && petTarget === 'veer';
    let speed = 0, mode = 'sit';
    if (voyage) { const f = voyage.fwd; v.root.position.set(px + f.z * .52 - f.x * .85, py, pz - f.x * .52 - f.z * .85); v.yaw = voyage.heading; v.placed = false; }
    else {
      const target = companionTarget(px, pz, player.yaw, 1.15, .25, .42);
      speed = followCompanion(v, target, dt, .42);
      mode = speed > .15 ? 'walk' : lap ? 'lie' : 'sit';
      if (mode !== 'walk') v.yaw = lerpAngle(v.yaw, Math.atan2(px - v.root.position.x, pz - v.root.position.z), 1 - Math.exp(-dt * 4));
      v.hop = Math.max(0, (v.hop || 0) - dt); v.root.position.y += v.hop > 0 ? Math.sin((1 - v.hop / .7) * Math.PI) * .45 : 0;
    }
    v.root.rotation.y = v.yaw;
    const happy = lap || cuddle || pillar.visible || (act?.id === 'cheer' && live);
    v.phase += dt * (2 + speed * 3.6); const sw = Math.sin(v.phase) * .7 * Math.min(1, speed / 2);
    v.sit += ((mode === 'walk' ? 0 : 1) - v.sit) * Math.min(1, dt * 4); v.lie += ((mode === 'lie' ? 1 : 0) - v.lie) * Math.min(1, dt * 2.5);
    v.legs[0].rotation.x = sw + .45 * v.sit - 1.4 * v.lie; v.legs[1].rotation.x = -sw + .45 * v.sit - 1.4 * v.lie; v.legs[2].rotation.x = -sw - .9 * v.sit; v.legs[3].rotation.x = sw - .9 * v.sit;
    v.body.rotation.x = -.45 * v.sit * (1 - v.lie); v.body.position.y = -.06 * v.sit - .12 * v.lie;
    v.head.rotation.x = (.38 * v.sit - (mode === 'sit' ? .25 : 0)) * (1 - v.lie) + .28 * v.lie; v.head.rotation.z = cuddle ? Math.sin(t * 3) * .18 : 0;
    v.tail.forEach((sg, j) => { sg.rotation.z = Math.sin(t * (happy ? 15 : 6) + j) * (happy ? .55 : .25); });
    v.blink = (v.blink ?? 2) - dt; if (v.blink < -.14) v.blink = 2 + Math.random() * 4;
    for (const e of v.eyes) e.scale.y = (lap && act.t > 4) || cuddle ? .004 : v.blink < 0 ? .005 : .024;
    v.tongue.visible = happy || speed > 2;
  }
  // Mochi follows a step behind her, sits when she stops, and purrs when petted.
  function catFrame(dt, t, px, py, pz) {
    const c = cat, petting = act?.id === 'pet' && petTarget === 'mochi';
    if (voyage) { const f = voyage.fwd; c.root.position.set(px - f.x * 1.5, py, pz - f.z * 1.5); c.yaw = voyage.heading; c.still = 2; c.placed = false; }
    else {
      const target = companionTarget(px, pz, player.yaw, -.9, 1.2, .25, (x, z) => Math.hypot(x - veer.root.position.x, z - veer.root.position.z) > .85);
      c.speed = followCompanion(c, petting ? null : target, dt, .25);
      if (c.speed > .1) c.still = 0; else { c.still += dt; c.yaw = lerpAngle(c.yaw, Math.atan2(px - c.root.position.x, pz - c.root.position.z), 1 - Math.exp(-dt * 3)); }
      c.hop = Math.max(0, c.hop - dt); c.root.position.y += c.hop > 0 ? Math.sin((1 - c.hop / .7) * Math.PI) * .4 : 0;
    }
    c.root.rotation.y = c.yaw;
    const sp = c.speed || 0; c.phase += dt * (2 + sp * 3.2);
    const sw = Math.sin(c.phase) * .7 * Math.min(1, sp / 3);
    c.sit += ((c.still > 1.2 ? 1 : 0) - c.sit) * Math.min(1, dt * 4);
    c.legs[0].rotation.x = sw + .45 * c.sit; c.legs[1].rotation.x = -sw + .45 * c.sit; c.legs[2].rotation.x = -sw - .9 * c.sit; c.legs[3].rotation.x = sw - .9 * c.sit;
    c.body.rotation.x = -.45 * c.sit; c.body.position.y = -.06 * c.sit; c.head.rotation.x = .38 * c.sit - (petting ? .1 : 0);
    c.head.rotation.z = petting ? Math.sin(t * 3) * .15 : 0;
    c.tail.forEach((s, i) => { s.rotation.x = (sp > .5 ? -.25 : -.5 + c.sit * .3) + (i ? .12 : 0); s.rotation.z = Math.sin(t * (sp > .5 ? 6 : 2.2) + i * .7) * (.18 + i * .04); });
    c.blink = (c.blink ?? 2) - dt; if (c.blink < -.14) c.blink = 2 + Math.random() * 4;
    for (const e of c.eyes) e.scale.y = petting ? .004 : c.blink < 0 ? .006 : .028;
  }

  // Frame loop (called by app.js tick through `draw`).
  let lastT = 0, firstFrame = true, frames = 0, frameTime = 0, envTimer = 0, clockTimer = 0;
  const worldPos = new THREE.Vector3();
  function render(t) {
    const dt = clamp(t - lastT, .001, .05); lastT = t;
    U.time.value = t;
    hooks.frame?.(dt, t);
    let [px, pz] = posW(state.position.x, state.position.y), py = prev ? motor.y : groundAt(px, pz);
    if (voyage) ({ x: px, y: py, z: pz } = voyage.deck);
    const moved = Math.hypot(px - player.root.position.x, pz - player.root.position.z);
    if (moved > .002 && moved < 5) player.yaw = lerpAngle(player.yaw, Math.atan2(px - player.root.position.x, pz - player.root.position.z), 1 - Math.exp(-dt * 14));
    if (talk.on) { const g = talk.target.ch ? talk.target.ch.root.position : talk.target.pos; player.yaw = lerpAngle(player.yaw, Math.atan2(g.x - px, g.z - pz), 1 - Math.exp(-dt * 6)); if ($('#modal').open || screen !== 'world') endTalk(); }
    player.root.position.set(px, py, pz); player.root.rotation.y = player.yaw;
    if (talk.flight) {
      const fl = talk.flight; fl.t += dt / .95; const k = Math.min(1, fl.t), e = k * k * (3 - 2 * k);
      scrollProp.position.lerpVectors(fl.from, fl.to, e); scrollProp.position.y += Math.sin(k * Math.PI) * .9;
      scrollProp.rotation.set(k * 5, k * 2.5, .3); scrollProp.scale.setScalar(1 + Math.sin(k * Math.PI) * .5);
      if (k >= 1) { talk.flight = null; scrollProp.visible = false; fl.resolve(); }
    }
    hooks.prePose?.();
    animateCharacter(player, voyage ? 0 : moved < 5 ? moved / dt : 0, dt, t);
    hooks.pose?.(dt, t, voyage ? 0 : moved < 5 ? moved / dt : 0, px, py, pz);
    U.player.value.set(px, py, pz);
    for (const o of bots) {
      if (!o.ch.root.visible) continue;
      const bp = o.ch.root.position, near = Math.hypot(px - bp.x, pz - bp.z), want = near < 7 ? Math.atan2(px - bp.x, pz - bp.z) : Math.sin(t * .2 + o.seed) * .4;
      o.ch.yaw = lerpAngle(o.ch.yaw, want, 1 - Math.exp(-dt * 3)); o.ch.root.rotation.y = o.ch.yaw;
      if (near < 3.6 && !o.greeted) { o.greeted = true; o.ch.wave = 1.8; } else if (near > 6) o.greeted = false;
      animateCharacter(o.ch, 0, dt, t, o.seed);
    }
    const hours = applySky(hourOverride ?? istHours());
    if ((clockTimer -= dt) <= 0) { clockTimer = 10; const [icon, phase] = dayPhase(hours), hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60); clock.textContent = `${icon} ${(hh % 12 || 12)}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'} · ${phase}`; }
    envTimer -= dt; if (envDirty && envTimer <= 0) { envDirty = false; envTimer = .5; sky.position.set(0, 0, 0); envRT?.dispose(); envRT = pmrem.fromScene(envScene, .02, .1, 1500); scene.environment = envRT.texture; }
    // camera
    if (cam.intro > 0) cam.intro = Math.max(0, cam.intro - dt / 3.2);
    const ease = cam.intro * cam.intro * (3 - 2 * cam.intro);
    let wantDist = cam.dist + ease * 38, wantPitch = cam.pitch + ease * .45, wantYaw = cam.yaw + ease * .7;
    worldPos.set(px, py + 1.3, pz);
    if (talk.on) {
      const g = talk.target.ch ? talk.target.ch.root.position : talk.target.pos, dx = g.x - px, dz = g.z - pz, sep = Math.hypot(dx, dz), side = Math.atan2(dx, dz);
      const a1 = side + Math.PI / 2, a2 = side - Math.PI / 2, near = Math.abs(lerpAngle(cam.yaw, a1, 1) - cam.yaw) <= Math.abs(lerpAngle(cam.yaw, a2, 1) - cam.yaw) ? a1 : a2;
      wantYaw = near + (near === a1 ? -.32 : .32); wantPitch = .13; wantDist = Math.max(4.8, sep * 1.25 + 2.6);
      worldPos.set((px + g.x) / 2, (py + g.y) / 2 + 1.45, (pz + g.z) / 2);
    }
    if (voyage) { wantYaw = voyage.heading + Math.PI + .55; wantPitch = .3; wantDist = 15; worldPos.set(px, py + 1, pz); }
    const blend = talk.on || talk.settle > 0 || voyage ? (reduceMotion.matches ? 1 : 1 - Math.exp(-dt * 3.2)) : 1;
    if (!talk.on && talk.settle > 0) talk.settle -= dt;
    view.yaw = lerpAngle(view.yaw, wantYaw, blend); view.pitch += (wantPitch - view.pitch) * blend; view.dist += (wantDist - view.dist) * blend;
    const yaw = view.yaw, pitch = view.pitch, dist = view.dist;
    cam.target.lerp(worldPos, reduceMotion.matches ? 1 : 1 - Math.exp(-dt * (talk.on ? 3.5 : 7)));
    camera.position.set(cam.target.x + Math.sin(yaw) * Math.cos(pitch) * dist, cam.target.y + Math.sin(pitch) * dist, cam.target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.position.y = Math.max(camera.position.y, Math.max(groundAt(camera.position.x, camera.position.z), 0) + 1.2);
    camera.lookAt(cam.target);
    sky.position.copy(camera.position);
    // sun shadow follows the view, snapped to texels to avoid shimmering
    const snap = 60 / Q.shadow, sx = Math.round(cam.target.x / snap) * snap, sz = Math.round(cam.target.z / snap) * snap;
    sun.target.position.set(sx, cam.target.y - 1.3, sz); sun.position.copy(sun.target.position).addScaledVector(look.sun, 90); sun.target.updateMatrixWorld();
    motes.material.uniforms.uOrigin.value.copy(cam.target); flies.material.uniforms.uOrigin.value.set(cam.target.x, cam.target.y + 1, cam.target.z);
    for (const fn of animated) fn(t, dt);
    for (const bd of birds) { const a = t * .12 + bd.off; bd.g.position.set(Math.cos(a) * bd.rad, bd.h + Math.sin(t * .5 + bd.off) * 1.2, Math.sin(a) * bd.rad * .7 - 4); bd.g.rotation.y = -a; const f = Math.sin(t * 7 + bd.off * 3) * .5; bd.l.rotation.z = f; bd.r.rotation.z = -f; }
    for (const bf of flutter) { const tt = t * .5 + bf.seed; bf.g.position.set(bf.home[0] + Math.sin(tt * 1.3) * 2.2, heightAt(bf.home[0], bf.home[1]) + .7 + Math.sin(tt * 2.3) * .35, bf.home[1] + Math.cos(tt) * 2.2); bf.g.rotation.y = tt * 1.3 + Math.PI / 2; const f = Math.sin(t * 22 + bf.seed) * 1.1; bf.l.rotation.z = f; bf.r.rotation.z = f; }
    marker.visible = !!travel;
    if (travel) { const [mx, mz] = posW(travel.x, travel.y); marker.position.set(mx, Math.max(groundAt(mx, mz), 0) + .06, mz); const k = (t * 1.5) % 1; marker.scale.setScalar(.8 + k * .6); marker.material.opacity = .9 * (1 - k); }
    // labels and compass
    // Labels are queued, then laid out nearest-and-most-important first. A label that would cover another
    // (or the map's own controls) lifts above it, or fades out if there is no room.
    labelQueue.length = 0;
    const placeLabel = (el, pos, far, pri) => {
      projV.copy(pos).project(camera);
      const d = camera.position.distanceTo(pos), show = projV.z < 1 && Math.abs(projV.x) < 1.15 && Math.abs(projV.y) < 1.15 && d < far;
      if (!show) { fadeLabel(el, 0); return; }
      labelQueue.push({ el, x: (projV.x * .5 + .5) * viewW, y: (-projV.y * .5 + .5) * viewH, op: clamp((far - d) / (far * .25), 0, 1), pri, d });
    };
    areaLabels.forEach(a => { if (realm || voyage) { a.el._op = 0; a.el.style.opacity = '0'; } else placeLabel(a.el, a.pos, 140, 3); });
    botLabels.forEach(({ o, el }) => { if (!o.ch.root.visible) { fadeLabel(el, 0); return; } worldPos.copy(o.ch.root.position); worldPos.y += 2.55; placeLabel(el, worldPos, 34, 4); });
    worldPos.set(gate.position.x, gate.position.y + 7.4, gate.position.z); if (gate.visible) placeLabel(gateLabel, worldPos, 140, 3); else fadeLabel(gateLabel, 0);
    placeLabel(seaLabel, seaPos, 160, 0);
    councilLabels.forEach(({ o, el }) => { worldPos.copy(o.pos); worldPos.y += 3.2; placeLabel(el, worldPos, 32, 2); });
    hooks.labels?.(placeLabel);
    layoutLabels();
    if (talk.on && talk.anchor && !bubble.hidden) {
      projV.copy(anchorOf(talk.anchor, worldPos)).project(camera);
      const bw = bubble.offsetWidth, bx = clamp((projV.x * .5 + .5) * viewW, bw / 2 + 8, viewW - bw / 2 - 8), by = clamp((-projV.y * .5 + .5) * viewH, bubble.offsetHeight + 46, viewH - 40);
      bubble.style.transform = `translate3d(${bx}px,${by}px,0) translate(-50%,-100%)`;
    }
    compass.style.transform = `rotate(${yaw}rad)`;
    // adaptive resolution: trade sharpness for smoothness on slower devices
    frames++; frameTime += dt;
    if (frameTime > 2.5) { const avg = frameTime / frames; frames = 0; frameTime = 0; const next = avg > .026 ? Math.max(.7, pixelRatio * .85) : avg < .0135 ? Math.min(maxRatio, pixelRatio * 1.1) : pixelRatio; if (Math.abs(next - pixelRatio) > .02) { pixelRatio = next; resize3d(); } }
    hover();
    composer.render(dt);
    if (firstFrame) { firstFrame = false; glCanvas.classList.add('ready'); }
  }

  sync();
  if (window.LOCAL_DESIGN_MODE) window.world3d = { THREE, scene, camera, renderer, cam, look, talk, converse, bots, councils, setHour: h => { hourOverride = h; envDirty = true; }, bloom, get player() { return player; }, outfit: () => outfitId, motor, veer, cat, realms, sail, doSpot, doEmote, activity: () => act, currentRealm: () => realm, walkable, nearestWalkable, obstacles: () => obstacles, heightAt, sdfAt, pathDistAt, toW, toL };
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const draw2d = draw;
  // If the GPU drops the context or a frame throws, hand the map back to the original 2D renderer
  // so app.js's tick loop keeps running instead of leaving a blank or frozen world.
  function fallback2d(err) {
    if (!active) return;
    if (err) console.error('3D world stopped; showing the 2D map.', err);
    active = false; movementDriver = null; draw = draw2d;
    endTalk(); glCanvas.remove(); layer.remove(); compass.remove(); clock.remove(); bubble.remove(); bars.remove();
    botTalk = cardTalk; councilTalk = cardCouncil; regionDialog = cardRegion; frameEl.classList.remove('is-3d');
    canvas.setAttribute('aria-label', label2d); if (hint) hint.textContent = hint2d; resize();
  }
  draw = t => { try { render(t); } catch (err) { fallback2d(err); draw2d(t); } };
  glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fallback2d(); });
}

const webgl2 = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
if (webgl2 && typeof WORLD !== 'undefined' && typeof canvas !== 'undefined') {
  try { start(); } catch (err) { console.error('3D world unavailable; keeping the 2D map.', err); document.querySelector('.w3-canvas')?.remove(); }
}
