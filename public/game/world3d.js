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
const SCALE = 0.08, SPEED = 0.62;                       // metres per logical unit; walk speed relative to app.js
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
    const leafColors = { oak: ['#2a6424', '#86b842'], birch: ['#477f2b', '#b3cf55'], sakura: ['#d97ba2', '#ffd6e6'], sacred: ['#2f6d2e', '#9ccd5e'] };
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
const PLAYER_LOOK = { skin: '#c58c65', hair: '#2a2321', hairStyle: 'long', eyes: '#6b4430', top: '#efe4c8', sleeve: '#efe4c8', legs: '#4a4843', boots: '#5b4636', skirt: '#efe4c8', belt: '#d5b76e', cloak: true, staff: true, blush: true };

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
  const legs = [-1, 1].map(s => {
    const g = bone(body, s * .085, .86, 0);
    part(g, capsule(.068, .56), look.legs, [0, -.4, 0]);
    part(g, capsule(.078, .1), look.boots, [0, -.76, .03], { s: [1, 1, 1.25] });
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
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * .06, -.012, .149); e.rotation.y = s * .36; head.add(e);
    part(e, SPHERE, '#ffffff', [0, 0, 0], { s: [.031, .041, .012], basic: true });
    part(e, SPHERE, look.eyes, [0, -.004, .006], { s: [.023, .032, .01], basic: true });
    part(e, SPHERE, '#1a1210', [0, -.003, .011], { s: [.011, .017, .008], basic: true });
    part(e, SPHERE, '#ffffff', [-.008 * s, .011, .016], { s: [.0065, .0065, .004], basic: true });
    part(e, new THREE.BoxGeometry(.068, .012, .012), '#1d1513', [0, .039, .004], { r: [0, 0, -s * .12], basic: true });
    part(head, new THREE.BoxGeometry(.05, .01, .012), look.hair === '#c6a574' ? '#9b7a4c' : '#2b211d', [s * .062, .072, .152], { r: [0, s * .3, s * .1], basic: true });
    if (look.blush) part(head, SPHERE, '#f0a093', [s * .096, -.052, .136], { s: [.026, .013, .006], r: [0, s * .55, 0], basic: true });
  }
  part(head, SPHERE, '#8a4a42', [0, -.084, .158], { s: [.022, .008, .008], basic: true });
  if (look.visor) part(head, new THREE.BoxGeometry(.21, .048, .03), look.visor, [0, -.008, .158], { basic: true });
  if (look.glasses) { for (const s of [-1, 1]) part(head, new THREE.TorusGeometry(.034, .006, 6, 18), '#1e2420', [s * .062, -.012, .168], { basic: true }); part(head, new THREE.BoxGeometry(.04, .006, .006), '#1e2420', [0, -.006, .172], { basic: true }); }
  hair(head, look, part);
  let cloak = null, cloakMesh = null;
  if (look.cloak || look.cape) {
    // The cloak keeps its own material so the wardrobe can recolour it; it hangs from its own bone and sways.
    const geo = new THREE.CylinderGeometry(.21, look.cape ? .36 : .42, look.cape ? 1.08 : 1.02, 26, 1, true, Math.PI * .42, Math.PI * 1.16); geo.translate(0, -.5, 0);
    cloak = bone(body, 0, 1.42, -.01);
    cloakMesh = new THREE.Mesh(geo, toonMat(look.cape || palettes[state.equipped])); cloakMesh.castShadow = true; cloak.add(cloakMesh);
    if (look.cloak) part(trunk, new THREE.TorusGeometry(.14, .05, 8, 20, Math.PI), look.top, [0, 1.42, -.03], { r: [Math.PI / 2 + .3, 0, Math.PI], outline: false });
    if (look.cape) part(trunk, new THREE.CylinderGeometry(.12, .17, .2, 18, 1, true, Math.PI * .7, Math.PI * 1.6), look.cape, [0, 1.47, 0], { double: true });
  }
  if (look.staff) {
    const staff = new THREE.Group(); staff.position.set(0, -.45, .05); arms[0].add(staff);
    part(staff, new THREE.CylinderGeometry(.018, .024, 1.55, 8), '#8d6b45', [0, .35, 0]);
    part(staff, new THREE.TorusGeometry(.07, .014, 8, 20), '#d5b76e', [0, 1.12, 0], { outline: false });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.062, 18, 12), glow('#ffd979', 4)); orb.position.set(0, -.45 + 1.14, .05); arms[0].add(orb);
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
  return { root, body, legs, arms, head, cloak, cloakMesh, phase: Math.random() * 6, yaw: 0, wave: 0, give: 0 };
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
  ch.phase += dt * (3 + speed * 1.55);
  const swing = Math.sin(ch.phase) * .75 * s;
  ch.legs[0].rotation.x = swing; ch.legs[1].rotation.x = -swing;
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
    scene.add(isle);
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
    const pier = mergeGroup(k.g); pier.position.set(sx, 0, sz); scene.add(pier);
    const boat = new THREE.Group(), hull = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); hull.scale(.62, .4, 1.6);
    const hm = new THREE.Mesh(hull, M.wood); hm.castShadow = true; boat.add(hm);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, .06, .3), M.woodDark); seat.position.y = -.05; boat.add(seat);
    boat.position.set(sx + 1.9, .08, sz + len - 2.2); boat.rotation.y = .25; scene.add(boat);
    animated.push(t => { boat.position.y = .1 + Math.sin(t * 1.1) * .06; boat.rotation.z = Math.sin(t * .9) * .04; boat.rotation.x = Math.sin(t * .7) * .03; });
  }

  // Characters.
  const player = makeCharacter(PLAYER_LOOK, true); scene.add(player.root);
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
  const refreshObstacles = level => { obstacles = [...staticObstacles, ...treeObstacles, ...botObstacles(), ...(level >= 7 ? gateObstacles : [])]; };
  const walkable = (lx, ly) => { const [x, z] = toW(lx, ly); return sdfAt(x, z) > 1.1 && heightAt(x, z) < 12.5 && obstacles.every(o => (lx - o.x) ** 2 + (ly - o.y) ** 2 > o.r * o.r); };
  function nearestWalkable(p) {
    if (walkable(p.x, p.y)) return p;
    for (let r = 6; r < 260; r += 6) for (let a = 0; a < 24; a++) { const x = p.x + Math.cos(a / 24 * Math.PI * 2) * r, y = p.y + Math.sin(a / 24 * Math.PI * 2) * r; if (walkable(x, y)) return { x, y }; }
    return { x: 555, y: 390 };
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
        <div class="qs-rewards"><div><b>+${q.xp}</b><small>${esc(q.stat)} XP</small></div><div><b>+${coins}</b><small>Coins</small></div>${st ? `<div><b>Lv ${st.level}</b><small>${esc(shortName(giver))} levels with you</small></div>` : ''}</div>
        <p class="qs-note">“${esc(voice.note)}”<span>— ${esc(giver.name)}</span></p>
        ${done ? '<div class="qs-stamp">Completed today</div>' : ''}
        <div class="qs-actions">${done ? '<button type="button" class="primary" data-act="close">Close the scroll</button>' : '<button type="button" class="primary" data-act="accept">Accept quest ✦</button><button type="button" class="secondary" data-act="claim">I’ve done it · claim XP</button>'}<button type="button" class="secondary" data-act="another">Another quest</button><button type="button" class="qs-link" data-act="list">All of ${esc(shortName(giver))}’s quests</button></div>
      </div></div><div class="qs-rod"></div></div><button type="button" class="qs-close" aria-label="Close the scroll">×</button>`;
      document.body.append(el);
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
        if (act === 'accept') { await say(me, pickLine(['On it.', 'Accepted. I’ll bring proof.', 'Deal. Back soon.'])); toast('Quest accepted: ' + q.title); await say(host, pickLine(voice.ok)); break; }
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
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest?.('button')) { e.preventDefault(); e.stopPropagation(); talk.advance?.(); }
  }, true);

  // Pointer input: drag to orbit, pinch/scroll to zoom, click/tap to travel or interact.
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), pointers = new Map();
  let dragged = false, downAt = null, pinchStart = 0, hoverEvent = null;
  const toNdc = e => { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
  function pick(e) {
    toNdc(e); raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(proxies.filter(p => p.visible !== false).concat(bots.filter(o => o.proxy.visible).map(o => o.proxy)), false).sort((a, b) => (a.object.userData.kind === 'bot' ? -1 : 0) - (b.object.userData.kind === 'bot' ? -1 : 0) || a.distance - b.distance)[0];
    return hit ? hit.object.userData : null;
  }
  function groundPoint(e) {
    toNdc(e); raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    let prev = 0;
    for (let t = .5; t < 500; t += .25 + t * .012) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= Math.max(heightAt(x, z), 0)) { let lo = prev, hi = t; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= Math.max(heightAt(o.x + d.x * m, o.z + d.z * m), 0)) hi = m; else lo = m; } return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi); }
      prev = t;
    }
    return null;
  }
  frameEl.addEventListener('click', e => {
    if (!active || e.target !== canvas) return;
    e.stopPropagation(); canvas.focus();
    if (dragged) { dragged = false; return; }
    if (talk.on) { talk.advance?.(); return; }
    const hit = pick(e);
    if (hit?.kind === 'bot') { botTalk(hit.bot); return; }
    if (hit?.kind === 'council') { councilTalk(hit.council); return; }
    if (hit?.kind === 'area') { visit(hit.area.id); return; }
    const g = groundPoint(e); if (!g) return;
    const [lx, ly] = toL(g.x, g.z), target = nearestWalkable({ x: clamp(lx, 40, 1060), y: clamp(ly, 40, 690) });
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
      const level = E.level(E.total(state)), text = hit.kind === 'bot' ? hit.bot.name + ' · ' + hit.bot.role : hit.kind === 'council' ? hit.council.name + ' · ' + hit.council.role : hit.area.name + (level < hit.area.unlock ? ' · Unlock at level ' + hit.area.unlock : ' · Visit');
      canvas.style.cursor = 'pointer'; tip.hidden = false; tip.textContent = text;
      tip.style.left = Math.min(e.clientX - box.left + 12, box.width - 200) + 'px'; tip.style.top = Math.max(45, e.clientY - box.top - 40) + 'px';
    } else { canvas.style.cursor = 'grab'; tip.hidden = true; }
  }

  // Movement: app.js moves state.position on the logical map; here it is rotated to the camera, slowed to a
  // natural jog and kept out of buildings, trees and the sea.
  let prev = null, prevState = null, wasTravelling = false, stuck = 0;
  function constrainMovement(dt) {
    const p = state.position;
    if (state !== prevState || !prev) { prevState = state; Object.assign(p, nearestWalkable(p)); prev = { x: p.x, y: p.y }; wasTravelling = !!travel; return; }
    if (talk.on) { travel = null; p.x = prev.x; p.y = prev.y; return; }
    let dx = p.x - prev.x, dy = p.y - prev.y;
    const arrived = wasTravelling && !travel;
    if (Math.hypot(dx, dy) > 40) { Object.assign(p, nearestWalkable(p)); }
    else if ((dx || dy) && !arrived) {
      if (!travel && keys.size) { const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw); [dx, dy] = [dx * c + dy * s, -dx * s + dy * c]; }
      dx *= SPEED; dy *= SPEED;
      let nx = prev.x + dx, ny = prev.y + dy;
      if (!walkable(nx, ny)) { if (walkable(nx, prev.y)) ny = prev.y; else if (walkable(prev.x, ny)) nx = prev.x; else { nx = prev.x; ny = prev.y; } }
      p.x = nx; p.y = ny;
    }
    if (travel) { stuck = Math.hypot(p.x - prev.x, p.y - prev.y) < .4 ? stuck + dt : 0; if (stuck > .8) { const t = nearestWalkable({ x: travel.x, y: travel.y }); p.x = t.x; p.y = t.y; stuck = 0; } }
    prev = { x: p.x, y: p.y }; wasTravelling = !!travel;
  }

  // Frame loop (called by app.js tick through `draw`).
  let lastT = 0, firstFrame = true, frames = 0, frameTime = 0, envTimer = 0, clockTimer = 0;
  const worldPos = new THREE.Vector3();
  function render(t) {
    const dt = clamp(t - lastT, .001, .05); lastT = t;
    U.time.value = t;
    constrainMovement(dt);
    const [px, pz] = toW(state.position.x, state.position.y), py = heightAt(px, pz);
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
    animateCharacter(player, moved < 5 ? moved / dt : 0, dt, t);
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
    const blend = talk.on || talk.settle > 0 ? (reduceMotion.matches ? 1 : 1 - Math.exp(-dt * 3.2)) : 1;
    if (!talk.on && talk.settle > 0) talk.settle -= dt;
    view.yaw = lerpAngle(view.yaw, wantYaw, blend); view.pitch += (wantPitch - view.pitch) * blend; view.dist += (wantDist - view.dist) * blend;
    const yaw = view.yaw, pitch = view.pitch, dist = view.dist;
    cam.target.lerp(worldPos, reduceMotion.matches ? 1 : 1 - Math.exp(-dt * (talk.on ? 3.5 : 7)));
    camera.position.set(cam.target.x + Math.sin(yaw) * Math.cos(pitch) * dist, cam.target.y + Math.sin(pitch) * dist, cam.target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.position.y = Math.max(camera.position.y, Math.max(heightAt(camera.position.x, camera.position.z), 0) + 1.2);
    camera.lookAt(cam.target);
    sky.position.copy(camera.position);
    // sun shadow follows the view, snapped to texels to avoid shimmering
    const snap = 60 / Q.shadow, sx = Math.round(cam.target.x / snap) * snap, sz = Math.round(cam.target.z / snap) * snap;
    sun.target.position.set(sx, 0, sz); sun.position.copy(sun.target.position).addScaledVector(look.sun, 90); sun.target.updateMatrixWorld();
    motes.material.uniforms.uOrigin.value.copy(cam.target); flies.material.uniforms.uOrigin.value.set(cam.target.x, cam.target.y + 1, cam.target.z);
    for (const fn of animated) fn(t, dt);
    for (const bd of birds) { const a = t * .12 + bd.off; bd.g.position.set(Math.cos(a) * bd.rad, bd.h + Math.sin(t * .5 + bd.off) * 1.2, Math.sin(a) * bd.rad * .7 - 4); bd.g.rotation.y = -a; const f = Math.sin(t * 7 + bd.off * 3) * .5; bd.l.rotation.z = f; bd.r.rotation.z = -f; }
    for (const bf of flutter) { const tt = t * .5 + bf.seed; bf.g.position.set(bf.home[0] + Math.sin(tt * 1.3) * 2.2, heightAt(bf.home[0], bf.home[1]) + .7 + Math.sin(tt * 2.3) * .35, bf.home[1] + Math.cos(tt) * 2.2); bf.g.rotation.y = tt * 1.3 + Math.PI / 2; const f = Math.sin(t * 22 + bf.seed) * 1.1; bf.l.rotation.z = f; bf.r.rotation.z = f; }
    marker.visible = !!travel;
    if (travel) { const [mx, mz] = toW(travel.x, travel.y); marker.position.set(mx, Math.max(heightAt(mx, mz), 0) + .06, mz); const k = (t * 1.5) % 1; marker.scale.setScalar(.8 + k * .6); marker.material.opacity = .9 * (1 - k); }
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
    areaLabels.forEach(a => placeLabel(a.el, a.pos, 140, 3));
    botLabels.forEach(({ o, el }) => { if (!o.ch.root.visible) { fadeLabel(el, 0); return; } worldPos.copy(o.ch.root.position); worldPos.y += 2.55; placeLabel(el, worldPos, 34, 4); });
    worldPos.set(gate.position.x, gate.position.y + 7.4, gate.position.z); if (gate.visible) placeLabel(gateLabel, worldPos, 140, 3); else fadeLabel(gateLabel, 0);
    placeLabel(seaLabel, seaPos, 160, 0);
    councilLabels.forEach(({ o, el }) => { worldPos.copy(o.pos); worldPos.y += 3.2; placeLabel(el, worldPos, 32, 2); });
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
  if (window.LOCAL_DESIGN_MODE) window.world3d = { THREE, scene, camera, renderer, cam, look, talk, converse, bots, councils, setHour: h => { hourOverride = h; envDirty = true; }, bloom, walkable, nearestWalkable, obstacles: () => obstacles, heightAt, sdfAt, pathDistAt, toW, toL };
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const draw2d = draw;
  // If the GPU drops the context or a frame throws, hand the map back to the original 2D renderer
  // so app.js's tick loop keeps running instead of leaving a blank or frozen world.
  function fallback2d(err) {
    if (!active) return;
    if (err) console.error('3D world stopped; showing the 2D map.', err);
    active = false; draw = draw2d;
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
