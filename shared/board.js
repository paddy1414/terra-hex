// Terra Hex — hex grid geometry and board generation for every map.
// Pure data, no DOM: shared by the browser, the server and the tests.
//
// Hexes are pointy-top, in axial coordinates (q, r). One hex has size 1 (centre to corner).
// World layout: x = sqrt(3) * (q + r/2), y = 1.5 * r  (y grows "south", toward the viewer),
// then the whole board is shifted so its centre sits on the origin.

export const SQRT3 = Math.sqrt(3);
export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
export const TERRAIN_RESOURCE = {
  forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore', desert: null
};
export const TERRAIN_COUNTS = { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 };
export const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
// The classic alphabetical token order, laid in a spiral (skipping the desert).
export const SPIRAL_TOKENS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
export const PORT_TYPES = ['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
const PORT_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4]; // classic island: gaps between its 9 harbours

const BEGINNER = [
  ['mountains', 10], ['pasture', 2], ['forest', 9],
  ['fields', 12], ['hills', 6], ['pasture', 4], ['hills', 10],
  ['fields', 9], ['forest', 11], ['desert', null], ['forest', 3], ['mountains', 8],
  ['forest', 8], ['mountains', 3], ['fields', 4], ['pasture', 5],
  ['hills', 5], ['fields', 6], ['pasture', 11]
];
const BEGINNER_PORTS = ['any', 'sheep', 'any', 'any', 'brick', 'wood', 'any', 'wheat', 'ore'];

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (q, r) => `${q},${r}`;
const axialDistance = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));

export const LAYOUTS = ['beginner', 'balanced', 'random', 'unrestricted'];

export function pips(n) { return n ? 6 - Math.abs(7 - n) : 0; }
export function hexCenter(q, r) { return { x: SQRT3 * (q + r / 2), y: 1.5 * r }; }
export function hexCorner(cx, cy, i) {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: cx + Math.cos(a), y: cy + Math.sin(a) };
}

// ------------------------------------------------------------------ map shapes
// Cell types: 'land' (random terrain), 'desert', 'rich' (ore/wheat/sheep), 'water' (an inland lake).
function shapeHexagon(radius, typeFor = () => 'land') {
  const out = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) > radius) continue;
      const type = typeFor(q, r);
      if (type) out.push({ q, r, type });
    }
  }
  return out;
}
/** Odd-row offset ASCII art: '.' land, 'D' desert, '*' rich, '~' water. Odd rows sit half a hex right. */
function shapeFromAscii(rows) {
  const out = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, col) => {
      const type = { '.': 'land', D: 'desert', '*': 'rich', '~': 'water' }[ch];
      if (type) out.push({ q: col - (r - (r & 1)) / 2, r, type });
    });
  });
  return out;
}
function ring(radius, startDir = 0) {
  if (radius === 0) return [[0, 0]];
  const out = [];
  const d = DIRS[(startDir + 4) % 6];
  let q = d[0] * radius, r = d[1] * radius;
  for (let side = 0; side < 6; side++) {
    const step = DIRS[(startDir + side) % 6];
    for (let k = 0; k < radius; k++) { out.push([q, r]); q += step[0]; r += step[1]; }
  }
  return out;
}
function shapeWild(rand) {
  // A connected landmass grown outward from the centre; a new shape every game.
  const target = 24 + Math.floor(rand() * 8);
  const land = new Map([[key(0, 0), { q: 0, r: 0 }]]);
  let guard = 0;
  while (land.size < target && guard++ < 6000) {
    const cells = [...land.values()];
    const base = cells[Math.floor(rand() * cells.length)];
    const [dq, dr] = DIRS[Math.floor(rand() * 6)];
    const q = base.q + dq, r = base.r + dr;
    if (land.has(key(q, r)) || axialDistance(q, r) > 4) continue;
    const n = DIRS.filter(([a, b]) => land.has(key(q + a, r + b))).length;
    if (n >= 2 || rand() < 0.25) land.set(key(q, r), { q, r });
  }
  return [...land.values()].map(c => ({ ...c, type: 'land' }));
}

export const MAPS = [
  { id: 'classic', name: 'Classic Island', players: [3, 4], desc: 'The standard 19-tile island.', cells: () => shapeHexagon(2) },
  { id: 'diamond', name: 'Diamond', players: [3, 4], desc: 'A long north–south island.', cells: () => shapeFromAscii(['  .', ' ..', ' ...', '....', '.....', '....', ' ...', ' ..', '  .']) },
  {
    id: 'oasis', name: 'Desert Oasis', players: [2, 4], deserts: 0, desc: 'A central desert ringed by rich land.',
    cells: () => shapeHexagon(2, (q, r) => (q === 0 && r === 0 ? 'desert' : axialDistance(q, r) === 1 ? 'rich' : 'land'))
  },
  {
    id: 'lakes', name: 'Lakes', players: [3, 5], desc: 'A large island with three inland lakes.',
    cells: () => { const lakes = new Set(['1,-2', '-2,1', '1,1']); return shapeHexagon(3, (q, r) => (lakes.has(key(q, r)) ? 'water' : 'land')); }
  },
  {
    id: 'gear', name: 'Gear', players: [3, 5], desc: 'A ring of land around a central lake, with outlying teeth.',
    cells: () => {
      const cells = shapeHexagon(2, (q, r) => (q === 0 && r === 0 ? 'water' : 'land'));
      ring(3).forEach(([q, r], i) => { if (i % 3 === 1) cells.push({ q, r, type: 'land' }); });
      return cells;
    }
  },
  {
    id: 'archipelago', name: 'Archipelago', players: [3, 5], desc: 'Several islands split by channels of sea.',
    cells: () => { const sea = new Set(['0,-2', '0,-1', '0,1', '0,2', '-1,0', '1,0', '-2,2', '2,-2']); return shapeHexagon(3, (q, r) => (sea.has(key(q, r)) ? null : 'land')); }
  },
  {
    id: 'twinisles', name: 'Twin Isles', players: [3, 5], desc: 'Two islands joined by a single land bridge.',
    cells: () => {
      const out = [];
      [[-3, 0], [3, 0]].forEach(([cq, cr]) => {
        shapeHexagon(2).forEach(({ q, r }) => {
          const corner = axialDistance(q, r) === 2 && (q === 0 || r === 0 || q + r === 0);
          if (!corner) out.push({ q: q + cq, r: r + cr, type: 'land' });
        });
      });
      out.push({ q: 0, r: 0, type: 'land' });
      return out;
    }
  },
  { id: 'pangea', name: 'Grand Continent', players: [4, 6], desc: 'A 37-tile continent with room for six.', cells: () => shapeHexagon(3) },
  {
    id: 'isles', name: 'British Isles', players: [4, 6], desc: 'A long, ragged pair of islands.',
    cells: () => shapeFromAscii([
      '      ..', '     ...', '     ..', '    ...', ' ..  ..', '...  ...', '...   ..',
      '....  ...', ' ..  ....', '    .....', '    .....', '  .......', ' .....'
    ])
  },
  { id: 'wild', name: 'Wild Frontier', players: [2, 5], random: true, desc: 'A new random coastline every game.', cells: (rand) => shapeWild(rand) },
  {
    id: 'newshores', name: 'New Shores', players: [3, 4], sea: true, desc: 'Seafarers: a home island, with small gold-bearing islands across the water.',
    cells: () => {
      const out = shapeHexagon(2).map(c => ({ q: c.q - 2, r: c.r, type: 'land' }));
      [[2, -3, 'land'], [3, -3, 'gold'], [2, -2, 'land'], [3, 0, 'land'], [4, -1, 'gold'], [4, 0, 'land'], [0, 3, 'land'], [1, 2, 'gold'], [-1, 4, 'land']]
        .forEach(([q, r, type]) => out.push({ q, r, type }));
      return out;
    }
  },
  { id: 'custom', name: 'Map Generator', players: [2, 6], custom: true, desc: 'Your own island from a seed: size, shape, lakes, resources and look.', cells: () => shapeHexagon(2) }
];
export const MAP_BY_ID = Object.fromEntries(MAPS.map(m => [m.id, m]));

// ------------------------------------------------------------------ topology
/** Builds hex/vertex/edge topology from cells (land only); lakes are returned separately. */
export function buildTopology(cells = shapeHexagon(2)) {
  const landCells = cells.filter(c => c.type !== 'water');
  const pos = cells.map(c => hexCenter(c.q, c.r));
  // Centre on dry land, so adding a ring of sea never shifts the island.
  const landPos = landCells.filter(c => c.type !== 'sea').map(c => hexCenter(c.q, c.r));
  const cx = landPos.reduce((a, p) => a + p.x, 0) / landPos.length;
  const cy = landPos.reduce((a, p) => a + p.y, 0) / landPos.length;
  const round = (v) => Math.round(v * 1e6) / 1e6;

  const hexes = landCells.map((c, id) => {
    const p = hexCenter(c.q, c.r);
    return { id, q: c.q, r: c.r, x: round(p.x - cx), y: round(p.y - cy), cell: c.type, terrain: 'desert', number: null, vertices: [], edges: [], neighbors: [] };
  });
  const lakes = cells.filter(c => c.type === 'water').map(c => { const p = hexCenter(c.q, c.r); return { q: c.q, r: c.r, x: round(p.x - cx), y: round(p.y - cy) }; });
  void pos;
  const byKey = new Map(hexes.map(h => [key(h.q, h.r), h]));
  hexes.forEach(h => {
    DIRS.forEach(([dq, dr]) => { const n = byKey.get(key(h.q + dq, h.r + dr)); if (n) h.neighbors.push(n.id); });
  });

  const vertices = [];
  const vKey = new Map();
  const keyOf = (p) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  hexes.forEach(h => {
    for (let i = 0; i < 6; i++) {
      const p = hexCorner(h.x, h.y, i);
      const k = keyOf(p);
      let v = vKey.get(k);
      if (!v) {
        v = { id: vertices.length, x: round(p.x), y: round(p.y), hexes: [], edges: [], adj: [], port: null };
        vertices.push(v);
        vKey.set(k, v);
      }
      v.hexes.push(h.id);
      h.vertices.push(v.id);
    }
  });

  const edges = [];
  const eKey = new Map();
  hexes.forEach(h => {
    for (let i = 0; i < 6; i++) {
      const a = h.vertices[i], b = h.vertices[(i + 1) % 6];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = eKey.get(k);
      if (!e) {
        const va = vertices[a], vb = vertices[b];
        e = { id: edges.length, v: [Math.min(a, b), Math.max(a, b)], hexes: [], x: round((va.x + vb.x) / 2), y: round((va.y + vb.y) / 2), port: null };
        edges.push(e);
        eKey.set(k, e);
        va.edges.push(e.id); vb.edges.push(e.id);
        va.adj.push(b); vb.adj.push(a);
      }
      e.hexes.push(h.id);
      h.edges.push(e.id);
    }
  });
  return { hexes, vertices, edges, lakes };
}

/** Sea-facing coastal edges (one land hex, not bordering a lake), sorted by angle around the centre. */
export const isSeaHex = (h) => h.cell === 'sea' || h.terrain === 'sea';
export function coastalEdges(topo) {
  const lakeAt = new Set((topo.lakes || []).map(l => `${Math.round(l.x * 100)},${Math.round(l.y * 100)}`));
  return topo.edges
    .filter(e => {
      const land = e.hexes.filter(x => !isSeaHex(topo.hexes[x]));
      if (land.length !== 1) return false;
      if (e.hexes.length === 2) return true; // land facing a sea space (Seafarers)
      const h = topo.hexes[e.hexes[0]];
      const ox = 2 * e.x - h.x, oy = 2 * e.y - h.y; // centre of the cell across this edge
      return !lakeAt.has(`${Math.round(ox * 100)},${Math.round(oy * 100)}`);
    })
    .map(e => ({ e, a: Math.atan2(e.y, e.x) }))
    .sort((p, q) => p.a - q.a)
    .map(p => p.e);
}

// ------------------------------------------------------------------ generation
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const isRed = (n) => n === 6 || n === 8;
function redNumbersTouch(hexes) {
  return hexes.some(h => isRed(h.number) && h.neighbors.some(n => isRed(hexes[n].number)));
}
/** Lower is better: touching reds are bad, matching neighbours mildly bad. */
function layoutPenalty(hexes) {
  let bad = 0;
  hexes.forEach(h => h.neighbors.forEach(n => {
    if (n < h.id || !h.number || !hexes[n].number) return;
    if (isRed(h.number) && isRed(hexes[n].number)) bad += 10;
    else if (h.number === hexes[n].number) bad += 1;
  }));
  return bad;
}
/** Terrain spread in classic proportions over any number of tiles. */
function terrainPool(count, rand) {
  const weights = { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3 };
  const pool = [];
  const fractions = [];
  Object.entries(weights).forEach(([t, w]) => {
    const exact = (count * w) / 18;
    const n = Math.floor(exact);
    for (let i = 0; i < n; i++) pool.push(t);
    fractions.push({ t, frac: exact - n + rand() * 0.001 });
  });
  fractions.sort((a, b) => b.frac - a.frac);
  for (let i = 0; pool.length < count; i++) pool.push(fractions[i % fractions.length].t);
  return shuffle(pool, rand);
}
function numberPool(count, rand) {
  const pool = [];
  while (pool.length < count) pool.push(...shuffle(NUMBER_TOKENS, rand));
  return shuffle(pool.slice(0, count), rand);
}
function dealNumbers(hexes, layout, rand) {
  const numbered = hexes.filter(h => h.terrain !== 'desert' && h.terrain !== 'sea');
  const tries = layout === 'unrestricted' ? 1 : layout === 'balanced' ? 700 : 500;
  let best = null, bestScore = Infinity;
  for (let t = 0; t < tries; t++) {
    const tokens = numberPool(numbered.length, rand);
    numbered.forEach((h, i) => { h.number = tokens[i]; });
    if (layout === 'unrestricted') return;
    const score = layout === 'balanced' ? layoutPenalty(hexes) : (redNumbersTouch(hexes) ? 1 : 0);
    if (score < bestScore) { bestScore = score; best = tokens; }
    if (score === 0) break;
  }
  numbered.forEach((h, i) => { h.number = best[i]; });
  // Repair: move any red number that touches another red onto a tile with no red neighbours.
  for (let guard = 0; guard < 400 && redNumbersTouch(hexes); guard++) {
    const bad = numbered.filter(h => isRed(h.number) && h.neighbors.some(n => isRed(hexes[n].number)));
    const from = bad[Math.floor(rand() * bad.length)];
    const safe = numbered.filter(h => !isRed(h.number) && h.neighbors.every(n => n === from.id || !isRed(hexes[n].number)));
    if (!safe.length) break;
    const to = safe[Math.floor(rand() * safe.length)];
    [from.number, to.number] = [to.number, from.number];
  }
}

/** Spreads `count` harbours around the coast, never sharing or touching intersections. */
function placeGenericPorts(topo, rand) {
  const coast = coastalEdges(topo);
  if (!coast.length) return [];
  const count = Math.max(5, Math.min(12, Math.round(coast.length / 3.4)));
  const specific = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
  const types = [];
  for (let i = 0; i < count; i++) types.push(i < 5 ? specific[i] : (i % 3 === 2 ? specific[i % 5] : 'any'));
  const shuffled = shuffle(types, rand);
  const step = coast.length / count;
  const offset = Math.floor(rand() * Math.max(1, step));
  const taken = new Set();
  const ports = [];
  for (let slot = 0; slot < count; slot++) {
    const start = Math.floor(offset + slot * step);
    for (let probe = 0; probe < Math.ceil(step) + 2; probe++) {
      const e = coast[(start + probe) % coast.length];
      const crowded = e.v.some(v => taken.has(v) || topo.vertices[v].adj.some(a => taken.has(a)));
      if (crowded) continue;
      e.v.forEach(v => taken.add(v));
      ports.push({ edge: e, type: shuffled[ports.length] });
      break;
    }
  }
  return ports;
}

function finishPorts(topo, list) {
  return list.map(({ edge: e, type }, i) => {
    const hex = topo.hexes[e.hexes.find(x => !isSeaHex(topo.hexes[x]))];
    const nx = e.x - hex.x, ny = e.y - hex.y;
    const len = Math.hypot(nx, ny);
    e.port = i;
    e.v.forEach(vid => { topo.vertices[vid].port = i; });
    return { id: i, type, edge: e.id, vertices: e.v.slice(), hex: hex.id, nx: nx / len, ny: ny / len };
  });
}

// ------------------------------------------------------------------ map generator
export const CUSTOM_DEFAULTS = {
  seed: 'terra', size: 'medium', shape: 'island', water: 'some', resources: 'even', deserts: -1,
  trees: 'normal', biome: 'temperate'
};
export const CUSTOM_OPTIONS = {
  size: { small: [19, 22], medium: [28, 32], large: [40, 44], huge: [54, 58] },
  shape: ['island', 'continent', 'twin', 'archipelago', 'ring'],
  water: ['none', 'some', 'lots'],
  resources: {
    even: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3 },
    lush: { forest: 5, pasture: 5, fields: 4, hills: 2.6, mountains: 2.6 },
    rocky: { forest: 3, pasture: 3, fields: 3.5, hills: 4.4, mountains: 4.4 },
    farmland: { forest: 3.4, pasture: 5, fields: 5, hills: 2.6, mountains: 2.6 },
    scarce: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3 }
  },
  trees: ['sparse', 'normal', 'dense'],
  biome: ['temperate', 'autumn', 'winter', 'arid', 'tropical']
};
/** Cleans user-supplied generator settings (also used by the server). */
export function cleanCustom(c = {}) {
  const out = { ...CUSTOM_DEFAULTS };
  if (c && typeof c === 'object') {
    if (c.seed !== undefined) out.seed = String(c.seed).replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 24) || CUSTOM_DEFAULTS.seed;
    if (CUSTOM_OPTIONS.size[c.size]) out.size = c.size;
    if (CUSTOM_OPTIONS.shape.includes(c.shape)) out.shape = c.shape;
    if (CUSTOM_OPTIONS.water.includes(c.water)) out.water = c.water;
    if (CUSTOM_OPTIONS.resources[c.resources]) out.resources = c.resources;
    if (Number.isInteger(c.deserts) && c.deserts >= -1 && c.deserts <= 4) out.deserts = c.deserts;
    if (CUSTOM_OPTIONS.trees.includes(c.trees)) out.trees = c.trees;
    if (CUSTOM_OPTIONS.biome.includes(c.biome)) out.biome = c.biome;
  }
  return out;
}
export function seedFromText(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0 || 1;
}
function seededRand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Grows land cells for the generator. Islands keep a sea channel between them. */
function generatorCells(c, rand) {
  const [lo, hi] = CUSTOM_OPTIONS.size[c.size];
  const total = lo + Math.floor(rand() * (hi - lo + 1));
  const land = new Map(); // key -> { q, r, island }
  const islandOf = (q, r) => land.get(key(q, r))?.island;
  let centers;
  const R = Math.ceil(Math.sqrt(total / 3)) + 1;
  if (c.shape === 'twin') centers = [[-R, 0], [R, 0]];
  else if (c.shape === 'archipelago') {
    const n = total < 26 ? 3 : total < 42 ? 4 : 5;
    centers = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rand(); const d = R * 0.9; centers.push([Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d * 0.9)]); }
    if (n >= 4) centers.push([0, 0]);
  } else centers = [[0, 0]];
  const share = centers.map((_, i) => Math.floor(total / centers.length) + (i < total % centers.length ? 1 : 0));
  const ringInner = c.shape === 'ring' ? Math.max(1, Math.round(R * 0.45)) : -1;
  const ringOuter = c.shape === 'ring' ? R + 1 : 99;
  const tryGrow = (idx) => {
    const mine = [...land.values()].filter(v => v.island === idx);
    const base = mine[Math.floor(rand() * mine.length)];
    const [dq, dr] = DIRS[Math.floor(rand() * 6)];
    const q = base.q + dq, r = base.r + dr;
    if (land.has(key(q, r))) return false;
    const dist = axialDistance(q, r);
    if (c.shape === 'ring' && (dist < ringInner || dist > ringOuter)) return false;
    // keep a channel of sea between different islands
    if (DIRS.some(([a, b]) => { const o = islandOf(q + a, r + b); return o !== undefined && o !== idx; })) return false;
    const n = DIRS.filter(([a, b]) => islandOf(q + a, r + b) === idx).length;
    const compact = c.shape === 'continent' ? 0.12 : c.shape === 'ring' ? 0.5 : 0.35;
    if (n >= 3 || (n === 2 && rand() < 0.75) || rand() < compact * (n === 1 ? 1 : 0.5)) { land.set(key(q, r), { q, r, island: idx }); return true; }
    return false;
  };
  centers.forEach(([cq, cr], idx) => {
    const start = c.shape === 'ring' ? [ringInner + 1, 0] : [cq, cr];
    land.set(key(...start), { q: start[0], r: start[1], island: idx });
    let count = 1, guard = 0;
    while (count < share[idx] && guard++ < 6000) if (tryGrow(idx)) count++;
  });
  // Islands that were boxed in hand their remaining tiles to the others.
  for (let guard = 0; land.size < total && guard < 30000; guard++) tryGrow(Math.floor(rand() * centers.length));
  const cells = [...land.values()].map(v => ({ q: v.q, r: v.r, type: 'land' }));
  // Lakes: interior cells (all six neighbours land), never next to each other.
  const lakeCount = c.water === 'none' ? 0 : Math.max(1, Math.round(total / (c.water === 'lots' ? 10 : 20)));
  const lakes = new Set();
  const interior = shuffle(cells.filter(cl => DIRS.every(([a, b]) => land.has(key(cl.q + a, cl.r + b)))), rand);
  for (const cl of interior) {
    if (lakes.size >= lakeCount) break;
    if (DIRS.some(([a, b]) => lakes.has(key(cl.q + a, cl.r + b)))) continue;
    lakes.add(key(cl.q, cl.r));
  }
  cells.forEach(cl => { if (lakes.has(key(cl.q, cl.r))) cl.type = 'water'; });
  return cells;
}
/** Terrain for the generator: resource mix, minimum shares, and matching terrain spread apart. */
function generatorTerrain(hexes, c, rand) {
  const weights = CUSTOM_OPTIONS.resources[c.resources];
  const autoDeserts = Math.max(1, Math.round(hexes.length / 19)) + (c.resources === 'scarce' ? 1 : 0);
  const deserts = Math.min(c.deserts >= 0 ? c.deserts : autoDeserts, Math.max(0, hexes.length - 10));
  const n = hexes.length - deserts;
  const min = Math.max(2, Math.floor(n * 0.11));
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
  const counts = {};
  Object.entries(weights).forEach(([t, w]) => { counts[t] = Math.max(min, Math.floor((n * w) / totalW)); });
  let sum = Object.values(counts).reduce((a, b) => a + b, 0);
  const order = Object.keys(weights).sort((a, b) => weights[b] - weights[a] || (rand() - 0.5));
  for (let i = 0; sum < n; i++) { counts[order[i % order.length]]++; sum++; }
  for (let i = order.length - 1; sum > n; i = (i + order.length - 1) % order.length) {
    const t = order[i];
    if (counts[t] > min) { counts[t]--; sum--; }
  }
  const pool = [...Array(deserts).fill('desert')];
  Object.entries(counts).forEach(([t, k]) => { for (let i = 0; i < k; i++) pool.push(t); });
  shuffle(pool, rand).forEach((t, i) => { hexes[i].terrain = t; });
  // Spread out matching terrain with greedy swaps.
  const clash = (h) => h.neighbors.filter(x => hexes[x].terrain === h.terrain).length;
  for (let it = 0; it < hexes.length * 30; it++) {
    const a = hexes[Math.floor(rand() * hexes.length)], b = hexes[Math.floor(rand() * hexes.length)];
    if (a.terrain === b.terrain) continue;
    const before = clash(a) + clash(b);
    [a.terrain, b.terrain] = [b.terrain, a.terrain];
    if (clash(a) + clash(b) > before) [a.terrain, b.terrain] = [b.terrain, a.terrain];
  }
}
/** Evens out production: each resource's total dots in line with its share of tiles. */
export function resourceBalance(hexes) {
  const per = {}, tiles = {};
  hexes.forEach(h => { const r = TERRAIN_RESOURCE[h.terrain]; if (!r) return; per[r] = (per[r] || 0) + pips(h.number); tiles[r] = (tiles[r] || 0) + 1; });
  const totalP = Object.values(per).reduce((a, b) => a + b, 0), totalT = Object.values(tiles).reduce((a, b) => a + b, 0);
  let err = 0;
  Object.keys(per).forEach(r => { err += Math.pow(per[r] / totalP - tiles[r] / totalT, 2); });
  return { per, tiles, err };
}
function balanceNumbers(hexes, rand) {
  const numbered = hexes.filter(h => h.number);
  let { err } = resourceBalance(hexes);
  for (let it = 0; it < numbered.length * 80; it++) {
    const a = numbered[Math.floor(rand() * numbered.length)], b = numbered[Math.floor(rand() * numbered.length)];
    if (a === b || a.terrain === b.terrain || pips(a.number) === pips(b.number)) continue;
    [a.number, b.number] = [b.number, a.number];
    const e = resourceBalance(hexes).err;
    if (e < err && !redNumbersTouch(hexes)) err = e;
    else [a.number, b.number] = [b.number, a.number];
  }
}

/**
 * Generates a board.
 *   map:    one of MAPS ids (default 'classic')
 *   layout: 'beginner' (classic only: the fixed starter island), 'balanced' (classic: spiral tokens;
 *           other maps: reds apart and matching numbers spread out), 'random' (red 6s and 8s never touch),
 *           'unrestricted' (anything goes).
 */
export function generateBoard(opts, rand) {
  const o = typeof opts === 'string' ? { layout: opts } : (opts || {});
  const land = generateLandBoard(o, rand);
  const def = MAP_BY_ID[o.map] || MAP_BY_ID.classic;
  return o.sea || def.sea ? addSea(land, rand) : land;
}

/** Seafarers: rebuilds a board with sea spaces around and between the land, then finds the islands. */
function addSea(landBoard, rand) {
  const landKeys = new Map(landBoard.hexes.map(h => [key(h.q, h.r), h]));
  const ringDist = landBoard.hexes.length < 30 ? 2 : 1;
  const seaKeys = new Map();
  landBoard.hexes.forEach(h => {
    for (let dq = -ringDist; dq <= ringDist; dq++) for (let dr = -ringDist; dr <= ringDist; dr++) {
      if (axialDistance(dq, dr) > ringDist) continue;
      const k = key(h.q + dq, h.r + dr);
      if (!landKeys.has(k)) seaKeys.set(k, { q: h.q + dq, r: h.r + dr, type: 'sea' });
    }
  });
  (landBoard.lakes || []).forEach(l => seaKeys.set(key(l.q, l.r), { q: l.q, r: l.r, type: 'sea' }));
  const cells = [...landBoard.hexes.map(h => ({ q: h.q, r: h.r, type: 'land' })), ...seaKeys.values()];
  const topo = buildTopology(cells);
  topo.hexes.forEach(h => {
    const src = landKeys.get(key(h.q, h.r));
    if (src) { h.terrain = src.terrain; h.number = src.number; } else { h.terrain = 'sea'; h.number = null; }
  });
  // Islands: connected land. Home islands are the big ones; settling any other earns a bonus.
  const island = topo.hexes.map(() => -1);
  const sizes = [];
  topo.hexes.forEach(h => {
    if (h.terrain === 'sea' || island[h.id] >= 0) return;
    const id = sizes.length; let n = 0;
    const stack = [h.id]; island[h.id] = id;
    while (stack.length) {
      const x = stack.pop(); n++;
      topo.hexes[x].neighbors.forEach(y => { if (topo.hexes[y].terrain !== 'sea' && island[y] < 0) { island[y] = id; stack.push(y); } });
    }
    sizes.push(n);
  });
  const biggest = Math.max(...sizes);
  const homeIslands = sizes.map((n, i) => (n >= biggest * 0.6 ? i : -1)).filter(i => i >= 0);
  // Gold fields on foreign islands that have none yet.
  sizes.forEach((n, i) => {
    if (homeIslands.includes(i) || n < 2) return;
    const tiles = topo.hexes.filter(h => island[h.id] === i);
    if (tiles.some(h => h.terrain === 'gold')) return;
    const pick = tiles.filter(h => h.terrain !== 'desert' && h.number);
    if (pick.length) pick[Math.floor(rand() * pick.length)].terrain = 'gold';
  });
  topo.hexes.forEach(h => { h.island = island[h.id]; });
  const ports = finishPorts(topo, placeGenericPorts(topo, rand));
  const seaHexes = topo.hexes.filter(h => h.terrain === 'sea');
  const open = seaHexes.filter(h => h.neighbors.every(n => topo.hexes[n].terrain === 'sea'));
  const pirate = (open.length ? open : seaHexes)[Math.floor(rand() * (open.length || seaHexes.length))].id;
  const desert = topo.hexes.find(h => h.terrain === 'desert');
  topo.hexes.forEach(h => { delete h.cell; });
  return {
    ...landBoard, hexes: topo.hexes, vertices: topo.vertices, edges: topo.edges, ports, lakes: [],
    desert: desert ? desert.id : topo.hexes.find(h => h.terrain !== 'sea' && h.terrain !== 'gold').id,
    sea: true, islands: sizes.length, islandSizes: sizes, homeIslands, pirate
  };
}

function generateLandBoard(opts, rand) {
  const { map = 'classic', layout = 'balanced', custom } = opts;
  const def = MAP_BY_ID[map] || MAP_BY_ID.classic;
  if (def.custom) {
    // Everything about a generated map comes from its own seed, so the same seed and settings give the same island.
    const c = cleanCustom(custom);
    const grand = seededRand(seedFromText(`${c.seed}|${c.size}|${c.shape}|${c.water}|${c.resources}|${c.deserts}`));
    const topo = buildTopology(generatorCells(c, grand));
    generatorTerrain(topo.hexes, c, grand);
    dealNumbers(topo.hexes, layout === 'unrestricted' ? 'unrestricted' : layout === 'random' ? 'random' : 'balanced', grand);
    if (layout !== 'unrestricted') balanceNumbers(topo.hexes, grand);
    const portList = finishPorts(topo, placeGenericPorts(topo, grand));
    const desert = topo.hexes.find(h => h.terrain === 'desert');
    topo.hexes.forEach(h => { delete h.cell; });
    return {
      hexes: topo.hexes, vertices: topo.vertices, edges: topo.edges, ports: portList, lakes: topo.lakes,
      desert: desert ? desert.id : null, layout, map: 'custom', custom: c
    };
  }
  const topo = buildTopology(def.cells(rand));
  const { hexes } = topo;
  let ports;

  if (def.id === 'classic') {
    if (layout === 'beginner') {
      BEGINNER.forEach(([t, n], i) => { hexes[i].terrain = t; hexes[i].number = n; });
    } else {
      const pool = [];
      Object.entries(TERRAIN_COUNTS).forEach(([t, c]) => { for (let i = 0; i < c; i++) pool.push(t); });
      shuffle(pool, rand).forEach((t, i) => { hexes[i].terrain = t; });
      if (layout === 'balanced') {
        const startDir = Math.floor(rand() * 6);
        const byKey = new Map(hexes.map(h => [key(h.q, h.r), h]));
        let order = [...ring(2, startDir), ...ring(1, startDir), [0, 0]].map(([q, r]) => byKey.get(key(q, r)));
        if (rand() < 0.5) order = [...order.slice(0, 12).reverse(), ...order.slice(12, 18).reverse(), order[18]];
        let k = 0;
        order.forEach(h => { h.number = h.terrain === 'desert' ? null : SPIRAL_TOKENS[k++]; });
        if (redNumbersTouch(hexes)) dealNumbers(hexes, 'random', rand);
      } else {
        dealNumbers(hexes, layout, rand);
      }
    }
    const coast = coastalEdges(topo);
    const types = layout === 'beginner' ? BEGINNER_PORTS.slice() : shuffle(PORT_TYPES, rand);
    const offset = layout === 'beginner' ? 0 : Math.floor(rand() * coast.length);
    let idx = offset;
    ports = PORT_GAPS.map((gap, i) => { const e = coast[idx % coast.length]; idx += gap; return { edge: e, type: types[i] }; });
  } else {
    const explicitDeserts = hexes.filter(h => h.cell === 'desert').length;
    const randomCells = hexes.filter(h => h.cell === 'land');
    const goldCells = hexes.filter(h => h.cell === 'gold').length;
    void goldCells;
    const extraDeserts = def.deserts !== undefined ? def.deserts
      : Math.max(explicitDeserts ? 0 : 1, Math.round(hexes.length / 19) - explicitDeserts);
    const pool = shuffle([...Array(extraDeserts).fill('desert'), ...terrainPool(Math.max(0, randomCells.length - extraDeserts), rand)], rand);
    let p = 0;
    hexes.forEach(h => {
      if (h.cell === 'desert') h.terrain = 'desert';
      else if (h.cell === 'gold') h.terrain = 'gold';
      else if (h.cell === 'rich') h.terrain = ['mountains', 'fields', 'pasture', 'mountains', 'fields'][Math.floor(rand() * 5)];
      else h.terrain = pool[p++];
    });
    dealNumbers(hexes, layout === 'beginner' ? 'balanced' : layout, rand);
    ports = placeGenericPorts(topo, rand);
  }

  const portList = finishPorts(topo, ports);
  const desert = hexes.find(h => h.terrain === 'desert');
  hexes.forEach(h => { delete h.cell; });
  return {
    hexes, vertices: topo.vertices, edges: topo.edges, ports: portList, lakes: topo.lakes,
    desert: desert ? desert.id : null, layout, map: def.id
  };
}
