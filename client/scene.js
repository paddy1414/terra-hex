// Terra Hex — 3D board. Renders whatever state it is given; it never decides game rules.
import * as THREE from 'three';
const RepeatWrapping = THREE.RepeatWrapping;
import { OrbitControls } from './vendor/OrbitControls.js';
import { pips } from '../shared/board.js';
import { iconDataUrl, RES_COLORS } from './icons.js';

const TILE_R = 0.985;      // tile radius (leaves a thin seam between tiles)
const TILE_H = 0.16;       // height of a tile's flat rim, where roads and buildings stand
const SQ3 = Math.sqrt(3);
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ noise & random
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 3) {
  let f = 0, amp = 0.5, fr = 1, norm = 0;
  for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, y * fr, s + i * 17); norm += amp; fr *= 2.03; amp *= 0.5; }
  return f / norm;
}
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Normalised hex distance: 0 at the centre, 1 on the tile's edge (pointy-top in the xz-plane). */
function hexRho(x, z) {
  const a = TILE_R * SQ3 / 2;
  return Math.max(Math.abs(x), Math.abs(x * 0.5 + z * SQ3 / 2), Math.abs(-x * 0.5 + z * SQ3 / 2)) / a;
}
/** Signed distance to a pointy-top hexagon of circumradius r centred at the origin. */
function sdHex(x, z, r) {
  const k = [-0.866025404, 0.5, 0.577350269];
  let px = Math.abs(z), py = Math.abs(x); // swap axes so flat sides face ±x
  const ap = r * SQ3 / 2;
  const d = 2 * Math.min(k[0] * px + k[1] * py, 0);
  px -= d * k[0]; py -= d * k[1];
  const cx = Math.min(Math.max(px, -k[2] * ap), k[2] * ap);
  px -= cx; py -= ap;
  return Math.hypot(px, py) * Math.sign(py);
}

// ------------------------------------------------------------------ geometry helpers
const tmpColor = new THREE.Color();
function colored(geom, color) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function merge(list) {
  let n = 0;
  list.forEach(g => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  list.forEach(g => {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += c;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
function mergeWithUv(list) {
  const geos = list.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  geos.forEach(g => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  geos.forEach(g => {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
function mergeGeos(list) {
  let n = 0;
  list.forEach(g => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  list.forEach(g => {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + g.attributes.position.count) * 3);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
function jitter(geom, amt, seed) {
  const p = geom.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round(x * 997 + y * 631 + z * 389);
    p.setXYZ(i, x + (hash2(k, 1, seed) - 0.5) * amt, y + (hash2(k, 2, seed) - 0.5) * amt * 0.6, z + (hash2(k, 3, seed) - 0.5) * amt);
  }
  geom.computeVertexNormals();
  return geom;
}

// ------------------------------------------------------------------ model library
function makeConifer() {
  return merge([
    colored(at(new THREE.CylinderGeometry(0.018, 0.026, 0.1, 5), 0, 0.05, 0), '#5d3b22'),
    colored(at(new THREE.ConeGeometry(0.11, 0.16, 7), 0, 0.15, 0), '#2f6a33'),
    colored(at(new THREE.ConeGeometry(0.085, 0.14, 7), 0, 0.24, 0), '#367a3a'),
    colored(at(new THREE.ConeGeometry(0.058, 0.12, 7), 0, 0.32, 0), '#3f8a41')
  ]);
}
function makeBroadleaf() {
  return merge([
    colored(at(new THREE.CylinderGeometry(0.016, 0.024, 0.12, 5), 0, 0.06, 0), '#5d3b22'),
    colored(jitter(at(new THREE.IcosahedronGeometry(0.1, 0), 0, 0.19, 0), 0.03, 3), '#4b8c3e'),
    colored(jitter(at(new THREE.IcosahedronGeometry(0.065, 0), 0.05, 0.24, 0.02), 0.02, 5), '#5a9d47')
  ]);
}
function makeBush() { return colored(jitter(new THREE.IcosahedronGeometry(0.05, 0), 0.02, 7), '#4f8a3b'); }
function makeRock() { return colored(jitter(new THREE.DodecahedronGeometry(0.045, 0), 0.025, 11), '#8a8780'); }
function makeWheat(n = 5) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = 0.012;
    const stalk = new THREE.CylinderGeometry(0.003, 0.004, 0.1, 3);
    stalk.rotateZ((Math.cos(a)) * 0.15); stalk.rotateX(Math.sin(a) * 0.15);
    parts.push(colored(at(stalk, Math.cos(a) * r, 0.05, Math.sin(a) * r), '#b8902f'));
    const ear = new THREE.ConeGeometry(0.009, 0.04, 4);
    ear.rotateX(Math.PI);
    ear.rotateX(Math.PI);
    parts.push(colored(at(ear, Math.cos(a) * r * 2.2, 0.115, Math.sin(a) * r * 2.2), '#e8c351'));
  }
  return merge(parts);
}
function makeSheep() {
  const legs = [];
  [[-0.03, -0.018], [-0.03, 0.018], [0.03, -0.018], [0.03, 0.018]].forEach(([x, z]) => {
    legs.push(colored(at(new THREE.BoxGeometry(0.012, 0.04, 0.012), x, 0.02, z), '#2b2622'));
  });
  const body = new THREE.IcosahedronGeometry(0.05, 1); body.scale(1.25, 0.85, 0.9);
  const head = new THREE.BoxGeometry(0.035, 0.035, 0.03);
  return merge([
    ...legs,
    colored(jitter(at(body, 0, 0.068, 0), 0.008, 21), '#f3efe4'),
    colored(at(head, 0.064, 0.082, 0), '#2b2622'),
    colored(at(new THREE.BoxGeometry(0.012, 0.012, 0.05), 0.058, 0.098, 0), '#2b2622')
  ]);
}
function makeHayBale() {
  const g = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8);
  g.rotateZ(Math.PI / 2);
  return colored(at(g, 0, 0.04, 0), '#d9b65a');
}
function makePeak(seed, h, r) {
  const g = new THREE.ConeGeometry(r, h, 7, 3);
  jitter(g, r * 0.35, seed);
  g.translate(0, h / 2, 0);
  const ng = g.toNonIndexed();
  const p = ng.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const t = y / h;
    const n = hash2(i, seed, 5);
    if (t > 0.68) tmpColor.set('#f2f4f6');
    else if (t > 0.58 && n > 0.4) tmpColor.set('#dfe3e8');
    else tmpColor.set(n > 0.5 ? '#6f7680' : '#7d848e').multiplyScalar(0.85 + t * 0.3);
    for (let k = 0; k < 3; k++) col.set([tmpColor.r, tmpColor.g, tmpColor.b], (i + k) * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.computeVertexNormals();
  return ng;
}
function makeCactus() {
  const arm1 = new THREE.CylinderGeometry(0.014, 0.014, 0.06, 6);
  const arm2 = new THREE.CylinderGeometry(0.013, 0.013, 0.05, 6);
  return merge([
    colored(at(new THREE.CylinderGeometry(0.022, 0.026, 0.17, 7), 0, 0.085, 0), '#5c8a46'),
    colored(at(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 6).rotateZ(Math.PI / 2), 0.03, 0.08, 0), '#5c8a46'),
    colored(at(arm1, 0.05, 0.11, 0), '#649550'),
    colored(at(new THREE.CylinderGeometry(0.011, 0.011, 0.035, 6).rotateZ(Math.PI / 2), -0.028, 0.06, 0), '#5c8a46'),
    colored(at(arm2, -0.046, 0.085, 0), '#649550')
  ]);
}
function makeDeadBush() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.003, 0.005, 0.07, 3);
    g.rotateZ(Math.cos(i * 1.3) * 0.7); g.rotateX(Math.sin(i * 1.9) * 0.7);
    parts.push(colored(at(g, 0, 0.03, 0), '#8a6a45'));
  }
  return merge(parts);
}
function makeClayPit() {
  return merge([
    colored(at(new THREE.CylinderGeometry(0.075, 0.085, 0.012, 9), 0, 0.004, 0), '#8f4426'),
    colored(at(new THREE.CylinderGeometry(0.05, 0.06, 0.008, 9), 0, 0.011, 0), '#6e2f19')
  ]);
}
function makeBrickStack() {
  const parts = [];
  for (let y = 0; y < 3; y++) for (let i = 0; i < 3 - y; i++) {
    parts.push(colored(at(new THREE.BoxGeometry(0.036, 0.016, 0.022), (i - (2 - y) / 2) * 0.038, 0.009 + y * 0.017, 0), y % 2 ? '#a9472a' : '#bb5634'));
  }
  return merge(parts);
}
function makeOreCrystal() {
  const g = new THREE.OctahedronGeometry(0.03, 0); g.scale(0.8, 1.6, 0.8);
  return colored(at(g, 0, 0.03, 0), '#86c6e0');
}
function makeFlower() { return colored(new THREE.IcosahedronGeometry(0.012, 0), '#ffffff'); }
function makeLog() {
  const g = new THREE.CylinderGeometry(0.018, 0.018, 0.14, 6); g.rotateZ(Math.PI / 2);
  return colored(at(g, 0, 0.018, 0), '#6b4a2c');
}

function makeHull(len, wid, hgt, color) {
  const s = new THREE.Shape();
  s.moveTo(-len / 2, -wid / 2);
  s.lineTo(len * 0.18, -wid / 2);
  s.quadraticCurveTo(len * 0.45, -wid * 0.42, len / 2, 0);
  s.quadraticCurveTo(len * 0.45, wid * 0.42, len * 0.18, wid / 2);
  s.lineTo(-len / 2, wid / 2);
  s.lineTo(-len / 2, -wid / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: hgt, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return colored(g, color);
}
/** A thin spar or rope between two points. */
function lineGeo(a, b, r) {
  const v = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, v.length(), 4);
  g.translate(0, v.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
const sailTexCache = new Map();
function sailTexture(color) {
  const key = String(color instanceof THREE.Color ? color.getHexString() : color);
  if (sailTexCache.has(key)) return sailTexCache.get(key);
  const c = new THREE.Color(color);
  const t = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = `#${c.getHexString()}`; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(0, 18, 64, 7); ctx.fillRect(0, 40, 64, 7);
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1;
    for (let x = 8; x < 64; x += 11) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(70,40,20,.5)'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, 61, 61);
  });
  sailTexCache.set(key, t);
  return t;
}
function billowSail(w, h, depth, segs = 5) {
  const g = new THREE.PlaneGeometry(w, h, segs, segs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, depth * (1 - Math.pow(x / (w / 2), 2)) * (1 - Math.pow(y / (h / 2), 2) * 0.6));
  }
  g.computeVertexNormals();
  g.rotateY(Math.PI / 2);
  return g;
}
function makeShip(scale, sailColor, seed = 1) {
  const S = scale, len = 0.46 * S, wid = 0.15 * S, hh = 0.06 * S;
  const deckY = hh + 0.008 * S;
  const parts = [
    makeHull(len, wid, hh, '#5e3a20'),
    colored(at(makeHull(len * 1.01, wid * 1.04, 0.016 * S, '#8f2d22'), 0, -0.004 * S, 0), '#8f2d22'), // waterline paint
    colored(at(new THREE.BoxGeometry(len * 0.82, 0.008 * S, wid * 1.03), -len * 0.06, hh * 0.72, 0), '#a7783f') // gold-brown wale stripe
  ];
  // deck planks
  for (let k = 0; k < 6; k++) parts.push(colored(at(new THREE.BoxGeometry(len * 0.76, 0.005 * S, wid * 0.12), -len * 0.05, deckY, (k - 2.5) * wid * 0.13), k % 2 ? '#b0854f' : '#a07443'));
  // railings
  for (let k = 0; k < 7; k++) {
    const x = -len * 0.42 + k * len * 0.11;
    [-1, 1].forEach(sd => parts.push(colored(at(new THREE.BoxGeometry(0.005 * S, 0.024 * S, 0.005 * S), x, deckY + 0.012 * S, sd * wid * 0.46), '#4a2e18')));
  }
  [-1, 1].forEach(sd => parts.push(colored(at(new THREE.BoxGeometry(len * 0.7, 0.005 * S, 0.006 * S), -len * 0.09, deckY + 0.025 * S, sd * wid * 0.46), '#6b4528')));
  // stern cabin with roof
  parts.push(colored(at(new THREE.BoxGeometry(len * 0.22, 0.05 * S, wid * 0.7), -len * 0.34, deckY + 0.025 * S, 0), '#7d5532'));
  parts.push(colored(at(new THREE.BoxGeometry(len * 0.25, 0.008 * S, wid * 0.78), -len * 0.34, deckY + 0.054 * S, 0), '#4a2e18'));
  // masts, yards, bowsprit, crow's nest
  const mainX = len * 0.02, foreX = len * 0.26;
  parts.push(colored(lineGeo(new THREE.Vector3(mainX, deckY, 0), new THREE.Vector3(mainX, 0.5 * S, 0), 0.007 * S), '#4a3220'));
  parts.push(colored(lineGeo(new THREE.Vector3(foreX, deckY, 0), new THREE.Vector3(foreX, 0.36 * S, 0), 0.006 * S), '#4a3220'));
  [[mainX, 0.42], [mainX, 0.17], [foreX, 0.3], [foreX, 0.13]].forEach(([x, y]) => parts.push(colored(lineGeo(new THREE.Vector3(x, y * S, -wid * 0.75), new THREE.Vector3(x, y * S, wid * 0.75), 0.004 * S), '#4a3220')));
  parts.push(colored(lineGeo(new THREE.Vector3(len * 0.42, hh, 0), new THREE.Vector3(len * 0.7, hh + 0.07 * S, 0), 0.005 * S), '#4a3220'));
  parts.push(colored(at(new THREE.CylinderGeometry(0.02 * S, 0.016 * S, 0.018 * S, 8), mainX, 0.45 * S, 0), '#5e3a20'));
  // rigging
  const rope = '#2e2418';
  [[new THREE.Vector3(mainX, 0.48 * S, 0), new THREE.Vector3(-len * 0.48, deckY + 0.02 * S, 0)],
   [new THREE.Vector3(mainX, 0.48 * S, 0), new THREE.Vector3(foreX, 0.34 * S, 0)],
   [new THREE.Vector3(foreX, 0.34 * S, 0), new THREE.Vector3(len * 0.7, hh + 0.07 * S, 0)],
   [new THREE.Vector3(mainX, 0.4 * S, 0), new THREE.Vector3(mainX - 0.02 * S, deckY, wid * 0.48)],
   [new THREE.Vector3(mainX, 0.4 * S, 0), new THREE.Vector3(mainX - 0.02 * S, deckY, -wid * 0.48)]
  ].forEach(([a, b]) => parts.push(colored(lineGeo(a, b, 0.0018 * S), rope)));
  const ship = new THREE.Group();
  const lit = '#ffd987';
  [-1, 1].forEach(sd => parts.push(colored(at(new THREE.BoxGeometry(0.018 * S, 0.014 * S, 0.004 * S), -len * 0.34, deckY + 0.028 * S, sd * wid * 0.355), lit)));
  parts.push(colored(at(new THREE.BoxGeometry(0.014 * S, 0.018 * S, 0.014 * S), -len * 0.5, deckY + 0.07 * S, 0), lit));
  parts.push(colored(at(new THREE.BoxGeometry(0.004 * S, 0.035 * S, 0.06 * S).rotateY(Math.PI / 2), mainX - 0.03 * S, 0.53 * S, 0), new THREE.Color(sailColor)));
  parts.push(colored(at(new THREE.BoxGeometry(0.045 * S, 0.014 * S, 0.003 * S), foreX - 0.022 * S, 0.37 * S, 0), '#c9a227'));
  const body = new THREE.Mesh(merge(parts), WOOD_MAT);
  body.castShadow = true;
  ship.add(body);
  const tex = sailTexture(sailColor);
  const sailMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, side: THREE.DoubleSide, roughness: 0.85, flatShading: true });
  // All three sails share one mesh (uv kept for the stripes).
  const mainG = billowSail(0.22 * S, 0.24 * S, 0.035 * S).translate(mainX + 0.006 * S, 0.295 * S, 0);
  const foreG = billowSail(0.17 * S, 0.16 * S, 0.026 * S).translate(foreX + 0.006 * S, 0.215 * S, 0);
  const jibG = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.17 * S, 0), new THREE.Vector2(0, 0.2 * S)])).translate(foreX + 0.01 * S, hh + 0.04 * S, 0.002);
  const sailGeo = mergeWithUv([mainG, foreG, jibG]);
  const sails = new THREE.Mesh(sailGeo, sailMat);
  sails.castShadow = true;
  ship.add(sails);
  ship.userData = { flag: null, seed, sails: [sails] };
  return ship;
}

// ------------------------------------------------------------------ materials & textures
const STD = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...opts });
const VCOL = STD({ vertexColors: true, flatShading: true });
const WOOD_MAT = STD({ vertexColors: true, flatShading: true, roughness: 0.9 });

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function cobbleTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#8a7a63'; ctx.fillRect(0, 0, w, h);
    const r = rng(77);
    for (let y = 0; y < h; y += 13) {
      for (let x = (y / 13) % 2 ? -8 : 0; x < w; x += 18) {
        const l = 120 + r() * 50;
        ctx.fillStyle = `rgb(${l + 20},${l + 8},${l - 12})`;
        ctx.beginPath();
        ctx.roundRect(x + 1.5, y + 1.5, 15 + r() * 2, 10, 3);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(70,50,30,.25)'; ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, h - 3, w, 3);
  });
}
/** Light cobbles with dark joints: multiplied by the player's colour, it becomes a coloured road. */
function cobbleTintTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#6e6e6e'; ctx.fillRect(0, 0, w, h);
    const r = rng(91);
    for (let y = 0; y < h; y += 13) {
      for (let x = (y / 13) % 2 ? -8 : 0; x < w; x += 18) {
        const l = 215 + r() * 40;
        ctx.fillStyle = `rgb(${l},${l},${l})`;
        ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, 15 + r() * 2, 10, 3); ctx.fill();
      }
    }
  });
}
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  _glowTex = canvasTexture(64, 64, (ctx) => { const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); });
  return _glowTex;
}
const TOKEN_ORDER = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
let _tokenAtlas = null;
/** Every number token face in one texture (4 × 3 cells), so all tokens draw together. */
function tokenAtlas() {
  if (_tokenAtlas) return _tokenAtlas;
  _tokenAtlas = canvasTexture(1024, 768, (ctx) => {
    ctx.fillStyle = '#b48f4f'; ctx.fillRect(0, 0, 1024, 768);
    TOKEN_ORDER.forEach((n, k) => {
      const ox = (k % 4) * 256, oy = Math.floor(k / 4) * 256;
      ctx.save(); ctx.translate(ox, oy);
      const g = ctx.createRadialGradient(128, 110, 20, 128, 128, 128);
      g.addColorStop(0, '#fbf3dc'); g.addColorStop(1, '#e8d6a8');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 126, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b48f4f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(128, 128, 114, 0, Math.PI * 2); ctx.stroke();
      const red = n === 6 || n === 8;
      ctx.fillStyle = red ? '#b3261e' : '#2a1f14';
      ctx.font = `800 ${n >= 10 ? 124 : 146}px "Alegreya SC", Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 128, 112);
      const dots = pips(n);
      for (let i = 0; i < dots; i++) { ctx.beginPath(); ctx.arc(128 + (i - (dots - 1) / 2) * 21, 200, 8, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    });
  });
  _tokenAtlas.anisotropy = 8;
  return _tokenAtlas;
}
const tokenCache = new Map();
function tokenTexture(n) {
  if (tokenCache.has(n)) return tokenCache.get(n);
  const tex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#b48f4f'; ctx.fillRect(0, 0, 256, 256); // the token's edge colour, sampled by its sides
    const g = ctx.createRadialGradient(128, 110, 20, 128, 128, 128);
    g.addColorStop(0, '#fbf3dc'); g.addColorStop(1, '#e8d6a8');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 128, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b48f4f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(128, 128, 116, 0, Math.PI * 2); ctx.stroke();
    const red = n === 6 || n === 8;
    ctx.fillStyle = red ? '#b3261e' : '#2a1f14';
    ctx.font = `800 ${n >= 10 ? 124 : 146}px "Alegreya SC", Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 128, 112);
    const k = pips(n);
    for (let i = 0; i < k; i++) {
      ctx.beginPath(); ctx.arc(128 + (i - (k - 1) / 2) * 21, 200, 8, 0, Math.PI * 2); ctx.fill();
    }
  });
  tokenCache.set(n, tex);
  return tex;
}
const PORT_LABEL = { any: 'any', wood: 'wood', brick: 'brick', sheep: 'sheep', wheat: 'wheat', ore: 'ore' };
/** Harbour sign: a resource-coloured badge, the ratio in large type and what it trades. */
function portSignTexture(port, owned = false) {
  const ratio = port.type === 'any' ? '3:1' : '2:1';
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const accent = RES_COLORS[port.type];
  const draw = (img) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 320, 128);
    ctx.fillStyle = owned ? 'rgba(60,44,12,.96)' : 'rgba(36,24,16,.94)';
    ctx.beginPath(); ctx.roundRect(6, 8, 308, 112, 30); ctx.fill();
    ctx.lineWidth = owned ? 9 : 6;
    ctx.strokeStyle = owned ? '#ffd76b' : accent;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(66, 64, 44, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fbf3dd';
    ctx.beginPath(); ctx.arc(66, 64, 37, 0, Math.PI * 2); ctx.fill();
    if (img) ctx.drawImage(img, 33, 31, 66, 66);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fbf3dd';
    ctx.font = '800 64px "Alegreya SC", Georgia, serif';
    ctx.fillText(ratio, 124, 78);
    ctx.font = '700 25px "Alegreya Sans", system-ui, sans-serif';
    ctx.fillStyle = owned ? '#ffd76b' : '#e7d6ab';
    ctx.fillText(owned ? `yours · ${PORT_LABEL[port.type]}` : PORT_LABEL[port.type], 126, 106);
    tex.needsUpdate = true;
  };
  draw(null);
  const img = new Image();
  img.onload = () => draw(img);
  img.src = iconDataUrl(port.type);
  return tex;
}

export const SYMBOLS = ['circle', 'triangle', 'square', 'diamond', 'star', 'cross'];
function drawSymbol(ctx, symbol, cx, cy, r) {
  ctx.beginPath();
  if (symbol === 'circle') ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  else if (symbol === 'triangle') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.95, cy + r * 0.72); ctx.lineTo(cx - r * 0.95, cy + r * 0.72); }
  else if (symbol === 'square') ctx.rect(cx - r * 0.72, cy - r * 0.72, r * 1.44, r * 1.44);
  else if (symbol === 'diamond') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy); }
  else if (symbol === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 ? r * 0.42 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } }
  else if (symbol === 'cross') { const w = r * 0.36; ctx.rect(cx - w, cy - r, w * 2, r * 2); ctx.rect(cx - r, cy - w, r * 2, w * 2); }
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------ terrain painters
const PALETTE = {
  pasture: ['#7fb04a', '#8dbd52', '#73a443', '#9ac65d'],
  forest: ['#3f6f33', '#477a37', '#365f2d', '#557f3c'],
  fields: ['#d8a93a', '#e3b84a', '#caa035', '#edc55c'],
  hills: ['#b25a34', '#a24d2c', '#bf6a3f', '#94452a'],
  mountains: ['#7b818a', '#6c727b', '#8a9099', '#5f656e'],
  desert: ['#e2c88f', '#d8bb7c', '#ead39d', '#cfb170'],
  gold: ['#b8742a', '#c98432', '#a8652a', '#d6913a'],
  sea: ['#2b6f86', '#2b6f86', '#2b6f86', '#2b6f86']
};
const RIM = { pasture: '#6f9a40', forest: '#3b6230', fields: '#b98e2f', hills: '#97482a', mountains: '#676d75', desert: '#cdb27a', gold: '#8a4f18', sea: '#2b6f86' };

/** Optional seasonal looks for generated maps. Resource identity stays readable in all of them. */
export function biomeTint(c, terrain, biome, n = 0.5) {
  if (!biome || biome === 'temperate') return c;
  const hsl = c.getHSL({});
  if (biome === 'autumn') {
    if (terrain === 'pasture') c.setHSL(hsl.h - 0.035, hsl.s * 0.9, hsl.l);
    else if (terrain === 'forest' || terrain === 'tree') c.setHSL(n > 0.45 ? 0.07 + n * 0.05 : hsl.h - 0.04, Math.min(1, hsl.s * 1.25), hsl.l * 1.05);
  } else if (biome === 'winter') {
    c.lerp(new THREE.Color('#eef3f7'), terrain === 'tree' ? 0.12 : 0.16);
    if (terrain !== 'tree' && n > 0.68) c.lerp(new THREE.Color('#ffffff'), 0.55);
  } else if (biome === 'arid') {
    if (terrain === 'pasture' || terrain === 'forest' || terrain === 'tree') c.setHSL(Math.max(0.13, hsl.h - 0.08), hsl.s * 0.75, Math.min(0.75, hsl.l * 1.12));
    if (terrain === 'desert') c.multiplyScalar(1.05);
  } else if (biome === 'tropical') {
    if (terrain === 'pasture' || terrain === 'forest' || terrain === 'tree') c.setHSL(hsl.h + 0.04, Math.min(1, hsl.s * 1.3), hsl.l);
    else c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l);
  }
  return c;
}

function makePainter(hex, seed, biome) {
  const t = hex.terrain;
  const pal = PALETTE[t].map(c => new THREE.Color(c));
  const rim = new THREE.Color(RIM[t]);
  const rowAngle = hash2(seed, 3, 9) * Math.PI;
  const ca = Math.cos(rowAngle), sa = Math.sin(rowAngle);
  // A winding path for forests and fields, from one side toward the clearing.
  const pa = hash2(seed, 5, 2) * Math.PI * 2;
  const path = [[Math.cos(pa) * 0.95, Math.sin(pa) * 0.95], [Math.cos(pa + 0.6) * 0.55, Math.sin(pa + 0.6) * 0.55], [Math.cos(pa) * 0.3, Math.sin(pa) * 0.3]];
  const pathDist = (x, z) => {
    let best = 9;
    for (let i = 0; i <= 12; i++) {
      const u = i / 12, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      const px = a * path[0][0] + b * path[1][0] + c * path[2][0];
      const pz = a * path[0][1] + b * path[1][1] + c * path[2][1];
      best = Math.min(best, Math.hypot(x - px, z - pz));
    }
    return best;
  };
  const height = (x, z) => {
    const rho = hexRho(x, z);
    const r = Math.hypot(x, z);
    const edge = smooth(0.95, 0.8, rho);
    const clear = smooth(0.26, 0.42, r);
    // Flat ground around every corner so settlements, cities and knights sit cleanly.
    let cd = 9;
    for (let i = 0; i < 6; i++) { const a = (60 * i - 30) * D2R; cd = Math.min(cd, Math.hypot(x - Math.cos(a) * TILE_R, z - Math.sin(a) * TILE_R)); }
    const m = edge * clear * smooth(0.2, 0.42, cd);
    const n = fbm(x * 2.2 + seed, z * 2.2 - seed, seed);
    switch (t) {
      case 'pasture': return m * (0.03 + 0.07 * n);
      case 'forest': return m * (0.02 + 0.05 * n);
      case 'fields': return m * 0.012 * (1 + Math.sin((x * ca + z * sa) * 46));
      case 'hills': return m * (0.03 + 0.2 * Math.pow(n, 1.6));
      case 'mountains': return m * (0.04 + 0.18 * n);
      case 'desert': return m * (0.02 + 0.06 * (0.5 + 0.5 * Math.sin((x * ca + z * sa) * 7 + n * 4)));
      default: return 0;
    }
  };
  const color = (x, z, h) => {
    const rho = hexRho(x, z);
    if (rho > 0.9) return biomeTint(rim.clone().multiplyScalar(0.92 + hash2(Math.round(x * 50), Math.round(z * 50), seed) * 0.1), t, biome === 'winter' ? 'tree' : biome);
    const n = fbm(x * 3.1 - seed, z * 3.1 + seed, seed + 3);
    const pick = pal[Math.min(3, Math.floor(n * 4))].clone();
    const r = Math.hypot(x, z);
    if (r < 0.34 && t !== 'desert') pick.lerp(new THREE.Color(t === 'mountains' ? '#9aa0a8' : t === 'hills' ? '#c98559' : '#a9b56a'), 0.35);
    if (t === 'fields') {
      const row = Math.floor(((x * ca + z * sa) * 46) / Math.PI);
      if (row % 2) pick.multiplyScalar(0.92);
    }
    if ((t === 'forest' || t === 'fields') && pathDist(x, z) < 0.045) pick.set(t === 'forest' ? '#7a6447' : '#a07b47');
    if (t === 'hills' && h > 0.13) pick.lerp(new THREE.Color('#8d7c6e'), 0.5);
    if (t === 'mountains' && h > 0.12) pick.lerp(new THREE.Color('#a3a8ae'), 0.4);
    pick.multiplyScalar(0.94 + hash2(Math.round(x * 40), Math.round(z * 40), seed + 7) * 0.12);
    return biomeTint(pick, t, biome, n);
  };
  return { height, color, pathDist };
}

/** Builds a faceted terrain patch for one hex, in world space. */
function hexPatch(hex, painter, n) {
  const pos = [], col = [];
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const a = (60 * i - 30) * D2R;
    corners.push([TILE_R * Math.cos(a), TILE_R * Math.sin(a)]);
  }
  const pt = (i, a, b) => {
    const c1 = corners[i], c2 = corners[(i + 1) % 6];
    const x = (c1[0] * a + c2[0] * b) / n, z = (c1[1] * a + c2[1] * b) / n;
    return [x, painter.height(x, z), z];
  };
  const tri = (p1, p2, p3) => {
    const cx = (p1[0] + p2[0] + p3[0]) / 3, cz = (p1[2] + p2[2] + p3[2]) / 3, ch = (p1[1] + p2[1] + p3[1]) / 3;
    const c = painter.color(cx, cz, ch);
    // Counter-clockwise when seen from above.
    const ux = p2[0] - p1[0], uz = p2[2] - p1[2], vx = p3[0] - p1[0], vz = p3[2] - p1[2];
    const up = uz * vx - ux * vz > 0;
    const seq = up ? [p1, p2, p3] : [p1, p3, p2];
    seq.forEach(p => { pos.push(p[0] + hex.wx, p[1] + TILE_H, p[2] + hex.wz); col.push(c.r, c.g, c.b); });
  };
  for (let i = 0; i < 6; i++) {
    for (let a = 0; a < n; a++) {
      for (let b = 0; a + b < n; b++) {
        tri(pt(i, a, b), pt(i, a + 1, b), pt(i, a, b + 1));
        if (a + b + 1 < n) tri(pt(i, a + 1, b), pt(i, a + 1, b + 1), pt(i, a, b + 1));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ the scene
/** Graphics levels. Auto picks one from the device and steps down if the frame rate drops. */
export const QUALITY = {
  high: { label: 'High', pixelRatio: 2, shadows: true, shadowSize: 2048, shadowEvery: 2, density: 1, water: 150, wildlife: true, fx: true, fps: 60 },
  balanced: { label: 'Balanced', pixelRatio: 1.5, shadows: true, shadowSize: 1024, shadowEvery: 5, density: 0.6, water: 90, wildlife: true, fx: true, fps: 60 },
  low: { label: 'Battery saver', pixelRatio: 1, shadows: false, shadowSize: 512, shadowEvery: 0, density: 0.32, water: 48, wildlife: false, fx: false, fps: 30 }
};
export function autoQuality() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  if ((coarse && (cores <= 6 || mem <= 4)) || cores <= 2 || mem <= 2) return 'low';
  if (coarse || cores <= 4 || mem <= 4) return 'balanced';
  return 'high';
}

export class BoardScene {
  constructor(canvas, { onPick, onHover } = {}) {
    this.canvas = canvas;
    this.onPick = onPick || (() => {});
    this.onHover = onHover || (() => {});
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.setting = 'auto';
    this.qualityKey = autoQuality();
    this.q = QUALITY[this.qualityKey];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.autoUpdate = false; // refreshed on our own schedule (see _frame)
    this.frameNo = 0; this.fpsSamples = []; this.lastFrameAt = 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.fogColor = new THREE.Color('#9cc9d3');
    this.scene.background = this.fogColor;
    this.scene.fog = new THREE.Fog(this.fogColor, 22, 48);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, minDistance: 6, maxDistance: 22,
      minPolarAngle: 0.25, maxPolarAngle: 1.12, rotateSpeed: 0.6, zoomSpeed: 0.9, panSpeed: 0.8, screenSpacePanning: false
    });
    this.controls.addEventListener('change', () => {
      const t = this.controls.target;
      const r = Math.hypot(t.x, t.z);
      const lim = this.bounds ? Math.max(this.bounds.halfX, this.bounds.halfZ) - 0.5 : 4.5;
      if (r > lim) { t.x *= lim / r; t.z *= lim / r; }
      t.y = 0;
    });

    const hemi = new THREE.HemisphereLight('#e6f3ff', '#6b5536', 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff0d6', 2.4);
    sun.position.set(-5, 12, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 34 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.015;
    this.scene.add(sun);
    this.sun = sun;

    this.time = { value: 0 };
    this.anims = [];
    this.pieces = { roads: new Map(), buildings: new Map(), nodes: new Map() };
    this.highlight = { kind: null, ids: [], meshes: [], ghost: null };
    this.hoverId = null;
    this.pieceMats = new Map();
    this.pickGroups = { vertex: [], edge: [], hex: [] };

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._bindPointer();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement || canvas);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------------------------------------------------------------- board construction
  setBoard(board) {
    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      this.boardGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.board = board;
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.pieces = { roads: new Map(), buildings: new Map(), nodes: new Map() };
    this.pieceGroup = new THREE.Group();
    this.boardGroup.add(this.pieceGroup);
    this.hexes = board.hexes.map(h => ({ ...h, wx: h.x, wz: h.y }));
    // Board extent (tile edges included) drives the sea, shadows, camera and panning.
    this.land = this.hexes.filter(h => h.terrain !== 'sea');
    const xs = this.land.map(h => h.wx), zs = this.land.map(h => h.wz);
    this.bounds = { minX: Math.min(...xs) - 1, maxX: Math.max(...xs) + 1, minZ: Math.min(...zs) - 1, maxZ: Math.max(...zs) + 1 };
    this.bounds.halfX = Math.max(-this.bounds.minX, this.bounds.maxX);
    this.bounds.halfZ = Math.max(-this.bounds.minZ, this.bounds.maxZ);
    this.bounds.radius = Math.hypot(this.bounds.halfX, this.bounds.halfZ);
    const sh = this.sun.shadow.camera, ext = Math.max(this.bounds.halfX, this.bounds.halfZ) + 2;
    Object.assign(sh, { left: -ext, right: ext, top: ext, bottom: -ext, far: 40 + ext * 2 });
    this.sun.position.set(-5, 12, 7).normalize().multiplyScalar(14 + ext);
    sh.updateProjectionMatrix();
    this.barbGroup = null; this.merchant = null; this._merchantKey = ''; this._recent = []; this._roadBadges = [];
    if (this.pieces) { this.pieces.knights = new Map(); this.pieces.ships = new Map(); }
    this.pirate = null; this.pirateHex = null; this.robberFx = null; this.pirateFx = null; this.smoke = null; this._smokeSources = [];
    this.roadBody = this.roadEdge = this.nodeTop = this.nodeEdge = null;
    this.biome = board.custom?.biome || 'temperate';
    this.density = ({ sparse: 0.5, normal: 1, dense: 1.6 }[board.custom?.trees] || 1) * this.q.density;
    this.painters = this.hexes.map(h => makePainter(h, h.id * 131 + 7, this.biome));
    this.scenery = new THREE.Group();
    this.boardGroup.add(this.scenery);
    this.classic = new THREE.Group();
    this.classic.visible = false;
    this.boardGroup.add(this.classic);

    this._buildSeaAndBeach();
    this._buildTiles();
    this._buildDecor();
    this._buildTokens();
    this._buildHarbours();
    this._buildRobber();
    this._buildPickers();
    this._buildBoats();
    if (this.q.wildlife) this._buildWildlife(); else this.birds = [];
    this._buildClassic();
    this.setStyle(this.style || 'tabletop', true);
  }

  _buildSeaAndBeach() {
    // Distance from every point to the island (union of land hexes).
    const landDist = (x, z) => {
      let d = Infinity;
      for (const h of this.land) d = Math.min(d, sdHex(x - h.wx, z - h.wz, 1.0));
      return d;
    };
    this.landDist = landDist;
    // Seabed and beach, faceted.
    const SIZE = 2 * (Math.max(this.bounds.halfX, this.bounds.halfZ) + 2.6);
    const N = Math.min(180, Math.round(SIZE * ({ high: 7, balanced: 5, low: 3.5 }[this.qualityKey] || 5)));
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const d = landDist(x, z) + (fbm(x * 1.4, z * 1.4, 41) - 0.5) * 0.22;
      let y;
      if (d < 0) y = 0.06;
      else if (d < 0.3) y = 0.06 - d * 0.28;
      else y = 0.06 - 0.084 - (d - 0.3) * 0.75;
      p.setY(i, Math.max(y, -1.1) + (fbm(x * 3, z * 3, 9) - 0.5) * 0.03);
    }
    const beach = geo.toNonIndexed();
    const bp = beach.attributes.position;
    const col = new Float32Array(bp.count * 3);
    const dry = new THREE.Color('#e7d09a'), wet = new THREE.Color('#c7a66f'), deep = new THREE.Color('#2e6d73'), mid = new THREE.Color('#5ea39a');
    for (let i = 0; i < bp.count; i += 3) {
      const y = (bp.getY(i) + bp.getY(i + 1) + bp.getY(i + 2)) / 3;
      if (y > 0.015) tmpColor.copy(dry);
      else if (y > -0.04) tmpColor.copy(wet);
      else if (y > -0.35) tmpColor.copy(mid).lerp(wet, smooth(-0.35, -0.04, y));
      else tmpColor.copy(deep);
      tmpColor.multiplyScalar(0.95 + hash2(i, 3, 4) * 0.08);
      for (let k = 0; k < 3; k++) col.set([tmpColor.r, tmpColor.g, tmpColor.b], (i + k) * 3);
    }
    beach.setAttribute('color', new THREE.BufferAttribute(col, 3));
    beach.computeVertexNormals();
    const beachMesh = new THREE.Mesh(beach, VCOL);
    beachMesh.receiveShadow = true;
    this.boardGroup.add(beachMesh);

    // Distance texture for the water shader (shallows and foam).
    const SPAN = 2 * (Math.max(this.bounds.halfX, this.bounds.halfZ) + 8);
    const TEX = Math.min(320, Math.round(SPAN * 7));
    const data = new Uint8Array(TEX * TEX * 4);
    for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
      const x = (i / (TEX - 1) - 0.5) * SPAN, z = (j / (TEX - 1) - 0.5) * SPAN;
      const d = Math.max(0, Math.min(4, landDist(x, z)));
      const k = (j * TEX + i) * 4;
      data[k] = Math.round((d / 4) * 255); data[k + 3] = 255;
    }
    const distTex = new THREE.DataTexture(data, TEX, TEX);
    distTex.magFilter = THREE.LinearFilter; distTex.minFilter = THREE.LinearFilter;
    distTex.needsUpdate = true;

    const seaSize = Math.max(80, SPAN * 3);
    const water = new THREE.PlaneGeometry(seaSize, seaSize, this.q.water, this.q.water);
    water.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: this.time, uDist: { value: distTex }, uSpan: { value: SPAN },
        uFog: { value: this.fogColor }, uFogNear: { value: 22 }, uFogFar: { value: 48 },
        uSun: { value: new THREE.Vector3(-5, 12, 7).normalize() }
      },
      vertexShader: `
        uniform float uTime; uniform sampler2D uDist; uniform float uSpan;
        varying vec2 vXZ; varying float vD; varying vec3 vN; varying float vView; varying vec3 vWorld;
        void main() {
          vec3 p = position;
          vec2 uv = p.xz / uSpan + 0.5;
          float d = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 4.0 : texture2D(uDist, uv).r * 4.0;
          float amp = mix(0.25, 1.0, smoothstep(0.0, 1.5, d));
          float w1 = sin(p.x * 1.1 + uTime * 0.9) * 0.028;
          float w2 = sin(p.z * 1.6 - uTime * 0.75 + p.x * 0.3) * 0.022;
          float w3 = sin((p.x + p.z) * 3.1 + uTime * 1.6) * 0.008;
          p.y += (w1 + w2 + w3) * amp;
          float dx = (cos(p.x * 1.1 + uTime * 0.9) * 0.0308 + cos((p.x + p.z) * 3.1 + uTime * 1.6) * 0.0248) * amp;
          float dz = (cos(p.z * 1.6 - uTime * 0.75 + p.x * 0.3) * 0.0352 + cos((p.x + p.z) * 3.1 + uTime * 1.6) * 0.0248) * amp;
          vN = normalize(vec3(-dx, 1.0, -dz));
          vXZ = p.xz; vD = d; vWorld = p;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform vec3 uSun;
        varying vec2 vXZ; varying float vD; varying vec3 vN; varying float vView; varying vec3 vWorld;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main() {
          vec3 shallow = vec3(0.30, 0.74, 0.74);
          vec3 mid = vec3(0.10, 0.48, 0.60);
          vec3 deep = vec3(0.05, 0.25, 0.42);
          vec3 col = mix(shallow, mid, smoothstep(0.0, 0.9, vD));
          col = mix(col, deep, smoothstep(0.9, 3.2, vD));
          // ripples
          float r = n2(vXZ * 3.0 + vec2(uTime * 0.25, uTime * 0.18)) * n2(vXZ * 5.0 - vec2(uTime * 0.2, -uTime * 0.12));
          col += vec3(0.05, 0.07, 0.07) * smoothstep(0.35, 0.6, r);
          // foam bands around the coast
          float band = sin(vD * 22.0 - uTime * 1.8) * 0.5 + 0.5;
          float foam = smoothstep(0.32, 0.02, vD) * smoothstep(0.55, 0.95, band + n2(vXZ * 8.0 + uTime * 0.3) * 0.35);
          foam += smoothstep(0.07, 0.0, vD) * 0.8;
          col = mix(col, vec3(0.97, 0.98, 0.96), clamp(foam, 0.0, 1.0) * 0.85);
          // sun glint
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float spec = pow(max(dot(reflect(-uSun, vN), viewDir), 0.0), 60.0);
          col += vec3(1.0, 0.95, 0.85) * spec * 0.45;
          float alpha = mix(0.5, 1.0, smoothstep(0.0, 2.2, vD));
          alpha = max(alpha, clamp(foam, 0.0, 1.0));
          float fogF = smoothstep(uFogNear, uFogFar, vView);
          gl_FragColor = vec4(mix(col, uFog, fogF), alpha);
          #include <colorspace_fragment>
        }`
    });
    this.seaUniforms = mat.uniforms;
    const sea = new THREE.Mesh(water, mat);
    sea.position.y = 0.0;
    sea.renderOrder = 2;
    this.boardGroup.add(sea);

    // Coastal rocks.
    const r = rng(404);
    const rocks = [];
    const B = this.bounds;
    const rockTarget = Math.round(70 * Math.max(1, ((B.maxX - B.minX) * (B.maxZ - B.minZ)) / 60));
    for (let i = 0; i < rockTarget * 30 && rocks.length < rockTarget; i++) {
      const x = B.minX - 0.6 + r() * (B.maxX - B.minX + 1.2), z = B.minZ - 0.6 + r() * (B.maxZ - B.minZ + 1.2);
      const d = landDist(x, z);
      if (d > 0.08 && d < 0.4) rocks.push([x, z, 0.8 + r() * 1.8, r() * 6]);
    }
    const rockGeo = colored(jitter(new THREE.DodecahedronGeometry(0.06, 0), 0.04, 12), '#8f8b82');
    const inst = new THREE.InstancedMesh(rockGeo, VCOL, rocks.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    rocks.forEach(([x, z, sc, rot], i) => {
      q.setFromEuler(new THREE.Euler(rot, rot * 1.7, rot * 0.3));
      m.compose(new THREE.Vector3(x, -0.01, z), q, s.set(sc, sc * 0.7, sc));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, tmpColor.setHSL(0.08, 0.06, 0.45 + (i % 5) * 0.05));
    });
    inst.castShadow = true; inst.receiveShadow = true;
    this.boardGroup.add(inst);
  }

  _buildTiles() {
    const tops = [], sides = [];
    this.hexes.forEach((h, i) => {
      if (h.terrain === 'sea') return;
      const n = h.terrain === 'mountains' || h.terrain === 'hills' ? 12 : 10;
      tops.push(hexPatch(h, this.painters[i], n));
      const side = new THREE.CylinderGeometry(TILE_R, TILE_R * 1.015, TILE_H - 0.02, 6, 1, true);
      side.translate(h.wx, (TILE_H - 0.02) / 2 + 0.02, h.wz);
      sides.push(colored(side, h.terrain === 'desert' ? '#a88a5a' : '#6e5134'));
    });
    const topMesh = new THREE.Mesh(merge(tops.map(g => { if (!g.attributes.normal) g.computeVertexNormals(); return g; })), VCOL);
    topMesh.receiveShadow = true;
    topMesh.castShadow = true;
    this.scenery.add(topMesh);
    const sideMesh = new THREE.Mesh(merge(sides), VCOL);
    sideMesh.receiveShadow = true;
    this.boardGroup.add(sideMesh);

    // Territory rings: tinted by whoever produces most from a tile (toggle in the toolbar).
    this.territory = this.hexes.map(h => {
      const ring = new THREE.RingGeometry(0.84, 0.955, 6, 1, Math.PI / 6);
      ring.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
      mesh.position.set(h.wx, TILE_H + 0.012, h.wz);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.boardGroup.add(mesh);
      return mesh;
    });

    // Glow rings used to flash a tile when it produces.
    this.hexGlows = this.hexes.map(h => {
      const ring = new THREE.RingGeometry(0.78, 0.97, 6, 1, Math.PI / 6);
      ring.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, depthWrite: false }));
      mesh.position.set(h.wx, TILE_H + 0.03, h.wz);
      mesh.renderOrder = 5;
      mesh.visible = false;
      this.boardGroup.add(mesh);
      return mesh;
    });
  }

  /** Random points inside a hex, away from its rim (roads) and its centre (number token). */
  _scatter(hex, count, minGap, seed, filter) {
    const r = rng(seed);
    const pts = [];
    for (let tries = 0; tries < count * 30 && pts.length < count; tries++) {
      const x = (r() * 2 - 1) * 0.9, z = (r() * 2 - 1) * 0.9;
      const rho = hexRho(x, z);
      if (rho > 0.78 || Math.hypot(x, z) < 0.38) continue;
      let nearCorner = false;
      for (let i = 0; i < 6 && !nearCorner; i++) { const a = (60 * i - 30) * D2R; if (Math.hypot(x - Math.cos(a) * TILE_R, z - Math.sin(a) * TILE_R) < 0.36) nearCorner = true; }
      if (nearCorner) continue;
      if (filter && !filter(x, z)) continue;
      if (pts.some(p => Math.hypot(p[0] - x, p[1] - z) < minGap)) continue;
      pts.push([x, z]);
    }
    return pts.map(([x, z]) => ({ x: x + hex.wx, z: z + hex.wz, lx: x, lz: z, y: TILE_H + this.painters[hex.id].height(x, z), r }));
  }

  _buildDecor() {
    const sets = {};
    const add = (name, geoFn, mat, p, scale, rotY, color, extra = {}) => {
      const s = (sets[name] ||= { geo: geoFn(), mat, items: [], ...extra });
      s.items.push({ p, scale, rotY, color });
    };
    const swayMat = (amp, speed) => {
      const m = STD({ vertexColors: true, flatShading: true });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.time;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float sw = sin(uTime * ${speed.toFixed(2)} + ip.x * 2.1 + ip.z * 1.7) + 0.45 * sin(uTime * ${(speed * 2.3).toFixed(2)} + ip.x * 3.7 - ip.z);
          float k = max(transformed.y, 0.0);
          transformed.x += sw * ${amp.toFixed(3)} * k;
          transformed.z += sw * ${(amp * 0.6).toFixed(3)} * k;`);
      };
      return m;
    };
    const treeMat = swayMat(0.09, 1.3);
    const wheatMat = swayMat(0.5, 2.2);
    const green = (r) => biomeTint(tmpColor.setHSL(0.27 + (r() - 0.5) * 0.06, 0.45 + r() * 0.15, 0.85 + r() * 0.25).clone(), 'tree', this.biome, r());
    const D = this.density;
    const k = (n) => Math.max(0, Math.round(n * D));
    this.sheep = [];

    this.hexes.forEach((h, i) => {
      const seed = h.id * 977 + 13;
      const painter = this.painters[i];
      const r = rng(seed);
      const notPath = (x, z) => painter.pathDist(x, z) > 0.09;
      // Tall things stay out of the strip in front of the token (as seen from the default camera).
      const clearView = (x, z) => !(z > -0.05 && Math.abs(x) < 0.42 && z < 0.75) && Math.hypot(x, z) > 0.45 && !(z < 0 && hexRho(x, z) > 0.64);
      if (h.terrain === 'forest') {
        this._scatter(h, k(24), 0.13 / Math.sqrt(D), seed, (x, z) => notPath(x, z) && clearView(x, z)).forEach(p => {
          const conifer = p.r() < 0.6;
          add(conifer ? 'conifer' : 'broadleaf', conifer ? makeConifer : makeBroadleaf, treeMat, p, 0.7 + p.r() * 0.35, p.r() * 6.3, green(p.r));
        });
        this._scatter(h, k(12), 0.08, seed + 1, notPath).forEach(p => add('bush', makeBush, VCOL, p, 0.8 + p.r() * 0.7, p.r() * 6, green(p.r)));
        this._scatter(h, 4, 0.1, seed + 2).forEach(p => add('rock', makeRock, VCOL, p, 0.8 + p.r(), p.r() * 6, tmpColor.setHSL(0.1, 0.05, 0.5 + p.r() * 0.15).clone()));
        if (r() < 0.7) this._scatter(h, 1, 0.1, seed + 3, notPath).forEach(p => add('log', makeLog, VCOL, p, 1, p.r() * 6, null));
      } else if (h.terrain === 'pasture') {
        this._scatter(h, k(18), 0.06, seed, null).forEach(p => {
          const c = ['#f4e46a', '#ffffff', '#e889b3', '#b9a3ef'][Math.floor(p.r() * 4)];
          add('flower', makeFlower, VCOL, p, 0.8 + p.r() * 0.6, 0, new THREE.Color(c));
        });
        this._scatter(h, 4, 0.12, seed + 4).forEach(p => add('bush', makeBush, VCOL, p, 0.6 + p.r() * 0.5, p.r() * 6, green(p.r)));
        // fence along an arc
        const a0 = r() * Math.PI * 2;
        for (let k = 0; k < 9; k++) {
          const a = a0 + k * 0.17;
          const x = Math.cos(a) * 0.6, z = Math.sin(a) * 0.6;
          if (hexRho(x, z) > 0.8) continue;
          const p = { x: h.wx + x, z: h.wz + z, y: TILE_H + painter.height(x, z) };
          add('post', () => colored(at(new THREE.BoxGeometry(0.014, 0.07, 0.014), 0, 0.035, 0), '#7a5634'), VCOL, p, 1, 0, null);
          if (k < 8) {
            const b = a + 0.085;
            const pr = { x: h.wx + Math.cos(b) * 0.6, z: h.wz + Math.sin(b) * 0.6, y: TILE_H + painter.height(Math.cos(b) * 0.6, Math.sin(b) * 0.6) };
            add('rail', () => merge([
              colored(at(new THREE.BoxGeometry(0.105, 0.01, 0.008), 0, 0.045, 0), '#8c6640'),
              colored(at(new THREE.BoxGeometry(0.105, 0.01, 0.008), 0, 0.022, 0), '#8c6640')
            ]), VCOL, pr, 1, -b + Math.PI / 2, null);
          }
        }
        this._scatter(h, 4, 0.18, seed + 5).forEach(p => {
          this.sheep.push({ hex: h, home: { x: p.lx, z: p.lz }, x: p.lx, z: p.lz, heading: p.r() * 6.3, target: null, wait: p.r() * 4, bob: p.r() * 6 });
        });
      } else if (h.terrain === 'fields') {
        const ang = hash2(h.id * 131 + 7, 3, 9) * Math.PI;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        let k = 0;
        const wStep = 1 / Math.sqrt(Math.max(0.2, this.q.density));
        for (let u = -0.85; u <= 0.85; u += 0.068 * wStep) {
          for (let v = -0.85; v <= 0.85; v += 0.055 * wStep) {
            const x = u * ca - v * sa, z = u * sa + v * ca;
            if (hexRho(x, z) > 0.78 || Math.hypot(x, z) < 0.38 || painter.pathDist(x, z) < 0.07) continue;
            const jx = (hash2(k, 1, h.id) - 0.5) * 0.02, jz = (hash2(k, 2, h.id) - 0.5) * 0.02;
            k++;
            const p = { x: h.wx + x + jx, z: h.wz + z + jz, y: TILE_H + painter.height(x, z) };
            add('wheat', () => makeWheat(this.qualityKey === 'high' ? 5 : 3), wheatMat, p, 0.8 + hash2(k, 3, h.id) * 0.5, hash2(k, 4, h.id) * 6, tmpColor.setHSL(0.12 + hash2(k, 5, h.id) * 0.02, 0.7, 0.9 + hash2(k, 6, h.id) * 0.2).clone());
          }
        }
        if (r() < 0.8) this._scatter(h, 2, 0.15, seed + 6, notPath).forEach(p => add('hay', makeHayBale, VCOL, p, 1, p.r() * 6, null));
      } else if (h.terrain === 'hills') {
        this._scatter(h, 3, 0.2, seed).forEach(p => add('clay', makeClayPit, VCOL, p, 0.8 + p.r() * 0.6, p.r() * 6, null));
        this._scatter(h, 2, 0.2, seed + 1).forEach(p => add('bricks', makeBrickStack, VCOL, p, 1.1, p.r() * 6, null));
        this._scatter(h, 9, 0.1, seed + 2).forEach(p => add('rock', makeRock, VCOL, p, 0.9 + p.r() * 1.2, p.r() * 6, tmpColor.setHSL(0.05, 0.35, 0.45 + p.r() * 0.1).clone()));
        this._scatter(h, 5, 0.12, seed + 3).forEach(p => add('bush', makeBush, VCOL, p, 0.6 + p.r() * 0.4, p.r() * 6, tmpColor.setHSL(0.22, 0.35, 0.75).clone()));
      } else if (h.terrain === 'mountains') {
        // Peaks only behind or beside the token so they never hide it from the default camera.
        const angles = [-60, -120, 0, 180, -90].map((a, i) => (a + (i === 4 ? 0 : (r() - 0.5) * 16)) * D2R);
        const count = 3 + Math.floor(r() * 2);
        for (let k = 0; k < count; k++) {
          const a = angles[k], rad = 0.46 + r() * 0.07;
          const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
          const hgt = (k === 0 ? 0.5 : 0.34) + r() * 0.12;
          const peak = new THREE.Mesh(makePeak(h.id * 10 + k, hgt, 0.21 + r() * 0.05), VCOL);
          peak.position.set(h.wx + x, TILE_H + painter.height(x, z) - 0.02, h.wz + z);
          peak.rotation.y = r() * 6;
          peak.updateMatrix();
          const pg = peak.geometry.clone(); pg.applyMatrix4(peak.matrix);
          (this._peakGeos ||= []).push(pg);
        }
        this._scatter(h, 5, 0.12, seed + 1, (x, z) => z > -0.1).forEach(p => add('ore', makeOreCrystal, STD({ vertexColors: true, flatShading: true, metalness: 0.4, roughness: 0.35, emissive: '#1b4d63', emissiveIntensity: 0.35 }), p, 0.8 + p.r() * 0.7, p.r() * 6, null));
        this._scatter(h, 7, 0.1, seed + 2).forEach(p => add('rock', makeRock, VCOL, p, 0.9 + p.r() * 1.3, p.r() * 6, tmpColor.setHSL(0.6, 0.05, 0.5 + p.r() * 0.15).clone()));
      } else if (h.terrain === 'gold') {
        // Gold field: nugget piles and glinting quartz.
        this._scatter(h, 18, 0.09, seed).forEach(p => add('nugget', () => colored(jitter(new THREE.DodecahedronGeometry(0.035, 0), 0.02, 31), '#ffd24a'), STD({ vertexColors: true, flatShading: true, metalness: 0.75, roughness: 0.25, emissive: '#7a4f00', emissiveIntensity: 0.45 }), p, 0.8 + p.r() * 0.9, p.r() * 6, null));
        this._scatter(h, 6, 0.12, seed + 1).forEach(p => add('rock', makeRock, VCOL, p, 0.8 + p.r(), p.r() * 6, tmpColor.setHSL(0.11, 0.3, 0.55).clone()));
        this._scatter(h, 3, 0.2, seed + 2).forEach(p => add('ore', makeOreCrystal, STD({ vertexColors: true, flatShading: true, metalness: 0.4, roughness: 0.3, emissive: '#5a3d00', emissiveIntensity: 0.4 }), p, 1, p.r() * 6, new THREE.Color('#fff2b0')));
      } else if (h.terrain === 'desert') {
        this._scatter(h, 4, 0.18, seed, clearView).forEach(p => add('cactus', makeCactus, VCOL, p, 0.8 + p.r() * 0.5, p.r() * 6, null));
        this._scatter(h, 6, 0.12, seed + 1).forEach(p => add('dead', makeDeadBush, VCOL, p, 0.8 + p.r() * 0.6, p.r() * 6, null));
        this._scatter(h, 6, 0.1, seed + 2).forEach(p => add('rock', makeRock, VCOL, p, 0.7 + p.r(), p.r() * 6, tmpColor.setHSL(0.09, 0.25, 0.7 + p.r() * 0.1).clone()));
      }
    });

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    Object.entries(sets).forEach(([name, set]) => {
      const inst = new THREE.InstancedMesh(set.geo, set.mat, set.items.length);
      set.items.forEach((it, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rotY);
        m.compose(pos.set(it.p.x, it.p.y, it.p.z), q, sc.setScalar(it.scale));
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, it.color || tmpColor.set('#ffffff'));
      });
      inst.castShadow = ['conifer', 'broadleaf', 'cactus', 'hay', 'bricks'].includes(name) || (this.qualityKey === 'high' && ['bush', 'rock', 'log'].includes(name));
      inst.receiveShadow = !['wheat', 'flower', 'nugget'].includes(name);
      this.scenery.add(inst);
    });

    // All mountain peaks in one mesh.
    if (this._peakGeos && this._peakGeos.length) {
      const peaks = new THREE.Mesh(mergeGeos(this._peakGeos), VCOL);
      peaks.castShadow = true; peaks.receiveShadow = true;
      this.scenery.add(peaks);
    }
    this._peakGeos = [];
    // Sheep get their own instanced mesh because they move.
    this.sheepMesh = new THREE.InstancedMesh(makeSheep(), VCOL, Math.max(1, this.sheep.length));
    this.sheepMesh.count = this.sheep.length;
    this.sheepMesh.castShadow = true;
    this.sheepMesh.frustumCulled = false;
    this.scenery.add(this.sheepMesh);
    this._updateSheep(0);
  }

  /** All number tokens in one instanced mesh, reading from a single atlas texture. */
  _buildTokens() {
    this.tokens = new Map();
    const numbered = this.hexes.filter(h => h.number);
    const g = new THREE.CylinderGeometry(0.27, 0.28, 0.045, 40);
    const uv = g.attributes.uv;
    g.groups.forEach(gr => { if (gr.materialIndex !== 1) for (let i = gr.start; i < gr.start + gr.count; i++) uv.setXY(g.index.getX(i), 0.01, 0.01); });
    g.clearGroups();
    const cells = new Float32Array(Math.max(1, numbered.length) * 2);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    const mat = new THREE.MeshStandardMaterial({ map: tokenAtlas(), roughness: 0.75 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec2 aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * vec2(0.25, 1.0 / 3.0) + aCell;\n#endif');
    };
    this.tokenMesh = new THREE.InstancedMesh(g, mat, Math.max(1, numbered.length));
    this.tokenMesh.castShadow = true; this.tokenMesh.receiveShadow = true;
    numbered.forEach((h, i) => {
      this.tokens.set(h.id, { index: i, number: h.number, base: TILE_H + 0.03, x: h.wx, z: h.wz, scale: 1 });
      this._setTokenCell(i, h.number);
      this.tokenMesh.setColorAt(i, tmpColor.set('#ffffff'));
    });
    this.tokenMesh.count = numbered.length;
    this._tokenMatrices();
    this.boardGroup.add(this.tokenMesh);
  }
  _setTokenCell(i, n) {
    const k = TOKEN_ORDER.indexOf(n);
    const col = k % 4, row = Math.floor(k / 4);
    const a = this.tokenMesh.geometry.attributes.aCell;
    a.setXY(i, col * 0.25, 1 - (row + 1) / 3);
    a.needsUpdate = true;
  }
  _tokenMatrices() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), sc = new THREE.Vector3(), p = new THREE.Vector3();
    this.tokens.forEach(t => {
      m.compose(p.set(t.x, t.base + (t.lift || 0), t.z), q, sc.set(t.scale, 1, t.scale));
      this.tokenMesh.setMatrixAt(t.index, m);
    });
    this.tokenMesh.instanceMatrix.needsUpdate = true;
  }


  _buildHarbours() {
    this.harbours = [];
    const plankMat = WOOD_MAT;
    this.board.ports.forEach(port => {
      const e = this.board.edges[port.edge];
      const va = this.board.vertices[port.vertices[0]], vb = this.board.vertices[port.vertices[1]];
      const nx = port.nx, nz = port.ny;
      const tx = -nz, tz = nx; // along the coast
      const g = new THREE.Group();
      // Local frame: +x points out to sea, +z along the coast; origin at the edge midpoint.
      g.position.set(e.x, 0, e.y);
      g.rotation.y = Math.atan2(-nz, nx);
      const parts = [];
      const L = 0.95, W = 0.17, deckY = 0.085;
      for (let k = 0; k < 11; k++) {
        const x = 0.16 + k * (L - 0.16) / 10.5;
        const shade = ['#9b7046', '#8d6440', '#a7794d'][k % 3];
        parts.push(colored(at(new THREE.BoxGeometry(0.068, 0.018, W), x, deckY, 0), shade));
      }
      parts.push(colored(at(new THREE.BoxGeometry(L - 0.16, 0.02, 0.018), (L + 0.16) / 2, deckY - 0.018, W / 2 - 0.01), '#6a4a2c'));
      parts.push(colored(at(new THREE.BoxGeometry(L - 0.16, 0.02, 0.018), (L + 0.16) / 2, deckY - 0.018, -W / 2 + 0.01), '#6a4a2c'));
      for (let k = 0; k < 4; k++) {
        const x = 0.24 + k * 0.23;
        [-1, 1].forEach(s => parts.push(colored(at(new THREE.CylinderGeometry(0.014, 0.016, 0.42, 6), x, deckY - 0.17, s * (W / 2 + 0.004)), '#5a3d24')));
      }
      // Boardwalks to the two harbour intersections, so both eligible settlement spots read as connected.
      [va, vb].forEach(v => {
        const lx = (v.x - e.x) * nx + (v.y - e.y) * nz + 0.1;
        const lz = (v.x - e.x) * tx + (v.y - e.y) * tz;
        const sx = lx * 0.62, sz = lz * 0.62; // stop short of the building spot
        const dx = 0.17 - sx, dz = -sz;
        const len = Math.hypot(dx, dz);
        const steps = Math.max(2, Math.round(len / 0.06));
        const ang = Math.atan2(dz, dx);
        for (let k = 0; k < steps; k++) {
          const u = (k + 0.5) / steps;
          const b = new THREE.BoxGeometry(0.05, 0.014, 0.085);
          b.rotateY(-ang);
          parts.push(colored(at(b, sx + dx * u, 0.07 + 0.012 * u, sz + dz * u), k % 2 ? '#94693f' : '#a3774a'));
        }
      });
      // Cargo.
      const r = rng(port.id * 33 + 5);
      for (let k = 0; k < 3; k++) {
        const c = new THREE.BoxGeometry(0.06, 0.06, 0.06);
        c.rotateY(r() * 0.6);
        parts.push(colored(at(c, 0.25 + k * 0.07, deckY + 0.04 + (k === 2 ? 0.06 : 0), (k === 2 ? 0.04 : -0.045) + r() * 0.01), k % 2 ? '#b8874f' : '#a3733f'));
      }
      for (let k = 0; k < 2; k++) {
        parts.push(colored(at(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 8), 0.42 + k * 0.06, deckY + 0.04, 0.05), '#7c5330'));
        parts.push(colored(at(new THREE.CylinderGeometry(0.027, 0.027, 0.006, 8), 0.42 + k * 0.06, deckY + 0.04, 0.05), '#3a3a3a'));
      }
      const coil = new THREE.TorusGeometry(0.022, 0.007, 4, 10); coil.rotateX(Math.PI / 2);
      parts.push(colored(at(coil, 0.82, deckY + 0.014, -0.05), '#c9b27d'));
      // Mooring bollards & lamp.
      parts.push(colored(at(new THREE.CylinderGeometry(0.012, 0.014, 0.03, 6), 0.9, deckY + 0.02, 0.06), '#3d3d3d'));
      parts.push(colored(at(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 5), 0.18, deckY + 0.1, -0.075), '#3a2a1c'));
      parts.push(colored(at(new THREE.BoxGeometry(0.03, 0.035, 0.03), 0.18, deckY + 0.215, -0.075), '#ffe08a'));
      parts.push(colored(at(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 5), 0.3, deckY + 0.15, W / 2 - 0.02), '#4a3220'));
      const pier = new THREE.Mesh(merge(parts), plankMat);
      pier.castShadow = true; pier.receiveShadow = true;
      g.add(pier);
      g.userData.pier = pier;
      // Flag with the harbour's colour.
      const flagColor = RES_COLORS[port.type];
      const flag = new THREE.Mesh(colored(new THREE.BoxGeometry(0.1, 0.06, 0.004), flagColor), plankMat);
      flag.position.set(0.35, deckY + 0.27, W / 2 - 0.02);
      g.add(flag);
      g.userData.flagMesh = flag;
      // The moored ship.
      const sail = port.type === 'any' ? '#f4ecd8' : new THREE.Color(flagColor).lerp(new THREE.Color('#ffffff'), 0.35);
      const ship = makeShip(0.9, sail, port.id);
      ship.position.set(0.66, -0.02, -W / 2 - 0.13);
      ship.rotation.y = 0.04;
      g.add(ship);
      // Ratio sign (always faces the camera).
      // Constant on-screen size (sizeAttenuation off) so the sign stays readable on big maps and zoomed out.
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: portSignTexture(port), depthTest: false, transparent: true, sizeAttenuation: false, toneMapped: false }));
      sign.scale.set(0.07, 0.028, 1);
      sign.position.set(0.82, 0.5, 0.05);
      sign.userData = { kind: 'port', id: port.id };
      sign.renderOrder = 20;
      g.add(sign);
      const ownRing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 32), new THREE.MeshBasicMaterial({ color: '#ffd76b', transparent: true, opacity: 0, depthWrite: false }));
      ownRing.rotation.x = -Math.PI / 2;
      ownRing.position.set(0.82, 0.02, 0.05);
      g.add(ownRing);
      this.boardGroup.add(g);
      this.harbours.push({ port, group: g, ship, flag, sign, ownRing, owned: false, seed: r() * 6 });
    });
    // All piers and flags in one mesh (they never move).
    const geos = [];
    let pmat = null;
    this.boardGroup.updateMatrixWorld(true);
    const toBoard = new THREE.Matrix4().copy(this.boardGroup.matrixWorld).invert();
    this.harbours.forEach(h => {
      h.group.updateMatrixWorld(true);
      [h.group.userData.pier, h.group.userData.flagMesh].forEach(m => {
        if (!m) return;
        pmat = pmat || m.material;
        const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toBoard, m.matrixWorld));
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geos.push(geo);
        m.parent.remove(m);
      });
    });
    if (geos.length) {
      const piers = new THREE.Mesh(mergeGeos(geos), pmat);
      piers.castShadow = true; piers.receiveShadow = true;
      this.boardGroup.add(piers);
      this.harbourPiers = piers;
    }
  }

  /** The robber: a hooded thief with glowing eyes and a sack of loot, on a dark base. */
  _buildRobber() {
    const g = new THREE.Group();
    const cloth = STD({ color: '#3d3650', roughness: 0.75, flatShading: true, emissive: '#120d1c', emissiveIntensity: 0.35, side: THREE.DoubleSide });
    const leather = STD({ color: '#6b4a30', roughness: 0.8, flatShading: true });
    const dark = STD({ color: '#1a1614', roughness: 0.7, flatShading: true });
    const steel = STD({ color: '#cfd5dc', metalness: 0.8, roughness: 0.25 });
    const trim = STD({ color: '#7a2230', roughness: 0.6, flatShading: true });
    const add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); return m; };
    // base
    add(new THREE.CylinderGeometry(0.15, 0.16, 0.03, 24), STD({ color: '#18151c', roughness: 0.6 }), 0, 0.015, 0);
    const ring = add(new THREE.TorusGeometry(0.152, 0.01, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d33a2c', toneMapped: false }), 0, 0.032, 0);
    // boots and legs
    [-1, 1].forEach(sd => {
      add(new THREE.BoxGeometry(0.045, 0.035, 0.07), dark, sd * 0.032, 0.05, 0.012);
      add(new THREE.CylinderGeometry(0.019, 0.022, 0.12, 7), leather, sd * 0.03, 0.12, 0);
    });
    // body: jerkin, belt, pouch
    const jerkin = [[0, 0.17], [0.06, 0.17], [0.068, 0.22], [0.062, 0.3], [0.072, 0.33], [0.045, 0.36], [0, 0.365]].map(([x, y]) => new THREE.Vector2(x, y));
    add(new THREE.LatheGeometry(jerkin, 12), leather, 0, 0, 0);
    add(new THREE.TorusGeometry(0.064, 0.009, 6, 16).rotateX(Math.PI / 2), dark, 0, 0.215, 0);
    add(new THREE.BoxGeometry(0.02, 0.018, 0.008), STD({ color: '#c9a227', metalness: 0.7, roughness: 0.3 }), 0, 0.215, 0.066);
    add(new THREE.SphereGeometry(0.026, 8, 6), STD({ color: '#6b4f2a', flatShading: true }), 0.05, 0.2, 0.04);
    // cloak, open at the front
    const cloak = [[0.045, 0.37], [0.085, 0.33], [0.1, 0.24], [0.115, 0.12], [0.125, 0.05]].map(([x, y]) => new THREE.Vector2(x, y));
    add(new THREE.LatheGeometry(cloak, 14, Math.PI * 0.3, Math.PI * 1.4), cloth, 0, 0, 0);
    add(new THREE.TorusGeometry(0.06, 0.01, 6, 14).rotateX(Math.PI / 2), trim, 0, 0.35, 0);
    // hood and shadowed face
    const hood = add(new THREE.SphereGeometry(0.068, 14, 10, Math.PI * 0.85, Math.PI * 1.75, 0, Math.PI * 0.7), cloth, 0, 0.415, 0);
    hood.scale.set(1, 1.12, 1.08);
    add(new THREE.ConeGeometry(0.035, 0.08, 8).rotateX(-0.6), cloth, 0, 0.49, -0.045);
    add(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#050307' }), 0, 0.41, 0.012);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffb02e', toneMapped: false });
    [-1, 1].forEach(sd => { const e = add(new THREE.SphereGeometry(0.01, 6, 5), eyeMat, sd * 0.019, 0.42, 0.056); e.castShadow = false; });
    // right arm with dagger
    add(new THREE.CylinderGeometry(0.015, 0.017, 0.12, 6), cloth, 0.085, 0.28, 0.02, 0.5, -0.35);
    add(new THREE.SphereGeometry(0.017, 6, 5), leather, 0.105, 0.23, 0.065);
    add(new THREE.BoxGeometry(0.008, 0.075, 0.016), steel, 0.108, 0.27, 0.075, 0.25, 0);
    add(new THREE.BoxGeometry(0.03, 0.007, 0.01), STD({ color: '#c9a227', metalness: 0.7 }), 0.108, 0.235, 0.068);
    // left arm with lantern
    add(new THREE.CylinderGeometry(0.015, 0.017, 0.13, 6), cloth, -0.085, 0.26, 0.03, 0.35, 0.25);
    const lanternGlass = new THREE.MeshStandardMaterial({ color: '#ffd987', emissive: '#ff9a2e', emissiveIntensity: 1.6 });
    add(new THREE.BoxGeometry(0.03, 0.04, 0.03), lanternGlass, -0.11, 0.18, 0.07);
    add(new THREE.BoxGeometry(0.036, 0.008, 0.036), dark, -0.11, 0.204, 0.07);
    add(new THREE.BoxGeometry(0.036, 0.008, 0.036), dark, -0.11, 0.156, 0.07);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb04a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glow.scale.set(0.22, 0.22, 1); glow.position.set(-0.11, 0.18, 0.07);
    g.add(glow);
    // loot sack on the back, tied at the neck, coins spilling
    const sack = STD({ color: '#8a6a3a', roughness: 0.9, flatShading: true });
    const sb = add(new THREE.SphereGeometry(0.055, 10, 8), sack, 0, 0.26, -0.095); sb.scale.set(1, 1.15, 0.9);
    add(new THREE.ConeGeometry(0.022, 0.035, 7), sack, 0, 0.33, -0.1);
    add(new THREE.TorusGeometry(0.014, 0.004, 4, 10).rotateX(Math.PI / 2), STD({ color: '#3a2a1c' }), 0, 0.318, -0.1);
    const gold = STD({ color: '#ffcf4a', metalness: 0.8, roughness: 0.25, emissive: '#5a3d00', emissiveIntensity: 0.4 });
    [[0.02, 0.05, -0.12], [0.045, 0.034, -0.1], [-0.03, 0.04, -0.13]].forEach(([x, y, z], i) => add(new THREE.CylinderGeometry(0.011, 0.011, 0.004, 10), gold, x, y, z, 0.4 * i, 0.3));
    // scarf mask over the lower face
    add(new THREE.CylinderGeometry(0.046, 0.05, 0.034, 12), trim, 0, 0.388, 0.008);
    add(new THREE.ConeGeometry(0.02, 0.05, 4), trim, 0.03, 0.36, -0.04, 0.4, 0.3);
    // shoulder guards
    [-1, 1].forEach(sd => { const g2 = add(new THREE.SphereGeometry(0.03, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), leather, sd * 0.062, 0.34, 0.005); g2.scale.set(1.2, 0.8, 1.1); });
    // boot cuffs and gloves
    [-1, 1].forEach(sd => add(new THREE.CylinderGeometry(0.026, 0.024, 0.018, 8), dark, sd * 0.03, 0.078, 0.002));
    add(new THREE.TorusGeometry(0.016, 0.005, 4, 10), dark, 0.1, 0.245, 0.06, 1.2, 0);
    add(new THREE.TorusGeometry(0.016, 0.005, 4, 10), dark, -0.104, 0.215, 0.066, 1.2, 0);
    // dagger sheath and belt pouches
    add(new THREE.BoxGeometry(0.014, 0.06, 0.012), dark, -0.06, 0.18, 0.045, 0, 0.3);
    add(new THREE.BoxGeometry(0.024, 0.022, 0.014), leather, 0.06, 0.2, 0.035);
    add(new THREE.BoxGeometry(0.02, 0.018, 0.012), leather, -0.03, 0.198, 0.06);
    // lantern handle
    add(new THREE.TorusGeometry(0.014, 0.003, 4, 10, Math.PI), dark, -0.11, 0.21, 0.07);
    g.children.forEach(c => { if (c.material === eyeMat) c.userData.keep = true; });
    ring.userData.keep = true;
    g.userData = { eyes: eyeMat, ring, lantern: glow };
    const baked = this._bake(g, true);
    baked.userData = g.userData;
    baked.scale.setScalar(1.15);
    this.robber = baked;
    this.robberHex = null;
    this.boardGroup.add(baked);
    // Warning ring on the tile the robber blocks.
    const warn = new THREE.Mesh(new THREE.RingGeometry(0.84, 0.95, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d33a2c', transparent: true, opacity: 0.6, depthWrite: false, depthTest: false, toneMapped: false }));
    warn.renderOrder = 7;
    const shade = new THREE.Mesh(new THREE.CircleGeometry(0.84, 6, Math.PI / 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1a0f18', transparent: true, opacity: 0.16, depthWrite: false, depthTest: false }));
    shade.renderOrder = 6;
    this.robberMark = new THREE.Group();
    this.robberMark.add(warn, shade);
    this.robberMark.userData.warn = warn;
    this.boardGroup.add(this.robberMark);
  }
  _placeRobberMark(hex) {
    const h = this.hexes[hex];
    this.robberMark.position.set(h.wx, TILE_H + 0.03, h.wz);
    this._setRobberFx(hex);
  }
  /** Lasting effect on the robber's tile, matching its terrain. */
  _setRobberFx(hex) {
    if (this.robberFx) { this.boardGroup.remove(this.robberFx); this.robberFx = null; }
    if (this.reduceMotion || !this.q.fx || hex === null || hex === undefined) return;
    const h = this.hexes[hex];
    const kind = { forest: 'fire', fields: 'fire', pasture: 'storm', gold: 'storm', hills: 'dust', mountains: 'dust', desert: 'sand' }[h.terrain];
    if (!kind) return;
    this.robberFx = this._makeFx(kind, h);
    this.boardGroup.add(this.robberFx);
  }
  _makeFx(kind, h) {
    const g = new THREE.Group();
    g.position.set(h.wx, TILE_H, h.wz);
    const r = rng(h.id * 13 + 5);
    const items = [];
    const add = (m, data) => { g.add(m); items.push(Object.assign(m.userData, data)); return m; };
    const spots = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 + 0.5; const d = 0.46 + r() * 0.2; return [Math.cos(a) * d, Math.sin(a) * d]; });
    if (kind === 'fire') {
      const outer = new THREE.MeshBasicMaterial({ color: '#ff6a1a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const inner = new THREE.MeshBasicMaterial({ color: '#ffd45a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      spots.forEach(([x, z], i) => {
        add(new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.34, 7), outer), { flame: true, base: 0.17, phase: i * 1.7 }).position.set(x, 0.17, z);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.21, 6), inner), { flame: true, base: 0.11, phase: i * 1.7 + 0.5 }).position.set(x, 0.11, z);
        const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff7a2a', transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        glowS.scale.set(0.75, 0.75, 1); glowS.position.set(x, 0.16, z); glowS.renderOrder = 14;
        add(glowS, { ember: true, phase: i });
      });
      for (let i = 0; i < 18; i++) {
        const [x, z] = spots[i % spots.length];
        add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), new THREE.MeshBasicMaterial({ color: '#2f2c2a', transparent: true, opacity: 0.5, depthWrite: false })), { smoke: true, x, z, phase: i / 18 });
      }
      const sparkMat = new THREE.MeshBasicMaterial({ color: '#ffcf5a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      for (let i = 0; i < 22; i++) { const [x, z] = spots[i % spots.length]; add(new THREE.Mesh(new THREE.OctahedronGeometry(0.012, 0), sparkMat.clone()), { spark: true, x, z, phase: r() }); }
      const tint = new THREE.Mesh(new THREE.CircleGeometry(0.86, 6, Math.PI / 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff5a1a', transparent: true, opacity: 0.18, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      tint.position.y = 0.05; tint.renderOrder = 6;
      add(tint, { tint: true });
    } else if (kind === 'storm') {
      const cloudMat = new THREE.MeshStandardMaterial({ color: '#7a808c', roughness: 1, flatShading: true, transparent: true, opacity: 0.82 });
      for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11 + r() * 0.07, 1), cloudMat); c.position.set((r() - 0.5) * 0.75, 0.78 + r() * 0.08, 0.05 + (r() - 0.5) * 0.5); c.scale.y = 0.6; add(c, { cloud: true, phase: i }); }
      const rainMat = new THREE.MeshBasicMaterial({ color: '#d6e8fa', transparent: true, opacity: 0.75, depthWrite: false });
      for (let i = 0; i < 50; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.13, 0.005), rainMat), { rain: true, x: (r() - 0.5) * 0.85, z: 0.05 + (r() - 0.5) * 0.6, phase: r() });
      for (let i = 0; i < 10; i++) { const sp = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e8f2ff', transparent: true, depthWrite: false })); sp.position.set((r() - 0.5) * 0.8, 0.03, 0.05 + (r() - 0.5) * 0.6); add(sp, { splash: true, phase: r() }); }
      const bg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#cfe4ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      bg.scale.set(1.3, 1.3, 1); bg.position.set(0, 0.45, 0.1); bg.visible = false;
      add(bg, { boltGlow: true });
      const pts = [[0, 0.76], [0.06, 0.58], [-0.03, 0.42], [0.05, 0.24], [0, 0.05]].map(([x, y]) => new THREE.Vector3(x, y, 0.1));
      const boltGeo = merge(pts.slice(1).map((p2, i) => colored(lineGeo(pts[i], p2, 0.012), '#ffffff')));
      add(new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: '#fffbe0', transparent: true, opacity: 0, toneMapped: false, depthWrite: false })), { bolt: true });
    } else if (kind === 'dust') {
      for (let i = 0; i < 16; i++) {
        const [x, z] = spots[i % spots.length];
        add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshBasicMaterial({ color: '#b8a080', transparent: true, opacity: 0.65, depthWrite: false })), { dust: true, x, z, phase: i / 16 });
      }
      for (let i = 0; i < 9; i++) {
        const [x, z] = spots[i % spots.length];
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.045, 0), STD({ color: '#6e6258', flatShading: true })), { rock: true, x, z, phase: i / 9 });
      }
      for (let i = 0; i < 14; i++) {
        const [x, z] = spots[i % spots.length];
        add(new THREE.Mesh(new THREE.TetrahedronGeometry(0.018, 0), STD({ color: '#8a7a68', flatShading: true })), { debris: true, x, z, dx: (r() - 0.5) * 0.4, dz: (r() - 0.5) * 0.4, phase: r() });
      }
    } else if (kind === 'sand') {
      const sandMat = new THREE.MeshBasicMaterial({ color: '#e8cf98', transparent: true, opacity: 0.7, depthWrite: false });
      const haze = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.5, 18, 1, true), new THREE.MeshBasicMaterial({ color: '#e2c48a', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      haze.position.y = 0.25;
      add(haze, { haze: true });
      for (let i = 0; i < 46; i++) add(new THREE.Mesh(new THREE.SphereGeometry(0.012 + r() * 0.012, 4, 3), sandMat), { sand: true, rad: 0.25 + r() * 0.55, h: 0.04 + r() * 0.4, phase: r() * Math.PI * 2, speed: 1.2 + r() * 1.6 });
    }
    // Particles of the same kind become one instanced mesh (one draw call per kind).
    const PARTICLE = ['smoke', 'spark', 'rain', 'splash', 'dust', 'rock', 'debris', 'sand'];
    const groups = new Map();
    items.forEach((u, idx) => {
      const k = PARTICLE.find(p => u[p]);
      if (!k) return;
      const mesh = g.children[idx];
      if (!groups.has(k)) groups.set(k, { geo: mesh.geometry, mat: mesh.material, list: [] });
      u.y0 = mesh.position.y; u.px = mesh.position.x; u.pz = mesh.position.z;
      groups.get(k).list.push(u);
      u._dead = mesh;
    });
    groups.forEach((gr, k) => {
      gr.mat = gr.mat.clone(); gr.mat.opacity = { smoke: 0.4, dust: 0.45, spark: 0.9 }[k] ?? gr.mat.opacity;
      const inst = new THREE.InstancedMesh(gr.geo, gr.mat, gr.list.length);
      inst.frustumCulled = false;
      inst.userData.kind = k; inst.userData.list = gr.list;
      g.add(inst);
    });
    items.forEach(u => { if (u._dead) { g.remove(u._dead); delete u._dead; } });
    g.userData.items = items.filter(u => !PARTICLE.some(p => u[p]));
    g.userData.particles = g.children.filter(c => c.isInstancedMesh);
    g.userData.kind = kind;
    return g;
  }
  _updateFx(g, t, dt) {
    if (!g) return;
    const flash = g.userData.kind === 'storm' && (t % 4.3) < 0.12;
    const solo = g.children.filter(c => !c.isInstancedMesh);
    g.userData.items.forEach((u, i) => {
      const m = solo[i];
      if (!m) return;
      if (u.flame) { const k = 0.8 + 0.35 * Math.sin(t * 13 + u.phase) * Math.sin(t * 7.3 + u.phase * 2); m.scale.set(1, k, 1); m.position.y = u.base * k; }
      else if (u.ember) m.material.opacity = 0.55 + 0.35 * Math.sin(t * 9 + u.phase);
      else if (u.tint) m.material.opacity = 0.14 + 0.08 * Math.sin(t * 6) * Math.sin(t * 2.3);
      else if (u.cloud) m.position.x += Math.sin(t * 0.5 + u.phase) * 0.0006;
      else if (u.bolt) { m.material.opacity = flash ? 1 : 0; m.visible = flash; }
      else if (u.boltGlow) { m.material.opacity = flash ? 0.9 : 0; m.visible = flash; }
      else if (u.haze) { m.rotation.y = t * 0.8; m.material.opacity = 0.12 + 0.06 * Math.sin(t * 2); }
    });
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
    g.userData.particles.forEach(inst => {
      const k = inst.userData.kind;
      inst.userData.list.forEach((u, i) => {
        let sc = 1; E.set(0, 0, 0);
        if (k === 'smoke') { const p = (t * 0.3 + u.phase) % 1; P.set(u.x + Math.sin(t + u.phase * 6) * 0.08 + p * 0.1, 0.28 + p * 1.0, u.z); sc = (0.7 + p * 2.6) * Math.min(1, (1 - p) * 2.5); }
        else if (k === 'spark') { const p = (t * 0.9 + u.phase) % 1; P.set(u.x + Math.sin(t * 3 + u.phase * 9) * 0.06 * p, 0.15 + p * 0.7, u.z + Math.cos(t * 2 + u.phase * 7) * 0.05 * p); sc = 1 - p; }
        else if (k === 'rain') { const p = (t * 1.8 + u.phase) % 1; P.set(u.x, 0.74 - p * 0.7, u.z); }
        else if (k === 'splash') { const p = (t * 1.8 + u.phase) % 1; P.set(u.px, 0.03, u.pz); sc = (0.3 + p * 1.6) * (1 - p * 0.6); }
        else if (k === 'dust') { const p = (t * 0.25 + u.phase) % 1; P.set(u.x + p * 0.08, 0.08 + p * 0.5, u.z); sc = (0.7 + p * 2.2) * Math.min(1, (1 - p) * 2.5); }
        else if (k === 'rock') { const p = (t * 0.7 + u.phase) % 1; P.set(u.x * (1 - p * 0.3), 0.45 * (1 - p * p) + 0.03, u.z * (1 - p * 0.3)); E.set(t * 4 + u.phase, 0, 0); }
        else if (k === 'debris') { const p = (t * 0.5 + u.phase) % 1; P.set(u.x + p * u.dx, 0.04 + Math.abs(Math.sin(p * Math.PI * 3)) * 0.12 * (1 - p), u.z + p * u.dz); E.set(t * 5, t * 3, 0); }
        else if (k === 'sand') { const a = u.phase + t * u.speed; P.set(Math.cos(a) * u.rad, u.h + Math.sin(t * 2 + u.phase) * 0.05, Math.sin(a) * u.rad); }
        M.compose(P, Q.setFromEuler(E), S.setScalar(Math.max(0.001, sc)));
        inst.setMatrixAt(i, M);
      });
      inst.instanceMatrix.needsUpdate = true;
    });
  }


  /** Seagulls circling and fish leaping now and then: an island that feels lived in. */
  _buildWildlife() {
    this.birds = [];
    if (this.reduceMotion) return;
    const r = rng(616);
    const B = this.bounds;
    const body = merge([colored(new THREE.OctahedronGeometry(0.03, 0).scale(1.8, 0.7, 0.8), '#f4f4f0'), colored(at(new THREE.ConeGeometry(0.008, 0.025, 4).rotateZ(-Math.PI / 2), 0.065, 0, 0), '#e0a12a')]);
    const wingGeo = colored(new THREE.BoxGeometry(0.035, 0.004, 0.12).translate(0, 0, 0.06), '#e9e9e4');
    const tipGeo = colored(new THREE.BoxGeometry(0.03, 0.005, 0.03).translate(0, 0, 0.13), '#3a3a3a');
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, VCOL));
      const wings = [1, -1].map(sd => { const w = new THREE.Group(); w.add(new THREE.Mesh(wingGeo, VCOL), new THREE.Mesh(tipGeo, VCOL)); w.scale.z = sd; g.add(w); return w; });
      g.children.forEach(c => { c.castShadow = true; });
      this.scenery.add(g);
      this.birds.push({ g, wings, cx: (r() - 0.5) * B.halfX * 1.4, cz: (r() - 0.5) * B.halfZ * 1.4, rad: 1.2 + r() * 2.4, h: 1.4 + r() * 1.2, a: r() * 6.3, speed: (0.25 + r() * 0.2) * (r() < 0.5 ? -1 : 1), flap: 7 + r() * 3 });
    }
    this.nextFish = 3;
  }
  _updateWildlife(t, dt) {
    (this.birds || []).forEach(b => {
      b.a += b.speed * dt;
      const x = b.cx + Math.cos(b.a) * b.rad, z = b.cz + Math.sin(b.a) * b.rad;
      b.g.position.set(x, b.h + Math.sin(t * 0.8 + b.rad) * 0.15, z);
      b.g.rotation.y = -b.a + (b.speed > 0 ? -Math.PI / 2 : Math.PI / 2);
      const glide = Math.sin(t * 0.4 + b.rad) > 0.3;
      const flap = glide ? 0.12 : Math.sin(t * b.flap) * 0.7;
      b.wings[0].rotation.x = flap; b.wings[1].rotation.x = -flap;
    });
    if (this.reduceMotion || !this.landDist) return;
    this.nextFish -= dt;
    if (this.nextFish > 0) return;
    this.nextFish = 3 + Math.random() * 5;
    const B = this.bounds;
    for (let k = 0; k < 20; k++) {
      const x = (Math.random() - 0.5) * (B.halfX * 2 + 3), z = (Math.random() - 0.5) * (B.halfZ * 2 + 3);
      const d = this.landDist(x, z);
      if (d < 0.5 || d > 3) continue;
      this._fishJump(x, z);
      break;
    }
  }
  _fishJump(x, z) {
    const fish = new THREE.Mesh(merge([colored(new THREE.OctahedronGeometry(0.03, 0).scale(2.2, 0.8, 0.6), '#c6d3dc'), colored(at(new THREE.ConeGeometry(0.02, 0.035, 3).rotateZ(Math.PI / 2), -0.075, 0, 0), '#9fb2bf')]), STD({ vertexColors: true, metalness: 0.6, roughness: 0.3, flatShading: true }));
    const dir = Math.random() * Math.PI * 2, len = 0.35;
    this.boardGroup.add(fish);
    const splash = (px, pz) => {
      const ringM = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.05, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }));
      ringM.position.set(px, 0.03, pz);
      this.boardGroup.add(ringM);
      this._anim(800, t => { ringM.scale.setScalar(1 + t * 4); ringM.material.opacity = 0.8 * (1 - t); }, () => this.boardGroup.remove(ringM));
    };
    splash(x, z);
    this._anim(900, t => {
      fish.position.set(x + Math.cos(dir) * len * t, 0.02 + Math.sin(t * Math.PI) * 0.28, z + Math.sin(dir) * len * t);
      fish.rotation.set(0, -dir, Math.cos(t * Math.PI) * 0.9);
    }, () => { this.boardGroup.remove(fish); splash(x + Math.cos(dir) * len, z + Math.sin(dir) * len); });
  }

  /** Smoke and a shockwave when the robber lands. */
  _robberLanding(hex) {
    const h = this.hexes[hex];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff5a3c', transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, toneMapped: false }));
    ring.position.set(h.wx, TILE_H + 0.05, h.wz - (h.number ? 0.34 : 0));
    ring.renderOrder = 13;
    this.boardGroup.add(ring);
    this._anim(800, t => { ring.scale.setScalar(1 + t * 3.2); ring.material.opacity = 0.9 * (1 - t); }, () => this.boardGroup.remove(ring));
    if (this.reduceMotion) return;
    const geo = new THREE.SphereGeometry(0.06, 7, 5);
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i % 3 ? '#3b3442' : '#5a4f63', transparent: true, opacity: 0.7, depthWrite: false }));
      const a = (i / 14) * Math.PI * 2, base = ring.position.clone();
      p.position.copy(base);
      this.boardGroup.add(p);
      this._anim(1100 + i * 20, t => {
        p.position.set(base.x + Math.cos(a) * t * 0.35, base.y + t * (0.25 + (i % 4) * 0.06), base.z + Math.sin(a) * t * 0.35);
        p.scale.setScalar(1 + t * 2.4);
        p.material.opacity = 0.7 * (1 - t);
      }, () => this.boardGroup.remove(p));
    }
    const mark = this.robberMark.userData.warn;
    this._anim(900, t => { mark.material.opacity = 0.6 + Math.sin(t * Math.PI * 3) * 0.35; });
  }

  _buildPickers() {
    const inv = new THREE.MeshBasicMaterial({ visible: false });
    this.pickGroups = { vertex: [], edge: [], hex: [] };
    const vg = new THREE.SphereGeometry(0.17, 8, 6);
    this.board.vertices.forEach(v => {
      const m = new THREE.Mesh(vg, inv);
      m.position.set(v.x, TILE_H + 0.05, v.y);
      m.userData = { kind: 'vertex', id: v.id };
      this.pickGroups.vertex.push(m);
    });
    this.board.edges.forEach(e => {
      const a = this.board.vertices[e.v[0]], b = this.board.vertices[e.v[1]];
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.2), inv);
      m.position.set(e.x, TILE_H + 0.04, e.y);
      m.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      m.userData = { kind: 'edge', id: e.id };
      this.pickGroups.edge.push(m);
    });
    const hg = new THREE.CylinderGeometry(0.9, 0.9, 0.1, 6);
    this.hexes.forEach(h => {
      const m = new THREE.Mesh(hg, inv);
      m.position.set(h.wx, TILE_H + 0.05, h.wz);
      m.userData = { kind: 'hex', id: h.id };
      this.pickGroups.hex.push(m);
    });
    [...this.pickGroups.vertex, ...this.pickGroups.edge, ...this.pickGroups.hex].forEach(m => { m.updateMatrixWorld(); });
  }

  /** The barbarian ship's course: 7 buoys off the coast, the ship moving one step per ship roll. */
  _syncBarbarians(pos) {
    if (!this.barbGroup) {
      this.barbGroup = new THREE.Group();
      const R = Math.max(this.bounds.halfX, this.bounds.halfZ) + 1.25;
      this.barbPath = [];
      for (let i = 0; i <= 7; i++) {
        const a = (200 + i * 11) * D2R;
        const p = new THREE.Vector3(Math.cos(a) * R * (1 - i * 0.035), 0, Math.sin(a) * R * (1 - i * 0.035));
        this.barbPath.push(p);
        if (i >= 1) {
          const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 8), STD({ color: i === 7 ? '#b9412c' : '#e7d6ab', emissive: i === 7 ? '#b9412c' : '#000000', emissiveIntensity: 0.4 }));
          buoy.position.copy(p).add(new THREE.Vector3(0, 0.03, 0));
          this.barbGroup.add(buoy);
        }
      }
      this.barbShip = makeShip(1.25, '#7d2c1f', 99);
      (this.barbShip.userData.sails || []).forEach(m => { m.material = new THREE.MeshStandardMaterial({ color: '#ffffff', map: sailTexture('#7d2c1f'), side: THREE.DoubleSide, roughness: 0.9, flatShading: true }); });
      this.barbGroup.add(this.barbShip);
      this.boardGroup.add(this.barbGroup);
      this.barbPos = -1;
    }
    if (pos === this.barbPos) return;
    const from = this.barbShip.position.clone(), to = this.barbPath[Math.min(7, pos)];
    const first = this.barbPos < 0;
    this.barbPos = pos;
    const look = this.barbPath[Math.min(7, pos + 1)];
    if (first) { this.barbShip.position.copy(to); }
    else this._anim(1200, t => { this.barbShip.position.lerpVectors(from, to, easeInOut(t)); });
    this.barbShip.rotation.y = Math.atan2(-(look.z - to.z), look.x - to.x) || 0;
  }

  /** Board game view: flat printed tiles with a resource icon, like a cardboard board. */
  _buildClassic() {
    const fills = { gold: ['#a8820f', '#6e520a'], forest: ['#3f7d3a', '#346a30'], pasture: ['#8dbb4c', '#7aa83f'], fields: ['#e3b43f', '#cf9f2c'], hills: ['#c0603a', '#a94f2e'], mountains: ['#8a929c', '#737b85'], desert: ['#e6cf98', '#d6bb7f'] };
    const iconFor = { forest: 'wood', pasture: 'sheep', fields: 'wheat', hills: 'brick', mountains: 'ore', desert: null, gold: 'gold' };
    const mats = {};
    Object.keys(fills).forEach(t => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const draw = (img) => {
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 150);
        g.addColorStop(0, fills[t][0]); g.addColorStop(1, fills[t][1]);
        ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
        // a light printed texture
        const r = rng(t.length * 97);
        ctx.globalAlpha = 0.12;
        for (let i = 0; i < 260; i++) { ctx.fillStyle = r() < 0.5 ? '#ffffff' : '#000000'; ctx.beginPath(); ctx.arc(r() * 256, r() * 256, 1 + r() * 3, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
        if (img) {
          // Icon on a light badge with a dark rim, so it never blends into a tile of its own colour.
          ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.arc(128, 52, 40, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2a1c13'; ctx.beginPath(); ctx.arc(128, 49, 39, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fbf3dd'; ctx.beginPath(); ctx.arc(128, 49, 34, 0, Math.PI * 2); ctx.fill();
          ctx.drawImage(img, 128 - 28, 49 - 28, 56, 56);
        }
        if (t === 'desert') { ctx.fillStyle = 'rgba(120,90,40,.35)'; ctx.font = '700 30px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('desert', 128, 205); }
        tex.needsUpdate = true;
      };
      draw(null);
      if (iconFor[t]) { const img = new Image(); img.onload = () => draw(img); img.src = iconDataUrl(iconFor[t]); }
      mats[t] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    });
    const top = new THREE.CircleGeometry(TILE_R * 0.985, 6, Math.PI / 6);
    top.rotateX(-Math.PI / 2);
    const edge = new THREE.RingGeometry(TILE_R * 0.93, TILE_R * 0.985, 6, 1, Math.PI / 6);
    edge.rotateX(-Math.PI / 2);
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#f5ecd2', transparent: true, opacity: 0.55, toneMapped: false });
    this.hexes.forEach(h => {
      if (!mats[h.terrain]) return;
      const m = new THREE.Mesh(top, mats[h.terrain]);
      m.position.set(h.wx, TILE_H + 0.001, h.wz);
      m.receiveShadow = true;
      const e = new THREE.Mesh(edge, edgeMat);
      e.position.set(h.wx, TILE_H + 0.003, h.wz);
      this.classic.add(m, e);
    });
  }

  /** 'tabletop' (detailed 3D island) or 'board' (flat printed board seen from above). */
  setStyle(style, instant = false) {
    this.style = style === 'board' ? 'board' : 'tabletop';
    if (!this.board) return;
    const flat = this.style === 'board';
    this.scenery.visible = !flat;
    this.classic.visible = flat;
    this.controls.minPolarAngle = flat ? 0.0 : 0.25;
    this.controls.maxPolarAngle = flat ? 0.55 : 1.12;
    this.controls.enableRotate = true;
    this.pieceGroup.scale.setScalar(1);
    this.pieces.buildings.forEach(b => { b.mesh.userData.baseScale = flat ? 1.35 : 1.15; b.mesh.scale.setScalar(b.mesh.userData.baseScale); });
    this.pieces.knights?.forEach(k => { k.mesh.userData.baseScale = flat ? 1.35 : 1.15; k.mesh.scale.setScalar(k.mesh.userData.baseScale); });
    this.resetCamera(instant);
  }

  _buildBoats() {
    this.boats = [];
    const r = rng(9001);
    const sails = ['#f2ead6', '#e9d9b8', '#f6f1e4'];
    for (let i = 0; i < 4; i++) {
      const ship = makeShip(0.75 + r() * 0.3, sails[i % 3], i + 50);
      this.scenery.add(ship);
      this.boats.push({ ship, rad: Math.max(this.bounds.halfX, this.bounds.halfZ) + 1.8 + r() * 2.2, a: r() * Math.PI * 2, speed: (0.025 + r() * 0.02) * (r() < 0.5 ? -1 : 1), phase: r() * 6 });
    }
    this._updateBoats(0);
  }

  // ---------------------------------------------------------------- pieces
  _mats(color) {
    if (this.pieceMats.has(color)) return this.pieceMats.get(color);
    const base = new THREE.Color(color);
    const light = base.getHSL({}).l;
    const roofCol = base.clone().multiplyScalar(light > 0.75 ? 0.52 : 0.62);
    const mats = {
      wall: STD({ color: base, roughness: 0.55, flatShading: true, emissive: base, emissiveIntensity: 0.16 }),
      roof: STD({ color: roofCol, roughness: 0.65, flatShading: true, emissive: roofCol, emissiveIntensity: 0.12 }),
      curb: STD({ color: base, roughness: 0.5, emissive: base, emissiveIntensity: 0.22 }),
      plate: STD({ color: base, roughness: 0.5, emissive: base, emissiveIntensity: 0.25 }),
      outline: new THREE.MeshBasicMaterial({ color: light > 0.75 ? '#2a1d14' : '#140d08', side: THREE.BackSide }),
      ghost: new THREE.MeshStandardMaterial({ color: base, transparent: true, opacity: 0.6, emissive: base, emissiveIntensity: 0.5, depthWrite: false })
    };
    this.pieceMats.set(color, mats);
    return mats;
  }

  /** Roads: the whole surface in the player's colour (with a cobble pattern), edged light then dark,
   *  so a road reads clearly on any terrain and for any colour. */
  _roadMesh(color, ghost = false) {
    if (!this._roadGeos) {
      const tex = cobbleTintTexture();
      tex.wrapS = tex.wrapT = RepeatWrapping;
      this._cobbleTint = tex;
      this._roadGeos = {
        outline: new THREE.BoxGeometry(1, 0.03, 0.19).translate(0.5, 0.015, 0),
        edge: new THREE.BoxGeometry(1, 0.044, 0.162).translate(0.5, 0.022, 0),
        body: new THREE.BoxGeometry(1, 0.058, 0.13).translate(0.5, 0.029, 0)
      };
      const uv = this._roadGeos.body.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3);
      this._edgeLight = new THREE.MeshBasicMaterial({ color: '#fff4dc', toneMapped: false });
      this._edgeDark = new THREE.MeshBasicMaterial({ color: '#120b06', toneMapped: false });
    }
    const m = this._mats(color);
    m.road ||= new THREE.MeshStandardMaterial({ color, map: this._cobbleTint, roughness: 0.75, emissive: color, emissiveIntensity: 0.28 });
    const g = new THREE.Group();
    const parts = ghost
      ? [new THREE.Mesh(this._roadGeos.body, m.ghost)]
      : [new THREE.Mesh(this._roadEdges(), this._edgeVC), new THREE.Mesh(this._roadGeos.body, m.road)];
    parts.forEach(p => { p.castShadow = !ghost; p.receiveShadow = true; g.add(p); });
    return g;
  }

  _ensureRoadInstances() {
    if (this.roadBody && this.roadBody.parent === this.pieceGroup) return;
    this._roadMesh('#ffffff', true); // builds the shared geometries
    const cap = this.board.edges.length;
    this._roadBodyMat ||= new THREE.MeshStandardMaterial({ map: this._cobbleTint, roughness: 0.75, emissive: '#ffffff', emissiveIntensity: 0.08 });
    this.roadEdge = new THREE.InstancedMesh(this._roadEdges(), this._edgeVC, cap);
    this.roadBody = new THREE.InstancedMesh(this._roadGeos.body, this._roadBodyMat, cap);
    this.roadBody.setColorAt(0, tmpColor.set('#ffffff'));
    [this.roadEdge, this.roadBody].forEach(m => { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.pieceGroup.add(m); });
  }
  _roadMatrix(eid, k) {
    const e = this.board.edges[eid];
    const a = this.board.vertices[e.v[0]], b = this.board.vertices[e.v[1]];
    const len = Math.hypot(b.x - a.x, b.y - a.y), trim = 0.075;
    const ux = (b.x - a.x) / len, uz = (b.y - a.y) / len;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(uz, ux));
    return new THREE.Matrix4().compose(new THREE.Vector3(a.x + ux * trim, TILE_H + 0.002 + (1 - Math.min(1, k)) * 0.05, a.y + uz * trim), q, new THREE.Vector3(Math.max(0.001, (len - 2 * trim) * k), 1, 1));
  }
  _animateRoadInstance(eid, color) {
    const e = this.board.edges[eid];
    this._dust(new THREE.Vector3(e.x, TILE_H + 0.05, e.y));
    this._pulseRing(e.x, e.y, color, 5000, 0.2);
    this._anim(520, t => {
      const r = this.pieces.roads.get(eid);
      if (!r) return;
      const mtx = this._roadMatrix(eid, easeOutBack(t));
      this.roadBody.setMatrixAt(r.index, mtx); this.roadEdge.setMatrixAt(r.index, mtx);
      this.roadBody.instanceMatrix.needsUpdate = this.roadEdge.instanceMatrix.needsUpdate = true;
    });
  }

  /** Road outline (dark) and edge (light) as one mesh. */
  _roadEdges() {
    if (this._roadEdgeGeo) return this._roadEdgeGeo;
    const a = colored(this._roadGeos.outline.clone(), '#120b06'), b = colored(this._roadGeos.edge.clone(), '#fff4dc');
    this._roadEdgeGeo = mergeGeos([a.index ? a.toNonIndexed() : a, b.index ? b.toNonIndexed() : b]);
    this._edgeVC = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    return this._roadEdgeGeo;
  }

  _placeRoad(group, edgeId) {
    const e = this.board.edges[edgeId];
    const a = this.board.vertices[e.v[0]], b = this.board.vertices[e.v[1]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const trim = 0.075;
    const ux = (b.x - a.x) / len, uz = (b.y - a.y) / len;
    group.position.set(a.x + ux * trim, TILE_H + 0.002, a.y + uz * trim);
    group.rotation.y = -Math.atan2(uz, ux);
    group.scale.set(len - 2 * trim, 1, 1);
    group.userData.len = len - 2 * trim;
  }

  _nodeMesh(color) {
    const g = new THREE.Group();
    const dark = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 6), this._edgeDark || new THREE.MeshBasicMaterial({ color: '#120b06' }));
    dark.position.y = 0.015;
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.044, 6), this._edgeLight || new THREE.MeshBasicMaterial({ color: '#fff4dc' }));
    light.position.y = 0.022;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.058, 6), color ? (this._mats(color).road || STD({ color })) : STD({ color: '#9a8a70' }));
    top.position.y = 0.029;
    g.add(dark, light, top);
    g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
    return g;
  }

  _settlementMesh(color, ghost = false) {
    const m = this._mats(color);
    const g = new THREE.Group();
    const roofShape = new THREE.Shape([new THREE.Vector2(-0.105, 0), new THREE.Vector2(0.105, 0), new THREE.Vector2(0, 0.1)]);
    const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 0.16, bevelEnabled: false }).translate(0, 0, -0.08);
    const meshes = ghost ? [
      [new THREE.BoxGeometry(0.18, 0.12, 0.14), m.ghost, 0, 0.1, 0],
      [roof, m.ghost, 0, 0.16, 0]
    ] : [
      [new THREE.BoxGeometry(0.22, 0.04, 0.18), STD({ color: '#8c8579', flatShading: true }), 0, 0.02, 0],
      [new THREE.BoxGeometry(0.18, 0.12, 0.14), m.wall, 0, 0.1, 0],
      [roof, m.roof, 0, 0.16, 0],
      [new THREE.BoxGeometry(0.035, 0.06, 0.01), STD({ color: '#3d2a1a' }), 0.03, 0.07, 0.072],
      [new THREE.BoxGeometry(0.03, 0.03, 0.01), STD({ color: '#ffe3a0', emissive: '#ffb84a', emissiveIntensity: 0.4 }), -0.05, 0.11, 0.072],
      [new THREE.BoxGeometry(0.03, 0.06, 0.03), STD({ color: '#7a7368' }), 0.05, 0.23, -0.03]
    ];
    meshes.forEach(([geo, mat, x, y, z]) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = !ghost; mesh.receiveShadow = true;
      g.add(mesh);
    });
    if (!ghost) this._houseDetail(g, m, { w: 0.18, h: 0.12, d: 0.14, y0: 0.04, x: 0, z: 0, roofH: 0.1, roofW: 0.105, door: 0.03, win: -0.05 });
    return g;
  }
  /** Timber framing, shutters, window box, roof ridge and shingles, door step: baked, so no extra draw calls. */
  _houseDetail(g, m, o) {
    const beam = this._beamMat ||= STD({ color: '#3b2716', flatShading: true });
    const stone = this._stoneMat ||= STD({ color: '#9a938a', flatShading: true });
    const add = (geo, mat, x, y, z, ry = 0, rz = 0) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(o.x + x, y, o.z + z); mesh.rotation.set(0, ry, rz); mesh.userData.noOutline = true; mesh.castShadow = false; g.add(mesh); };
    const fz = o.d / 2 + 0.003, top = o.y0 + o.h;
    // front framing: corner posts, mid rail, and a cross brace
    [-1, 1].forEach(sd => add(new THREE.BoxGeometry(0.012, o.h, 0.006), beam, sd * (o.w / 2 - 0.006), o.y0 + o.h / 2, fz));
    add(new THREE.BoxGeometry(o.w, 0.01, 0.006), beam, 0, o.y0 + o.h * 0.55, fz);
    add(new THREE.BoxGeometry(o.w, 0.012, 0.006), beam, 0, top - 0.006, fz);
    // side framing
    [-1, 1].forEach(sd => { add(new THREE.BoxGeometry(0.006, 0.01, o.d), beam, sd * (o.w / 2 + 0.003), o.y0 + o.h * 0.55, 0); add(new THREE.BoxGeometry(0.006, o.h * 0.9, 0.01), beam, sd * (o.w / 2 + 0.003), o.y0 + o.h / 2, 0, 0, 0.45); });
    // window shutters and flower box
    [-1, 1].forEach(sd => add(new THREE.BoxGeometry(0.012, 0.032, 0.005), m.roof, o.win + sd * 0.023, o.y0 + o.h * 0.6, fz + 0.002));
    add(new THREE.BoxGeometry(0.04, 0.01, 0.014), beam, o.win, o.y0 + o.h * 0.43, fz + 0.006);
    ['#e85a6a', '#f4d35e', '#ffffff'].forEach((c, i) => add(new THREE.SphereGeometry(0.006, 5, 4), (this._flowerMats ||= {})[c] ||= STD({ color: c }), o.win - 0.012 + i * 0.012, o.y0 + o.h * 0.47, fz + 0.008));
    // door frame and step
    add(new THREE.BoxGeometry(0.045, 0.008, 0.008), beam, o.door, o.y0 + 0.064, fz + 0.002);
    add(new THREE.BoxGeometry(0.05, 0.012, 0.03), stone, o.door, o.y0 + 0.006, fz + 0.016);
    // roof ridge and shingle bands
    add(new THREE.CylinderGeometry(0.008, 0.008, o.d + 0.03, 6).rotateX(Math.PI / 2), beam, 0, top + o.roofH + 0.004, 0);
    const slope = Math.atan2(o.roofH, o.roofW), len = Math.hypot(o.roofH, o.roofW);
    [-1, 1].forEach(sd => [0.33, 0.66].forEach(f => add(new THREE.BoxGeometry(0.005, len * 0.04 + 0.004, o.d + 0.024), m.roof === beam ? beam : (this._shingle ||= STD({ color: '#2a1c12', transparent: false })), sd * o.roofW * (1 - f), top + o.roofH * f + 0.004, 0, 0, sd * slope)));
  }

  _cityMesh(color, ghost = false) {
    const m = this._mats(color);
    const g = new THREE.Group();
    const wall = ghost ? m.ghost : m.wall, roofM = ghost ? m.ghost : m.roof;
    const roofShape = new THREE.Shape([new THREE.Vector2(-0.1, 0), new THREE.Vector2(0.1, 0), new THREE.Vector2(0, 0.09)]);
    const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 0.15, bevelEnabled: false }).translate(0, 0, -0.075);
    const list = [
      [new THREE.BoxGeometry(0.36, 0.045, 0.26), ghost ? m.ghost : STD({ color: '#8c8579', flatShading: true }), 0, 0.022, 0],
      [new THREE.BoxGeometry(0.18, 0.15, 0.14), wall, -0.07, 0.12, 0.02],
      [roof, roofM, -0.07, 0.195, 0.02],
      [new THREE.BoxGeometry(0.11, 0.3, 0.11), wall, 0.1, 0.195, -0.03],
      [new THREE.ConeGeometry(0.085, 0.12, 4).rotateY(Math.PI / 4), roofM, 0.1, 0.405, -0.03]
    ];
    if (!ghost) {
      // a second, round tower and a low battlemented wall in front
      list.push([new THREE.CylinderGeometry(0.045, 0.05, 0.22, 10), wall, -0.15, 0.155, -0.08]);
      list.push([new THREE.ConeGeometry(0.06, 0.1, 10), roofM, -0.15, 0.315, -0.08]);
      list.push([new THREE.BoxGeometry(0.3, 0.035, 0.02), this._stoneMat ||= STD({ color: '#9a938a', flatShading: true }), 0.0, 0.062, 0.12]);
      [-0.12, -0.06, 0, 0.06, 0.12].forEach(x => list.push([new THREE.BoxGeometry(0.03, 0.022, 0.022), this._stoneMat, x, 0.09, 0.12]));
      [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]].forEach(([x, z]) => list.push([new THREE.BoxGeometry(0.03, 0.03, 0.03), wall, 0.1 + x, 0.355, -0.03 + z]));
      list.push([new THREE.BoxGeometry(0.04, 0.07, 0.01), STD({ color: '#3d2a1a' }), -0.07, 0.08, 0.092]);
      list.push([new THREE.BoxGeometry(0.03, 0.04, 0.01), STD({ color: '#ffe3a0', emissive: '#ffb84a', emissiveIntensity: 0.5 }), 0.1, 0.24, 0.026]);
    }
    list.forEach(([geo, mat, x, y, z]) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = !ghost; mesh.receiveShadow = true;
      g.add(mesh);
    });
    if (!ghost) {
      this._houseDetail(g, m, { w: 0.18, h: 0.15, d: 0.14, y0: 0.045, x: -0.07, z: 0.02, roofH: 0.09, roofW: 0.1, door: 0.0, win: -0.05 });
      const beam = this._beamMat, add = (geo, mat, x, y, z) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.userData.noOutline = true; g.add(mesh); };
      // tower: arrow slits, an arched door, a banner
      [0.17, 0.27].forEach(y => add(new THREE.BoxGeometry(0.01, 0.035, 0.004), beam, 0.1, y, 0.027));
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), beam, 0.1, 0.09, 0.027);
      add(new THREE.BoxGeometry(0.044, 0.04, 0.006), beam, 0.1, 0.07, 0.027);
      add(new THREE.BoxGeometry(0.035, 0.07, 0.004), m.roof, 0.155, 0.23, -0.03);
      // round tower windows
      add(new THREE.BoxGeometry(0.012, 0.03, 0.004), beam, -0.15, 0.2, -0.033);
      // chimney on the hall
      add(new THREE.BoxGeometry(0.025, 0.05, 0.025), this._stoneMat, -0.12, 0.27, 0.04);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.004), new THREE.MeshStandardMaterial({ color }));
      flag.userData.noOutline = true;
      flag.position.set(0.135, 0.49, -0.03);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), STD({ color: '#3a2a1c' }));
      pole.position.set(0.1, 0.47, -0.03);
      g.add(flag, pole);
    }
    return g;
  }

  /** A player's symbol badge (shape + colour), so pieces never rely on colour alone. */
  _badgeTexture(color, symbol) {
    const key = `${color}|${symbol}`;
    this._badgeCache ||= new Map();
    if (this._badgeCache.has(key)) return this._badgeCache.get(key);
    const tex = canvasTexture(96, 96, (ctx) => {
      ctx.fillStyle = '#1b120b'; ctx.beginPath(); ctx.arc(48, 48, 46, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(48, 48, 40, 0, Math.PI * 2); ctx.fill();
      const light = new THREE.Color(color).getHSL({}).l > 0.6;
      ctx.fillStyle = light ? '#1b120b' : '#ffffff';
      drawSymbol(ctx, symbol, 48, 48, 24);
    });
    this._badgeCache.set(key, tex);
    return tex;
  }
  _badge(color, symbol, size = 0.024) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._badgeTexture(color, symbol), depthTest: false, transparent: true, sizeAttenuation: false, toneMapped: false }));
    sp.scale.set(size, size, 1);
    sp.renderOrder = 18;
    sp.userData.noOutline = true;
    return sp;
  }
  _knightMesh(color, level, active, ghost = false) {
    const m = this._mats(color);
    const g = new THREE.Group();
    const body = ghost ? m.ghost : active ? m.wall : (this._dimMats ||= new Map()).get(color) || (() => { const d = STD({ color: new THREE.Color(color).lerp(new THREE.Color('#4a4a4a'), 0.6), roughness: 0.8, flatShading: true }); this._dimMats.set(color, d); return d; })();
    const steel = ghost ? m.ghost : STD({ color: active ? '#d9dde2' : '#7d8288', metalness: 0.6, roughness: 0.35, flatShading: true });
    const pts = [[0, 0], [0.085, 0], [0.09, 0.025], [0.06, 0.05], [0.05, 0.13], [0.065, 0.17], [0.04, 0.2], [0, 0.205]].map(([x, y]) => new THREE.Vector2(x, y));
    const add = (geo, mat, x, y, z) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = !ghost; g.add(mesh); return mesh; };
    add(new THREE.LatheGeometry(pts, 10), body, 0, 0, 0);
    add(new THREE.SphereGeometry(0.048, 10, 8), steel, 0, 0.235, 0);
    add(new THREE.BoxGeometry(0.06, 0.012, 0.012), ghost ? m.ghost : STD({ color: '#1d1d1d' }), 0, 0.235, 0.044);
    // Crest plumes show strength: 1, 2 or 3.
    for (let i = 0; i < level; i++) {
      const plume = add(new THREE.ConeGeometry(0.016, 0.07, 6), ghost ? m.ghost : (active ? m.roof : body), (i - (level - 1) / 2) * 0.03, 0.3, -0.005);
      plume.rotation.z = (i - (level - 1) / 2) * -0.35;
    }
    if (level >= 2) {
      const shield = add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 6), ghost ? m.ghost : (active ? m.roof : body), 0.07, 0.11, 0.02);
      shield.rotation.z = Math.PI / 2;
    }
    if (level >= 3) add(new THREE.CylinderGeometry(0.006, 0.006, 0.32, 5), steel, -0.07, 0.15, 0);
    return g;
  }
  _wallMesh() {
    const g = new THREE.Group();
    const stone = STD({ color: '#9c968b', flatShading: true, roughness: 0.95 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.07, 18, 1, true), stone);
    ring.position.y = 0.035; ring.material.side = THREE.DoubleSide;
    g.add(ring);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.03), stone);
      b.position.set(Math.cos(a) * 0.272, 0.085, Math.sin(a) * 0.272);
      b.rotation.y = -a;
      g.add(b);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.noOutline = true; } });
    return g;
  }
  _metroTower(color, trackColor) {
    const g = new THREE.Group();
    const m = this._mats(color);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 8), m.wall);
    tower.position.set(-0.11, 0.25, -0.06);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.14, 8), STD({ color: trackColor, emissive: trackColor, emissiveIntensity: 0.3, flatShading: true }));
    cap.position.set(-0.11, 0.53, -0.06);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.06), new THREE.MeshStandardMaterial({ color: trackColor, side: THREE.DoubleSide, emissive: trackColor, emissiveIntensity: 0.25 }));
    banner.position.set(-0.05, 0.58, -0.06);
    banner.userData.keep = true;
    g.add(tower, cap, banner);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.userData.flag = banner;
    return g;
  }
  _merchantMesh(color) {
    const g = new THREE.Group();
    const m = this._mats(color);
    const add = (geo, mat, x, y, z) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };
    add(new THREE.BoxGeometry(0.16, 0.06, 0.1), STD({ color: '#8a5a33', flatShading: true }), 0, 0.06, 0);
    add(new THREE.ConeGeometry(0.13, 0.08, 4).rotateY(Math.PI / 4), m.wall, 0, 0.16, 0);
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), STD({ color: '#3a2a1c' }), -0.07, 0.1, 0.04);
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), STD({ color: '#3a2a1c' }), 0.07, 0.1, 0.04);
    [[-0.05, 0.1], [0.0, 0.1], [0.05, 0.1]].forEach(([x, y], i) => add(new THREE.SphereGeometry(0.02, 6, 5), STD({ color: ['#e0b33c', '#b5532f', '#8dbb4c'][i] }), x, y, 0.03));
    return g;
  }
  _pulseRing(x, z, color, dur = 5000, radius = 0.22) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.7, radius, 32).rotateX(-Math.PI / 2), mat);
    ring.position.set(x, TILE_H + 0.03, z);
    ring.renderOrder = 12;
    this.boardGroup.add(ring);
    this._anim(dur, t => {
      const pulse = 0.5 + 0.5 * Math.sin(t * dur / 160);
      mat.opacity = (1 - t) * (0.45 + 0.5 * pulse);
      ring.scale.setScalar(1 + pulse * 0.35);
    }, () => this.boardGroup.remove(ring));
  }
  /** Persistent markers on what other players built since your last turn. */
  setRecent(items) {
    (this._recent || []).forEach(m => this.boardGroup.remove(m));
    this._recent = [];
    if (!this.board) return;
    items.forEach(({ kind, id, color }) => {
      let x, z, r = 0.2;
      if (kind === 'road') { const e = this.board.edges[id]; x = e.x; z = e.y; r = 0.16; }
      else { const v = this.board.vertices[id]; if (!v) return; x = v.x; z = v.y; r = kind === 'city' ? 0.27 : 0.21; }
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, toneMapped: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 32).rotateX(-Math.PI / 2), mat);
      ring.position.set(x, TILE_H + 0.025, z);
      ring.renderOrder = 11;
      ring.userData.recent = true;
      this.boardGroup.add(ring);
      this._recent.push(ring);
    });
  }

  /** Bakes a piece's many small meshes into a few (body, dark outline, light outline): far fewer draw calls.
   *  Children marked keep (badges, flags, halos, sprites) stay separate. */
  _bake(g, doubleSide = false) {
    const body = [], dark = [], light = [];
    const kept = [];
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    g.traverse(o => {
      if (o === g) return;
      if (!o.isMesh || o.userData.keep || o.userData.halo || o.userData.flag || o.material?.transparent || Array.isArray(o.material) || o.material?.map) {
        if (o.isMesh || o.isSprite) kept.push(o);
        return;
      }
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      ['uv', 'uv1', 'uv2'].forEach(a => geo.deleteAttribute(a));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const m = o.material;
      if (m.side === THREE.BackSide) {
        const c = m.color, n = geo.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        dark.push(geo); // dark and light shells share one mesh
        return;
      }
      const c = m.color.clone();
      if (m.emissive && m.emissiveIntensity > 0.6) c.lerp(m.emissive, 0.5).multiplyScalar(1.3);
      const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      body.push(geo);
    });
    const out = new THREE.Group();
    out.userData = g.userData;
    const mk = (list, mat) => { if (!list.length) return; const geo = mergeGeos(list); const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mat === this._bakedMat || mat === this._bakedMat2; mesh.receiveShadow = true; out.add(mesh); };
    this._bakedMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.06 });
    this._bakedMat2 ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
    this._darkShell ||= new THREE.MeshBasicMaterial({ color: '#140d08', side: THREE.BackSide });
    this._shellVC ||= new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false });
    mk(body, doubleSide ? this._bakedMat2 : this._bakedMat); mk(dark, this._shellVC);
    kept.forEach(k => {
      const m = new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld);
      m.decompose(k.position, k.quaternion, k.scale);
      out.add(k);
    });
    return out;
  }

  /** A player's ship piece: a sturdy little boat in their colour, outlined like every piece. */
  _shipPiece(color, ghost = false) {
    const m = this._mats(color);
    const g = new THREE.Group();
    const hull = makeHull(0.34, 0.12, 0.05, '#ffffff');
    const hullMesh = new THREE.Mesh(hull, ghost ? m.ghost : new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true, emissive: color, emissiveIntensity: 0.2 }));
    hullMesh.castShadow = !ghost;
    g.add(hullMesh);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.26, 5), ghost ? m.ghost : STD({ color: '#3a2a1c' }));
    mast.position.set(0, 0.17, 0);
    g.add(mast);
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.004), ghost ? m.ghost : new THREE.MeshStandardMaterial({ color: '#fbf3dd', emissive: '#fbf3dd', emissiveIntensity: 0.2 }));
    sail.position.set(0.004, 0.18, 0); sail.rotation.y = Math.PI / 2;
    g.add(sail);
    const pennant = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.003), ghost ? m.ghost : new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }));
    pennant.position.set(-0.03, 0.31, 0);
    g.add(pennant);
    pennant.userData.noOutline = true;
    if (!ghost) this._decorateBuilding(g, color, 0.0);
    return g;
  }
  _placeShip(g, eid) {
    const e = this.board.edges[eid];
    const a = this.board.vertices[e.v[0]], b = this.board.vertices[e.v[1]];
    let x = e.x, z = e.y;
    // On a coast, float the ship on the water side.
    const seaHex = e.hexes.map(h => this.hexes[h]).find(h => h.terrain === 'sea');
    const landHex = e.hexes.map(h => this.hexes[h]).find(h => h.terrain !== 'sea');
    if (seaHex && landHex) { x += (seaHex.wx - x) * 0.22; z += (seaHex.wz - z) * 0.22; }
    g.position.set(x, landHex ? 0.02 : 0.0, z);
    g.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
  }
  _pirateShip() {
    const g = makeShip(1.05, '#1b1b1f', 77);
    (g.userData.sails || []).forEach(m => { m.material = new THREE.MeshStandardMaterial({ color: '#1b1b1f', map: sailTexture('#3a3a42'), side: THREE.DoubleSide, roughness: 0.9, flatShading: true }); });
    const flag = canvasTexture(64, 40, (ctx) => {
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 64, 40);
      ctx.fillStyle = '#f2efe6'; ctx.beginPath(); ctx.arc(32, 16, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillRect(27, 14, 4, 4); ctx.fillRect(34, 14, 4, 4);
      ctx.strokeStyle = '#f2efe6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(18, 28); ctx.lineTo(46, 38); ctx.moveTo(46, 28); ctx.lineTo(18, 38); ctx.stroke();
    });
    const jolly = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.075), new THREE.MeshBasicMaterial({ map: flag, side: THREE.DoubleSide, toneMapped: false }));
    jolly.position.set(0, 0.52, 0);
    g.add(jolly);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d33a2c', transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
    ring.position.y = 0.01;
    g.add(ring);
    g.userData.ring = ring;
    return g;
  }

  /** Dark outline shells and a coloured base plate, so buildings read clearly at any zoom. */
  _decorateBuilding(g, color, radius) {
    const m = this._mats(color);
    const shells = [];
    this._lightShell ||= new THREE.MeshBasicMaterial({ color: '#fff3d6', side: THREE.BackSide, toneMapped: false });
    g.children.forEach(child => {
      if (!child.isMesh || child.userData.noOutline) return;
      // Two-tone outline: dark close to the piece, light outside it, so it separates from any terrain.
      [[m.outline, 1.1], [this._lightShell, 1.2]].forEach(([mat, k]) => {
        const o = new THREE.Mesh(child.geometry, mat);
        o.position.copy(child.position); o.rotation.copy(child.rotation);
        o.scale.copy(child.scale).multiplyScalar(k);
        o.userData.noOutline = true;
        shells.push(o);
      });
    });
    shells.forEach(o => g.add(o));
    if (!radius) return g;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, 0.035, 24), m.plate);
    plate.position.y = 0.012;
    plate.receiveShadow = true;
    plate.userData.noOutline = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.1, radius * 1.12, 0.026, 24), this._lightShell.clone());
    rim.material.side = THREE.FrontSide;
    rim.position.y = 0.008;
    const rim2 = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.2, radius * 1.22, 0.018, 24), m.outline.clone());
    rim2.material.side = THREE.FrontSide;
    rim2.position.y = 0.004;
    rim.userData.noOutline = rim2.userData.noOutline = true;
    g.add(plate, rim, rim2);
    return g;
  }

  _placeBuilding(group, vid) {
    const v = this.board.vertices[vid];
    group.position.set(v.x, TILE_H + 0.012, v.y);
    group.rotation.y = (hash2(vid, 7, 1) - 0.5) * 0.5;
  }

  /** Brings pieces, robber and harbours in line with a game view. animateIds marks freshly built pieces. */
  sync(view, { colors, viewer = null, animate = new Set() } = {}) {
    if (!this.board) return;
    this.colors = colors;
    // Roads: every road on the board is one instance of two shared meshes (2 draw calls in total).
    this._ensureRoadInstances();
    const prevRoads = this.pieces.roads;
    const roads = new Map();
    let ri = 0;
    view.eOwner.forEach((owner, eid) => {
      if (owner === null) return;
      const color = colors[owner];
      roads.set(eid, { owner, color, index: ri });
      const mtx = this._roadMatrix(eid, 1);
      this.roadBody.setMatrixAt(ri, mtx); this.roadEdge.setMatrixAt(ri, mtx);
      this.roadBody.setColorAt(ri, tmpColor.set(color).multiplyScalar(1.12));
      if (!prevRoads.has(eid) && animate.has(`road:${eid}`)) this._animateRoadInstance(eid, color);
      ri++;
    });
    this.roadBody.count = this.roadEdge.count = ri;
    this.roadBody.instanceMatrix.needsUpdate = this.roadEdge.instanceMatrix.needsUpdate = true;
    if (this.roadBody.instanceColor) this.roadBody.instanceColor.needsUpdate = true;
    this.pieces.roads = roads;
    // Buildings.
    const sym = (pid) => SYMBOLS[pid % SYMBOLS.length];
    const symKey = this.showSymbols ? 's' : '';
    view.vOwner.forEach((owner, vid) => {
      const type = view.vType[vid];
      const metro = view.vMetro ? view.vMetro[vid] : null;
      const wall = view.vWall ? !!view.vWall[vid] : false;
      const cur = this.pieces.buildings.get(vid);
      if (owner === null) { if (cur) { this.pieceGroup.remove(cur.mesh); this.pieces.buildings.delete(vid); } return; }
      const key = `${owner}|${type}|${metro}|${wall}|${colors[owner]}|${symKey}`;
      if (cur && cur.key === key) return;
      let mesh = type === 'city' ? this._cityMesh(colors[owner]) : this._settlementMesh(colors[owner]);
      if (metro) mesh.add(this._metroTower(colors[owner], { trade: '#d9b23a', politics: '#3e6fb0', science: '#4f9a5a' }[metro]));
      this._decorateBuilding(mesh, colors[owner], type === 'city' ? 0.21 : 0.155);
      if (wall) mesh.add(this._wallMesh());
      if (this.showSymbols) { const b = this._badge(colors[owner], sym(owner)); b.position.y = metro ? 0.78 : type === 'city' ? 0.62 : 0.42; mesh.add(b); }
      mesh = this._bake(mesh);
      mesh.userData.baseScale = this.style === 'board' ? 1.35 : 1.15;
      mesh.scale.setScalar(mesh.userData.baseScale);
      this._placeBuilding(mesh, vid);
      this.pieceGroup.add(mesh);
      this.pieces.buildings.set(vid, { owner, type, mesh, key });
      if (animate.has(`settlement:${vid}`) || animate.has(`city:${vid}`) || animate.has(`wall:${vid}`)) this._pulseRing(mesh.position.x, mesh.position.z, colors[owner], 5000, type === 'city' ? 0.34 : 0.27);
      if (cur) {
        if (animate.has(`city:${vid}`)) this._animateUpgrade(cur.mesh, mesh);
        else this.pieceGroup.remove(cur.mesh);
      } else if (animate.has(`settlement:${vid}`)) this._animatePop(mesh);
    });
    // Chimney smoke sources (drawn by one instanced mesh in _frame).
    this._smokeSources = [];
    this.pieces.buildings.forEach((b, vid) => {
      const local = b.type === 'city' ? new THREE.Vector3(-0.12, 0.31, 0.04) : new THREE.Vector3(0.05, 0.27, -0.03);
      b.mesh.updateMatrixWorld();
      const wpos = local.applyMatrix4(b.mesh.matrixWorld);
      this._smokeSources.push({ x: wpos.x, y: wpos.y, z: wpos.z, seed: hash2(vid, 3, 9) });
    });

    // Junction plates where roads meet without a building: two instanced meshes for all of them.
    if (!this.nodeTop || this.nodeTop.parent !== this.pieceGroup) {
      const cap = this.board.vertices.length;
      const edgeGeo = mergeGeos([colored(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 6).translate(0, 0.015, 0), '#120b06'), colored(new THREE.CylinderGeometry(0.092, 0.092, 0.044, 6).translate(0, 0.022, 0), '#fff4dc')].map(g => (g.index ? g.toNonIndexed() : g)));
      this.nodeEdge = new THREE.InstancedMesh(edgeGeo, this._edgeVC || new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), cap);
      this.nodeTop = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.078, 0.078, 0.058, 6).translate(0, 0.029, 0), this._roadBodyMat, cap);
      this.nodeTop.setColorAt(0, tmpColor.set('#ffffff'));
      [this.nodeEdge, this.nodeTop].forEach(m => { m.count = 0; m.receiveShadow = true; m.frustumCulled = false; this.pieceGroup.add(m); });
    }
    let ni = 0;
    const nm = new THREE.Matrix4();
    this.board.vertices.forEach(v => {
      if (view.vOwner[v.id] !== null || (view.kOwner && view.kOwner[v.id] !== null)) return;
      const owners = new Set(v.edges.map(e => view.eOwner[e]).filter(o => o !== null));
      if (!owners.size) return;
      nm.makeTranslation(v.x, TILE_H + 0.002, v.y);
      this.nodeEdge.setMatrixAt(ni, nm); this.nodeTop.setMatrixAt(ni, nm);
      this.nodeTop.setColorAt(ni, tmpColor.set(owners.size === 1 ? colors[[...owners][0]] : '#9a8a70').multiplyScalar(1.12));
      ni++;
    });
    this.nodeEdge.count = this.nodeTop.count = ni;
    this.nodeEdge.instanceMatrix.needsUpdate = this.nodeTop.instanceMatrix.needsUpdate = true;
    if (this.nodeTop.instanceColor) this.nodeTop.instanceColor.needsUpdate = true;

    // Cities & Knights: knights, merchant, barbarian ship, swapped tokens.
    this.pieces.knights ||= new Map();
    if (view.kOwner) {
      view.kOwner.forEach((owner, vid) => {
        const cur = this.pieces.knights.get(vid);
        if (owner === null) { if (cur) { this.pieceGroup.remove(cur.mesh); this.pieces.knights.delete(vid); } return; }
        const key = `${owner}|${view.kLevel[vid]}|${view.kActive[vid]}|${colors[owner]}|${symKey}`;
        if (cur && cur.key === key) return;
        if (cur) this.pieceGroup.remove(cur.mesh);
        let mesh = this._knightMesh(colors[owner], view.kLevel[vid], view.kActive[vid]);
        this._decorateBuilding(mesh, colors[owner], 0.12);
        if (view.kActive[vid]) {
          const halo = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.17, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd76b', transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }));
          halo.position.y = 0.04; halo.userData.noOutline = true; halo.userData.halo = true;
          mesh.add(halo);
        }
        if (this.showSymbols) { const b = this._badge(colors[owner], sym(owner)); b.position.y = 0.48; mesh.add(b); }
        mesh = this._bake(mesh);
        this._placeBuilding(mesh, vid);
        mesh.rotation.y = 0;
        mesh.userData.baseScale = this.style === 'board' ? 1.35 : 1.15;
        mesh.scale.setScalar(mesh.userData.baseScale);
        this.pieceGroup.add(mesh);
        this.pieces.knights.set(vid, { owner, mesh, key });
        if (animate.has(`knight:${vid}`)) { this._animatePop(mesh, 500); this._pulseRing(mesh.position.x, mesh.position.z, colors[owner], 4000, 0.22); }
      });
    } else if (this.pieces.knights.size) { this.pieces.knights.forEach(k => this.pieceGroup.remove(k.mesh)); this.pieces.knights.clear(); }
    const mKey = view.merchant ? `${view.merchant.hex}|${view.merchant.owner}|${colors[view.merchant.owner]}` : '';
    if (mKey !== this._merchantKey) {
      if (this.merchant) this.pieceGroup.remove(this.merchant);
      this.merchant = null;
      if (view.merchant) {
        const h = this.hexes[view.merchant.hex];
        this.merchant = this._merchantMesh(colors[view.merchant.owner]);
        this.merchant.position.set(h.wx + 0.36, TILE_H + 0.02, h.wz + 0.3);
        if (this.showSymbols) { const b = this._badge(colors[view.merchant.owner], sym(view.merchant.owner)); b.position.y = 0.32; this.merchant.add(b); }
        this.pieceGroup.add(this.merchant);
        this._animatePop(this.merchant, 500);
      }
      this._merchantKey = mKey;
    }
    if (view.barb) this._syncBarbarians(view.barb.pos);
    else if (this.barbGroup) { this.boardGroup.remove(this.barbGroup); this.barbGroup = null; }
    view.board.hexes.forEach((h, i) => {
      const tok = this.tokens.get(i);
      if (tok && h.number && tok.number !== h.number) { tok.number = h.number; this._setTokenCell(tok.index, h.number); this.flashHex(i, '#c9a8ff'); }
    });
    // Road symbols (colour-blind mode).
    (this._roadBadges || []).forEach(b => this.pieceGroup.remove(b));
    this._roadBadges = [];
    if (this.showSymbols && this.roadSymbols) {
      view.eOwner.forEach((o, eid) => {
        if (o === null) return;
        const e = this.board.edges[eid];
        const b = this._badge(colors[o], sym(o), 0.016);
        b.position.set(e.x, TILE_H + 0.12, e.y);
        this.pieceGroup.add(b);
        this._roadBadges.push(b);
      });
    }

    // Seafarers: ships and the pirate.
    this.pieces.ships ||= new Map();
    if (view.sOwner) {
      view.sOwner.forEach((owner, eid) => {
        const cur = this.pieces.ships.get(eid);
        if (owner === null) { if (cur) { this.pieceGroup.remove(cur.mesh); this.pieces.ships.delete(eid); } return; }
        const key = `${owner}|${colors[owner]}|${symKey}`;
        if (cur && cur.key === key) return;
        if (cur) this.pieceGroup.remove(cur.mesh);
        let mesh = this._shipPiece(colors[owner]);
        if (this.showSymbols) { const b = this._badge(colors[owner], sym(owner)); b.position.y = 0.44; mesh.add(b); }
        mesh = this._bake(mesh);
        this._placeShip(mesh, eid);
        mesh.userData.baseY = mesh.position.y;
        mesh.userData.phase = eid * 0.7;
        this.pieceGroup.add(mesh);
        this.pieces.ships.set(eid, { owner, mesh, key });
        if (animate.has(`ship:${eid}`)) { this._animatePop(mesh, 500); const e = this.board.edges[eid]; this._pulseRing(e.x, e.y, colors[owner], 5000, 0.22); }
      });
    }
    if (view.pirate !== undefined && view.pirate !== null) {
      if (!this.pirate) { this.pirate = this._pirateShip(); this.boardGroup.add(this.pirate); this.pirateHex = null; }
      if (this.pirateHex !== view.pirate) {
        const h = this.hexes[view.pirate];
        const to = new THREE.Vector3(h.wx, -0.02, h.wz);
        if (this.pirateHex === null || !animate.has('pirate')) this.pirate.position.copy(to);
        else { const from = this.pirate.position.clone(); this._anim(1200, t => { this.pirate.position.lerpVectors(from, to, easeInOut(t)); }, () => this._robberLanding(view.pirate)); }
        this.pirateHex = view.pirate;
        if (this.pirateFx) this.boardGroup.remove(this.pirateFx);
        this.pirateFx = this.reduceMotion || !this.q.fx ? null : this._makeFx('storm', h);
        if (this.pirateFx) { this.pirateFx.position.y = 0; this.boardGroup.add(this.pirateFx); }
      }
    } else if (this.pirate) { this.boardGroup.remove(this.pirate); this.pirate = null; }

    // Robber.
    if (this.robberHex !== view.robber) {
      const to = this.hexes[view.robber];
      if (this.robberHex === null || !animate.has('robber')) this.robber.position.set(to.wx, TILE_H + 0.02, to.wz - (to.number ? 0.34 : 0));
      else this._animateRobber(this.hexes[this.robberHex], to);
      this._placeRobberMark(view.robber);
      this.robberHex = view.robber;
    }
    // The token of the robbed tile dims; the robber stands behind it so the number stays readable.
    this.tokens.forEach((t, hid) => { this.tokenMesh.setColorAt(t.index, tmpColor.set(hid === view.robber ? '#8a8a8a' : '#ffffff')); });
    if (this.tokenMesh.instanceColor) this.tokenMesh.instanceColor.needsUpdate = true;
    this._lastView = view;
    this._updateTerritory();
    // Harbour ownership for the viewing player.
    this.harbours.forEach(h => {
      h.owned = viewer !== null && h.port.vertices.some(v => view.vOwner[v] === viewer);
    });
  }

  /** Marks the two corners that give access to a harbour (shown while hovering its sign). */
  showPortSpots(id) {
    if (this.hoverPort === id) return;
    this.hoverPort = id;
    (this._portMarks || []).forEach(m => this.boardGroup.remove(m));
    this._portMarks = [];
    if (id === null || id === undefined || !this.board) return;
    const port = this.board.ports[id];
    const mat = new THREE.MeshBasicMaterial({ color: RES_COLORS[port.type], transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false });
    port.vertices.forEach(vid => {
      const v = this.board.vertices[vid];
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 28).rotateX(-Math.PI / 2), mat);
      ring.position.set(v.x, TILE_H + 0.08, v.y);
      ring.renderOrder = 15;
      this.boardGroup.add(ring);
      this._portMarks.push(ring);
    });
  }

  _seaOnly(eid) { return this.board.edges[eid].hexes.every(h => this.hexes[h].terrain === 'sea'); }

  setTerritory(on) { this.showTerritory = !!on; this._updateTerritory(); }
  _updateTerritory() {
    const view = this._lastView;
    if (!this.territory || !view) return;
    this.board.hexes.forEach((h, i) => {
      const mesh = this.territory[i];
      if (!this.showTerritory) { mesh.visible = false; return; }
      const score = {};
      h.vertices.forEach(v => { const o = view.vOwner[v]; if (o !== null) score[o] = (score[o] || 0) + (view.vType[v] === 'city' ? 2 : 1); });
      const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
      if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) { mesh.visible = false; return; }
      mesh.material.color.set(this.colors[Number(ranked[0][0])]);
      mesh.visible = true;
    });
  }

  // ---------------------------------------------------------------- highlights & ghosts
  setHighlights(kind, ids, color, ghostType, style) {
    this.highlight.meshes.forEach(m => this.boardGroup.remove(m));
    if (this.highlight.ghost) this.boardGroup.remove(this.highlight.ghost);
    this.highlight = { kind, ids: ids || [], meshes: [], ghost: null, color, ghostType, style, set: new Set(ids || []) };
    this.hoverId = null;
    if (!kind || !ids || !ids.length) return;
    const soft = style === 'soft';
    // Bright gold with a white core, sitting on a dark outline: readable on wheat, sand and snow alike.
    const glow = new THREE.MeshBasicMaterial({ color: soft ? '#fff1c2' : '#ffcc1f', transparent: true, opacity: soft ? 0.4 : 1, depthWrite: false, depthTest: false, toneMapped: false });
    const core = new THREE.MeshBasicMaterial({ color: '#fffbe8', transparent: true, opacity: soft ? 0 : 1, depthWrite: false, depthTest: false, toneMapped: false });
    const dark = new THREE.MeshBasicMaterial({ color: '#160d05', transparent: true, opacity: soft ? 0.35 : 0.9, depthWrite: false, depthTest: false, toneMapped: false });
    const halo = new THREE.MeshBasicMaterial({ color: '#ffb800', transparent: true, opacity: soft ? 0.15 : 0.45, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.highlight.material = glow;
    this.highlight.core = core;
    this.highlight.halo = halo;
    // Every highlight in one mesh per layer (halo, dark outline, gold, white core): a handful of draw calls even with 54 spots.
    const layers = { halo: [], dark: [], glow: [], core: [] };
    const put = (layer, geo, x, y, z, rotY = 0) => { const g = (geo.index ? geo.toNonIndexed() : geo); if (rotY) g.rotateY(rotY); g.translate(x, y, z); ['uv'].forEach(a => g.deleteAttribute(a)); if (!g.attributes.normal) g.computeVertexNormals(); layers[layer].push(g); };
    ids.forEach(id => {
      if (kind === 'vertex') {
        const v = this.board.vertices[id];
        const y = TILE_H + (this.pieces.buildings.has(id) || this.pieces.knights?.has(id) ? 0.34 : 0.06);
        put('halo', new THREE.CircleGeometry(0.24, 24).rotateX(-Math.PI / 2), v.x, y - 0.01, v.y);
        put('dark', new THREE.RingGeometry(0.07, 0.15, 28).rotateX(-Math.PI / 2), v.x, y, v.y);
        put('dark', new THREE.CircleGeometry(0.06, 20).rotateX(-Math.PI / 2), v.x, y + 0.001, v.y);
        put('glow', new THREE.RingGeometry(0.088, 0.132, 28).rotateX(-Math.PI / 2), v.x, y + 0.002, v.y);
        put('core', new THREE.CircleGeometry(0.045, 20).rotateX(-Math.PI / 2), v.x, y + 0.003, v.y);
      } else if (kind === 'edge') {
        const e = this.board.edges[id];
        const a = this.board.vertices[e.v[0]], b = this.board.vertices[e.v[1]];
        const rot = -Math.atan2(b.y - a.y, b.x - a.x);
        const y = this._seaOnly(id) ? 0.06 : TILE_H + 0.07;
        put('halo', new THREE.PlaneGeometry(0.72, 0.34).rotateX(-Math.PI / 2), e.x, y - 0.02, e.y, rot);
        put('dark', new THREE.BoxGeometry(0.6, 0.02, 0.15), e.x, y, e.y, rot);
        put('glow', new THREE.BoxGeometry(0.55, 0.03, 0.105), e.x, y + 0.004, e.y, rot);
        put('core', new THREE.BoxGeometry(0.46, 0.032, 0.03), e.x, y + 0.008, e.y, rot);
      } else if (kind === 'hex') {
        const h = this.hexes[id];
        put('dark', new THREE.RingGeometry(0.8, 0.95, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2), h.wx, TILE_H + 0.04, h.wz);
        put('glow', new THREE.RingGeometry(0.83, 0.92, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2), h.wx, TILE_H + 0.041, h.wz);
        put('halo', new THREE.CircleGeometry(0.8, 6, Math.PI / 6).rotateX(-Math.PI / 2), h.wx, TILE_H + 0.035, h.wz);
      }
    });
    [['halo', halo, 8], ['dark', dark, 9], ['glow', glow, 10], ['core', core, 11]].forEach(([k, mat, order]) => {
      if (!layers[k].length) return;
      const mesh = new THREE.Mesh(mergeGeos(layers[k]), mat);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.boardGroup.add(mesh);
      this.highlight.meshes.push(mesh);
    });
  }

  _showGhost(id) {
    const hl = this.highlight;
    if (hl.ghost) { this.boardGroup.remove(hl.ghost); hl.ghost = null; }
    if (id === null || !hl.color || hl.ghostType === 'none') return;
    let g;
    if (hl.kind === 'edge' && (hl.ghostType === 'ship' || (hl.ghostType === 'auto' && this._seaOnly(id)))) { g = this._shipPiece(hl.color, true); this._placeShip(g, id); }
    else if (hl.kind === 'edge') { g = this._roadMesh(hl.color, true); this._placeRoad(g, id); }
    else if (hl.kind === 'vertex') {
      g = hl.ghostType === 'city' ? this._cityMesh(hl.color, true) : hl.ghostType === 'knight' ? this._knightMesh(hl.color, 1, true, true) : this._settlementMesh(hl.color, true);
      this._placeBuilding(g, id);
    } else if (hl.kind === 'hex') {
      g = this.robber.clone();
      const ghostMat = new THREE.MeshStandardMaterial({ color: '#2f2c33', transparent: true, opacity: 0.5, depthWrite: false });
      g.traverse(o => { if (o.isMesh) o.material = ghostMat; });
      const h = this.hexes[id];
      g.position.set(h.wx, TILE_H + 0.02, h.wz - (h.number ? 0.34 : 0));
    }
    if (g) { this.boardGroup.add(g); hl.ghost = g; }
  }

  // ---------------------------------------------------------------- effects
  _anim(dur, fn, done) { this.anims.push({ t0: performance.now(), dur, fn, done }); }

  _animateRoad(mesh) {
    const len = mesh.userData.len;
    mesh.scale.x = 0.001;
    this._dust(mesh.position.clone().add(new THREE.Vector3(Math.cos(-mesh.rotation.y) * len / 2, 0.05, Math.sin(-mesh.rotation.y) * len / 2)));
    this._anim(520, t => { mesh.scale.x = Math.max(0.001, len * easeOutBack(t)); mesh.position.y = TILE_H + 0.002 + (1 - t) * 0.05; });
  }
  _animatePop(mesh, dur = 650) {
    mesh.scale.setScalar(0.01);
    const y = mesh.position.y;
    this._dust(mesh.position.clone().add(new THREE.Vector3(0, 0.05, 0)));
    const k = mesh.userData.baseScale || 1;
    this._anim(dur, t => { mesh.scale.setScalar(Math.max(0.01, easeOutBack(t)) * k); mesh.position.y = y + (1 - t) * 0.35; });
  }
  _animateUpgrade(oldMesh, newMesh) {
    newMesh.scale.setScalar(0.01);
    const y = newMesh.position.y;
    this._anim(380, t => { oldMesh.scale.setScalar(1 - t); oldMesh.position.y = y - t * 0.05; }, () => this.pieceGroup.remove(oldMesh));
    this._anim(820, t => {
      const k = t < 0.35 ? 0 : (t - 0.35) / 0.65;
      const b = newMesh.userData.baseScale || 1;
      newMesh.scale.set(Math.max(0.01, easeOutBack(k)) * b, Math.max(0.01, easeOutBack(k) * (1 + Math.sin(k * Math.PI) * 0.15)) * b, Math.max(0.01, easeOutBack(k)) * b);
    });
    this._dust(newMesh.position.clone().add(new THREE.Vector3(0, 0.05, 0)), 14);
  }
  _animateRobber(from, to) {
    const a = new THREE.Vector3(this.robber.position.x, this.robber.position.y, this.robber.position.z);
    const b = new THREE.Vector3(to.wx, TILE_H + 0.02, to.wz - (to.number ? 0.34 : 0));
    this._anim(900, t => {
      const e = easeInOut(t);
      this.robber.position.lerpVectors(a, b, e);
      this.robber.position.y += Math.sin(e * Math.PI) * 1.1;
      this.robber.rotation.y = e * Math.PI * 2;
    }, () => { this.robber.rotation.y = 0; this._robberLanding(to.id); });
  }
  _dust(pos, n = 9) {
    if (this.reduceMotion) return;
    const mat = new THREE.MeshBasicMaterial({ color: '#e9dcc0', transparent: true, opacity: 0.8, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.03, 6, 4);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(geo, mat.clone());
      const a = (i / n) * Math.PI * 2;
      p.position.copy(pos);
      this.boardGroup.add(p);
      this._anim(600 + i * 15, t => {
        p.position.set(pos.x + Math.cos(a) * t * 0.22, pos.y + t * 0.08, pos.z + Math.sin(a) * t * 0.22);
        p.scale.setScalar(1 + t * 1.6);
        p.material.opacity = 0.75 * (1 - t);
      }, () => this.boardGroup.remove(p));
    }
  }
  flashHex(hid, color = '#fff3c4') {
    const ring = this.hexGlows[hid];
    ring.material.color.set(color);
    ring.visible = true;
    this._anim(1300, t => { ring.material.opacity = Math.sin(t * Math.PI) * 0.85; }, () => { ring.visible = false; });
    const tok = this.tokens.get(hid);
    if (tok) this._anim(700, t => { tok.scale = 1 + Math.sin(t * Math.PI) * 0.35; tok.lift = Math.sin(t * Math.PI) * 0.12; this._tokenMatrices(); }, () => { tok.scale = 1; tok.lift = 0; this._tokenMatrices(); });
  }
  /** The robber's number came up: he hops, rattles his loot and the tile pulses red. */
  robberGloat() {
    if (!this.robber) return;
    const base = this.robber.position.clone();
    this.flashHex(this.robberHex, '#ff3b2a');
    const eyes = this.robber.userData.eyes;
    this._anim(1100, t => {
      const hop = Math.abs(Math.sin(t * Math.PI * 3)) * 0.09 * (1 - t);
      this.robber.position.set(base.x + Math.sin(t * 60) * 0.012 * (1 - t), base.y + hop, base.z);
      this.robber.rotation.y = Math.sin(t * Math.PI * 4) * 0.35 * (1 - t);
      if (eyes) eyes.color.setRGB(1, 0.2 + 0.4 * (1 - t), 0.1);
    }, () => { this.robber.position.copy(base); this.robber.rotation.y = 0; });
  }
  shakeRobber() {
    const x0 = this.robber.position.x;
    this._anim(600, t => { this.robber.position.x = x0 + Math.sin(t * 40) * 0.025 * (1 - t); });
  }

  // ---------------------------------------------------------------- camera & projection
  resetCamera(instant) {
    // Fit the island (with its harbours) to the screen, whatever its shape.
    const aspect = this.camera.aspect || 1;
    const tanHalf = Math.tan((this.camera.fov * D2R) / 2);
    const portrait = aspect < 0.9;
    const flat = this.style === 'board';
    const polar = flat ? 0.18 : portrait ? 0.5 : 0.78;
    const B = this.bounds || { halfX: 5, halfZ: 4.5 };
    const fitWidth = ((B.halfX + (portrait ? 0.3 : 1.0)) / (tanHalf * aspect)) * 0.92;
    const fitHeight = ((B.halfZ + 0.7) / tanHalf) * (flat ? 1.22 : 0.86);
    const dist = Math.min(70, Math.max(11.5, fitWidth, fitHeight));
    this.controls.maxDistance = Math.max(22, dist * 1.25);
    const target = new THREE.Vector3(0, 0, flat ? 0.45 : portrait ? 0.9 : 0.65); // nudged up to clear the hand at the bottom
    const pos = new THREE.Vector3(0, Math.cos(polar) * dist, Math.sin(polar) * dist).add(target);
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    this._anim(700, t => {
      const e = easeInOut(t);
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
    });
  }
  /** A short sweep in from above when a game starts. */
  introSweep() {
    if (this.reduceMotion) return;
    this.resetCamera(true);
    const endPos = this.camera.position.clone(), endT = this.controls.target.clone();
    const startPos = endPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.6).multiplyScalar(1.45);
    this.camera.position.copy(startPos);
    this._anim(1700, t => { const e = easeInOut(t); this.camera.position.lerpVectors(startPos, endPos, e); this.controls.target.copy(endT); });
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
  }
  projectHex(hid) { const h = this.hexes[hid]; return this.project(h.wx, TILE_H + 0.1, h.wz); }
  projectVertex(vid) { const v = this.board.vertices[vid]; return this.project(v.x, TILE_H + 0.2, v.y); }

  // ---------------------------------------------------------------- input
  _bindPointer() {
    let down = null;
    const toNdc = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const pick = (e) => {
      const kind = this.highlight.kind;
      toNdc(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (kind) {
        const cands = this.pickGroups[kind].filter(m => this.highlight.set.has(m.userData.id));
        const hit = this.raycaster.intersectObjects(cands, false)[0];
        if (hit) return { kind, id: hit.object.userData.id };
        // Forgiving touch: snap to the nearest candidate on screen within 28px.
        if (e.pointerType === 'touch' || e.type === 'pointerup') {
          let best = null, bestD = 28;
          cands.forEach(m => {
            const s = this.project(m.position.x, m.position.y, m.position.z);
            const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
            if (d < bestD) { bestD = d; best = m; }
          });
          if (best) return { kind, id: best.userData.id };
        }
        return null;
      }
      const sign = this.raycaster.intersectObjects((this.harbours || []).map(h => h.sign), false)[0];
      if (sign) return { kind: 'port', id: sign.object.userData.id, idle: true };
      const hit = this.raycaster.intersectObjects(this.pickGroups.hex || [], false)[0];
      return hit ? { kind: 'hex', id: hit.object.userData.id, idle: true } : null;
    };
    ['pointerdown', 'pointermove', 'wheel'].forEach(ev => this.canvas.addEventListener(ev, () => { this.lastActive = performance.now(); }, { passive: true }));
    this.canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.canvas.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 7) return;
      const p = pick(e);
      if (p && !p.idle) this.onPick(p);
    });
    this.canvas.addEventListener('pointermove', e => {
      if (down || e.pointerType === 'touch') return;
      const p = pick(e);
      const id = p && !p.idle ? p.id : null;
      if (id !== this.hoverId) { this.hoverId = id; this._showGhost(id); }
      this.showPortSpots(p && p.kind === 'port' ? p.id : null);
      this.canvas.style.cursor = id !== null ? 'pointer' : 'grab';
      this.onHover(p, e);
    });
    this.canvas.addEventListener('pointerleave', () => { this.onHover(null); if (this.hoverId !== null) { this.hoverId = null; this._showGhost(null); } });
  }

  _resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const before = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.board && Math.abs(before - this.camera.aspect) > 0.25) this.resetCamera(true);
  }

  // ---------------------------------------------------------------- per-frame
  _updateSheep(dt) {
    if (!this.sheepMesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const t = this.time.value;
    this.sheep.forEach((sh, i) => {
      if (dt > 0 && !this.reduceMotion) {
        if (sh.wait > 0) sh.wait -= dt;
        else {
          if (!sh.target) {
            const a = Math.random() * Math.PI * 2, d = 0.08 + Math.random() * 0.15;
            const tx = sh.home.x + Math.cos(a) * d, tz = sh.home.z + Math.sin(a) * d;
            if (hexRho(tx, tz) < 0.75 && Math.hypot(tx, tz) > 0.4) sh.target = { x: tx, z: tz };
            else sh.wait = 0.5;
          }
          if (sh.target) {
            const dx = sh.target.x - sh.x, dz = sh.target.z - sh.z, d = Math.hypot(dx, dz);
            const want = Math.atan2(-dz, dx);
            let diff = want - sh.heading;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            sh.heading += diff * Math.min(1, dt * 4);
            if (Math.abs(diff) < 0.3) { const step = Math.min(d, dt * 0.06); sh.x += dx / d * step; sh.z += dz / d * step; }
            if (d < 0.01) { sh.target = null; sh.wait = 2 + Math.random() * 6; }
          }
        }
      }
      const grazing = !sh.target;
      const y = TILE_H + this.painters[sh.hex.id].height(sh.x, sh.z) + (sh.target ? Math.abs(Math.sin(t * 9 + sh.bob)) * 0.008 : 0);
      q.setFromEuler(new THREE.Euler(0, sh.heading, grazing ? Math.sin(t * 1.5 + sh.bob) * 0.12 - 0.1 : 0));
      m.compose(p.set(sh.hex.wx + sh.x, y, sh.hex.wz + sh.z), q, s);
      this.sheepMesh.setMatrixAt(i, m);
    });
    this.sheepMesh.instanceMatrix.needsUpdate = true;
  }

  /** Advances animations. Animations started by another's finish are kept (they used to be lost,
   *  leaving e.g. the robber's landing ring frozen on the board). */
  _stepAnims(now) {
    const list = this.anims;
    this.anims = [];
    const keep = list.filter(a => {
      const p = Math.min(1, (now - a.t0) / a.dur);
      a.fn(p);
      if (p >= 1) { if (a.done) a.done(); return false; }
      return true;
    });
    this.anims = keep.concat(this.anims);
  }

  _updateSmoke(t) {
    if (!this.q.fx || this.style === 'board') { if (this.smoke) this.smoke.visible = false; return; }
    const src = this._smokeSources || [];
    const per = 3;
    if (!this.smoke || this.smoke.userData.cap < src.length * per) {
      if (this.smoke) this.boardGroup.remove(this.smoke);
      const cap = Math.max(30, src.length * per + 15);
      this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: '#d8d4cc', transparent: true, opacity: 0.38, depthWrite: false }), cap);
      this.smoke.userData.cap = cap;
      this.smoke.frustumCulled = false;
      this.boardGroup.add(this.smoke);
    }
    this.smoke.visible = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let i = 0;
    src.forEach(s0 => {
      for (let k = 0; k < per; k++) {
        const ph = (t * 0.22 + k / per + s0.seed) % 1;
        const r = 0.012 + ph * 0.04;
        m.compose(p.set(s0.x + ph * 0.07 + Math.sin(t + k) * 0.01, s0.y + ph * 0.32, s0.z - ph * 0.03), q, sc.setScalar(r * Math.sin(Math.min(1, ph * 1.4) * Math.PI * 0.95 + 0.15)));
        this.smoke.setMatrixAt(i++, m);
      }
    });
    this.smoke.count = i;
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  _updateBoats(dt) {
    const t = this.time.value;
    this.boats.forEach(b => {
      b.a += b.speed * dt;
      const x = Math.cos(b.a) * b.rad, z = Math.sin(b.a) * b.rad * 0.85;
      b.ship.position.set(x, -0.02 + Math.sin(t * 1.3 + b.phase) * 0.02, z);
      b.ship.rotation.y = -b.a + (b.speed > 0 ? -Math.PI / 2 : Math.PI / 2);
      b.ship.rotation.z = Math.sin(t + b.phase) * 0.05;
    });
  }

  /** 'auto', 'high', 'balanced' or 'low'. Rebuilds the board so density and shadows apply. */
  setQuality(setting) {
    this.setting = setting;
    this.qualityKey = setting === 'auto' ? autoQuality() : setting;
    this._applyQuality();
  }
  _applyQuality() {
    this.q = QUALITY[this.qualityKey];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this._resize();
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    if (this.board) { const b = this.board, v = this._lastView, c = this.colors; this.setBoard(b); if (v) this.sync(v, { colors: c || [], viewer: null }); }
    this.renderer.shadowMap.needsUpdate = true;
    this.fpsSamples = [];
  }
  poke() { this.lastActive = performance.now(); }
  /** Simple performance numbers for the FPS overlay and tests. */
  stats() {
    const i = this.renderer.info;
    return { quality: this.qualityKey, fps: this.fps || 0, calls: i.render.calls, triangles: i.render.triangles, pixelRatio: this.renderer.getPixelRatio() };
  }

  _frame() {
    // Frame cap (Battery saver runs at 30 fps).
    const nowMs = performance.now();
    // Idle: nobody touching the board and nothing animating → 30 fps is plenty.
    const idle = nowMs - (this.lastActive || 0) > 12000 && !this.anims.length && !this.autoOrbit;
    const fpsCap = idle ? Math.min(30, this.q.fps) : this.q.fps;
    if (fpsCap < 60 && nowMs - this.lastFrameAt < 1000 / fpsCap - 2) return;
    const frameMs = nowMs - this.lastFrameAt;
    this.lastFrameAt = nowMs;
    if (frameMs > 0 && frameMs < 1000) {
      this.fpsSamples.push(frameMs);
      if (this.fpsSamples.length > 90) this.fpsSamples.shift();
      if (this.frameNo % 30 === 0) {
        const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
        this.fps = Math.round(1000 / avg);
        // Auto: step down when it keeps struggling (never flip back up, to avoid see-sawing).
        if (this.setting === 'auto' && this.fpsSamples.length >= 90 && this.fps < (this.q.fps === 30 ? 24 : 40) && this.qualityKey !== 'low' && !document.hidden) {
          this.qualityKey = this.qualityKey === 'high' ? 'balanced' : 'low';
          this._applyQuality();
          this.onQuality?.(this.qualityKey); // only automatic step-downs are announced
        }
      }
    }
    this.frameNo++;
    if (this.q.shadows && (this.q.shadowEvery <= 1 || this.frameNo % this.q.shadowEvery === 0 || this.anims.length)) this.renderer.shadowMap.needsUpdate = true;
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.reduceMotion) this.time.value += dt;
    const t = this.time.value;
    if (this.autoOrbit && !this.reduceMotion) {
      const t0 = this.controls.target, p = this.camera.position;
      const ang = 0.05 * dt, dx = p.x - t0.x, dz = p.z - t0.z;
      p.x = t0.x + dx * Math.cos(ang) - dz * Math.sin(ang);
      p.z = t0.z + dx * Math.sin(ang) + dz * Math.cos(ang);
    }
    this.controls.update();
    // Fog follows the camera distance so zoomed-out views (phones) stay clear.
    const camDist = this.camera.position.distanceTo(this.controls.target);
    this.scene.fog.near = camDist + 8;
    this.scene.fog.far = camDist + 34;
    if (this.seaUniforms) { this.seaUniforms.uFogNear.value = this.scene.fog.near; this.seaUniforms.uFogFar.value = this.scene.fog.far; }
    if (this.board) {
      if (this.style !== 'board') this._updateSheep(dt);
      this.harbours.forEach(h => {
        h.ship.position.y = -0.02 + Math.sin(t * 1.4 + h.seed) * 0.012;
        h.ship.rotation.x = Math.sin(t * 1.1 + h.seed) * 0.04;
        h.ship.rotation.z = Math.sin(t * 0.9 + h.seed * 2) * 0.025;

        const target = h.owned ? 0.85 : 0;
        h.ownRing.material.opacity += (target - h.ownRing.material.opacity) * 0.1;
        h.ownRing.visible = h.ownRing.material.opacity > 0.02;
        if (h.owned !== h.signOwned) {
          h.signOwned = h.owned;
          h.sign.material.map.dispose();
          h.sign.material.map = portSignTexture(h.port, h.owned);
        }
        const s = (h.owned ? 1.1 + Math.sin(t * 2.4) * 0.02 : 1) * (this.hoverPort === h.port.id ? 1.15 : 1) * (this.style === 'board' ? 1.15 : 1);
        h.sign.scale.set(0.07 * s, 0.028 * s, 1);
        h.ownRing.scale.setScalar(1 + Math.sin(t * 2.4) * 0.08);
      });
      this._updateBoats(dt);
      this.pieces.ships?.forEach(sh => { sh.mesh.position.y = sh.mesh.userData.baseY + Math.sin(t * 1.6 + sh.mesh.userData.phase) * 0.012; sh.mesh.rotation.z = Math.sin(t * 1.2 + sh.mesh.userData.phase) * 0.04; });
      if (this.pirate) { this.pirate.rotation.z = Math.sin(t * 1.1) * 0.05; this.pirate.userData.ring.material.opacity = 0.35 + 0.2 * Math.sin(t * 2.4); }
      if (this.style !== 'board' && this.q.wildlife) this._updateWildlife(t, dt);
      this._updateSmoke(t);
      this._updateFx(this.robberFx, t, dt);
      this._updateFx(this.pirateFx, t, dt);

      if (this.robber?.userData.lantern) this.robber.userData.lantern.material.opacity = 0.75 + 0.25 * Math.sin(t * 11) * Math.sin(t * 4.3);
      if (this.robber && this.robber.userData.eyes) {
        this.robber.scale.set(1, 1 + Math.sin(t * 2.2) * 0.015, 1);
        const flick = 0.75 + 0.25 * Math.sin(t * 7.3) * Math.sin(t * 2.9);
        this.robber.userData.eyes.color.setRGB(1, 0.55 + 0.25 * flick, 0.12);
        if (this.robberMark) this.robberMark.userData.warn.material.opacity = 0.45 + 0.2 * Math.sin(t * 2.4);
      }
      if (this.barbShip) { this.barbShip.position.y = -0.02 + Math.sin(t * 1.2) * 0.02; this.barbShip.rotation.z = Math.sin(t * 0.9) * 0.05; }
      (this._recent || []).forEach((r, i) => { r.material.opacity = 0.45 + 0.35 * Math.sin(t * 2.2 + i); });
      this.pieces.knights?.forEach(k => k.mesh.children.forEach(c => { if (c.userData.halo) c.material.opacity = 0.55 + 0.3 * Math.sin(t * 3); }));
      this.pieces.buildings.forEach(b => { if (b.mesh.userData.flag) b.mesh.userData.flag.rotation.y = Math.sin(t * 3 + b.mesh.position.x * 5) * 0.4; });
      if (this.highlight.material) {
        const soft = this.highlight.style === 'soft';
        const wave = Math.sin(t * 5);
        this.highlight.material.opacity = soft ? 0.3 + Math.sin(t * 3) * 0.12 : 0.8 + wave * 0.2;
        if (this.highlight.halo) this.highlight.halo.opacity = soft ? 0.12 : 0.3 + (wave + 1) * 0.18;
        if (this.highlight.core) this.highlight.core.opacity = soft ? 0 : 0.75 + 0.25 * wave;
      }
    }
    this._stepAnims(performance.now());
    this.renderer.render(this.scene, this.camera);
  }
}
