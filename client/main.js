// Terra Hex — client controller. Connects the rules engine, the 3D board, the interface,
// local AI players and online rooms. Rules live in ../shared/engine.js; nothing here decides them.
import { BoardScene, QUALITY } from './scene.js';
import { Sound } from './audio.js';
import { OnlineClient, serverAvailable, accountCall } from './net.js';
import { iconSvg, RES_COLORS, RES_NAMES, TERRAIN_NAMES, TRACK_COLORS } from './icons.js';
import { PROGRESS, TRACKS, TRACK_NAMES, TRACK_ABILITY, CK_COSTS, KNIGHT_NAMES, BARBARIAN_STEPS } from '../shared/ck.js';
import * as E from '../shared/engine.js';
import { decide, respondToTrade, createAIMemory } from '../shared/ai.js';
import { RESOURCES, pips, TERRAIN_RESOURCE, MAPS, MAP_BY_ID, generateBoard, CUSTOM_DEFAULTS, CUSTOM_OPTIONS, cleanCustom, resourceBalance } from '../shared/board.js';

const $ = (id) => document.getElementById(id);
/** Sets innerHTML only when it changed: avoids needless layout work on every refresh. */
function setHTML(el, html) { if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PALETTE = [
  { c: '#d94a3d', n: 'Red' }, { c: '#2f6fd6', n: 'Blue' }, { c: '#e8e1cf', n: 'White' },
  { c: '#e48a1c', n: 'Orange' }, { c: '#3c9a4e', n: 'Green' }, { c: '#8a5a3b', n: 'Brown' },
  { c: '#8b55c9', n: 'Purple' }, { c: '#2aa7a0', n: 'Teal' }
];
const MAX_SEATS = 6;
const RULES = [
  { key: 'friendlyRobber', name: 'Friendly Robber', desc: 'Players on 2 points or fewer cannot be blocked or robbed.' },
  { key: 'balancedDice', name: 'Balanced Dice', desc: 'Rolls are dealt from a shuffled deck of all 36 outcomes: fewer streaks.' },
  { key: 'hiddenHands', name: 'Hidden Hands', desc: 'Other players’ card counts are hidden.' },
  { key: 'ck', name: 'Cities & Knights', desc: 'Commodities, city improvements, knights, barbarians and progress cards. Played to 13 points.' },
  { key: 'sea', name: 'Seafarers', desc: 'Ships, open sea between islands, gold fields, the pirate and +2 for each new island. Played to 13 points.' }
];
const sea = () => !!app.view?.config?.sea;
const ck = () => !!app.view?.config?.ck;
const DECK_COLOR = { trade: TRACK_COLORS.trade, politics: TRACK_COLORS.politics, science: TRACK_COLORS.science };
const TIMERS = [[0, 'Off'], [30, '30s'], [45, '45s'], [60, '60s'], [90, '90s'], [120, '2 min'], [180, '3 min'], [300, '5 min']];
const TERRAIN_FILL = { sea: '#3f8fb0', gold: '#a8820f', forest: '#3f7d3a', pasture: '#8dbb4c', fields: '#e0b33c', hills: '#b5532f', mountains: '#7d8794', desert: '#e2c88f' };
const AI_NAMES = ['Ada', 'Bram', 'Cora', 'Dov', 'Ines', 'Jun'];
const LAYOUTS = { beginner: 'Beginner', balanced: 'Balanced', random: 'Random', unrestricted: 'Unrestricted' };
const LAYOUT_HINTS = {
  beginner: 'The fixed starter island. Good for a first game.',
  balanced: 'Numbers spread fairly: red 6s and 8s apart, matching numbers kept apart.',
  random: 'Random numbers; red 6s and 8s never touch.',
  unrestricted: 'Fully random numbers. Anything goes, including 6 next to 8.'
};
const SPEEDS = { relaxed: 1.5, normal: 1, fast: 0.45 };
const DEV_TEXT = {
  knight: 'Move the robber and steal a card.',
  roadBuilding: 'Build two roads for free.',
  yearOfPlenty: 'Take any two resources from the bank.',
  monopoly: 'Take every card of one resource from all players.',
  victoryPoint: 'Worth 1 point. Stays hidden until you win.'
};
const GLYPH = {
  road: '<svg width="26" height="26" viewBox="0 0 32 32"><path d="M5 25 25 7" stroke="#8a7a63" stroke-width="7" stroke-linecap="round"/><path d="M5 25 25 7" stroke="#c9b48f" stroke-width="3" stroke-dasharray="3 3" stroke-linecap="round"/></svg>',
  settlement: '<svg width="26" height="26" viewBox="0 0 32 32"><path d="M6 15 16 6l10 9v11H6z" fill="#e8c56f"/><path d="M4 16 16 5l12 11" fill="none" stroke="#8d6a24" stroke-width="3" stroke-linejoin="round"/><rect x="13" y="19" width="6" height="7" fill="#5b4733"/></svg>',
  city: '<svg width="26" height="26" viewBox="0 0 32 32"><path d="M3 27V15l7-5 7 5v12z" fill="#e8c56f"/><path d="M17 27V7h3V4h2v3h2V4h2v3h3v20z" fill="#c99a3b"/><rect x="8" y="20" width="4" height="7" fill="#5b4733"/><rect x="21" y="12" width="3" height="4" fill="#5b4733"/></svg>',
  ship: '<svg width="26" height="26" viewBox="0 0 32 32"><path d="M4 21h24l-4 6H8z" fill="#8a5a33"/><path d="M16 4v16" stroke="#3a2a1c" stroke-width="2"/><path d="M17 6l9 12H17z" fill="#f3e8cb"/><path d="M15 8l-7 10h7z" fill="#e7d6ab"/><path d="M16 4h6l-2 2 2 2h-6z" fill="#c99a3b"/></svg>',
  dev: '<svg width="26" height="26" viewBox="0 0 32 32"><rect x="7" y="4" width="18" height="24" rx="3" fill="#6b4c78" stroke="#c9a8d6" stroke-width="1.5"/><path d="m16 10 2 4.5 4.6.4-3.5 3 1.1 4.6L16 20l-4.2 2.5 1.1-4.6-3.5-3 4.6-.4z" fill="#e8c56f"/></svg>'
};
const SMALL = {
  cards: '<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="4" width="10" height="14" rx="2" fill="#d6bf8a" stroke="#4a3624" stroke-width="1.2"/><rect x="7" y="2" width="10" height="14" rx="2" fill="#fbf3dd" stroke="#4a3624" stroke-width="1.2"/><path d="M10 7h4M10 10h4" stroke="#8d6a24" stroke-width="1.4" stroke-linecap="round"/></svg>',
  dev: '<svg width="20" height="20" viewBox="0 0 20 20"><rect x="4" y="2" width="12" height="16" rx="2" fill="#6b4c78" stroke="#d9c2e6" stroke-width="1.2"/><path d="m10 6 1.3 2.8 3 .3-2.3 2 .7 3L10 12.5l-2.7 1.6.7-3-2.3-2 3-.3z" fill="#e8c56f"/></svg>',
  knight: '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 2 17 4.5v5c0 4.3-3 7.2-7 8.5-4-1.3-7-4.2-7-8.5v-5z" fill="#b8bec7" stroke="#2f3238" stroke-width="1.2"/><path d="M10 5v10M6 9h8" stroke="#7d2c1f" stroke-width="2"/></svg>',
  road: '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 17 17 3" stroke="#4a3624" stroke-width="6" stroke-linecap="round"/><path d="M3 17 17 3" stroke="#d6bf8a" stroke-width="3.6" stroke-linecap="round"/><path d="M5.5 14.5 14.5 5.5" stroke="#4a3624" stroke-width="1.2" stroke-dasharray="2 2"/></svg>'
};

function randomSeedText() {
  const words = ['amber', 'basalt', 'cedar', 'dune', 'ember', 'fjord', 'grove', 'harbor', 'isle', 'juniper', 'kelp', 'lagoon', 'moss', 'north', 'oak', 'pine', 'quarry', 'reef', 'sage', 'tide', 'umber', 'vale', 'willow', 'yarrow'];
  const a = new Uint32Array(2);
  try { crypto.getRandomValues(a); } catch { a[0] = Date.now(); a[1] = Date.now() >> 7; }
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${(a[0] >>> 8) % 100}`;
}
const GEN_LABELS = {
  size: { small: 'Small', medium: 'Medium', large: 'Large', huge: 'Huge' },
  shape: { island: 'Island', continent: 'Continent', twin: 'Twin isles', archipelago: 'Archipelago', ring: 'Ring' },
  water: { none: 'None', some: 'Some', lots: 'Lots' },
  resources: { even: 'Even', lush: 'Lush', rocky: 'Rocky', farmland: 'Farmland', scarce: 'Scarce' },
  deserts: { '-1': 'Auto', 0: '0', 1: '1', 2: '2', 3: '3' },
  trees: { sparse: 'Sparse', normal: 'Normal', dense: 'Dense' },
  biome: { temperate: 'Temperate', autumn: 'Autumn', winter: 'Winter', arid: 'Arid', tropical: 'Tropical' }
};
const GEN_NAMES = { size: 'Size', shape: 'Shape', water: 'Lakes', resources: 'Resources', deserts: 'Deserts', trees: 'Trees', biome: 'Look' };
const mapCode = (c) => ['TH', c.seed, c.size, c.shape, c.water, c.resources, c.deserts, c.trees, c.biome].join(':');
function parseMapCode(text) {
  const parts = String(text || '').trim().split(':');
  if (parts[0] !== 'TH' || parts.length < 9) return null;
  const [, seed, size, shape, water, resources, deserts, trees, biome] = parts;
  return cleanCustom({ seed, size, shape, water, resources, deserts: Number(deserts), trees, biome });
}
const genCache = new Map();
function generatedBoard(c) {
  const k = JSON.stringify(c);
  if (!genCache.has(k)) { genCache.set(k, generateBoard({ map: 'custom', layout: 'balanced', custom: c }, Math.random)); if (genCache.size > 30) genCache.delete(genCache.keys().next().value); }
  return genCache.get(k);
}
function boardSvg(b, numbers = false) {
  const pts = [...b.hexes, ...b.lakes];
  const xs = pts.map(h => h.x), ys = pts.map(h => h.y);
  const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 1, minY = Math.min(...ys) - 1.1, maxY = Math.max(...ys) + 1.1;
  const hex = (x, y, fill) => `<polygon points="${[0, 1, 2, 3, 4, 5].map(i => { const a = (60 * i - 30) * Math.PI / 180; return `${(x + Math.cos(a) * 0.95).toFixed(2)},${(y + Math.sin(a) * 0.95).toFixed(2)}`; }).join(' ')}" fill="${fill}"/>`;
  const nums = numbers ? b.hexes.filter(h => h.number).map(h => `<circle cx="${h.x}" cy="${h.y}" r="0.42" fill="#fbf3dd"/><text x="${h.x}" y="${h.y + 0.2}" text-anchor="middle" font-size="0.55" font-weight="800" fill="${h.number === 6 || h.number === 8 ? '#b3261e' : '#24190f'}">${h.number}</text>`).join('') : '';
  const ports = numbers ? b.ports.map(p => { const e = b.edges[p.edge]; return `<circle cx="${e.x + p.nx * 0.55}" cy="${e.y + p.ny * 0.55}" r="0.28" fill="${RES_COLORS[p.type]}" stroke="#fbf3dd" stroke-width="0.08"/>`; }).join('') : '';
  return `<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${b.hexes.map(h => hex(h.x, h.y, TERRAIN_FILL[h.terrain])).join('')}${b.lakes.map(l => hex(l.x, l.y, '#3f8fb0')).join('')}${ports}${nums}</svg>`;
}
/** The generator settings panel (setup screen or lobby). attr: data attribute used for buttons; editable: host/local. */
function genPanelHtml(c, attr, editable) {
  const b = generatedBoard(c);
  const bal = resourceBalance(b.hexes);
  const totalP = Object.values(bal.per).reduce((x, y) => x + y, 0);
  const share = RESOURCES.map(r => `<span title="${RES_NAMES[r]}: ${bal.tiles[r] || 0} tiles, ${Math.round(((bal.per[r] || 0) / totalP) * 100)}% of all production">${iconSvg(r, 14).replace('class="ico"', 'class="ico" style="display:inline-block;vertical-align:-2px"')} ${Math.round(((bal.per[r] || 0) / totalP) * 100)}%</span>`).join(' ');
  const rows = Object.keys(GEN_LABELS).map(f => `<div class="line"><label>${GEN_NAMES[f]}</label><div class="seg">${Object.entries(GEN_LABELS[f]).map(([val, name]) => `<button class="${String(c[f]) === String(val) ? 'on' : ''}" ${attr}="${f}" data-val="${val}" ${editable ? '' : 'disabled'}>${name}</button>`).join('')}</div></div>`).join('');
  return `<div class="gen"><div><div class="prev">${boardSvg(b, true)}</div>
      <div class="stats">${b.hexes.length} tiles · ${b.lakes.length} lake${b.lakes.length === 1 ? '' : 's'} · ${b.ports.length} harbours</div>
      <div class="stats" title="Share of all production (dots) per resource">Production: ${share}</div></div>
    <div class="opts">
      <div class="line"><label for="${attr}-seed">Seed</label><input type="text" id="${attr}-seed" value="${esc(c.seed)}" maxlength="24" style="width:170px" ${editable ? '' : 'disabled'}>${editable ? `<button class="btn small" ${attr}="reroll" title="New random seed">New seed</button>` : ''}</div>
      ${rows}
      <div class="line"><label for="${attr}-code">Map code</label><input type="text" id="${attr}-code" value="${esc(mapCode(c))}" style="flex:1;min-width:180px;font-size:12px" ${editable ? '' : 'readonly'}><button class="btn small" data-copy-code="${esc(mapCode(c))}">Copy</button></div>
      <div class="stats">The same seed and settings always make the same island; share the map code with friends. Every map keeps each resource on at least a tenth of the tiles, spreads matching terrain apart, keeps red 6s and 8s apart, and evens out production per resource.</div>
    </div></div>`;
}

const sfx = new Sound();
const app = {
  mode: null, state: null, view: null, viewer: null, humans: [], ai: [], aiTimer: null, aiSpeed: 1,
  buildMode: null, boardKey: null, revealed: null, lastViewer: null, net: null, online: null,
  hlKey: '', animate: new Set(), victoryShown: false, tradeUI: null, modal: null, deadline: null,
  setupSeats: null, layout: 'balanced', speedKey: 'normal', mapId: 'classic', pieceChoice: 'road', shipFrom: null,
  rules: { friendlyRobber: true, balancedDice: false, hiddenHands: false, ck: false, sea: false }, timer: 0,
  showTerritory: false
};
try {
  const saved = JSON.parse(localStorage.getItem('terrahex.setup') || '{}');
  ['layout', 'speedKey', 'mapId', 'timer'].forEach(k => { if (saved[k] !== undefined) app[k] = saved[k]; });
  app.custom = cleanCustom(saved.custom || { seed: randomSeedText() });
  if (saved.rules) app.rules = { ...app.rules, ...saved.rules };
  if (saved.rulesVersion !== 2) app.rules.friendlyRobber = true; // Friendly Robber became the default
  app.showTerritory = localStorage.getItem('terrahex.territory') === '1';
} catch { /* storage blocked */ }
if (!app.custom) app.custom = cleanCustom({ seed: randomSeedText() });
// Display options (this device only).
const CB_COLORS = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00'];
const SYMBOL_CHARS = ['●', '▲', '■', '◆', '★', '✚'];
app.display = { symbols: false, roadSymbols: false, cbColors: false, recent: true };
try { Object.assign(app.display, JSON.parse(localStorage.getItem('terrahex.display') || '{}')); } catch { /* ignore */ }
app.recentBuilds = [];
function saveDisplay() { try { localStorage.setItem('terrahex.display', JSON.stringify(app.display)); } catch { /* ignore */ } }
/** Applies the colour-blind palette (if chosen) to a view, keeping the real colours to restore. */
function displayColors(v) {
  v.players.forEach((p, i) => {
    if (p.baseColor === undefined) p.baseColor = p.color;
    p.color = app.display.cbColors ? CB_COLORS[i % CB_COLORS.length] : p.baseColor;
  });
}
function saveSetup() {
  try { localStorage.setItem('terrahex.setup', JSON.stringify({ layout: app.layout, speedKey: app.speedKey, mapId: app.mapId, timer: app.timer, rules: app.rules, custom: app.custom, rulesVersion: 2 })); } catch { /* ignore */ }
}
window.__terrahex = app;
app.onPick = (p) => onPick(p); // used by automated tests
app.refresh = () => refresh();
app.act = (a, pid) => act(a, pid); // handy for debugging and automated tests

let scene = null;
try {
  scene = new BoardScene($('canvas'), { onPick, onHover });
} catch (err) {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', '<div class="modal-back"><div class="modal panel"><h2>3D is unavailable</h2><p>This browser could not start WebGL, which the board needs. Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.</p></div></div>');
}

// ================================================================== helpers
function crest(color, letter, cls = 'crest') { return `<div class="${cls}" style="background:${color}">${esc(letter)}</div>`; }
function player(pid) { return app.view?.players[pid]; }
function nameHtml(pid) {
  const p = player(pid);
  if (!p) return 'Someone';
  return `<b style="color:${p.color === '#e8e1cf' ? '#f6f0de' : p.color}">${esc(p.name)}</b>`;
}
const shortName = (pid) => (pid === app.viewer && app.mode === 'online' ? 'You' : esc(player(pid)?.name || '?'));
function bundleHtml(b) {
  const parts = RESOURCES.filter(r => b[r]).map(r => `<span class="mini">${b[r] > 1 ? b[r] : ''}${iconSvg(r, 18)}</span>`);
  return parts.join(' ') || '—';
}
/** Large resource chips for trade terms, from the viewer's point of view. */
function chipsHtml(b, hand = null, mode = 'get') {
  const list = RESOURCES.filter(r => b[r]);
  if (!list.length) return '<span class="empty-note">nothing</span>';
  return list.map(r => {
    const short = mode === 'give' && hand && hand[r] < b[r];
    return `<span class="tchip${short ? ' short' : ''}" style="--c:${RES_COLORS[r]}">${iconSvg(r, 30)}<span class="n">${b[r]}</span><span class="l">${RES_NAMES[r]}</span>${mode === 'give' && hand ? `<span class="have">have ${hand[r]}</span>` : ''}</span>`;
  }).join('');
}
function termsHtml(give, get, hand) {
  return `<div class="terms2"><div class="side give"><div class="cap">You give</div><div class="chips">${chipsHtml(give, hand, 'give')}</div></div>
    <div class="arrow" aria-hidden="true">⇄</div>
    <div class="side get"><div class="cap">You get</div><div class="chips">${chipsHtml(get, hand, 'get')}</div></div></div>`;
}
/** What is still missing for a build, and what could be spared toward it. */
function missingFor(hand, cost) {
  const out = {};
  Object.entries(cost).forEach(([r, n]) => { if ((hand[r] || 0) < n) out[r] = n - (hand[r] || 0); });
  return out;
}
function spareFor(hand, cost) {
  const out = {};
  RESOURCES.forEach(r => { const k = (hand[r] || 0) - (cost[r] || 0); if (k > 0) out[r] = k; });
  return out;
}

function formatLog(msg) {
  return esc(msg)
    .replace(/@(\d+)/g, (_, d) => nameHtml(Number(d)))
    .replace(/:(wood|brick|sheep|wheat|ore):/g, (_, r) => iconSvg(r, 15));
}
function toast(html, kind = '', life = 2.6) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.style.setProperty('--life', `${life}s`);
  el.innerHTML = html;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), (life + 0.5) * 1000);
}
function randomSeed() {
  const a = new Uint32Array(1);
  (crypto.getRandomValues ? crypto.getRandomValues(a) : (a[0] = Date.now()));
  return a[0] || 1;
}
/** The full hand of a local player, or the viewer's own hand online. */
function handOf(pid) {
  if (app.mode === 'local') return app.state.players[pid].hand;
  return pid === app.viewer ? app.view.players[pid].hand : null;
}
function isLocalHuman(pid) { return app.mode === 'local' ? app.humans.includes(pid) : pid === app.viewer; }
function curtainUp() { return !$('curtain').classList.contains('hidden'); }
function myTurn() { const v = app.view; return v && app.viewer !== null && v.current === app.viewer && !curtainUp(); }

// ================================================================== local game
function startLocal(seats, config, seed = randomSeed()) {
  const players = seats.map(s => ({ name: s.name, color: s.color, isAI: s.type !== 'human', ai: s.type === 'human' ? null : s.type }));
  app.state = E.createGame({ seed, players, config });
  app.humans = players.map((p, i) => (p.isAI ? -1 : i)).filter(i => i >= 0);
  beginLocal();
}
function beginLocal() {
  app.mode = 'local';
  app.recentBuilds = [];
  if (!window.__renderOnce) setTimeout(() => scene?.introSweep?.(), 50); // skipped in the frozen-frame test mode
  app.ai = app.state.players.map((_, i) => createAIMemory(randomSeed() + i));
  app.revealed = app.humans.length === 1 ? app.humans[0] : null;
  app.lastViewer = app.humans[0] ?? null;
  app.victoryShown = app.state.phase === 'over';
  app.buildMode = null;
  enterGameUI();
  refresh();
  scheduleAI();
}
function saveLocal() {
  try {
    if (app.state.phase === 'over') localStorage.removeItem('terrahex.save');
    else localStorage.setItem('terrahex.save', JSON.stringify({ state: app.state, humans: app.humans, speed: app.speedKey }));
  } catch { /* storage full or blocked */ }
}
function loadSaved() {
  try { const s = JSON.parse(localStorage.getItem('terrahex.save') || 'null'); return s && s.state && s.state.phase !== 'over' ? s : null; } catch { return null; }
}

function localViewer() {
  const s = app.state;
  if (!app.humans.length) return null;
  if (s.prompts && s.prompts.length && app.humans.includes(s.prompts[0].pid)) return s.prompts[0].pid;
  if (s.gold) { const g = app.humans.find(p => s.gold[p]); if (g !== undefined) return g; }
  if (s.phase === 'discard') {
    const h = app.humans.find(p => s.discards[p]);
    if (h !== undefined) return h;
  }
  if (s.phase !== 'over' && app.humans.includes(s.current)) return s.current;
  return app.lastViewer ?? app.humans[0];
}

function scheduleAI() {
  clearTimeout(app.aiTimer);
  if (app.mode !== 'local' || !app.state || app.state.phase === 'over') return;
  const s = app.state;
  const tradeAI = s.trade && s.players.some(p => p.isAI && p.id !== s.trade.from && !s.trade.responses[p.id] && (!s.trade.to || s.trade.to.includes(p.id)));
  const turnAI = E.pendingActors(s).some(pid => s.players[pid].isAI);
  if (!tradeAI && !turnAI) return;
  const base = s.phase === 'setup' ? 550 : s.phase === 'roll' ? 850 : tradeAI ? 900 : 700;
  app.aiTimer = setTimeout(stepAI, base * app.aiSpeed);
}
function stepAI() {
  const s = app.state;
  if (!s || s.phase === 'over') return;
  if (s.trade) {
    for (const p of s.players) {
      if (!p.isAI) continue;
      const a = respondToTrade(s, p.id, app.ai[p.id]);
      if (a) { localApply(p.id, a); return; }
    }
  }
  const pid = E.pendingActors(s).find(x => s.players[x].isAI);
  if (pid === undefined) return;
  const mem = app.ai[pid];
  mem.actions = mem.lastTurn === s.turn ? (mem.actions || 0) + 1 : 0;
  mem.lastTurn = s.turn;
  let a = decide(s, pid, mem);
  if (a && a.type === 'wait') { app.aiTimer = setTimeout(stepAI, 1500 * app.aiSpeed); return; }
  if (!a || (mem.actions > 60 && s.phase === 'main')) a = { type: s.trade ? 'cancelTrade' : 'endTurn' };
  if (!localApply(pid, a) && s.phase === 'main') localApply(pid, { type: 'endTurn' });
}
// ---- local turn timer (same behaviour as online rooms: a simple move is made when time runs out)
function localClockKey(st) { return `${st.current}|${st.turn}|${st.phase}|${st.setup.index}|${Object.keys(st.discards || {}).join(',')}`; }
function updateLocalClock() {
  const st = app.state;
  const secs = st.config.turnTimer || 0;
  const humanPending = E.pendingActors(st).some(p => app.humans.includes(p));
  if (!secs || !humanPending || st.phase === 'over') { app.deadline = null; app.clockKey = null; return; }
  const k = localClockKey(st);
  if (k !== app.clockKey) { app.clockKey = k; app.deadline = Date.now() + secs * 1000; }
}
setInterval(() => {
  if (app.mode !== 'local' || !app.state || !app.deadline) return;
  const left = (app.deadline - Date.now()) / 1000;
  if (left <= 5 && left > 0 && Math.ceil(left) !== app.lastTick) { app.lastTick = Math.ceil(left); sfx.tick?.(left <= 3); }
  if (left > 0) return;
  // Time is up: move for every person who still has to act.
  const st = app.state;
  const pid = E.pendingActors(st).find(p => app.humans.includes(p));
  if (pid === undefined) return;
  closeModal();
  $('curtain').classList.add('hidden'); app.revealed = pid;
  toast(`${nameHtml(pid)} ran out of time, so a move was made for them.`);
  const proxy = { ...st, players: st.players.map(p => (p.id === pid ? { ...p, ai: 'easy' } : p)) };
  let a = (st.phase === 'main' || st.phase === 'specialBuild') && st.current === pid ? { type: st.trade ? 'cancelTrade' : 'endTurn' } : decide(proxy, pid, createAIMemory(7));
  if (!a || a.type === 'wait') a = { type: 'endTurn' };
  app.clockKey = null;
  if (!localApply(pid, a, true)) localApply(pid, { type: 'endTurn' }, true);
}, 250);

function localApply(pid, action, quiet = false) {
  const r = E.applyAction(app.state, pid, action);
  if (!r.ok) {
    if (!quiet && !app.state.players[pid].isAI) { toast(esc(r.error), 'err'); sfx.error(); }
    if (app.state.players[pid].isAI) console.warn('AI move rejected:', action, r.error);
    return false;
  }
  app.state = r.state;
  handleEvents(r.events);
  saveLocal();
  refresh();
  scheduleAI();
  return true;
}

/** Send an action for player `pid` (default: the viewer). */
async function act(action, pid = app.viewer) {
  sfx.unlock();
  if (app.mode === 'local') return localApply(pid, action);
  if (app.busy) return false;
  app.busy = true;
  try {
    // Never wait forever: a hung connection must not leave the buttons locked.
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('The server did not answer. Check your connection and try again.')), 12000));
    await Promise.race([app.net.action(action, app.view.version), timeout]);
    return true;
  } catch (err) {
    toast(esc(err.message), 'err');
    sfx.error();
    return false;
  } finally {
    app.busy = false;
    // The server's update may have arrived while we were busy (and drawn the buttons disabled): redraw now.
    if (app.view) { renderActions(app.view); renderDiceTray(app.view); renderStatus(app.view); }
  }
}

// ================================================================== events → animation & sound
function handleEvents(events) {
  if (!events || !events.length) return;
  const viewer = app.mode === 'local' ? localViewer() : app.viewer;
  const rolled = events.find(e => e.type === 'roll');
  const later = rolled ? (matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 1300) : 0;
  for (const e of events) {
    switch (e.type) {
      case 'roll': animateDice(e.dice); bigRoll(e.dice, e.event, e.pid); sfx.dice(); break;
      case 'produce':
        setTimeout(() => {
          const hexes = new Set(e.gains.map(g => g.hex));
          hexes.forEach(h => scene?.flashHex(h));
          if (e.blockedHex !== null && e.blockedHex !== undefined && !e.setup) {
            scene?.robberGloat();
            sfx.robberLaugh();
            const t = app.view.board.hexes[e.blockedHex];
            toast(`The robber blocks the ${TERRAIN_NAMES[t.terrain].toLowerCase()} on ${t.number}.`);
          }
          (e.shortages || []).forEach(r => toast(`The bank is out of ${RES_NAMES[r].toLowerCase()}: nobody collects it.`));
          e.gains.forEach((g, i) => setTimeout(() => flyCard(g, viewer), i * 90));
          if (e.gains.length && !e.setup) setTimeout(() => gainSummary(e.gains, viewer), 600);
          if (e.gains.length) sfx.collect(e.gains.length);
        }, e.setup ? 300 : later);
        break;
      case 'build': {
        app.animate.add(`${e.kind}:${e.id}`); sfx.build(e.kind);
        const setup = app.view && app.view.phase === 'setup';
        if (!setup && !e.free) flyBundle(e.pid, 'bank', E.COSTS[e.kind] || CK_COSTS[e.kind]);
        if (e.pid !== viewer && viewer !== null && e.kind !== 'wall') app.recentBuilds.push({ kind: e.kind, id: e.id, pid: e.pid });
        break;
      }
      case 'roadRemoved': break;
      case 'robber': app.animate.add('robber'); sfx.robber(); break;
      case 'discardStart': sfx.robber(); break;
      case 'steal':
        flyBetween(e.victim, e.pid, e.pid === viewer || e.victim === viewer ? e.res : null, e.res || e.empty ? (e.empty ? 0 : 1) : 1, 400);
        if (e.pid === viewer && e.res) toast(`${iconSvg(e.res, 18)} You stole ${RES_NAMES[e.res].toLowerCase()} from ${shortName(e.victim)}.`, 'good');
        else if (e.victim === viewer && e.res) toast(`${iconSvg(e.res, 18)} ${shortName(e.pid)} stole your ${RES_NAMES[e.res].toLowerCase()}.`, 'err');
        break;
      case 'devBought':
        sfx.card();
        flyBundle(e.pid, 'bank', E.COSTS.dev);
        if (e.pid === viewer && e.card) toast(`${GLYPH.dev} You drew <b>${E.DEV_NAMES[e.card]}</b>. ${DEV_TEXT[e.card]}`, 'good', 3.5);
        break;
      case 'devPlayed': sfx.card(); if (e.pid !== viewer) toast(`${nameHtml(e.pid)} played <b>${E.DEV_NAMES[e.card]}</b>.`); break;
      case 'monopoly': app.view.players.forEach(o => { if (o.id !== e.pid) flyBetween(o.id, e.pid, e.resource, 1, 200); }); toast(`${nameHtml(e.pid)} took ${e.total} ${RES_NAMES[e.resource].toLowerCase()} with Monopoly.`); break;
      case 'award':
        sfx.award();
        if (e.pid !== null) toast(`${nameHtml(e.pid)} takes the <b>${e.award === 'longestRoad' ? 'Longest Road' : 'Largest Army'}</b> (+2).`, 'good', 3.2);
        else toast(`Nobody holds the <b>Longest Road</b> now.`);
        break;
      case 'bankTrade': sfx.trade(); flyBetween(e.pid, 'bank', e.give, e.ratio * e.count); flyBetween('bank', e.pid, e.get, e.count, 500); break;
      case 'cardsMoved': flyBundle(e.from, e.to, e.cards); break;
      case 'gain': (e.resources || []).forEach((r, i) => flyBetween('bank', e.pid, r, 1, i * 120)); break;
      case 'discard': flyBetween(e.pid, 'bank', null, e.n); break;
      case 'trade':
        sfx.trade();
        flyBundle(e.pid, e.partner, e.give); flyBundle(e.partner, e.pid, e.get, 300);
        if (e.pid === viewer) toast(`Traded ${bundleHtml(e.give)} to ${nameHtml(e.partner)} for ${bundleHtml(e.get)}.`, 'good', 3);
        else if (e.partner === viewer) toast(`Traded ${bundleHtml(e.get)} to ${nameHtml(e.pid)} for ${bundleHtml(e.give)}.`, 'good', 3);
        break;
      case 'tradeResponse':
        if (app.view?.trade?.from === viewer && e.answer !== 'reject' && app.modal !== 'trade') sfx.card();
        break;
      case 'tradeOffer': if (e.trade.from !== viewer) sfx.card(); break;
      case 'turn':
        app.buildMode = null; app.knightMode = null;
        if (app.lastTurnOwner === viewer && e.pid !== viewer) app.recentBuilds = [];
        app.lastTurnOwner = e.pid;

        if (isLocalHuman(e.pid)) setTimeout(() => { $('status').classList.remove('flash'); void $('status').offsetWidth; $('status').classList.add('flash'); }, 200);
        break;
      case 'island': sfx.award(); toast(`${nameHtml(e.pid)} settled a new island (+2).`, 'good', 3.2); break;
      case 'goldField': setTimeout(() => scene?.flashHex(e.hex, '#ffd24a'), later); break;
      case 'pirate': app.animate.add('pirate'); sfx.robber(); break;
      case 'shipMoved': app.animate.add(`ship:${e.to}`); sfx.build('road'); break;
      case 'barbarians': if (e.pos >= BARBARIAN_STEPS - 2) toast(`The barbarian ship is ${BARBARIAN_STEPS - e.pos} step${BARBARIAN_STEPS - e.pos === 1 ? '' : 's'} away. Activate your knights!`, 'err', 3.5); break;
      case 'barbarianAttack': setTimeout(() => showAttack(e), later); break;
      case 'pillage': if (e.pid === viewer) toast('The barbarians pillaged one of your cities.', 'err', 3.5); break;
      case 'metropolis': sfx.award(); toast(`${nameHtml(e.pid)} builds the ${TRACK_NAMES[e.track]} metropolis (+2).`, 'good', 3.5); break;
      case 'improve': sfx.build('city'); flyBetween(e.pid, 'bank', TRACKS[e.track], e.level); break;
      case 'progressDrawn': sfx.card(); if (e.pid === viewer && e.card) toast(`You drew <b>${PROGRESS[e.card].name}</b>: ${PROGRESS[e.card].text}`, 'good', 4); break;
      case 'progressVP': sfx.award(); toast(`${nameHtml(e.pid)} drew ${PROGRESS[e.card].name} (+1 point).`, 'good'); break;
      case 'progressPlayed': sfx.card(); if (e.pid !== viewer) toast(`${nameHtml(e.pid)} played <b>${PROGRESS[e.card].name}</b>.`, '', 3.2); break;
      case 'knight':
        sfx.build(e.what === 'promote' ? 'city' : 'road');
        if (e.what === 'activate') flyBetween(e.pid, 'bank', 'wheat', 1);
        if (e.what === 'promote' && !e.free) flyBundle(e.pid, 'bank', CK_COSTS.promote);
        if (['place', 'move', 'displace'].includes(e.what)) app.animate.add(`knight:${e.id}`);
        break;
      case 'merchant': sfx.build('settlement'); break;
      case 'tokens': scene?.retoken?.(app.view); break;
      case 'specialBuild':
        app.buildMode = null;
        if (isLocalHuman(e.pid)) setTimeout(() => sfx.turn(), 150);
        break;
      case 'win':
        setTimeout(() => { sfx.victory(); confetti(); }, 600);
        break;
      default: break;
    }
  }
}

// ---- turn alerts: sound, banner, tab title, vibration, desktop notification, reminder
const BASE_TITLE = document.title;
let titleFlash = null, reminder = null;
function myTurnKey(v) {
  if (!v || app.viewer === null || v.phase === 'over') return null;
  const mine = v.prompts && v.prompts.length ? v.prompts[0].pid === app.viewer
    : v.gold && Object.keys(v.gold).length ? !!v.gold[app.viewer]
    : v.phase === 'discard' ? !!v.discards[app.viewer] : v.current === app.viewer;
  return mine ? `${v.turn}|${v.current}|${v.phase === 'setup' ? `s${v.setup.index}` : v.phase === 'discard' ? 'd' : 't'}` : null;
}
function stopTitleFlash() { if (titleFlash) { clearInterval(titleFlash); titleFlash = null; } document.title = BASE_TITLE; }
function alertMyTurn(v) {
  const rolling = v.phase === 'roll';
  sfx.yourTurn();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && (v.phase === 'roll' || v.phase === 'setup')) yourTurnBanner();
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }
  if (document.hidden) {
    stopTitleFlash();
    let on = false;
    titleFlash = setInterval(() => { on = !on; document.title = on ? '● Your turn · Terra Hex' : BASE_TITLE; }, 900);
    try { if (window.Notification && Notification.permission === 'granted') new Notification('Terra Hex', { body: rolling ? 'Your turn: roll the dice.' : 'It is your move.', tag: 'terrahex-turn' }); } catch { /* blocked */ }
  }
  clearTimeout(reminder);
  const key = myTurnKey(v);
  reminder = setTimeout(() => {
    if (myTurnKey(app.view) === key && (app.view.phase === 'roll' || app.view.phase === 'setup')) {
      sfx.yourTurn();
      toast(app.view.phase === 'roll' ? 'Still your turn: roll the dice.' : 'Still your turn: place your piece.', 'good', 3);
      const b = $('btn-roll'); b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
    }
  }, 25000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) stopTitleFlash(); });

function yourTurnBanner() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div');
  el.className = 'yourturn';
  el.textContent = 'Your turn';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
function showAttack(e) {
  const el = document.createElement('div');
  el.className = `attack panel${e.won ? ' won' : ''}`;
  const who = e.won ? (e.defender !== null ? `${nameHtml(e.defender)} is the Defender of Catan (+1).` : e.tied.length ? `${e.tied.map(nameHtml).join(' and ')} each draw a progress card.` : '') : (e.losers.length ? `${e.losers.map(nameHtml).join(' and ')} lose${e.losers.length === 1 ? 's' : ''} a city.` : 'Only metropolises stand: nothing is lost.');
  el.innerHTML = `<h2>${e.won ? 'The barbarians are driven off' : 'The barbarians break through'}</h2><p style="margin:6px 0 0">Barbarians ${e.strength} · Knights ${e.defense}</p><p style="margin:4px 0 0">${who}</p>${e.first ? '<p style="margin:4px 0 0;color:var(--parchment-3)">The robber may now be moved.</p>' : ''}`;
  document.body.appendChild(el);
  sfx.robber();
  setTimeout(() => el.remove(), 3700);
}
/** Where a player's cards live on screen: your hand cards, or their scoreboard plaque. */
function cardAnchor(pid, res, viewer) {
  if (pid === 'bank') {
    const b = $('bank');
    if (b && b.offsetParent) { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    const d = $('dice-tray').getBoundingClientRect();
    return { x: d.left + d.width / 2, y: d.top + 20 };
  }
  const el = pid === viewer && !curtainUp() ? ($(`card-${res}`) || $('hand')) : $(`plaque-${pid}`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
/** Flies cards between two places. res === null shows a face-down card. */
function flyBetween(from, to, res, n = 1, delay = 0) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const viewer = app.viewer;
  for (let k = 0; k < Math.min(n, 6); k++) {
    const a = cardAnchor(from, res, viewer), b = cardAnchor(to, res, viewer);
    if (!a || !b) return;
    const el = document.createElement('div');
    el.className = 'fly';
    el.innerHTML = res ? iconSvg(res, 24) : '<span style="font-family:var(--display);font-weight:800;color:#8d6a24">?</span>';
    document.body.appendChild(el);
    const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 60 };
    el.animate([
      { transform: `translate(${a.x - 17}px, ${a.y - 23}px) scale(.5)`, opacity: 0 },
      { transform: `translate(${a.x - 17}px, ${a.y - 40}px) scale(1)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${mid.x - 17}px, ${mid.y - 23}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${b.x - 17}px, ${b.y - 23}px) scale(.6)`, opacity: 0.15 }
    ], { duration: 820, delay: delay + k * 110, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'both' }).onfinish = () => {
      el.remove();
      const target = to === viewer && !curtainUp() ? $(`card-${res}`) : typeof to === 'number' ? $(`plaque-${to}`) : null;
      if (target) { target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); }
    };
  }
}
function flyBundle(from, to, bundle, delay = 0) {
  let d = delay;
  Object.entries(bundle || {}).forEach(([r, n]) => { if (n > 0) { flyBetween(from, to, r, n, d); d += 120 * Math.min(n, 6); } });
}

function flyCard(g, viewer) {
  if (!scene) return;
  const from = scene.projectHex(g.hex);
  const target = g.pid === viewer && !curtainUp() ? $(`card-${g.res}`) : $(`plaque-${g.pid}`);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  for (let k = 0; k < g.n; k++) {
    const el = document.createElement('div');
    el.className = 'fly';
    el.innerHTML = iconSvg(g.res, 24);
    document.body.appendChild(el);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 80 };
    el.animate([
      { transform: `translate(${from.x - 17}px, ${from.y - 23}px) scale(.3)`, opacity: 0 },
      { transform: `translate(${from.x - 17}px, ${from.y - 50}px) scale(1.1)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${mid.x - 17}px, ${mid.y - 23}px) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${to.x - 17}px, ${to.y - 23}px) scale(.6)`, opacity: 0.2 }
    ], { duration: 900, delay: k * 120, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'both' }).onfinish = () => {
      el.remove();
      target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump');
    };
  }
}

function setDie(el, n, red) {
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[n] || [];
  el.innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${on.includes(i) ? 'on' : ''}"></i>`).join('');
  el.classList.toggle('red', !!red);
}
/** A large roll in the middle of the screen, so nobody misses it; it settles into the dice tray. */
function bigRoll(dice, event, pid) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.bigroll, .yourturn').forEach(n => n.remove());
  const total = dice[0] + dice[1];
  const el = document.createElement('div');
  el.className = 'bigroll' + (total === 7 ? ' seven' : '');
  const who = app.view && pid !== undefined ? app.view.players[pid] : null;
  el.innerHTML = `<div class="bigdice"><div class="die big rolling" id="bd1"></div><div class="die big rolling" id="bd2"></div>${event ? `<div class="evdie big">${EVENT_FACE[event]}</div>` : ''}</div>
    <div class="bigtotal"><span class="who">${who ? `${esc(who.name)} rolled` : 'Rolled'}</span><b>${total}</b>${total === 7 ? '<span class="sub">The robber!</span>' : event === 'ship' ? '<span class="sub">The barbarians advance</span>' : ''}</div>`;
  document.body.appendChild(el);
  const d1 = el.querySelector('#bd1'), d2 = el.querySelector('#bd2');
  let k = 0;
  const spin = setInterval(() => { setDie(d1, 1 + (k++ % 6)); setDie(d2, 1 + ((k * 5) % 6)); }, 70);
  setTimeout(() => {
    clearInterval(spin);
    d1.classList.remove('rolling'); d2.classList.remove('rolling');
    setDie(d1, dice[0], total === 7); setDie(d2, dice[1], total === 7);
    el.classList.add('landed');
  }, 650);
  // Settle into the tray.
  setTimeout(() => {
    const tray = $('die1').getBoundingClientRect(), r = el.getBoundingClientRect();
    el.animate([{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${tray.left - (r.left + r.width / 2) + 50}px), calc(-50% + ${tray.top - (r.top + r.height / 2) + 20}px)) scale(.35)`, opacity: 0 }], { duration: 450, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).onfinish = () => el.remove();
  }, 1650);
}
/** "+2 wood, +1 ore" above your hand, and "+3" on other players' plaques. */
function gainSummary(gains, viewer) {
  const per = {};
  gains.forEach(g => { (per[g.pid] ||= {})[g.res] = ((per[g.pid] || {})[g.res] || 0) + g.n; });
  Object.entries(per).forEach(([pid, bundle]) => {
    pid = Number(pid);
    const total = Object.values(bundle).reduce((a, b) => a + b, 0);
    const el = document.createElement('div');
    if (pid === viewer && !curtainUp()) {
      el.className = 'gainpop mine';
      el.innerHTML = Object.entries(bundle).map(([r, n]) => `<span>+${n} ${iconSvg(r, 26)}</span>`).join('');
      const h = $('hand').getBoundingClientRect();
      el.style.left = `${h.left + h.width / 2}px`; el.style.top = `${h.top - 14}px`;
    } else {
      const pl = $(`plaque-${pid}`);
      if (!pl) return;
      const r = pl.getBoundingClientRect();
      el.className = 'gainpop';
      el.textContent = `+${total}`;
      el.style.left = `${r.right - 8}px`; el.style.top = `${r.top + r.height / 2}px`;
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  });
}
function animateDice(dice) {
  const d1 = $('die1'), d2 = $('die2');
  app.diceRolling = true;
  d1.classList.add('rolling'); d2.classList.add('rolling'); d1.classList.remove('landed'); d2.classList.remove('landed');
  let k = 0;
  const spin = setInterval(() => { setDie(d1, 1 + (k++ % 6)); setDie(d2, 1 + ((k * 5) % 6)); }, 80);
  $('dice-total').innerHTML = '&nbsp;';
  setTimeout(() => {
    clearInterval(spin);
    app.diceRolling = false;
    d1.classList.remove('rolling'); d2.classList.remove('rolling');
    d1.classList.add('landed'); d2.classList.add('landed');
    const seven = dice[0] + dice[1] === 7;
    setDie(d1, dice[0], seven); setDie(d2, dice[1], seven);
    $('dice-total').innerHTML = `Rolled <b>${dice[0] + dice[1]}</b>`;
    renderHistogram(app.view);
  }, 700);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#e8c56f', '#d94a3d', '#2f6fd6', '#3c9a4e', '#f3e8cb', '#e48a1c'];
  for (let i = 0; i < 90; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.left = `${Math.random() * 100}vw`;
    el.style.background = colors[i % colors.length];
    document.body.appendChild(el);
    const drift = (Math.random() - 0.5) * 200;
    el.animate([
      { transform: 'translate(0,0) rotate(0)' },
      { transform: `translate(${drift}px, ${window.innerHeight + 40}px) rotate(${Math.random() * 900}deg)` }
    ], { duration: 2400 + Math.random() * 1800, delay: Math.random() * 600, easing: 'cubic-bezier(.3,.1,.6,1)' }).onfinish = () => el.remove();
  }
}

// ================================================================== render
function refresh() {
  if (app.mode === 'local') {
    const v = localViewer();
    if (v !== null && v !== app.lastViewer) app.lastViewer = v;
    app.viewer = v;
    app.view = E.viewFor(app.state, v);
    updateLocalClock();
    // Hot-seat: hide the hand until the right person is at the screen.
    if (app.humans.length > 1 && v !== null && app.revealed !== v && app.state.phase !== 'over') showCurtain(v);
  }
  const v = app.view;
  if (!v) return;
  displayColors(v);
  if (scene) { scene.showSymbols = app.display.symbols; scene.roadSymbols = app.display.roadSymbols; }
  const key = v.board.hexes.map(h => h.terrain[0]).join('') + v.board.ports.map(p => p.type + p.edge).join('') + v.board.hexes.length;
  if (scene && key !== app.boardKey) { scene.setBoard(v.board); app.boardKey = key; app.animate.clear(); }
  if (scene && key !== app.boardKey) { /* handled above */ }
  if (scene) scene.sync(v, { colors: v.players.map(p => p.color), viewer: app.viewer, animate: app.animate });
  if (scene) {
    const exists = (r) => (r.kind === 'road' ? v.eOwner[r.id] === r.pid : r.kind === 'knight' ? v.kOwner?.[r.id] === r.pid : v.vOwner[r.id] === r.pid);
    app.recentBuilds = app.recentBuilds.filter(exists);
    scene.setRecent(app.display.recent ? app.recentBuilds.map(r => ({ ...r, color: v.players[r.pid].color })) : []);
  }
  app.animate = new Set();
  if (app.buildMode && !(myTurn() && (v.phase === 'main' || v.phase === 'specialBuild'))) app.buildMode = null;
  document.body.classList.toggle('many', v.players.length > 4);

  $('dock').classList.toggle('watching', app.viewer === null);
  $('devs').classList.toggle('watching', app.viewer === null);
  scene?.poke();
  const tk = myTurnKey(v);
  if (tk && tk !== app.lastTurnKey && !curtainUp() && app.lastTurnKey !== undefined) alertMyTurn(v);
  if (!tk) clearTimeout(reminder);
  app.lastTurnKey = tk;
  renderPlayers(v); renderStatus(v); renderDiceTray(v); renderHand(v); renderActions(v);
  renderDevs(v); renderLog(v); renderChat(); renderBank(v); renderOffer(v); updateHighlights(v);
  if (app.modal === 'trade') renderTrade();
  if (sea()) {
    const need = v.gold && v.gold[app.viewer] && !curtainUp();
    if (need && app.modal !== 'gold') { app.goldPick = {}; openModal('gold', ''); renderGold(); }
    else if (!need && app.modal === 'gold') closeModal();
    if (v.phase !== 'main') app.shipFrom = null;
    if (v.phase === 'setup' && v.setup.step === 'road' && v.current === app.viewer && !E.legalRoadEdges(v, app.viewer).length) app.pieceChoice = 'ship';
    if (v.phase === 'setup' && v.setup.step === 'settlement') app.pieceChoice = 'road';
  }
  if (ck()) {
    syncPromptModal(v);
    if (app.modal === 'improve') renderImprove();
    if (app.modal === 'knight') renderKnightMenu();
    if (app.knightMode && !(myTurn() && v.phase === 'main')) app.knightMode = null;
  }
  if (app.modal === 'discard' && !(v.phase === 'discard' && v.discards[app.viewer])) closeModal();
  if (v.phase === 'discard' && v.discards[app.viewer] && app.modal !== 'discard' && !curtainUp()) openDiscard();
  if (app.modal === 'victims' && v.phase !== 'robber') closeModal();
  if (v.phase === 'over' && !app.victoryShown) { app.victoryShown = true; setTimeout(showVictory, 1400); }
}

function renderPlayers(v) {
  const room = app.online?.room;
  setHTML($('players'), v.players.map(p => {
    const active = v.phase === 'setup' || v.phase !== 'over' ? v.current === p.id : v.winner === p.id;
    const me = p.id === app.viewer;
    const hidden = me && p.dev ? p.dev.filter(c => c.type === 'victoryPoint').length : 0;
    const online = room ? room.seats[p.id]?.online : true;
    const tags = [];
    if (p.isAI) tags.push(`<span class="tag">AI ${p.ai}</span>`);
    if (me && app.mode === 'online') tags.push('<span class="tag">You</span>');
    const badges = [];
    if (sea() && p.islandVP) badges.push(`<span class="badge" title="New islands settled: +2 points each">Islands +${p.islandVP}</span>`);
    if (ck() && p.defender) badges.push(`<span class="badge" title="Defender of Catan: +1 point each">Defender ×${p.defender}</span>`);
    if (ck() && v.merchant && v.merchant.owner === p.id) badges.push('<span class="badge" title="Merchant: +1 point">Merchant</span>');
    if (v.longestRoad === p.id) badges.push(`<span class="badge" title="Longest Road: +2 points">${SMALL.road.replace(/#d6bf8a/g, '#24190f')} Longest Road</span>`);
    if (v.largestArmy === p.id) badges.push(`<span class="badge" title="Largest Army: +2 points">${SMALL.knight.replace(/#d6bf8a/g, '#24190f')} Largest Army</span>`);
    if (v.phase === 'discard' && v.discards[p.id]) badges.push(`<span class="badge wait">Discarding ${v.discards[p.id]}</span>`);
    if (v.trade && v.trade.responses[p.id]) {
      const a = v.trade.responses[p.id].answer;
      badges.push(`<span class="badge${a === 'reject' ? ' wait' : ''}">${a === 'accept' ? 'Accepts trade' : a === 'counter' ? 'Counteroffer' : 'Declines'}</span>`);
    }
    const vpShown = (p.vpTotal ?? p.vp) + (v.phase !== 'over' ? hidden : 0);
    return `<div class="plaque panel${active ? ' active' : ''}" id="plaque-${p.id}">
      ${crest(p.color, p.name[0])}
      <div class="pname">${room ? `<span class="dot${online ? '' : ' off'}" title="${online ? 'Connected' : 'Disconnected'}"></span>` : ''}<span class="sym" style="color:${p.color}" title="This player's symbol">${SYMBOL_CHARS[p.id % SYMBOL_CHARS.length]}</span><span class="nm">${esc(p.name)}</span>${tags.join('')}</div>
      <div class="vp" title="${hidden && v.phase !== 'over' ? `Victory points, including ${hidden} from secret cards only you can see` : 'Victory points'}">${vpShown}${hidden && v.phase !== 'over' ? `<small>incl. ${hidden} secret</small>` : ''}</div>
      <div class="stats">
        <span class="st" title="${p.handCount === null ? 'Resource cards (hidden by house rule)' : 'Resource cards in hand'}">${SMALL.cards}<b>${p.handCount === null ? '?' : p.handCount}</b></span>
        <span class="st" title="Development cards">${SMALL.dev}<b>${p.devCount}</b></span>
        <span class="st" title="Knights played (Largest Army needs 3)">${SMALL.knight}<b>${p.knights}</b></span>
        <span class="st" title="Longest road${sea() ? ' / trade route' : ''} (Longest Road needs 5)">${SMALL.road}<b>${p.roadLength}</b></span>
      </div>
      ${ck() ? `<div class="imps">${['trade', 'politics', 'science'].map(t => `<span title="${TRACK_NAMES[t]} level ${p.improve[t]}${v.metropolis[t] === p.id ? ' (metropolis)' : ''}" style="color:${TRACK_COLORS[t]}">${[1, 2, 3, 4, 5].map(l => `<i style="${l <= p.improve[t] ? `background:${TRACK_COLORS[t]}` : ''}"></i>`).join('')}${v.metropolis[t] === p.id ? '★' : ''}</span>`).join('')}<span title="Active knight strength / total" style="margin-left:auto">${SMALL.knight}${E.CKH.defenseOf(v, p.id)}/${E.CKH.knightsOf(v, p.id).reduce((a, k) => a + v.kLevel[k], 0)}</span><span title="Progress cards">${SMALL.dev}${p.progCount ?? 0}</span></div>` : ''}
      <div class="badges">${badges.join('')}</div>
      <div class="vpbar" title="${vpShown} of ${v.config.vpTarget} points"><i style="width:${Math.min(100, (vpShown / v.config.vpTarget) * 100)}%;background:${p.color}"></i></div>
    </div>`;
  }).join(''));
}

function statusText(v) {
  const me = app.viewer;
  const cur = v.current;
  if (v.prompts && v.prompts.length && v.phase !== 'over') {
    const p = v.prompts[0];
    if (p.pid === me && !curtainUp()) return [p.title, p.text + (p.optional ? ' (You can skip this.)' : '')];
    return [`Waiting for ${nameHtml(p.pid)}`, esc(p.title)];
  }
  if (v.gold && Object.keys(v.gold).length && v.phase !== 'over') {
    if (v.gold[me] && !curtainUp()) return ['Gold!', `Choose ${v.gold[me]} resource${v.gold[me] > 1 ? 's' : ''} from the gold field.`];
    return ['Waiting for gold choices', Object.keys(v.gold).map(p => nameHtml(Number(p))).join(', ')];
  }
  if (sea() && myTurn() && (v.phase === 'setup' ? v.setup.step === 'road' : v.phase === 'roadBuilding')) {
    const pick = `<span class="piecepick"><button class="${app.pieceChoice !== 'ship' ? 'on' : ''}" data-piece="road">Road</button><button class="${app.pieceChoice === 'ship' ? 'on' : ''}" data-piece="ship">Ship</button></span>`;
    return [v.phase === 'setup' ? `Place a road or a ship next to it ${pick}` : `Place a free road or ship (${v.freeRoads} left) ${pick}`, 'Roads go on land, ships on water. Switch with the buttons.'];
  }
  if (sea() && myTurn() && app.shipFrom !== null && app.shipFrom !== undefined) return ['Choose where the ship sails to', 'It must stay linked to your route. Press Esc to cancel.'];
  if (sea() && myTurn() && app.buildMode === 'ship') return ['Choose open water for your ship', 'Ships link to your settlements and other ships. Press Esc to cancel.'];
  if (sea() && v.phase === 'robber' && myTurn()) return ['Move the robber or the pirate', 'Pick a land tile for the robber, or a sea space for the pirate (he robs ship owners and blocks ships beside him).'];
  if (app.knightMode && myTurn()) return [app.knightMode.what === 'move' ? 'Choose where the knight moves' : 'Choose a weaker knight to displace', 'Press Esc to cancel.'];
  if (ck() && myTurn() && v.phase === 'main' && ['knight', 'wall'].includes(app.buildMode)) return [app.buildMode === 'knight' ? 'Choose an intersection on your roads for the knight' : 'Choose a city for the wall', 'Press Esc to cancel.'];
  const mine = myTurn();
  const who = nameHtml(cur);
  switch (v.phase) {
    case 'setup': {
      const second = v.setup.index >= v.players.length;
      if (mine) return v.setup.step === 'settlement'
        ? [`Place your ${second ? 'second' : 'first'} settlement`, second ? 'You collect one card from each tile next to it.' : 'Pick a glowing intersection. Higher dots on the numbers mean more production.']
        : ['Place a road next to it', 'Click a glowing path.'];
      return [`${who} is placing a ${v.setup.step}`, 'Starting placement goes around the table and back.'];
    }
    case 'roll': return mine ? ['Roll the dice', v.players[me].dev?.some(c => c.type === 'knight' && c.turn < v.turn) && !v.devPlayed ? 'You can play a Knight before rolling.' : ''] : [`${who} is rolling`, ''];
    case 'discard': {
      if (me !== null && v.discards[me]) return [`Discard ${v.discards[me]} cards`, 'A 7 was rolled and you hold more than ' + v.config.discardLimit + '.'];
      return ['Waiting for players to discard', Object.keys(v.discards).map(p => nameHtml(Number(p))).join(', ')];
    }
    case 'robber': return mine
      ? ['Move the robber', v.config.friendlyRobber ? 'Pick a glowing tile to block and steal one card there. Players on 2 points or fewer are protected (Friendly Robber).' : 'Pick a tile to block and steal one card there. Friendly Robber is off, so anyone can be robbed.']
      : [`${who} is moving the robber`, ''];
    case 'roadBuilding': return mine ? [`Place a free road (${v.freeRoads} left)`, 'Click a glowing path.'] : [`${who} is building roads`, ''];
    case 'main': {
      if (!mine) return [`${who}\u2019s turn`, v.trade && v.trade.from === cur ? 'They are proposing a trade.' : ''];
      const labels = { road: 'Choose a path for your road', settlement: 'Choose a spot for your settlement', city: 'Choose a settlement to upgrade' };
      if (app.buildMode) return [labels[app.buildMode], 'Press Esc to cancel.'];
      return ['Build, trade or end your turn', ''];
    }
    case 'specialBuild': {
      if (!mine) return [`${who} may build between turns`, 'With 5–6 players, everyone gets a chance to build after each turn.'];
      const labels = { road: 'Choose a path for your road', settlement: 'Choose a spot for your settlement', city: 'Choose a settlement to upgrade' };
      if (app.buildMode) return [labels[app.buildMode], 'Press Esc to cancel.'];
      return ['Your chance to build', 'Build or buy a card now if you like (no trading or playing cards), then press Done.'];
    }
    case 'over': return [`${who} wins!`, `${(v.players[v.winner].vpTotal)} victory points`];
    default: return ['', ''];
  }
}
function renderStatus(v) {
  const [line, sub] = statusText(v);
  const el = $('status');
  let timer = '';
  if (app.deadline && v.phase !== 'over') {
    const left = Math.max(0, Math.round((app.deadline - Date.now()) / 1000));
    timer = `<span class="timer">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>`;
  }
  el.querySelector('.line').innerHTML = line + timer;
  el.querySelector('.sub').innerHTML = sub;
  el.classList.toggle('mine', myTurn() && v.phase !== 'over');
}
setInterval(() => { if (app.view && app.deadline) renderStatus(app.view); }, 1000);

function renderBarbarians(v) {
  const el = $('barb');
  if (!ck()) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const strength = v.vType.filter((t, x) => t === 'city' && v.vOwner[x] !== null).length;
  const defense = v.players.reduce((a, p) => a + E.CKH.defenseOf(v, p.id), 0);
  const steps = Array.from({ length: BARBARIAN_STEPS }, (_, i) => `<span class="bstep${i < v.barb.pos ? ' on' : ''}${i === v.barb.pos - 1 ? ' ship' : ''}"></span>`).join('');
  el.innerHTML = `<div class="vs"><span>Barbarians</span><span>${BARBARIAN_STEPS - v.barb.pos} to go</span></div><div class="track" title="The ship advances on every ship roll; at the end it attacks">${steps}</div>
    <div class="vs" title="Barbarian strength is the number of cities; defence is the total of active knights"><span>Attack <b class="bad">${strength}</b></span><span>Defence <b class="${defense >= strength ? 'good' : 'bad'}">${defense}</b></span></div>
    ${v.barb.attacked ? '' : '<div style="color:var(--parchment-3)">The robber waits for the first attack.</div>'}`;
}
const EVENT_FACE = { ship: '⛵', trade: '<span style="color:#d9b23a">⬢</span>', politics: '<span style="color:#3e6fb0">⬢</span>', science: '<span style="color:#4f9a5a">⬢</span>' };
function renderDiceTray(v) {
  renderBarbarians(v);
  let ev = $('evdie');
  if (ck() && !ev) { $('die2').insertAdjacentHTML('afterend', '<div class="evdie" id="evdie" title="Event die: ship moves the barbarians; a coloured gate draws progress cards"></div>'); ev = $('evdie'); }
  if (!ck() && ev) ev.remove();
  if (ev) ev.innerHTML = v.eventDie ? EVENT_FACE[v.eventDie] : '';
  const canRoll = myTurn() && v.phase === 'roll';
  const btn = $('btn-roll');
  btn.disabled = !canRoll || app.busy;
  btn.classList.toggle('pulse', canRoll);
  if (!app.diceRolling) {
    if (v.dice) {
      const seven = v.dice[0] + v.dice[1] === 7;
      setDie($('die1'), v.dice[0], seven); setDie($('die2'), v.dice[1], seven);
      $('dice-total').innerHTML = `Rolled <b>${v.dice[0] + v.dice[1]}</b>`;
    } else if (!$('die1').innerHTML) { setDie($('die1'), 0); setDie($('die2'), 0); }
    else if (v.phase === 'roll') $('dice-total').innerHTML = '&nbsp;';
    renderHistogram(v);
  }
}
function renderHistogram(v) {
  const rolls = v.stats.rolls;
  const max = Math.max(1, ...rolls.slice(2));
  const last = v.dice ? v.dice[0] + v.dice[1] : null;
  setHTML($('hist'), rolls.slice(2).map((n, i) => `<div class="${i + 2 === last ? 'hot' : ''}" style="height:${Math.round((n / max) * 100)}%" title="${i + 2}: rolled ${n} time${n === 1 ? '' : 's'}"></div>`).join(''));
  if (!$('hist-labels').innerHTML) $('hist-labels').innerHTML = Array.from({ length: 11 }, (_, i) => `<span>${i + 2}</span>`).join('');
}

function renderHand(v) {
  const me = app.viewer;
  if (me === null || !v.players[me].hand) {
    setHTML($('hand'), me === null ? '<span class="empty-note">Watching the AI players.</span>' : '');
    return;
  }
  const h = v.players[me].hand;
  if (curtainUp()) { setHTML($('hand'), ''); return; }
  const ratios = E.tradeRatios(v, me);
  const types = E.kinds(v);
  const rates = `<div class="rates" title="Your bank and harbour trade rates"><span class="cap">Your rates</span>${types.map(r => `<span class="rt${ratios[r] < 4 ? ' good' : ''}">${iconSvg(r, 15)}${ratios[r]}:1</span>`).join('')}</div>`;
  setHTML($('hand'), rates + types.map(r => `
    <div class="card${h[r] ? '' : ' empty'}" id="card-${r}" title="${RES_NAMES[r]}: ${h[r]}">
      <div class="band" style="background:${RES_COLORS[r]}"></div>${iconSvg(r, 44)}
      <div class="lbl">${RES_NAMES[r]}</div>${h[r] ? `<div class="cnt">${h[r]}</div>` : ''}
    </div>`).join(''));
}

function buildState(v, kind) {
  const me = app.viewer;
  if (me === null || !v.players[me].hand) return { ok: false, why: '' };
  const hand = v.players[me].hand;
  const cost = E.COSTS[kind] || CK_COSTS[kind];
  const mine = myTurn() && (v.phase === 'main' || v.phase === 'specialBuild');
  let left = null, why = '';
  if (kind === 'knight' || kind === 'wall') {
    left = kind === 'knight' ? E.CKH.knightPieces(v, me, 1) : 3 - E.CKH.wallsOf(v, me);
    if (!mine) why = 'Not available right now.';
    else if (left <= 0) why = kind === 'knight' ? 'No basic knights left (promote one to free a piece).' : 'No walls left (3 maximum).';
    else if (!E.canAfford(hand, cost)) why = 'Not enough resources.';
    else if (kind === 'knight' && !E.CKH.knightSpots(v, me).length) why = 'Knights need an empty intersection on your roads.';
    else if (kind === 'wall' && !E.CKH.cities(v, me).some(x => !v.vWall[x])) why = 'Walls go under cities without one.';
    return { ok: !why, why, left, hand, cost };
  }
  if (kind === 'dev') left = v.devDeckCount;
  else left = E.piecesLeft(v, me, kind);
  if (kind === 'ship' && mine && left > 0 && E.canAfford(hand, cost) && !E.legalShipEdges(v, me).length) return { ok: false, why: 'No open water linked to your settlements or ships (or the pirate is in the way).', left, hand, cost };
  if (!mine) why = 'Not available right now.';
  else if (left <= 0) why = kind === 'dev' ? 'The deck is empty.' : `No ${kind === 'city' ? 'cities' : kind + 's'} left.`;
  else if (!E.canAfford(hand, cost)) why = 'Not enough resources.';
  else if (kind === 'road' && !E.legalRoadEdges(v, me).length) why = 'Nowhere to build a road.';
  else if (kind === 'settlement' && !E.legalSettlementVertices(v, me, false).length) why = 'No legal spot: extend a road at least two paths from other buildings.';
  else if (kind === 'city' && !E.legalCityVertices(v, me).length) why = 'You have no settlement to upgrade.';
  return { ok: !why, why, left, hand, cost };
}
function renderActions(v) {
  const names = { road: 'Road', settlement: 'Settlement', city: 'City', dev: 'Dev card', knight: 'Knight', wall: 'Wall', ship: 'Ship' };
  $('act-wall').classList.toggle('hidden', !ck());
  $('act-ship').classList.toggle('hidden', !sea());
  $('btn-improve').classList.toggle('hidden', !ck());
  $('btn-improve').disabled = !(myTurn() && ['main', 'specialBuild'].includes(v.phase));
  ['road', 'settlement', 'city', ck() ? 'knight' : 'dev', ...(ck() ? ['wall'] : []), ...(sea() ? ['ship'] : [])].forEach(kind => {
    const el = $(`act-${kind === 'knight' ? 'dev' : kind}`);
    el.dataset.kind = kind;
    const s = buildState(v, kind);
    const cost = E.COSTS[kind] || CK_COSTS[kind];
    const hand = s.hand || {};
    const chips = [];
    Object.entries(cost).forEach(([r, n]) => { for (let i = 0; i < n; i++) chips.push(iconSvg(r, 17).replace('class="ico"', `class="ico${(hand[r] || 0) > i ? '' : ' short'}"`)); });
    el.innerHTML = `<span class="glyph">${GLYPH[kind] || GLYPH.city}</span><span class="name">${names[kind]}<span class="left">${s.left ?? ''}${kind === 'dev' ? ' left' : ''}</span></span><span class="cost">${chips.join('')}</span>`;
    el.disabled = !s.ok;
    el.title = `${names[kind]}: ${Object.entries(cost).map(([r, n]) => `${n} ${RES_NAMES[r].toLowerCase()}`).join(', ')}${s.why ? ' \u2014 ' + s.why : ''}`;
    el.classList.toggle('on', app.buildMode === kind);
  });
  const main = myTurn() && v.phase === 'main';
  const sbp = myTurn() && v.phase === 'specialBuild';
  $('btn-trade').disabled = !main;
  $('btn-end').disabled = !(main || sbp) || app.busy;
  $('btn-end').textContent = sbp ? 'Done building' : 'End turn';
}

function renderProgress(v) {
  const me = app.viewer;
  $('devs').querySelector('h3 span').textContent = 'Progress cards';
  $('deck-left').textContent = ['trade', 'politics', 'science'].map(d => `${v.progCounts?.[d] ?? 0}`).join(' / ') + ' in decks';
  const p = me !== null ? v.players[me] : null;
  if (!p || !p.prog || curtainUp()) { setHTML($('devlist'), '<span class="empty-note">No cards.</span>'); return; }
  const vpCards = (p.progVP || []).map(c => `<div class="prog" style="--c:${DECK_COLOR[PROGRESS[c].deck]}"><div class="t">${PROGRESS[c].name}<small>+1 point</small></div></div>`).join('');
  const canMain = myTurn() && v.phase === 'main' && !(v.prompts && v.prompts.length);
  const canRoll = myTurn() && v.phase === 'roll' && !(v.prompts && v.prompts.length);
  const cards = p.prog.map((c, i) => {
    const def = PROGRESS[c.type];
    const can = def.before ? canRoll : canMain;
    const art = { bg: c.deck === 'trade' ? ['#5c4a12', '#2a2006'] : c.deck === 'politics' ? ['#1f3a63', '#0d1b30'] : ['#1f4a2a', '#0d2213'], svg: `<g transform="translate(14 8) scale(.56)">${iconSvg({ trade: 'cloth', politics: 'coin', science: 'paper' }[c.deck], 64).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>` };
    return devCardHtml({ type: c.type, name: def.name, text: def.text, art, can, play: `data-pplay="${i}"`, why: can ? '' : def.before ? 'Before rolling' : 'After rolling', deckColor: DECK_COLOR[c.deck] });
  }).join('');
  setHTML($('devlist'), cards || vpCards ? `<div class="dfan" style="--ov:${[0, 0, 8, 26, 44, 56][Math.min(5, p.prog.length)]}px">${cards}</div>${vpCards}<span class="empty-note">Hold up to 4.</span>` : '<span class="empty-note">No progress cards. Improve your cities to draw them when a gate is rolled.</span>');
}
/** Card art for development cards (original, drawn in SVG). */
const DEV_ART = {
  knight: { bg: ['#5a2a2a', '#2e1414'], accent: '#e8c56f', svg: '<path d="M32 10c-9 0-14 6-14 15v6h28v-6c0-9-5-15-14-15z" fill="#c9ced6"/><path d="M22 27h20v3H22z" fill="#2b2b2b"/><path d="M26 33h12l-2 14h-8z" fill="#9aa1ab"/><path d="M44 18l8-8 2 2-8 8z" fill="#e8c56f"/><path d="M47 21l-14 22-3-2 14-22z" fill="#dfe3e8"/><path d="M14 36c0 9 8 16 18 16s18-7 18-16" fill="none" stroke="#e8c56f" stroke-width="3"/>' },
  victoryPoint: { bg: ['#6b5212', '#2f2406'], accent: '#ffe08a', svg: '<path d="M14 40l6-18 12 10 12-10 6 18z" fill="#ffd24a"/><circle cx="20" cy="20" r="3.5" fill="#ffe08a"/><circle cx="32" cy="14" r="3.5" fill="#ffe08a"/><circle cx="44" cy="20" r="3.5" fill="#ffe08a"/><path d="M14 44h36v5H14z" fill="#e0a419"/><text x="32" y="38" text-anchor="middle" font-family="Georgia,serif" font-weight="800" font-size="12" fill="#6b4a06">+1</text>' },
  roadBuilding: { bg: ['#4a3a24', '#221a0e'], accent: '#e7d6ab', svg: '<path d="M10 46L30 18" stroke="#8a7a63" stroke-width="9" stroke-linecap="round"/><path d="M34 46L54 18" stroke="#8a7a63" stroke-width="9" stroke-linecap="round"/><path d="M10 46L30 18M34 46L54 18" stroke="#e7d6ab" stroke-width="2.5" stroke-dasharray="4 4"/><path d="M26 52h12" stroke="#e8c56f" stroke-width="3" stroke-linecap="round"/>' },
  yearOfPlenty: { bg: ['#3f5a24', '#1c2a10'], accent: '#e8c56f', svg: '<path d="M14 44c4-14 18-24 36-22-6 4-10 10-10 18-8 0-16 1-26 4z" fill="#c99a3b"/><circle cx="44" cy="22" r="5" fill="#d94a3d"/><circle cx="36" cy="18" r="4" fill="#8dbb4c"/><ellipse cx="48" cy="31" rx="3" ry="6" fill="#e5b83f"/><circle cx="40" cy="28" r="3.5" fill="#7d8794"/>' },
  monopoly: { bg: ['#2a3d5a', '#101b2c'], accent: '#a9c6ff', svg: '<ellipse cx="32" cy="44" rx="16" ry="5" fill="#2e558a"/><rect x="16" y="34" width="32" height="10" fill="#3e6fb0"/><ellipse cx="32" cy="34" rx="16" ry="5" fill="#6b9be0"/><rect x="20" y="24" width="24" height="10" fill="#3e6fb0"/><ellipse cx="32" cy="24" rx="12" ry="4" fill="#86b0ec"/><path d="M12 18c6-6 14-6 20 0" stroke="#a9c6ff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M30 14l3 4-5 1z" fill="#a9c6ff"/>' }
};
function devCardHtml({ type, name, text, art, count, badge, can, play, why, fresh, deckColor }) {
  const a = art || DEV_ART[type] || DEV_ART.roadBuilding;
  return `<div class="dcard${can ? ' can' : ''}${fresh ? ' fresh' : ''}" style="--c1:${a.bg[0]};--c2:${a.bg[1]};--ac:${deckColor || a.accent}" ${can ? `${play} role="button" tabindex="0"` : ''} title="${esc(name)}: ${esc(text)}${why ? ` (${esc(why)})` : ''}">
    <div class="dtop"><span class="dname">${esc(name)}</span>${count > 1 ? `<span class="dcount">×${count}</span>` : ''}</div>
    <svg class="dart" viewBox="0 0 64 60" aria-hidden="true">${a.svg}</svg>
    <div class="dtext">${esc(text)}</div>
    ${badge ? `<div class="dbadge">${badge}</div>` : can ? '<div class="dbadge go">Play</div>' : why ? `<div class="dbadge wait">${esc(why)}</div>` : ''}
  </div>`;
}
function renderDevs(v) {
  if (ck()) return renderProgress(v);
  $('devs').querySelector('h3 span').textContent = 'Development cards';
  const me = app.viewer;
  $('deck-left').textContent = `${v.devDeckCount} in deck`;
  const p = me !== null ? v.players[me] : null;
  if (!p || !p.dev || curtainUp()) { setHTML($('devlist'), '<span class="empty-note">No cards.</span>'); return; }
  if (!p.dev.length) { setHTML($('devlist'), '<span class="empty-note">None yet. Buy one with sheep, wheat and ore.</span>'); return; }
  const playable = E.playableDevCards(v, me);
  const groups = {};
  p.dev.forEach(c => { const g = (groups[c.type] ||= { n: 0, fresh: 0 }); g.n++; if (c.turn >= v.turn) g.fresh++; });
  const order = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'];
  const kinds = order.filter(t => groups[t]).length;
  setHTML($('devlist'), `<div class="dfan" style="--ov:${[0, 0, 8, 26, 44, 56][kinds]}px">${order.filter(t => groups[t]).map(t => {
    const g = groups[t];
    const can = playable.includes(t);
    let why = '';
    if (t !== 'victoryPoint' && !can) why = v.devPlayed && myTurn() ? 'One per turn' : g.fresh === g.n ? 'Next turn' : myTurn() ? '' : 'Your turn';
    return devCardHtml({ type: t, name: E.DEV_NAMES[t], text: DEV_TEXT[t], count: g.n, can, play: `data-play="${t}"`, why, fresh: g.fresh > 0, badge: t === 'victoryPoint' ? 'Secret +1' : '' });
  }).join('')}</div>`);
}

let logCount = -1;
function renderLog(v) {
  const last = v.log.length ? v.log[v.log.length - 1].i : -1;
  if (last === logCount) return;
  logCount = last;
  const el = $('log');
  el.innerHTML = v.log.slice(-80).map(e => `<div class="e">${formatLog(e.msg)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
function renderBank(v) {
  const types = E.kinds(v);
  setHTML($('bank'), `<div class="bank-head"><span>Bank</span>${v.devDeckCount !== undefined && !ck() ? `<span title="Development cards left">${SMALL.dev}${v.devDeckCount}</span>` : ''}</div>
    <div class="bank-grid" style="grid-template-columns:repeat(${types.length > 5 ? 4 : 5},1fr)">${types.map(r => `<div class="bk${v.bank[r] <= 3 ? ' low' : ''}" title="${RES_NAMES[r]}: ${v.bank[r]} left in the bank">${iconSvg(r, 24)}<b>${v.bank[r]}</b></div>`).join('')}</div>`);
}

// ---- trade offers on the table (incoming, and replies to your own)
function renderOffer(v) {
  const el = $('offer-card');
  const t = v.trade;
  if (!t || curtainUp() || app.modal === 'trade') { el.classList.add('hidden'); return; }
  // Your own offer, while the trade window is closed: show the replies.
  if (t.from === app.viewer) {
    const rows = v.players.filter(p => p.id !== app.viewer).map(p => {
      const r = t.responses[p.id];
      const pill = !r ? '<span class="pill wait">Thinking…</span>' : r.answer === 'accept' ? '<span class="pill yes">Accepts</span>' : r.answer === 'counter' ? '<span class="pill counter">Counteroffer</span>' : '<span class="pill no">Declines</span>';
      const btn = r?.answer === 'accept' ? `<button class="btn small green" data-confirm="${p.id}">Trade</button>` : r?.answer === 'counter' ? '<button class="btn small" data-open-trade>View</button>' : '';
      return `<div class="resp mini-resp"><div class="who">${crest(p.color, p.name[0], 'chip-crest')}${nameHtml(p.id)}</div>${pill}${btn}</div>`;
    }).join('');
    el.innerHTML = `<div class="head">Your offer</div>${termsHtml(t.give, t.get, v.players[app.viewer].hand)}<div class="responses">${rows}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn small" data-open-trade>Open trade</button><button class="btn small danger" id="btn-cancel-offer">Withdraw</button></div>`;
    el.classList.remove('hidden');
    return;
  }
  const responders = (app.mode === 'local' ? app.humans : [app.viewer])
    .filter(pid => pid !== null && pid !== t.from && (!t.to || t.to.includes(pid)));
  if (!responders.length || (app.mode === 'local' && app.humans.includes(t.from))) { el.classList.add('hidden'); return; }
  const offerer = player(t.from);
  const blocks = responders.map(pid => {
    const r = t.responses[pid];
    const hand = handOf(pid);
    const multi = app.mode === 'local' && app.humans.length > 1;
    // From the responder's side: they give what the offerer asks for, and get what the offerer gives.
    const body = termsHtml(t.get, t.give, hand);
    if (r) return `${multi ? `<div class="label" style="margin:4px 0">${nameHtml(pid)}</div>` : ''}${body}<div class="row" style="justify-content:center"><span class="pill ${r.answer === 'accept' ? 'yes' : r.answer === 'counter' ? 'counter' : 'no'}">${r.answer === 'accept' ? `Accepted: waiting for ${esc(offerer.name)}` : r.answer === 'counter' ? 'Counteroffer sent' : 'Declined'}</span></div>`;
    const can = hand && E.canAfford(hand, t.get);
    return `${multi ? `<div class="label" style="margin:4px 0">For ${nameHtml(pid)}</div>` : ''}${body}
      ${can ? '' : '<div class="warn">You do not have the cards they want.</div>'}
      <div class="row" style="justify-content:center">
        <button class="btn green" data-resp="accept" data-pid="${pid}" ${can ? '' : 'disabled'}>Accept</button>
        <button class="btn" data-resp="counter" data-pid="${pid}">Counter</button>
        <button class="btn danger" data-resp="reject" data-pid="${pid}">Decline</button></div>`;
  }).join('<hr>');
  el.innerHTML = `<div class="head">${crest(offerer.color, offerer.name[0], 'chip-crest')} ${nameHtml(t.from)} offers you a trade</div>${blocks}`;
  el.classList.remove('hidden');
}

// ---- board highlights
function updateHighlights(v) {
  if (!scene) return;
  const me = app.viewer;
  let spec = null;
  const pr = v.prompts && v.prompts[0];
  if (pr && pr.pid === me && !curtainUp() && ['vertex', 'edge', 'hex'].includes(pr.kind)) {
    spec = [pr.kind, pr.options, v.players[me].color, 'none'];
  } else if (pr) {
    spec = null;
  } else if (me !== null && !curtainUp() && v.current === me && ck() && v.phase === 'main' && app.knightMode) {
    const km = app.knightMode;
    const reach = [...E.CKH.reachable(v, me, km.from)];
    const ids = km.what === 'move' ? reach.filter(x => E.CKH.vertexFree(v, x)) : reach.filter(x => v.kOwner[x] !== null && v.kOwner[x] !== me && v.kLevel[x] < v.kLevel[km.from]);
    spec = ['vertex', ids, v.players[me].color, 'none'];
  } else if (me !== null && !curtainUp() && v.current === me && sea() && (v.phase === 'setup' ? v.setup.step === 'road' : v.phase === 'roadBuilding')) {
    spec = app.pieceChoice === 'ship' ? ['edge', E.legalShipEdges(v, me), v.players[me].color, 'ship'] : ['edge', E.legalRoadEdges(v, me), v.players[me].color];
  } else if (me !== null && !curtainUp() && v.current === me && sea() && ['main', 'specialBuild'].includes(v.phase) && app.buildMode === 'ship') {
    spec = ['edge', E.legalShipEdges(v, me), v.players[me].color, 'ship'];
  } else if (me !== null && !curtainUp() && v.current === me && sea() && v.phase === 'main' && app.shipFrom !== null && app.shipFrom !== undefined) {
    const without = { ...v, sOwner: v.sOwner.map((o, e) => (e === app.shipFrom ? null : o)) };
    spec = ['edge', E.legalShipEdges(without, me).filter(e => e !== app.shipFrom), v.players[me].color, 'ship'];
  } else if (me !== null && !curtainUp() && v.current === me && sea() && v.phase === 'main' && !app.buildMode && E.movableShips(v, me).length) {
    spec = ['edge', E.movableShips(v, me), v.players[me].color, 'none', 'soft'];
  } else if (me !== null && !curtainUp() && v.current === me && ck() && ['main', 'specialBuild'].includes(v.phase) && ['knight', 'wall'].includes(app.buildMode)) {
    spec = app.buildMode === 'knight' ? ['vertex', E.CKH.knightSpots(v, me), v.players[me].color, 'knight'] : ['vertex', E.CKH.cities(v, me).filter(x => !v.vWall[x]), v.players[me].color, 'none'];
  } else if (me !== null && !curtainUp() && v.current === me && ck() && v.phase === 'main' && !app.buildMode && E.CKH.knightsOf(v, me).length) {
    spec = ['vertex', E.CKH.knightsOf(v, me), v.players[me].color, 'none', 'soft'];
  }
  if (spec) { /* chosen above */ } else if (me !== null && !curtainUp() && v.current === me) {
    const color = v.players[me].color;
    if (v.phase === 'setup') spec = v.setup.step === 'settlement' ? ['vertex', E.legalSettlementVertices(v, me, true), color, 'settlement'] : ['edge', E.legalRoadEdges(v, me), color];
    else if (v.phase === 'robber') spec = ['hex', E.legalRobberHexes(v), color];
    else if (v.phase === 'roadBuilding') spec = ['edge', E.legalRoadEdges(v, me), color];
    else if ((v.phase === 'main' || v.phase === 'specialBuild') && app.buildMode === 'road') spec = ['edge', E.legalRoadEdges(v, me), color];
    else if ((v.phase === 'main' || v.phase === 'specialBuild') && app.buildMode === 'settlement') spec = ['vertex', E.legalSettlementVertices(v, me, false), color, 'settlement'];
    else if ((v.phase === 'main' || v.phase === 'specialBuild') && app.buildMode === 'city') spec = ['vertex', E.legalCityVertices(v, me), color, 'city'];
  }
  const key = spec ? `${spec[0]}|${spec[1].join(',')}|${spec[3] || ''}|${v.version}` : '';
  if (key === app.hlKey) return;
  app.hlKey = key;
  if (spec) scene.setHighlights(spec[0], spec[1], spec[2], spec[3], spec[4]);
  else scene.setHighlights(null, []);
}

// ================================================================== board input
function onPick({ kind, id }) {
  const v = app.view;
  if (!v) return;
  const pr = v.prompts && v.prompts[0];
  if (pr && pr.pid === app.viewer && !curtainUp()) { act({ type: 'answer', id: pr.id, value: id }, app.viewer); return; }
  if (!myTurn()) return;
  sfx.unlock();
  if (sea() && kind === 'edge' && (v.phase === 'setup' || v.phase === 'roadBuilding') && app.pieceChoice === 'ship') {
    act({ type: 'buildShip', edge: id }).then(() => refreshSoon()); return;
  }
  if (sea() && kind === 'edge' && app.buildMode === 'ship') { act({ type: 'buildShip', edge: id }).then(ok => { if (ok) app.buildMode = null; refreshSoon(); }); return; }
  if (sea() && kind === 'edge' && v.phase === 'main' && app.shipFrom !== null && app.shipFrom !== undefined) {
    const from = app.shipFrom; app.shipFrom = null;
    act({ type: 'moveShip', from, to: id }).then(() => refreshSoon()); return;
  }
  if (sea() && kind === 'edge' && v.phase === 'main' && !app.buildMode && v.sOwner[id] === app.viewer) { app.shipFrom = id; app.hlKey = ''; refreshSoon(); toast('Choose where the ship sails to (Esc to cancel).', '', 2.4); return; }
  if (ck() && v.phase === 'main' && app.knightMode && kind === 'vertex') {
    const km = app.knightMode; app.knightMode = null;
    act(km.what === 'move' ? { type: 'moveKnight', vertex: km.from, to: id } : { type: 'displaceKnight', vertex: km.from, target: id }).then(() => refreshSoon());
    return;
  }
  if (ck() && ['knight', 'wall'].includes(app.buildMode) && kind === 'vertex') {
    const what = app.buildMode;
    act(what === 'knight' ? { type: 'buildKnight', vertex: id } : { type: 'buildWall', vertex: id }).then(ok => { if (ok) app.buildMode = null; refreshSoon(); });
    return;
  }
  if (ck() && v.phase === 'main' && !app.buildMode && kind === 'vertex' && v.kOwner[id] === app.viewer) { openKnightMenu(id); return; }
  if (v.phase === 'setup') {
    if (kind === 'vertex') act({ type: 'buildSettlement', vertex: id });
    else if (kind === 'edge') act({ type: 'buildRoad', edge: id });
    return;
  }
  if (v.phase === 'robber' && kind === 'hex') {
    const victims = E.robberVictims(v, id, app.viewer);
    if (victims.length <= 1) act({ type: 'moveRobber', hex: id, victim: victims[0] ?? null });
    else openVictims(id, victims);
    return;
  }
  if ((v.phase === 'roadBuilding' || app.buildMode === 'road') && kind === 'edge') { act({ type: 'buildRoad', edge: id }).then(ok => { if (ok && v.phase !== 'roadBuilding') app.buildMode = null; refreshSoon(); }); return; }
  if (app.buildMode === 'settlement' && kind === 'vertex') { act({ type: 'buildSettlement', vertex: id }).then(ok => { if (ok) app.buildMode = null; refreshSoon(); }); return; }
  if (app.buildMode === 'city' && kind === 'vertex') { act({ type: 'buildCity', vertex: id }).then(ok => { if (ok) app.buildMode = null; refreshSoon(); }); }
}
function refreshSoon() { if (app.mode === 'local') refresh(); else if (app.view) { renderActions(app.view); renderStatus(app.view); updateHighlights(app.view); } }

function onHover(p, e) {
  const tip = $('tip');
  const v = app.view;
  if (!p || !v || !e) { tip.classList.add('hidden'); return; }
  let html = '';
  if (p.kind === 'hex') {
    const h = v.board.hexes[p.id];
    const res = TERRAIN_RESOURCE[h.terrain];
    if (h.terrain === 'sea') { html = `<b>Open sea</b>${h.id === v.pirate ? ' \u00b7 <span style="color:#ffb4a3">the pirate is here</span>' : ''}`; tip.innerHTML = html; tip.classList.remove('hidden'); tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 16}px`; return; }
    html = `<b>${TERRAIN_NAMES[h.terrain]}</b>${res ? ` \u00b7 ${RES_NAMES[res]}` : h.terrain === 'gold' ? ' \u00b7 any resource you choose' : ''}${h.number ? ` \u00b7 rolls on ${h.number} (${pips(h.number)}/36)` : ''}`;
    if (h.id === v.robber) html += ' \u00b7 <span style="color:#ffb4a3">robber here</span>';
    if (v.phase === 'robber' && myTurn() && !E.legalRobberHexes(v, app.viewer).includes(h.id) && h.id !== v.robber) {
      html += '<br><span style="color:#ffb4a3">Protected: a player here has 2 points or fewer (Friendly Robber).</span>';
    } else if (v.phase === 'robber' && myTurn()) {
      const vic = E.robberVictims(v, h.id, app.viewer);
      html += vic.length ? `<br>Steal from: ${vic.map(nameHtml).join(', ')}` : '<br>Nobody to steal from here';
    }
  } else if (p.kind === 'vertex') {
    const vx = v.board.vertices[p.id];
    const parts = vx.hexes.map(hid => v.board.hexes[hid]).filter(h => h.number).map(h => `${iconSvg(TERRAIN_RESOURCE[h.terrain], 15).replace('class="ico"', 'class="ico" style="display:inline-block;vertical-align:-3px"')} ${h.number}`);
    const total = vx.hexes.reduce((a, hid) => a + pips(v.board.hexes[hid].number), 0);
    html = `${parts.join(' &nbsp;') || 'No production'} \u00b7 <b>${total}</b> dots`;
    if (vx.port !== null) { const pt = v.board.ports[vx.port]; html += `<br>Harbour: ${pt.type === 'any' ? '3:1 any resource' : `2:1 ${RES_NAMES[pt.type].toLowerCase()}`}`; }
  } else if (p.kind === 'port') {
    const port = v.board.ports[p.id];
    const owners = port.vertices.map(x => v.vOwner[x]).filter(o => o !== null);
    const deal = port.type === 'any' ? 'Trade 3 of any one resource for 1 of your choice.' : `Trade 2 ${RES_NAMES[port.type].toLowerCase()} for 1 of your choice.`;
    html = `<b>${port.type === 'any' ? '3:1 harbour' : `2:1 ${RES_NAMES[port.type].toLowerCase()} harbour`}</b><br>${deal}<br>`;
    html += owners.length ? `Used by ${[...new Set(owners)].map(nameHtml).join(' and ')}.` : 'Build on either marked corner to use it.';
  } else if (p.kind === 'edge') {
    html = 'Build a road here';
  }
  if (!html) { tip.classList.add('hidden'); return; }
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, e.clientX + 14)}px`;
  tip.style.top = `${e.clientY + 16}px`;
}

// ================================================================== modals
function openModal(name, html, wide = false) {
  app.modal = name;
  const body = $('modal-body');
  body.className = `modal panel${wide ? ' wide' : ''}`;
  body.id = 'modal-body';
  body.innerHTML = html;
  body.dataset.name = name;
  $('modal').classList.remove('hidden');
}
function closeModal() {
  app.modal = null;
  app.tradeUI = null;
  $('modal').classList.add('hidden');
  if (app.view) renderOffer(app.view);
}
$('modal').addEventListener('pointerdown', (e) => {
  if (e.target === $('modal') && !['discard', 'victory'].includes(app.modal)) closeModal();
});

function stepperHtml(group, values, maxes, extra = {}) {
  return `<div class="stepper">${RESOURCES.map(r => `
    <div class="step">${iconSvg(r, 32)}<div class="val">${values[r] || 0}</div>
      ${extra[r] ? `<div class="${extra[r].cls || 'have'}">${extra[r].text}</div>` : ''}
      <div class="pm"><button data-step="${group}" data-res="${r}" data-d="-1" ${(values[r] || 0) <= 0 ? 'disabled' : ''} aria-label="Less ${RES_NAMES[r]}">−</button>
      <button data-step="${group}" data-res="${r}" data-d="1" ${(values[r] || 0) >= maxes[r] ? 'disabled' : ''} aria-label="More ${RES_NAMES[r]}">+</button></div>
    </div>`).join('')}</div>`;
}

// ---- discard
function openDiscard() {
  app.discardPick = {};
  openModal('discard', '');
  renderDiscard();
}
function renderDiscard() {
  const v = app.view;
  const need = v.discards[app.viewer];
  const hand = v.players[app.viewer].hand;
  const pick = app.discardPick;
  const total = RESOURCES.reduce((a, r) => a + (pick[r] || 0), 0);
  const maxes = Object.fromEntries(RESOURCES.map(r => [r, total >= need ? (pick[r] || 0) : hand[r]]));
  $('modal-body').innerHTML = `<h2>Discard ${need} cards</h2>
    <p>A 7 was rolled and you hold ${E.handSize(hand)} cards. Choose ${need} to return to the bank.</p>
    ${stepperHtml('discard', pick, maxes, Object.fromEntries(RESOURCES.map(r => [r, { text: `of ${hand[r]}` }])))}
    <div class="actions-row"><span class="empty-note" style="margin-right:auto">${total} of ${need} chosen</span>
    <button class="btn primary" id="btn-discard" ${total === need ? '' : 'disabled'}>Discard</button></div>`;
}

// ---- robber victims
function openVictims(hex, victims) {
  const v = app.view;
  openModal('victims', `<h2>Steal from whom?</h2><p>You take one random card from the player you pick.</p>
    <div class="responses">${victims.map(pid => `<div class="resp"><div class="who">${crest(v.players[pid].color, v.players[pid].name[0], 'chip-crest')}${nameHtml(pid)}</div>
    <span class="what">${SMALL.cards} ${v.players[pid].handCount === null ? '?' : v.players[pid].handCount} cards</span><button class="btn small primary" data-victim="${pid}" data-hex="${hex}">Steal</button></div>`).join('')}</div>
    <div class="actions-row"><button class="btn" data-close>Pick another tile</button></div>`);
}

// ---- Year of Plenty / Monopoly
function openPicker(card) {
  app.pick = { card, sel: {} };
  openModal('picker', '');
  renderPicker();
}
function renderPicker() {
  const v = app.view;
  const { card, sel } = app.pick;
  if (card === 'monopoly') {
    $('modal-body').innerHTML = `<h2>Monopoly</h2><p>Name a resource. Every other player gives you all of theirs.</p>
      <div class="picker">${RESOURCES.map(r => `<button class="pick${sel[r] ? ' on' : ''}" data-mono="${r}">${iconSvg(r, 38)}${RES_NAMES[r]}</button>`).join('')}</div>
      <div class="actions-row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="btn-pick-ok" ${Object.keys(sel).length ? '' : 'disabled'}>Play Monopoly</button></div>`;
  } else {
    const total = RESOURCES.reduce((a, r) => a + (sel[r] || 0), 0);
    const maxes = Object.fromEntries(RESOURCES.map(r => [r, total >= 2 ? (sel[r] || 0) : Math.min(2, v.bank[r])]));
    $('modal-body').innerHTML = `<h2>Year of Plenty</h2><p>Take any two resources from the bank (the same one twice is fine).</p>
      ${stepperHtml('yop', sel, maxes, Object.fromEntries(RESOURCES.map(r => [r, { text: `${v.bank[r]} in bank` }])))}
      <div class="actions-row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="btn-pick-ok" ${total === 2 ? '' : 'disabled'}>Take them</button></div>`;
  }
}

// ---- trade
function openTrade(tab = 'players', counterFor = null) {
  const v = app.view;
  app.tradeUI = { tab, give: {}, get: {}, bankGive: null, bankGet: null, bankCount: 1, counterFor };
  if (counterFor !== null && v.trade) {
    // Start the counter from the reverse of the offer (responder's point of view).
    app.tradeUI.give = { ...v.trade.get };
    app.tradeUI.get = { ...v.trade.give };
  }
  openModal('trade', '', true);
  $('offer-card').classList.add('hidden');
  renderTrade();
}
function renderTrade() {
  const v = app.view, ui = app.tradeUI;
  if (!ui) return;
  const me = app.viewer;
  const body = $('modal-body');
  if (ui.counterFor !== null) {
    const who = ui.counterFor;
    const hand = handOf(who);
    if (!v.trade) { closeModal(); return; }
    body.innerHTML = `<h2>Counteroffer${app.mode === 'local' && app.humans.length > 1 ? ` from ${esc(v.players[who].name)}` : ''}</h2>
      <p>Propose different terms to ${nameHtml(v.trade.from)}. They can accept it or ignore it.</p>
      <div class="label">You give</div>${stepperHtml('give', ui.give, Object.fromEntries(RESOURCES.map(r => [r, hand ? hand[r] : 0])), Object.fromEntries(RESOURCES.map(r => [r, { text: `have ${hand ? hand[r] : 0}` }])))}
      <div class="label">You get</div>${stepperHtml('get', ui.get, Object.fromEntries(RESOURCES.map(r => [r, 9])))}
      <div class="label">Your counteroffer</div>${termsHtml(ui.give, ui.get, hand)}
      <div class="actions-row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="btn-send-counter">Send counteroffer</button></div>`;
    return;
  }
  const hand = v.players[me].hand;
  const tabs = `<div class="tabs"><button class="${ui.tab === 'players' ? 'on' : ''}" data-tab="players">With players</button><button class="${ui.tab === 'bank' ? 'on' : ''}" data-tab="bank">With the bank or a harbour</button></div>`;
  if (ui.tab === 'bank') {
    const ratios = E.tradeRatios(v, me);
    const g = ui.bankGive, w = ui.bankGet;
    const maxCount = g ? Math.floor(hand[g] / ratios[g]) : 0;
    const count = Math.max(1, Math.min(ui.bankCount, maxCount || 1, w ? v.bank[w] : 19));
    ui.bankCount = count;
    const owned = E.ownedPorts(v, me).map(id => v.board.ports[id]);
    body.innerHTML = `<h2>Trade</h2>${tabs}
      <p>${owned.length ? `Your harbours: ${owned.map(p => p.type === 'any' ? '3:1 any' : `2:1 ${RES_NAMES[p.type].toLowerCase()}`).join(', ')}. The best rate is applied automatically.` : 'Without a harbour the bank trades 4 of a kind for 1. Build on a harbour for 3:1 or 2:1.'}</p>
      ${bankSuggestions(v, me, hand, ratios)}
      <div class="label">Give</div>
      <div class="picker">${RESOURCES.map(r => `<button class="pick${g === r ? ' on' : ''}" data-bgive="${r}" ${hand[r] >= ratios[r] ? '' : 'disabled'}>${iconSvg(r, 38)}<span>${ratios[r]} : 1</span><small>have ${hand[r]}</small></button>`).join('')}</div>
      <div class="label">Get</div>
      <div class="picker">${RESOURCES.map(r => `<button class="pick${w === r ? ' on' : ''}" data-bget="${r}" ${r !== g && v.bank[r] > 0 ? '' : 'disabled'}>${iconSvg(r, 38)}<span>${RES_NAMES[r]}</span><small>${v.bank[r]} in bank</small></button>`).join('')}</div>
      <div class="actions-row" style="align-items:center">
        ${g && maxCount > 1 ? `<span class="row" style="margin-right:auto"><button class="btn small" data-bcount="-1" ${count <= 1 ? 'disabled' : ''}>−</button><b>${count}×</b><button class="btn small" data-bcount="1" ${count >= maxCount ? 'disabled' : ''}>+</button></span>` : ''}
        <button class="btn" data-close>Close</button>
        <button class="btn primary" id="btn-bank-trade" ${g && w && g !== w ? '' : 'disabled'}>${g && w ? `Give ${ratios[g] * count} ${RES_NAMES[g].toLowerCase()} for ${count} ${RES_NAMES[w].toLowerCase()}` : 'Choose resources'}</button>
      </div>`;
    return;
  }
  const t = v.trade && v.trade.from === me ? v.trade : null;
  if (t) {
    const others = v.players.filter(p => p.id !== me);
    body.innerHTML = `<h2>Trade</h2>${tabs}
      <div class="label">Your offer</div>${termsHtml(t.give, t.get, hand)}
      <div class="responses">${others.map(p => {
        const r = t.responses[p.id];
        let status = '<span class="pill wait">Thinking…</span>', btns = '';
        if (r?.answer === 'accept') { status = '<span class="pill yes">Accepts</span>'; btns = `<button class="btn small green" data-confirm="${p.id}">Trade</button>`; }
        else if (r?.answer === 'reject') status = '<span class="pill no">Declines</span>';
        else if (r?.answer === 'counter') { status = `<span class="pill counter">Counteroffer</span><div class="counter-terms">${termsHtml(r.give, r.get, hand)}</div>`; btns = `<button class="btn small green" data-confirm="${p.id}" ${E.canAfford(hand, r.give) ? '' : 'disabled'}>Accept counteroffer</button>`; }
        else if (app.mode === 'local' && app.humans.includes(p.id)) {
          const can = E.canAfford(handOf(p.id), t.get);
          status = '<span class="empty-note">Their answer:</span>';
          btns = `<button class="btn small green" data-hs="accept" data-pid="${p.id}" ${can ? '' : 'disabled title="They do not have those cards"'}>Accept</button><button class="btn small" data-hs="counter" data-pid="${p.id}">Counter</button><button class="btn small danger" data-hs="reject" data-pid="${p.id}">Decline</button>`;
        } else if (!p.isAI && app.mode === 'online') status = '<span class="pill wait">Waiting…</span>';
        return `<div class="resp"><div class="who">${crest(p.color, p.name[0], 'chip-crest')}${nameHtml(p.id)}</div>${status}${btns}</div>`;
      }).join('')}</div>
      <div class="actions-row"><button class="btn danger" id="btn-cancel-offer">Withdraw offer</button><button class="btn" data-close>Close</button></div>`;
    return;
  }
  const giveN = RESOURCES.reduce((a, r) => a + (ui.give[r] || 0), 0), getN = RESOURCES.reduce((a, r) => a + (ui.get[r] || 0), 0);
  const overlap = RESOURCES.some(r => ui.give[r] && ui.get[r]);
  const quick = ['road', 'settlement', 'city', 'dev'].map(k => {
    const miss = missingFor(hand, E.COSTS[k]);
    const n = Object.values(miss).reduce((a, b) => a + b, 0);
    const label = { road: 'Road', settlement: 'Settlement', city: 'City', dev: 'Card' }[k];
    return `<button class="btn small" data-quick="${k}" ${n ? '' : 'disabled'} title="${n ? `Ask for the ${n} card${n > 1 ? 's' : ''} you are missing` : 'You already have everything for this'}">${GLYPH[k].replace(/width="26" height="26"/, 'width="18" height="18"')} ${label}${n ? ` <span class="pill wait">${n}</span>` : ' ✓'}</button>`;
  }).join('');
  body.innerHTML = `<h2>Trade</h2>${tabs}
    <div class="row quick"><span class="empty-note">Ask for what you need:</span>${quick}</div>
    <div class="label">You give</div>${stepperHtml('give', ui.give, hand, Object.fromEntries(RESOURCES.map(r => [r, { text: `have ${hand[r]}` }])))}
    <div class="label">You get</div>${stepperHtml('get', ui.get, Object.fromEntries(RESOURCES.map(r => [r, 9])))}
    ${giveN || getN ? `<div class="label">Your offer</div>${termsHtml(ui.give, ui.get, hand)}` : ''}
    <div class="actions-row">${overlap ? '<span class="warn" style="margin-right:auto">You cannot give and ask for the same resource.</span>' : giveN && !getN ? '<span class="empty-note" style="margin-right:auto">Add something to get.</span>' : getN && !giveN ? '<span class="empty-note" style="margin-right:auto">Add something to give: gifts are not allowed.</span>' : ''}
      ${giveN || getN ? '<button class="btn" data-clear-offer>Clear</button>' : ''}
      <button class="btn" data-close>Close</button>
      <button class="btn primary" id="btn-offer" ${giveN && getN && !overlap ? '' : 'disabled'}>Offer to everyone</button></div>`;
}

/** One-click bank trades that complete a build you are one or two cards short of. */
function bankSuggestions(v, me, hand, ratios) {
  const out = [];
  ['city', 'settlement', 'road', 'dev'].forEach(k => {
    const miss = missingFor(hand, E.COSTS[k]);
    const missN = Object.values(miss).reduce((a, b) => a + b, 0);
    if (!missN || missN > 2) return;
    const spare = spareFor(hand, E.COSTS[k]);
    const plan = [];
    const left = { ...spare };
    for (const [want, n] of Object.entries(miss)) {
      for (let i = 0; i < n; i++) {
        const give = RESOURCES.filter(r => r !== want && (left[r] || 0) >= ratios[r]).sort((a, b) => (left[b] - ratios[b]) - (left[a] - ratios[a]))[0];
        if (!give || v.bank[want] < 1) return;
        left[give] -= ratios[give];
        plan.push({ give, get: want, ratio: ratios[give] });
      }
    }
    const label = { road: 'road', settlement: 'settlement', city: 'city', dev: 'development card' }[k];
    out.push(`<button class="suggest" data-bankplan='${JSON.stringify(plan)}'><span>${plan.map(p => `${p.ratio}${iconSvg(p.give, 18)} → 1${iconSvg(p.get, 18)}`).join(' &nbsp;+&nbsp; ')}</span><b>completes a ${label}</b></button>`);
  });
  return out.length ? `<div class="label">Shortcuts</div><div class="suggests">${out.join('')}</div>` : '';
}

// ---- Cities & Knights dialogs
function promptModalNeeded(v) {
  const p = v.prompts && v.prompts[0];
  return p && p.pid === app.viewer && !curtainUp() && ['cards', 'resource', 'player', 'deck', 'progress'].includes(p.kind);
}
function renderPromptModal() {
  const v = app.view;
  const p = v.prompts[0];
  const skip = p.optional ? '<button class="btn" data-pskip>Skip</button>' : '';
  let body = '';
  if (p.kind === 'cards') {
    const src = p.reveal && p.reveal.hand ? p.reveal.hand : v.players[app.viewer].hand;
    const types = p.types || E.kinds(v);
    app.promptPick ||= {};
    const pick = app.promptPick;
    const total = types.reduce((a, r) => a + (pick[r] || 0), 0);
    body = `<div class="stepper" style="grid-template-columns:repeat(${Math.min(types.length, 8)},minmax(0,1fr))">${types.map(r => `<div class="step">${iconSvg(r, 30)}<div class="val">${pick[r] || 0}</div><div class="have">of ${src[r] || 0}</div>
      <div class="pm"><button data-pstep="${r}" data-d="-1" ${(pick[r] || 0) <= 0 ? 'disabled' : ''}>−</button><button data-pstep="${r}" data-d="1" ${(pick[r] || 0) >= (src[r] || 0) || total >= p.count ? 'disabled' : ''}>+</button></div></div>`).join('')}</div>
      <div class="actions-row"><span class="empty-note" style="margin-right:auto">${total} of ${p.count} chosen</span>${skip}<button class="btn primary" data-pcards ${total === p.count ? '' : 'disabled'}>Confirm</button></div>`;
  } else if (p.kind === 'resource') {
    body = `<div class="picker" style="grid-template-columns:repeat(${Math.min(p.options.length, 8)},minmax(0,1fr))">${p.options.map(r => `<button class="pick" data-pans='${JSON.stringify(r)}'>${iconSvg(r, 38)}${RES_NAMES[r]}</button>`).join('')}</div><div class="actions-row">${skip}</div>`;
  } else if (p.kind === 'player') {
    body = `<div class="responses">${p.options.map(pid => `<div class="resp"><div class="who">${crest(v.players[pid].color, v.players[pid].name[0], 'chip-crest')}${nameHtml(pid)}</div><span class="what">${SMALL.cards} ${v.players[pid].handCount ?? '?'} · ${SMALL.dev} ${v.players[pid].progCount ?? 0} · ${E.victoryPoints(v, pid, false)} pts</span><button class="btn small primary" data-pans='${pid}'>Choose</button></div>`).join('')}</div><div class="actions-row">${skip}</div>`;
  } else if (p.kind === 'deck') {
    body = `<div class="tracks">${p.options.map(d => `<button class="track" style="--c:${DECK_COLOR[d]}" data-pans='${JSON.stringify(d)}'><h3>${TRACK_NAMES[d]}</h3><small>${v.progCounts?.[d] ?? '?'} cards left</small></button>`).join('')}</div>`;
  } else if (p.kind === 'progress') {
    const cards = p.reveal && p.reveal.prog ? p.reveal.prog : v.players[app.viewer].prog;
    body = `<div class="devlist">${p.options.map(i => `<div class="prog" style="--c:${DECK_COLOR[cards[i].deck]}"><div class="t">${PROGRESS[cards[i].type].name}<small>${PROGRESS[cards[i].type].text}</small></div><button class="btn small primary" data-pans='${i}'>Choose</button></div>`).join('')}</div><div class="actions-row">${skip}</div>`;
  }
  $('modal-body').innerHTML = `<h2>${esc(p.title)}</h2><p>${esc(p.text)}</p>${body}`;
}
function syncPromptModal(v) {
  const need = promptModalNeeded(v);
  const id = need ? v.prompts[0].id : null;
  if (need && (app.modal !== 'prompt' || app.promptId !== id)) { app.promptId = id; app.promptPick = {}; openModal('prompt', '', true); renderPromptModal(); }
  else if (!need && app.modal === 'prompt') closeModal();
}
function renderGold() {
  const v = app.view, n = v.gold[app.viewer], pick = app.goldPick;
  const total = RESOURCES.reduce((a, r) => a + (pick[r] || 0), 0);
  $('modal-body').innerHTML = `<h2>${iconSvg('gold', 30).replace('class="ico"', 'class="ico" style="display:inline-block;vertical-align:-6px"')} Gold!</h2><p>Your gold field paid out. Choose any ${n} resource${n > 1 ? 's' : ''} from the bank.</p>
    <div class="stepper">${RESOURCES.map(r => `<div class="step">${iconSvg(r, 32)}<div class="val">${pick[r] || 0}</div><div class="have">${v.bank[r]} in bank</div>
      <div class="pm"><button data-gstep="${r}" data-d="-1" ${(pick[r] || 0) <= 0 ? 'disabled' : ''}>−</button><button data-gstep="${r}" data-d="1" ${total >= n || (pick[r] || 0) >= v.bank[r] ? 'disabled' : ''}>+</button></div></div>`).join('')}</div>
    <div class="actions-row"><span class="empty-note" style="margin-right:auto">${total} of ${n} chosen</span><button class="btn primary" data-gconfirm ${total === n ? '' : 'disabled'}>Take them</button></div>`;
}
function openImprove() {
  openModal('improve', '', true);
  renderImprove();
}
function renderImprove() {
  const v = app.view, me = app.viewer, p = v.players[me];
  const can = myTurn() && ['main', 'specialBuild'].includes(v.phase) && !(v.prompts && v.prompts.length);
  const hasCity = E.CKH.cities(v, me).length > 0;
  $('modal-body').innerHTML = `<h2>City improvements</h2><p>Spend commodities to improve your cities. Level 3 unlocks a special ability; the first to reach level 4 builds that metropolis (+2 points), and the first to level 5 can take it. Higher levels also draw progress cards more often when that gate is rolled.</p>
    <div class="tracks">${['trade', 'politics', 'science'].map(t => {
      const lvl = p.improve[t];
      const cost = lvl < 5 ? E.CKH.improvementCost(v, me, t) : null;
      const comm = TRACKS[t];
      const afford = cost && E.canAfford(p.hand, cost);
      const holder = v.metropolis[t];
      return `<div class="track" style="--c:${TRACK_COLORS[t]}"><h3>${iconSvg(comm, 22)} ${TRACK_NAMES[t]}</h3>
        <div class="lv">${[1, 2, 3, 4, 5].map(l => `<i class="${l <= lvl ? 'on' : ''}${l === 4 && holder === me ? ' metro' : ''}"></i>`).join('')}</div>
        <small>Level ${lvl} of 5 · draws on red ${lvl ? `1–${lvl + 1}` : '—'}</small>
        <small><b>${TRACK_ABILITY[t].name}</b> (level 3): ${TRACK_ABILITY[t].text}${lvl >= 3 ? ' ✓' : ''}</small>
        <small>Metropolis: ${holder === null ? 'unclaimed' : nameHtml(holder)}</small>
        ${lvl < 5 ? `<button class="btn ${afford ? 'primary' : ''}" data-improve="${t}" ${can && afford && hasCity ? '' : 'disabled'}>Raise to ${lvl + 1}: ${cost[comm]} ${iconSvg(comm, 16).replace('class="ico"', 'class="ico" style="display:inline-block;vertical-align:-3px"')} <span style="font-weight:500">(have ${p.hand[comm]})</span></button>` : '<small>Complete</small>'}
      </div>`;
    }).join('')}</div>
    ${hasCity ? '' : '<p class="warn">You need at least one city to improve.</p>'}
    ${v.crane === me ? '<p class="empty-note">Crane: your next improvement this turn costs one commodity less.</p>' : ''}
    <div class="actions-row"><button class="btn" data-close>Close</button></div>`;
}
function openKnightMenu(vid) {
  app.knightVid = vid;
  openModal('knight', '');
  renderKnightMenu();
}
function renderKnightMenu() {
  const v = app.view, me = app.viewer, vid = app.knightVid;
  if (v.kOwner[vid] !== me) { closeModal(); return; }
  const lvl = v.kLevel[vid], active = v.kActive[vid];
  const hand = v.players[me].hand;
  const actedNow = v.kActed[vid] === v.turn, freshNow = v.kActivated[vid] === v.turn;
  const ready = active && !actedNow && !freshNow;
  const readyWhy = !active ? 'Activate it first.' : freshNow ? 'It was activated this turn.' : actedNow ? 'It already acted this turn.' : '';
  const nextOk = lvl < 3 && (lvl < 2 || v.players[me].improve.politics >= 3) && E.CKH.knightPieces(v, me, lvl + 1) > 0 && v.kPromoted[vid] !== v.turn;
  const reach = [...E.CKH.reachable(v, me, vid)];
  const canMove = ready && reach.some(x => E.CKH.vertexFree(v, x));
  const canDisplace = ready && reach.some(x => v.kOwner[x] !== null && v.kOwner[x] !== me && v.kLevel[x] < lvl);
  const nearRobber = v.board.vertices[vid].hexes.includes(v.robber);
  const b = (attr, label, okk, why) => `<button class="btn ${okk ? 'primary' : ''}" ${attr} ${okk ? '' : `disabled title="${esc(why)}"`}><span>${label}</span><small style="font-weight:600">${okk ? '' : esc(why)}</small></button>`;
  $('modal-body').innerHTML = `<h2>${KNIGHT_NAMES[lvl]} · strength ${lvl}</h2><p>${active ? 'Active: it defends against the barbarians and can take one action per turn.' : 'Inactive: it does not defend and cannot act. Activate it with 1 wheat.'}</p>
    <div class="knight-menu">
      ${b('data-kact="activate"', `Activate (1 ${iconSvg('wheat', 16).replace('class="ico"', 'class="ico" style="display:inline-block;vertical-align:-3px"')})`, !active && E.canAfford(hand, CK_COSTS.activate), active ? 'Already active.' : 'Needs 1 wheat.')}
      ${b('data-kact="promote"', `Promote to ${lvl < 3 ? KNIGHT_NAMES[lvl + 1].toLowerCase() : '—'} (1 sheep, 1 ore)`, nextOk && E.canAfford(hand, CK_COSTS.promote), lvl >= 3 ? 'Already mighty.' : lvl === 2 && v.players[me].improve.politics < 3 ? 'Needs the Fortress (Politics level 3).' : v.kPromoted[vid] === v.turn ? 'Already promoted this turn.' : E.CKH.knightPieces(v, me, lvl + 1) <= 0 ? 'No pieces of that level left.' : 'Needs 1 sheep and 1 ore.')}
      ${b('data-kact="move"', 'Move along your roads', canMove, readyWhy || 'Nowhere to move.')}
      ${b('data-kact="displace"', 'Displace a weaker knight', canDisplace, readyWhy || 'No weaker knight within reach.')}
      ${b('data-kact="chase"', 'Chase the robber away', ready && nearRobber && v.barb.attacked, readyWhy || (!v.barb.attacked ? 'The robber is locked until the first attack.' : 'The robber is not next to this knight.'))}
    </div>
    <div class="actions-row"><button class="btn" data-close>Close</button></div>`;
}
function openAlchemist(index) {
  app.alch = { index, red: 3, yellow: 4 };
  openModal('alchemist', '');
  renderAlchemist();
}
function renderAlchemist() {
  const a = app.alch;
  const row = (die, colour) => `<div class="row" style="justify-content:center">${[1, 2, 3, 4, 5, 6].map(n => `<button class="pick${a[die] === n ? ' on' : ''}" style="width:48px" data-alch="${die}" data-n="${n}"><b style="color:${colour}">${n}</b></button>`).join('')}</div>`;
  $('modal-body').innerHTML = `<h2>Alchemist</h2><p>Choose the red and yellow dice for your roll. The event die is still rolled normally, and the red die still decides progress cards.</p>
    <div class="label">Red die</div>${row('red', '#d94a3d')}<div class="label">Yellow die</div>${row('yellow', '#c99a3b')}
    <p style="text-align:center;font-weight:800">Total ${a.red + a.yellow}${a.red + a.yellow === 7 ? ' (a 7: the robber)' : ''}</p>
    <div class="actions-row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="btn-alch">Play and roll</button></div>`;
}

function openHowTo() {
  openModal('howto', `<h2>How to play</h2>
    <div class="rules">
      <h3>The goal</h3><ul><li>Be the first to reach the points target (10, or 13 in Cities &amp; Knights) on your own turn.</li><li>Settlements are worth 1 point, cities 2, and Longest Road and Largest Army 2 each.</li></ul>
      <h3>Your turn</h3><ul><li><b>Roll.</b> Every tile showing that number pays its resource to the settlements (1) and cities (2) around it. The dots on a number show how often it comes up.</li><li><b>Trade.</b> With other players, or with the bank at 4:1 (3:1 or 2:1 at a harbour you have built on).</li><li><b>Build.</b> Roads extend your network, settlements need a gap of two roads from any other building, and cities upgrade settlements.</li></ul>
      <h3>The robber</h3><ul><li>On a 7, nobody collects; anyone holding more than 7 cards discards half. The roller moves the robber, blocking a tile and stealing a card.</li></ul>
      <h3>Tips</h3><ul><li>Start on numbers with many dots (6, 8, 5, 9) and a mix of resources.</li><li>Wood and brick build roads and settlements early; wheat and ore build cities later.</li><li>Hover any tile, corner or harbour on the board for details. Press <kbd>H</kbd> in a game for costs and full rules.</li></ul>
    </div><div class="actions-row"><button class="btn primary" data-close>Got it</button></div>`);
}

// ---- help, menu, sound
function openHelp() {
  const row = (kind, label, glyph) => `<span>${glyph}</span><b>${label}</b><span class="mini">${bundleHtml(E.COSTS[kind])}</span>`;
  openModal('help', `<h2>Costs and rules</h2>
    <div class="costs">${row('road', 'Road', GLYPH.road)}${row('settlement', 'Settlement (1 point)', GLYPH.settlement)}${row('city', 'City (2 points, doubles production)', GLYPH.city)}${row('dev', 'Development card', GLYPH.dev)}</div>
    <div class="rules">
      <h3>A turn</h3><ul><li>Roll the dice. Every tile with that number pays its resource: 1 card per settlement and 2 per city around it.</li><li>Then trade and build as much as you like, and end your turn.</li><li>You can play one development card per turn, even before rolling, but not one you bought this turn.</li></ul>
      <h3>Building</h3><ul><li>Roads extend your own network and cannot pass through another player\u2019s building.</li><li>Settlements need one of your roads and at least two paths between them and any other building.</li><li>Each player has 15 roads, 5 settlements and 4 cities.</li></ul>
      <h3>The robber</h3><ul><li>On a 7 nobody collects. Anyone with more than ${app.view?.config.discardLimit ?? 7} cards discards half (rounded down).</li><li>The roller moves the robber to a new tile and steals one random card from a player with a building there. That tile produces nothing while the robber stays.</li><li>A Knight card moves the robber the same way.</li></ul>
      <h3>Trading</h3><ul><li>On your turn, after rolling, trade with any player, or with the bank at 4:1.</li><li>A settlement or city on a harbour gives 3:1 for any resource, or 2:1 for its resource.</li></ul>
      <h3>Winning</h3><ul><li>Longest Road (5+ unbroken roads) and Largest Army (3+ Knights) are worth 2 points each, and change hands only when someone beats the holder.</li><li>The first player to reach ${app.view?.config.vpTarget ?? 10} points on their own turn wins.</li></ul>
      ${(() => {
        const c = app.view?.config || {};
        const on = RULES.filter(r => c[r.key]).map(r => `<li><b>${r.name}:</b> ${r.desc}</li>`);
        if (c.sea) on.unshift('<li><b>Seafarers:</b> ships (1 wood + 1 sheep) sail on water, linking to your settlements and other ships; roads and ships join only at your own settlement. Once per turn you may move the ship at the open end of a route. Settlements can be founded from ships. Gold fields pay any resource you choose. On a 7 or a Knight, move the robber (land) or the pirate (sea): he robs ship owners and blocks ships beside him. Your first settlement on each new island is worth +2. Roads and ships together count for Longest Trade Route.</li>');
        if (c.specialBuild) on.unshift('<li><b>5–6 players:</b> the bank holds 24 of each resource, the deck has 34 cards (20 Knights), and after each turn every other player in order may build or buy a card (no trading or playing cards). You can only win on your own turn.</li>');
        return on.length ? `<h3>In this game</h3><ul>${on.join('')}</ul>` : '';
      })()}
      <h3>Keys</h3><ul><li><kbd>R</kbd> roll · <kbd>1</kbd> road · <kbd>2</kbd> settlement · <kbd>3</kbd> city · <kbd>D</kbd> buy card · <kbd>T</kbd> trade · <kbd>E</kbd> end turn · <kbd>C</kbd> reset view · <kbd>V</kbd> territory · <kbd>B</kbd> board game view · <kbd>Esc</kbd> cancel</li><li>Drag to rotate, right-drag or two fingers to move, scroll or pinch to zoom.</li></ul>
    </div><div class="actions-row"><button class="btn primary" data-close>Close</button></div>`);
}
function openSound() {
  openModal('sound', `<h2>Sound</h2>
    <div class="field" style="margin-top:10px"><label for="vol">Volume: <b id="vol-out">${Math.round(sfx.volume * 100)}%</b></label><input type="range" id="vol" min="0" max="100" value="${Math.round(sfx.volume * 100)}" style="width:100%"></div>
    <p style="margin-top:12px">Turn alerts: a chime when it becomes your turn, a reminder after 25 seconds, and the tab title flashes when you are in another tab.</p>
    <div class="row"><button class="btn small" id="btn-notify">${window.Notification ? (Notification.permission === 'granted' ? 'Desktop alerts are on' : 'Also show desktop alerts') : 'Desktop alerts not supported here'}</button></div>
    <div class="actions-row"><button class="btn" id="btn-mute">${sfx.muted ? 'Turn sound on' : 'Mute'}</button><button class="btn primary" data-close>Done</button></div>`);
}
function openMenu() {
  const online = app.mode === 'online';
  openModal('menu', `<h2>Menu</h2>
    <p>${online ? `Room <b>${esc(app.net.code)}</b>. The server keeps the game, so you can close this tab and rejoin later.` : 'Your game is saved on this device after every move.'}</p>
    <div class="label">Display (this device)</div>
    <div class="rules-grid" style="margin-top:0">
      ${[['symbols', 'Player symbols', 'Show each player’s symbol (●▲■◆★✚) above their buildings and knights.'],
         ['roadSymbols', 'Symbols on roads', 'Also mark every road. Busy, but unmistakable.'],
         ['cbColors', 'Colour-blind friendly colours', 'Swap player colours for a palette that stays distinct with colour blindness.'],
         ['recent', 'Mark recent builds', 'Ring what other players built since your last turn.'],
         ['fps', 'Show frame rate', 'A small counter at the bottom of the screen.']]
        .map(([k, n, d]) => `<button class="rule${app.display[k] ? ' on' : ''}" data-disp="${k}" aria-pressed="${!!app.display[k]}"><span class="box">${app.display[k] ? '✓' : ''}</span><span><b>${n}</b><small>${d}</small></span></button>`).join('')}
    </div>
    <div class="label">Graphics</div>
    <div class="seg">${[['auto', 'Auto'], ['high', 'High'], ['balanced', 'Balanced'], ['low', 'Battery saver']].map(([k, n]) => `<button class="${app.gfx === k ? 'on' : ''}" data-gfx="${k}">${n}</button>`).join('')}</div>
    <p class="empty-note" style="margin:4px 0 0">${app.gfx === 'auto' ? `Auto picked ${QUALITY[scene?.qualityKey || 'high'].label} for this device and lowers it if the game struggles.` : 'Lower settings draw fewer trees and shadows, use a lower resolution, and Battery saver caps the frame rate at 30.'}</p>
    ${app.hasServer ? `<div class="row" style="margin-top:10px"><button class="btn small" data-acct="${app.auth ? 'friends' : 'signin'}">${app.auth ? 'Friends' : 'Sign in'}</button><button class="btn small" data-acct="leaderboard">Leaderboard</button></div>` : ''}
    <div class="row" style="margin-top:14px">
      <button class="btn primary" data-close>Back to the game</button>
      ${online ? '<button class="btn" id="btn-copy-invite">Copy invite link</button><button class="btn danger" id="btn-menu-leave">Leave room</button>' : '<button class="btn" id="btn-menu-new">New game</button>'}
    </div>`);
}

function showVictory() {
  const v = app.view;
  if (!v || v.phase !== 'over') return;
  const w = v.players[v.winner];
  const rows = v.players.slice().sort((a, b) => b.vpTotal - a.vpTotal).map(p => {
    let s = 0, c = 0;
    v.vOwner.forEach((o, i) => { if (o === p.id) { if (v.vType[i] === 'city') c++; else s++; } });
    const vpc = (p.dev || []).filter(d => d.type === 'victoryPoint').length;
    return `<tr><td><span class="chip-crest" style="background:${p.color}"></span>${esc(p.name)}</td><td>${s}</td><td>${c * 2}</td><td>${v.longestRoad === p.id ? 2 : ''}</td><td>${v.largestArmy === p.id ? 2 : ''}</td><td>${vpc || ''}</td><td class="total">${p.vpTotal}</td></tr>`;
  }).join('');
  const st = v.stats;
  const mins = Math.max(1, Math.round(((st.endedAt || Date.now()) - st.startedAt) / 60000));
  const statRows = v.players.map(p => {
    const gained = RESOURCES.reduce((a, r) => a + st.gained[p.id][r], 0);
    return `<tr><td>${esc(p.name)}</td><td>${gained}</td><td>${st.stolen[p.id]}</td><td>${st.lostToRobber[p.id]}</td><td>${st.trades[p.id]}</td><td>${st.devBought[p.id]}</td><td>${p.knights}</td><td>${p.roadLength}</td></tr>`;
  }).join('');
  const max = Math.max(1, ...st.rolls.slice(2));
  const total = st.rolls.reduce((a, b) => a + b, 0);
  const rc = app.mode === 'online' && app.online?.ratings && app.viewer !== null ? app.online.ratings[app.viewer] : null;
  if (rc !== null && rc !== undefined) setTimeout(refreshProfile, 1500);
  openModal('victory', `<div class="winner">${crest(w.color, w.name[0])}<h2>${esc(w.name)} wins</h2><p style="margin:4px auto 0">${w.vpTotal} points after ${v.turn} turns and about ${mins} minute${mins === 1 ? '' : 's'}.</p>${rc !== null && rc !== undefined && app.auth ? `<p style="margin:6px auto 0;font-weight:800;color:${rc >= 0 ? '#b6e3a0' : '#ffb4a3'}">Your rating ${rc >= 0 ? '+' : ''}${rc}</p>` : ''}</div>
    <table class="scores"><thead><tr><th>Player</th><th>Settlements</th><th>Cities</th><th>Longest Road</th><th>Largest Army</th><th>Point cards</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="label">How the game went</div>
    <table class="scores"><thead><tr><th>Player</th><th>Cards earned</th><th>Stole</th><th>Robbed</th><th>Trades</th><th>Dev bought</th><th>Knights</th><th>Longest trail</th></tr></thead><tbody>${statRows}</tbody></table>
    <div class="label">Dice rolls (${total})</div>
    <div class="hist" style="height:60px">${st.rolls.slice(2).map((n, i) => `<div style="height:${Math.round(n / max * 100)}%" title="${i + 2}: ${n}"></div>`).join('')}</div>
    <div class="hist-labels">${Array.from({ length: 11 }, (_, i) => `<span>${i + 2}</span>`).join('')}</div>
    <div class="actions-row"><button class="btn" data-close>Look at the board</button><button class="btn primary" id="btn-again">New game</button></div>`, true);
}

// ---- hot-seat curtain
function showCurtain(pid) {
  const p = app.state.players[pid];
  const why = app.state.phase === 'discard' ? 'Next: discard cards after the 7.' : app.state.phase === 'setup' ? 'Next: place a starting piece.' : 'Next: their turn.';
  $('curtain').innerHTML = `<div>${crest(p.color, p.name[0])}<h2>Pass to ${esc(p.name)}</h2><p>${why} Hands stay hidden until the right player is at the screen.</p><button class="btn primary" id="btn-reveal">I am ${esc(p.name)}: show my hand</button></div>`;
  $('curtain').classList.remove('hidden');
  $('curtain').dataset.pid = pid;
}

// ================================================================== global click handling
document.addEventListener('click', (e) => {
  const t = e.target.closest('button') || e.target.closest('.dcard.can');
  if (!t) return;
  sfx.unlock();
  const d = t.dataset;
  const v = app.view;
  if ('close' in d) { closeModal(); return; }
  if (t.id === 'btn-reveal') {
    app.revealed = Number($('curtain').dataset.pid);
    $('curtain').classList.add('hidden');
    app.lastTurnKey = null;
    refresh();
    return;
  }
  if (d.play) {
    if (d.play === 'yearOfPlenty' || d.play === 'monopoly') openPicker(d.play);
    else act({ type: 'playDev', card: d.play });
    return;
  }
  if (d.resp) {
    const pid = Number(d.pid);
    if (d.resp === 'counter') { openTrade('players', pid); return; }
    act({ type: 'respondTrade', id: v.trade.id, answer: d.resp }, pid);
    return;
  }
  if (d.hs) {
    const pid = Number(d.pid);
    if (d.hs === 'counter') { openTrade('players', pid); return; }
    act({ type: 'respondTrade', id: v.trade.id, answer: d.hs }, pid);
    return;
  }
  if (d.victim !== undefined) {
    closeModal();
    act({ type: 'moveRobber', hex: Number(d.hex), victim: Number(d.victim) });
    return;
  }
  if (d.step) {
    const delta = Number(d.d);
    if (d.step === 'discard') { app.discardPick[d.res] = Math.max(0, (app.discardPick[d.res] || 0) + delta); renderDiscard(); }
    else if (d.step === 'yop') { app.pick.sel[d.res] = Math.max(0, (app.pick.sel[d.res] || 0) + delta); renderPicker(); }
    else { const ui = app.tradeUI; ui[d.step][d.res] = Math.max(0, (ui[d.step][d.res] || 0) + delta); renderTrade(); }
    return;
  }
  if (d.mono) { app.pick.sel = { [d.mono]: 1 }; renderPicker(); return; }
  if (d.piece) { app.pieceChoice = d.piece; app.hlKey = ''; refreshSoon(); renderStatus(app.view); return; }
  if (d.gstep) { app.goldPick[d.gstep] = Math.max(0, (app.goldPick[d.gstep] || 0) + Number(d.d)); renderGold(); return; }
  if ('gconfirm' in d) { act({ type: 'pickGold', cards: app.goldPick }, app.viewer).then(ok => { if (ok) closeModal(); }); return; }
  if (d.pans !== undefined) { const p = v.prompts[0]; act({ type: 'answer', id: p.id, value: JSON.parse(d.pans) }, app.viewer); return; }
  if ('pskip' in d) { const p = v.prompts[0]; act({ type: 'answer', id: p.id, value: null }, app.viewer); return; }
  if (d.pstep) { app.promptPick[d.pstep] = Math.max(0, (app.promptPick[d.pstep] || 0) + Number(d.d)); renderPromptModal(); return; }
  if ('pcards' in d) { const p = v.prompts[0]; act({ type: 'answer', id: p.id, value: app.promptPick }, app.viewer); return; }
  if (d.improve) { act({ type: 'improveCity', track: d.improve }).then(() => { if (app.modal === 'improve') renderImprove(); }); return; }
  if (d.kact) {
    const vid = app.knightVid;
    if (d.kact === 'activate') act({ type: 'activateKnight', vertex: vid }).then(() => app.modal === 'knight' && renderKnightMenu());
    else if (d.kact === 'promote') act({ type: 'promoteKnight', vertex: vid }).then(() => app.modal === 'knight' && renderKnightMenu());
    else if (d.kact === 'chase') { closeModal(); act({ type: 'chaseRobber', vertex: vid }); }
    else { closeModal(); app.knightMode = { what: d.kact, from: vid }; app.hlKey = ''; refreshSoon(); }
    return;
  }
  if (d.pplay !== undefined) {
    const i = Number(d.pplay), card = v.players[app.viewer].prog[i];
    if (card.type === 'alchemist') openAlchemist(i);
    else act({ type: 'playProgress', index: i });
    return;
  }
  if (d.alch) { app.alch[d.alch] = Number(d.n); renderAlchemist(); return; }
  if (d.disp) {
    app.display[d.disp] = !app.display[d.disp];
    if (d.disp === 'cbColors' || d.disp === 'symbols') { /* rebuilds piece meshes with new colours/badges */ }
    saveDisplay(); openMenu(); refresh();
    return;
  }
  if (d.tab) { app.tradeUI.tab = d.tab; renderTrade(); return; }
  if (d.quick) {
    const hand = v.players[app.viewer].hand;
    const cost = E.COSTS[d.quick];
    const miss = missingFor(hand, cost);
    const need = Object.values(miss).reduce((x, y) => x + y, 0);
    const spare = spareFor(hand, cost);
    const give = {};
    let left = need;
    // Offer one spare card per missing card, from the most plentiful first.
    while (left > 0) {
      const r = RESOURCES.filter(x => !miss[x] && (spare[x] || 0) > (give[x] || 0)).sort((a, b) => (spare[b] - (give[b] || 0)) - (spare[a] - (give[a] || 0)))[0];
      if (!r) break;
      give[r] = (give[r] || 0) + 1; left--;
    }
    app.tradeUI.give = give; app.tradeUI.get = miss;
    if (!Object.keys(give).length) toast('You have no spare cards to offer for that.', 'err');
    renderTrade();
    return;
  }
  if ('clearOffer' in d) { app.tradeUI.give = {}; app.tradeUI.get = {}; renderTrade(); return; }
  if ('openTrade' in d) { openTrade('players'); return; }
  if (d.bankplan) {
    const plan = JSON.parse(d.bankplan);
    (async () => { for (const step of plan) { if (!(await act({ type: 'bankTrade', give: step.give, get: step.get, count: 1 }))) break; } renderTrade(); })();
    return;
  }
  if (d.bgive) { app.tradeUI.bankGive = d.bgive; if (app.tradeUI.bankGet === d.bgive) app.tradeUI.bankGet = null; app.tradeUI.bankCount = 1; renderTrade(); return; }
  if (d.bget) { app.tradeUI.bankGet = d.bget; renderTrade(); return; }
  if (d.bcount) { app.tradeUI.bankCount += Number(d.bcount); renderTrade(); return; }
  if (d.confirm !== undefined) { act({ type: 'acceptTrade', id: v.trade.id, partner: Number(d.confirm) }).then(ok => { if (ok) closeModal(); }); return; }
  if (d.ai && t.closest('#host-controls')) { app.net.lobby('addAI', { ai: d.ai }).catch(err => toast(esc(err.message), 'err')); return; }
  if (d.removeSeat !== undefined) { app.net.lobby('removeSeat', { seat: Number(d.removeSeat) }).catch(err => toast(esc(err.message), 'err')); return; }

  switch (t.id) {
    case 'btn-alch': {
      const a = app.alch; closeModal();
      act({ type: 'playProgress', index: a.index, red: a.red, yellow: a.yellow }).then(ok => { if (ok) act({ type: 'roll' }); });
      break;
    }
    case 'btn-discard': {
      const ok = act({ type: 'discard', cards: app.discardPick }, app.viewer);
      Promise.resolve(ok).then(r => { if (r) closeModal(); });
      break;
    }
    case 'btn-pick-ok': {
      const { card, sel } = app.pick;
      const action = card === 'monopoly' ? { type: 'playDev', card, resource: Object.keys(sel)[0] }
        : { type: 'playDev', card, resources: RESOURCES.flatMap(r => Array(sel[r] || 0).fill(r)) };
      closeModal();
      act(action);
      break;
    }
    case 'btn-offer': {
      const ui = app.tradeUI;
      act({ type: 'offerTrade', give: ui.give, get: ui.get }).then(() => renderTrade());
      break;
    }
    case 'btn-send-counter': {
      const ui = app.tradeUI;
      // Convert to the offerer's point of view: they give what we get, and get what we give.
      act({ type: 'respondTrade', id: v.trade.id, answer: 'counter', give: ui.get, get: ui.give }, ui.counterFor).then(ok => {
        if (!ok) return;
        if (app.mode === 'local' && app.humans.includes(v.trade?.from)) { app.tradeUI = { tab: 'players', give: {}, get: {}, counterFor: null }; renderTrade(); }
        else closeModal();
      });
      break;
    }
    case 'btn-cancel-offer': act({ type: 'cancelTrade' }).then(() => renderTrade()); break;
    case 'btn-bank-trade': {
      const ui = app.tradeUI;
      act({ type: 'bankTrade', give: ui.bankGive, get: ui.bankGet, count: ui.bankCount }).then(ok => { if (ok) { ui.bankCount = 1; renderTrade(); } });
      break;
    }
    case 'btn-mute': sfx.setMuted(!sfx.muted); openSound(); break;
    case 'btn-notify': if (window.Notification && Notification.permission !== 'granted') Notification.requestPermission().then(() => openSound()); break;
    case 'btn-menu-new': closeModal(); backToSetup(); break;
    case 'btn-menu-leave': closeModal(); leaveOnline(); break;
    case 'btn-copy-invite': copyInvite(); break;
    case 'btn-again': closeModal(); if (app.mode === 'online') leaveOnline(); else backToSetup(); break;
    default: break;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'vol') { sfx.setVolume(Number(e.target.value) / 100); $('vol-out').textContent = `${e.target.value}%`; }
});

['road', 'settlement', 'city'].forEach(kind => {
  $(`act-${kind}`).addEventListener('click', () => {
    app.buildMode = app.buildMode === kind ? null : kind;
    renderActions(app.view); renderStatus(app.view); updateHighlights(app.view);
  });
});
$('act-dev').addEventListener('click', () => {
  if (ck()) { app.buildMode = app.buildMode === 'knight' ? null : 'knight'; app.knightMode = null; renderActions(app.view); renderStatus(app.view); updateHighlights(app.view); }
  else act({ type: 'buyDev' });
});
$('act-wall').addEventListener('click', () => { app.buildMode = app.buildMode === 'wall' ? null : 'wall'; renderActions(app.view); renderStatus(app.view); updateHighlights(app.view); });
$('btn-improve').addEventListener('click', openImprove);
$('act-ship').addEventListener('click', () => { app.buildMode = app.buildMode === 'ship' ? null : 'ship'; app.shipFrom = null; app.hlKey = ''; renderActions(app.view); renderStatus(app.view); updateHighlights(app.view); });
$('btn-roll').addEventListener('click', () => act({ type: 'roll' }));
$('btn-end').addEventListener('click', () => { app.buildMode = null; act({ type: 'endTurn' }); });
$('btn-trade').addEventListener('click', () => openTrade());
$('btn-help').addEventListener('click', openHelp);
$('btn-sound').addEventListener('click', openSound);
$('btn-menu').addEventListener('click', openMenu);
$('btn-camera').addEventListener('click', () => scene?.resetCamera());
function setTerritory(on) {
  app.showTerritory = on;
  $('btn-territory').setAttribute('aria-pressed', String(on));
  scene?.setTerritory(on);
  try { localStorage.setItem('terrahex.territory', on ? '1' : '0'); } catch { /* ignore */ }
}
$('btn-territory').addEventListener('click', () => setTerritory(!app.showTerritory));
app.boardView = (() => { try { return localStorage.getItem('terrahex.view') === 'board'; } catch { return false; } })();
function setBoardView(on) {
  app.boardView = on;
  $('btn-view').setAttribute('aria-pressed', String(on));
  $('btn-view').title = on ? 'Detailed 3D view (B)' : 'Board game view (B)';
  scene?.setStyle(on ? 'board' : 'tabletop');
  try { localStorage.setItem('terrahex.view', on ? 'board' : 'tabletop'); } catch { /* ignore */ }
}
$('btn-view').addEventListener('click', () => setBoardView(!app.boardView));
if (scene) scene.style = app.boardView ? 'board' : 'tabletop';
$('btn-view').setAttribute('aria-pressed', String(app.boardView));
setTerritory(app.showTerritory);
$('btn-hosting').addEventListener('click', () => openModal('hosting', `<h2>Host Terra Hex on your server</h2>
  <p>Terra Hex runs on any machine with Node.js 18 or newer. There is nothing to install: copy the whole folder (<kbd>server.js</kbd>, <kbd>package.json</kbd>, <kbd>client/</kbd> and <kbd>shared/</kbd>) and run <kbd>npm start</kbd>. It serves on port 7779.</p>
  <h3 style="font-size:16px;color:var(--brass-hi);margin:14px 0 6px">CubeCoders AMP (Generic module)</h3>
  <ul style="color:var(--parchment-2);padding-left:18px;margin:0">
    <li>Upload the folder to the instance root.</li>
    <li>Configuration → Generic Settings: Executable <kbd>/usr/bin/node</kbd>, Arguments <kbd>server.js --port {{$ApplicationPort1}}</kbd>, Application Port 1 <kbd>7779</kbd> (TCP).</li>
    <li>Start the instance and share <kbd>http://YOUR-SERVER-IP:7779</kbd>. Friends outside your network need the port forwarded on your router.</li>
  </ul>
  <p style="margin-top:12px">Online rooms are saved to <kbd>data/rooms.json</kbd> and survive restarts.</p>
  <div class="actions-row"><button class="btn primary" data-close>Close</button></div>`));
$('btn-log-toggle').addEventListener('click', () => {
  const p = $('log-panel');
  p.classList.toggle('collapsed');
  $('btn-log-toggle').textContent = p.classList.contains('collapsed') ? 'Show' : 'Hide';
});
$('btn-more').addEventListener('click', () => { $('log-panel').classList.toggle('show'); $('devs').classList.toggle('show'); });

document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('dcard')) { e.preventDefault(); e.target.click(); } });
document.addEventListener('keydown', (e) => {
  if (!app.view || e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (app.modal && !['discard', 'victory'].includes(app.modal)) closeModal();
    else if (app.buildMode || app.knightMode || app.shipFrom !== null) { app.buildMode = null; app.knightMode = null; app.shipFrom = null; app.hlKey = ''; refreshSoon(); }
    return;
  }
  if (app.modal || curtainUp()) return;
  const click = (id) => { const b = $(id); if (b && !b.disabled) b.click(); };
  if (k === 'r') click('btn-roll');
  else if (k === 'e') click('btn-end');
  else if (k === '1') click('act-road');
  else if (k === '2') click('act-settlement');
  else if (k === '3') click('act-city');
  else if (k === 'd') click('act-dev');
  else if (k === 'i' && ck()) click('btn-improve');
  else if (k === 't') click('btn-trade');
  else if (k === 'h') openHelp();
  else if (k === 'c') scene?.resetCamera();
  else if (k === 'v') setTerritory(!app.showTerritory);
  else if (k === 'b') setBoardView(!app.boardView);
});

// ================================================================== setup screen
function enterGameUI() {
  if (scene) scene.autoOrbit = false;
  previewKey = '';
  $('setup').classList.add('hidden');
  $('hud').classList.remove('hidden');
  closeModal();
  logCount = -1;
  app.hlKey = '';
}
function backToSetup() {
  clearTimeout(app.aiTimer);
  app.mode = null; app.state = null; app.view = null; app.deadline = null;
  $('hud').classList.add('hidden');
  $('curtain').classList.add('hidden');
  $('setup').classList.remove('hidden');
  scene?.setHighlights(null, []);
  app.boardKey = null; previewKey = '';
  renderSetup();
}

function defaultSeats() {
  return [
    { name: 'You', type: 'human', color: PALETTE[0].c },
    { name: 'Ada', type: 'normal', color: PALETTE[1].c },
    { name: 'Bram', type: 'normal', color: PALETTE[2].c },
    { name: 'Cora', type: 'normal', color: PALETTE[3].c }
  ];
}
/** Small top-down map preview (SVG) from a sample board. */
const previewCache = new Map();
function mapPreview(id) {
  if (previewCache.has(id)) return previewCache.get(id);
  let seed = 4242;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const b = generateBoard({ map: id, layout: id === 'classic' ? 'beginner' : 'balanced', custom: app.custom }, rand);
  const pts = [...b.hexes, ...b.lakes];
  const xs = pts.map(h => h.x), ys = pts.map(h => h.y);
  const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 1, minY = Math.min(...ys) - 1.1, maxY = Math.max(...ys) + 1.1;
  const hexPath = (x, y, fill) => `<polygon points="${[0, 1, 2, 3, 4, 5].map(i => { const a = (60 * i - 30) * Math.PI / 180; return `${(x + Math.cos(a) * 0.95).toFixed(2)},${(y + Math.sin(a) * 0.95).toFixed(2)}`; }).join(' ')}" fill="${fill}"/>`;
  const svg = `<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    ${b.hexes.map(h => hexPath(h.x, h.y, id === 'wild' ? '#9c8a5e' : TERRAIN_FILL[h.terrain])).join('')}
    ${b.lakes.map(l => hexPath(l.x, l.y, '#3f8fb0')).join('')}
    ${id === 'wild' ? `<text x="${(minX + maxX) / 2}" y="${(minY + maxY) / 2 + 1.2}" text-anchor="middle" font-size="3.6" font-weight="800" fill="#f3e8cb">?</text>` : ''}</svg>`;
  previewCache.set(id, svg);
  return svg;
}
function mapCards(selected, seatCount, attr) {
  return MAPS.map(m => {
    const [lo, hi] = m.players;
    const off = seatCount < lo || seatCount > hi;
    const prev = m.custom ? boardSvg(generatedBoard(attr === 'data-omap' && app.online?.room?.config.custom ? app.online.room.config.custom : app.custom)) : mapPreview(m.id);
    return `<button class="map${selected === m.id ? ' on' : ''}${off ? ' off-range' : ''}" ${attr}="${m.id}" title="${esc(m.desc)}">${prev}<b>${esc(m.name)}</b><small>Best for ${lo}–${hi}</small></button>`;
  }).join('');
}
function ruleCards(rules, attr, disabled = false) {
  return RULES.map(r => `<button class="rule${rules[r.key] ? ' on' : ''}" ${attr}="${r.key}" ${disabled ? 'disabled' : ''} aria-pressed="${!!rules[r.key]}"><span class="box">${rules[r.key] ? '✓' : ''}</span><span><b>${r.name}</b><small>${r.desc}</small></span></button>`).join('');
}
function layoutButtons(mapId, current, attr) {
  return Object.entries(LAYOUTS).filter(([k]) => k !== 'beginner' || mapId === 'classic')
    .map(([k, n]) => `<button class="${current === k ? 'on' : ''}" ${attr}="${k}">${n}</button>`).join('');
}
function applyAccountName() {
  if (!app.auth || !app.setupSeats) return;
  const first = app.setupSeats.find(x => x.type === 'human');
  if (first) first.name = app.auth.profile.username;
}
function renderSetup() {
  applyAccountName();
  const seats = app.setupSeats ||= (() => { try { return JSON.parse(localStorage.getItem('terrahex.seats')) || defaultSeats(); } catch { return defaultSeats(); } })();
  if (app.layout === 'beginner' && app.mapId !== 'classic') app.layout = 'balanced';
  $('seats').innerHTML = seats.map((s, i) => `
    <div class="seat">
      ${crest(s.color, SYMBOL_CHARS[i % SYMBOL_CHARS.length])}
      <input type="text" maxlength="16" value="${esc(s.name)}" data-seat-name="${i}" aria-label="Player ${i + 1} name">
      <select data-seat-type="${i}" aria-label="Player ${i + 1} type">
        <option value="human" ${s.type === 'human' ? 'selected' : ''}>Human</option>
        <option value="easy" ${s.type === 'easy' ? 'selected' : ''}>AI · easy</option>
        <option value="normal" ${s.type === 'normal' ? 'selected' : ''}>AI · normal</option>
        <option value="hard" ${s.type === 'hard' ? 'selected' : ''}>AI · hard</option>
      </select>
      <div class="swatches">${PALETTE.map(p => `<button class="sw${s.color === p.c ? ' on' : ''}" style="background:${p.c}" data-seat-color="${i}" data-color="${p.c}" title="${p.n}" aria-label="${p.n}" ${seats.some((o, j) => j !== i && o.color === p.c) ? 'disabled' : ''}></button>`).join('')}</div>
      <button class="btn small ghost" data-seat-remove="${i}" ${seats.length <= 2 ? 'disabled' : ''} aria-label="Remove player">✕</button>
    </div>`).join('');
  $('btn-add-seat').disabled = seats.length >= MAX_SEATS;
  $('map-grid').innerHTML = mapCards(app.mapId, seats.length, 'data-map');
  const m = MAP_BY_ID[app.mapId];
  const notes = [m.desc];
  if (seats.length < m.players[0] || seats.length > m.players[1]) notes.push(`It is designed for ${m.players[0]}–${m.players[1]} players, but you can still play it with ${seats.length}.`);
  if (seats.length >= 5) notes.push('With 5–6 players the bank holds 24 of each resource, the deck has 34 cards, and everyone may build between turns.');
  $('map-note').textContent = notes.join(' ');
  $('gen-panel').innerHTML = app.mapId === 'custom' ? genPanelHtml(app.custom, 'data-gen', true) : '';
  $('seg-layout').innerHTML = layoutButtons(app.mapId, app.layout, 'data-layout');
  $('layout-hint').textContent = app.mapId === 'classic' && app.layout === 'balanced' ? 'Random tiles; numbers laid in the classic spiral, so red 6s and 8s never touch.' : LAYOUT_HINTS[app.layout];
  $('seg-speed').innerHTML = Object.keys(SPEEDS).map(k => `<button class="${app.speedKey === k ? 'on' : ''}" data-speed="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
  $('rule-toggles').innerHTML = ruleCards(app.rules, 'data-rule');
  $('seg-timer').innerHTML = TIMERS.map(([sec, n]) => `<button class="${app.timer === sec ? 'on' : ''}" data-ltimer="${sec}">${n}</button>`).join('');
  $('btn-continue').classList.toggle('hidden', !loadSaved());
  $('presets').innerHTML = PRESETS.map(p => `<button class="preset" data-preset="${p.id}"><b>${p.name}</b><small>${p.text}</small></button>`).join('');
  renderSetupSummary();
  updateSetupPreview();
  const humans = seats.filter(s => s.type === 'human').length;
  $('btn-start').textContent = humans ? 'Start game' : 'Watch the AI play';
}
const PRESETS = [
  { id: 'quick', name: 'Quick game', text: 'Classic island, you against 3 AIs', apply: () => ({ seats: 4, ai: 'normal', map: 'classic', layout: 'balanced', rules: {}, vp: 10 }) },
  { id: 'learn', name: 'First game', text: 'The starter island and easy AIs', apply: () => ({ seats: 4, ai: 'easy', map: 'classic', layout: 'beginner', rules: { friendlyRobber: true }, vp: 10 }) },
  { id: 'ck', name: 'Cities & Knights', text: 'Knights, barbarians and city upgrades', apply: () => ({ seats: 4, ai: 'normal', map: 'classic', layout: 'balanced', rules: { ck: true }, vp: 13 }) },
  { id: 'sea', name: 'Seafarers', text: 'New Shores: sail to gold-rich islands', apply: () => ({ seats: 4, ai: 'normal', map: 'newshores', layout: 'balanced', rules: { sea: true }, vp: 13 }) },
  { id: 'big', name: 'Big table', text: 'Six players on the Grand Continent', apply: () => ({ seats: 6, ai: 'normal', map: 'pangea', layout: 'balanced', rules: {}, vp: 10 }) },
  { id: 'surprise', name: 'Surprise me', text: 'A freshly generated island', apply: () => ({ seats: 4, ai: 'normal', map: 'custom', layout: 'balanced', rules: {}, vp: 10, surprise: true }) }
];
function applyPreset(id) {
  const p = PRESETS.find(x => x.id === id).apply();
  const seats = app.setupSeats;
  while (seats.length < p.seats) { const color = PALETTE.find(c => !seats.some(s => s.color === c.c)).c; seats.push({ name: AI_NAMES.find(n => !seats.some(s => s.name === n)) || 'Player', type: p.ai, color }); }
  while (seats.length > p.seats) seats.pop();
  seats.forEach(s => { if (s.type !== 'human') s.type = p.ai; });
  if (!seats.some(s => s.type === 'human')) seats[0].type = 'human';
  app.mapId = p.map; app.layout = p.layout;
  app.rules = { friendlyRobber: true, balancedDice: false, hiddenHands: false, ck: false, sea: false, ...p.rules };
  if (p.surprise) {
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    app.custom = cleanCustom({ seed: randomSeedText(), size: pick(['small', 'medium', 'large']), shape: pick(CUSTOM_OPTIONS.shape), water: pick(CUSTOM_OPTIONS.water), resources: pick(Object.keys(CUSTOM_OPTIONS.resources)), biome: pick(CUSTOM_OPTIONS.biome), trees: pick(CUSTOM_OPTIONS.trees) });
  }
  $('in-vp').value = p.vp; $('out-vp').textContent = p.vp;
  saveSeats(); saveSetup(); renderSetup();
  toast(`${PRESETS.find(x => x.id === id).name}: ready to start.`, 'good', 1.8);
}
function renderSetupSummary() {
  const seats = app.setupSeats;
  const humans = seats.filter(x => x.type === 'human').length;
  const m = MAP_BY_ID[app.mapId];
  const chips = [
    app.rules.ck ? '<span class="chip mode">Cities &amp; Knights</span>' : app.rules.sea ? '<span class="chip mode">Seafarers</span>' : '<span class="chip mode">Classic rules</span>',
    `<span class="chip">${esc(m.name)}${app.mapId === 'custom' ? ` · ${esc(app.custom.seed)}` : ''}</span>`,
    `<span class="chip">${seats.length} players (${humans} ${humans === 1 ? 'person' : 'people'})</span>`,
    `<span class="chip">${$('in-vp').value} points</span>`,
    `<span class="chip">${LAYOUTS[app.layout]} numbers</span>`,
    ...RULES.filter(r => r.key !== 'ck' && r.key !== 'sea' && r.key !== 'friendlyRobber' && app.rules[r.key]).map(r => `<span class="chip">${r.name}</span>`),
    app.rules.friendlyRobber ? '<span class="chip">Friendly Robber</span>' : '<span class="chip">Robber: anyone can be robbed</span>',
    app.timer ? `<span class="chip">${app.timer}s turns</span>` : '',
    seats.length >= 5 ? '<span class="chip">5–6 player rules</span>' : ''
  ];
  $('setup-summary').innerHTML = chips.join('');
}
/** Shows the chosen map in 3D behind the menu. */
let previewKey = '';
function updateSetupPreview() {
  if (!scene || app.mode) return;
  const key = app.mapId + (app.mapId === 'custom' ? JSON.stringify(app.custom) : '') + (app.rules.sea ? '|sea' : '');
  if (key === previewKey) return;
  previewKey = key;
  let seed = 777;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const board = generateBoard({ map: app.mapId, layout: app.mapId === 'classic' ? 'beginner' : 'balanced', custom: app.custom, sea: app.rules.sea }, rand);
  scene.setBoard(board);
  scene.autoOrbit = true;
  scene.sync({ board, robber: board.desert ?? 0, vOwner: board.vertices.map(() => null), vType: board.vertices.map(() => null), eOwner: board.edges.map(() => null), players: [] }, { colors: [] });
}

function saveSeats() { try { localStorage.setItem('terrahex.seats', JSON.stringify(app.setupSeats)); } catch { /* ignore */ } }
$('setup').addEventListener('input', (e) => {
  const d = e.target.dataset;
  if (d.seatName !== undefined) { app.setupSeats[d.seatName].name = e.target.value; saveSeats(); }
  if (e.target.id === 'in-vp') { $('out-vp').textContent = e.target.value; renderSetupSummary(); }
  if (e.target.id === 'in-discard') $('out-discard').textContent = e.target.value;
});
$('setup').addEventListener('change', (e) => {
  const d = e.target.dataset;
  if (e.target.id === 'data-gen-seed') { app.custom = cleanCustom({ ...app.custom, seed: e.target.value }); saveSetup(); renderSetup(); return; }
  if (e.target.id === 'data-gen-code') { const c = parseMapCode(e.target.value); if (c) { app.custom = c; saveSetup(); renderSetup(); } else toast('That is not a Terra Hex map code.', 'err'); return; }
  if (e.target.id === 'data-ogen-seed') { app.net.lobby('config', { config: { custom: { ...(app.online.room.config.custom || {}), seed: e.target.value } } }).catch(() => {}); return; }
  if (e.target.id === 'data-ogen-code') { const c = parseMapCode(e.target.value); if (c) app.net.lobby('config', { config: { custom: c } }).catch(() => {}); else toast('That is not a Terra Hex map code.', 'err'); return; }
  if (d.seatType !== undefined) { app.setupSeats[d.seatType].type = e.target.value; saveSeats(); renderSetup(); }
});
$('setup').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.seatColor !== undefined) { app.setupSeats[d.seatColor].color = d.color; saveSeats(); renderSetup(); }
  else if (d.seatRemove !== undefined) { app.setupSeats.splice(Number(d.seatRemove), 1); saveSeats(); renderSetup(); }
  else if (d.preset) applyPreset(d.preset);
  else if (d.allai) { app.setupSeats.forEach(x => { if (x.type !== 'human') x.type = d.allai; }); saveSeats(); renderSetup(); }
  else if (d.layout) { app.layout = d.layout; saveSetup(); renderSetup(); }
  else if (d.speed) { app.speedKey = d.speed; saveSetup(); renderSetup(); }
  else if (d.map) {
    app.mapId = d.map;
    if (MAP_BY_ID[d.map].sea && !app.rules.sea) { app.rules.sea = true; app.rules.ck = false; $('in-vp').value = 13; $('out-vp').textContent = 13; }
    saveSetup(); renderSetup();
  }
  else if (d.gen) {
    if (d.gen === 'reroll') app.custom = cleanCustom({ ...app.custom, seed: randomSeedText() });
    else app.custom = cleanCustom({ ...app.custom, [d.gen]: d.gen === 'deserts' ? Number(d.val) : d.val });
    saveSetup(); renderSetup();
  }
  else if (d.ogen) {
    const cur = app.online.room.config.custom || {};
    const next = d.ogen === 'reroll' ? { ...cur, seed: randomSeedText() } : { ...cur, [d.ogen]: d.ogen === 'deserts' ? Number(d.val) : d.val };
    app.net.lobby('config', { config: { custom: next } }).catch(err => toast(esc(err.message), 'err'));
  }
  else if (d.copyCode) { (navigator.clipboard?.writeText(d.copyCode) || Promise.reject()).then(() => toast('Map code copied.', 'good'), () => toast(esc(d.copyCode), '', 6)); }
  else if (d.rule) {
    app.rules[d.rule] = !app.rules[d.rule];
    if (d.rule === 'ck' && app.rules.ck) { app.rules.sea = false; if (MAP_BY_ID[app.mapId].sea) app.mapId = 'classic'; }
    if (d.rule === 'sea' && app.rules.sea) app.rules.ck = false;
    if (d.rule === 'sea' && !app.rules.sea && MAP_BY_ID[app.mapId].sea) app.mapId = 'classic';
    if (d.rule === 'ck' || d.rule === 'sea') { $('in-vp').value = app.rules.ck || app.rules.sea ? 13 : 10; $('out-vp').textContent = $('in-vp').value; }
    saveSetup(); renderSetup();
  }
  else if (d.ltimer !== undefined) { app.timer = Number(d.ltimer); saveSetup(); renderSetup(); }
  else if (d.omap) app.net.lobby('config', { config: { map: d.omap } }).catch(err => toast(esc(err.message), 'err'));
  else if (d.orule) {
    const on = !app.online.room.config[d.orule];
    app.net.lobby('config', { config: { [d.orule]: on, ...(d.orule === 'ck' ? { vpTarget: on ? 13 : 10 } : {}) } }).catch(err => toast(esc(err.message), 'err'));
  }
  else if (d.olayout) app.net.lobby('config', { config: { layout: d.olayout } }).catch(err => toast(esc(err.message), 'err'));
  else if (d.otimer !== undefined) app.net.lobby('config', { config: { turnTimer: Number(d.otimer) } }).catch(err => toast(esc(err.message), 'err'));
  else if (d.ocolor) { app.onlineColor = d.ocolor; renderOnlineColors(); if (app.net?.code && app.online?.room?.status === 'lobby') app.net.lobby('profile', { name: $('on-name').value, color: d.ocolor }).catch(() => {}); }
});
$('btn-howto').addEventListener('click', openHowTo);
$('btn-add-seat').addEventListener('click', () => {
  const seats = app.setupSeats;
  if (seats.length >= MAX_SEATS) return;
  const color = PALETTE.find(p => !seats.some(s => s.color === p.c)).c;
  const name = AI_NAMES.find(n => !seats.some(s => s.name === n)) || 'Player';
  seats.push({ name, type: 'normal', color });
  saveSeats(); renderSetup();
});
$('btn-start').addEventListener('click', () => {
  sfx.unlock();
  const seats = app.setupSeats.map((s, i) => ({ ...s, name: (s.name || '').trim().slice(0, 16) || `Player ${i + 1}` }));
  const q = new URLSearchParams(location.search);
  app.aiSpeed = Number(q.get('aispeed')) || SPEEDS[app.speedKey];
  startLocal(seats, {
    map: app.mapId, layout: app.layout, vpTarget: Number($('in-vp').value), discardLimit: Number($('in-discard').value),
    turnTimer: app.timer, ...app.rules, custom: app.custom
  });
});
$('btn-continue').addEventListener('click', () => {
  const s = loadSaved();
  if (!s) return;
  sfx.unlock();
  app.state = s.state; app.humans = s.humans; app.speedKey = s.speed || 'normal';
  app.aiSpeed = Number(new URLSearchParams(location.search).get('aispeed')) || SPEEDS[app.speedKey];
  beginLocal();
});
$('tab-local').addEventListener('click', () => switchTab('local'));
$('tab-online').addEventListener('click', () => switchTab('online'));
function switchTab(which) {
  $('tab-local').classList.toggle('on', which === 'local');
  $('tab-online').classList.toggle('on', which === 'online');
  $('pane-local').classList.toggle('hidden', which !== 'local');
  $('pane-online').classList.toggle('hidden', which !== 'online');
  if (which === 'online') checkServer();
}

// ================================================================== online
app.onlineColor = PALETTE[1].c;
function renderOnlineColors() {
  $('on-colors').innerHTML = PALETTE.map(p => `<button class="sw${app.onlineColor === p.c ? ' on' : ''}" style="background:${p.c}" data-ocolor="${p.c}" title="${p.n}" aria-label="${p.n}"></button>`).join('');
}
async function checkServer() {
  const ok = await serverAvailable();
  app.hasServer = ok; renderAccountButton();
  $('online-unavailable').classList.toggle('hidden', ok);
  $('online-entry').classList.toggle('hidden', !ok || !!app.net?.code);
  $('btn-rejoin').classList.toggle('hidden', !OnlineClient.savedRoom());
}
function ensureNet() {
  if (!app.net) {
    app.net = new OnlineClient({
      onUpdate: onServerUpdate,
      onStatus: (s) => { if (s === 'reconnecting' && app.mode === 'online') toast('Connection lost. Reconnecting…', 'err'); }
    });
  }
  return app.net;
}
async function createRoom() {
  try { await ensureNet().create($('on-name').value, app.onlineColor); showLobby(); } catch (err) { toast(esc(err.message), 'err'); }
}
async function joinRoom(code) {
  try { await ensureNet().join(code, $('on-name').value, app.onlineColor); showLobby(); } catch (err) {
    toast(esc(err.message), 'err');
    if (err.status === 404) OnlineClient.forget(code);
  }
}
function showLobby() {
  $('online-entry').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('lobby-code').textContent = app.net.code;
  history.replaceState(null, '', `?room=${app.net.code}`);
}
function onServerUpdate(p) {
  app.online = p;
  app.deadline = p.deadline || null;
  if (!p.view) { renderLobby(p); return; }
  const first = app.mode !== 'online';
  if (first) {
    app.mode = 'online';
    app.viewer = p.you >= 0 ? p.you : null;
    app.victoryShown = p.view.phase === 'over';
    enterGameUI();
  }
  app.viewer = p.you >= 0 ? p.you : null;
  app.view = p.view;
  if (!first) handleEvents(p.events);
  refresh();
}
function renderLobby(p) {
  const room = p.room;
  const host = p.isHost;
  $('lobby-seats').innerHTML = room.seats.map((s, i) => `
    <div class="seat" style="grid-template-columns:30px 1fr auto auto">
      ${crest(s.color, s.name[0])}<div><b>${esc(s.name)}</b> ${i === p.you ? '<span class="tag">You</span>' : ''} ${s.isAI ? `<span class="tag">AI ${s.ai}</span>` : ''}</div>
      <span class="dot${s.online ? '' : ' off'}" title="${s.online ? 'Connected' : 'Not connected'}"></span>
      ${host && i > 0 ? `<button class="btn small ghost" data-remove-seat="${i}" aria-label="Remove">✕</button>` : '<span></span>'}
    </div>`).join('') + (room.seats.length < MAX_SEATS ? `<div class="empty-note">${MAX_SEATS - room.seats.length} open seat${room.seats.length === MAX_SEATS - 1 ? '' : 's'}. Share the code or the invite link.</div>` : '');
  $('host-controls').classList.toggle('hidden', !host);
  $('lobby-wait').classList.toggle('hidden', host);
  $('btn-lobby-start').classList.toggle('hidden', !host);
  $('btn-lobby-start').disabled = room.seats.length < 3 && room.seats.filter(s => !s.isAI).length < 2;
  const c = room.config;
  $('lobby-maps').innerHTML = mapCards(c.map, room.seats.length, 'data-omap');
  const genFocus = document.activeElement && document.activeElement.id && document.activeElement.id.startsWith('data-ogen');
  if (!genFocus) $('lobby-gen').innerHTML = c.map === 'custom' && c.custom ? genPanelHtml(c.custom, 'data-ogen', host) : '';
  $('lobby-layout').innerHTML = layoutButtons(c.map, c.layout, 'data-olayout');
  $('lobby-timer').innerHTML = TIMERS.map(([sec, n]) => `<button class="${c.turnTimer === sec ? 'on' : ''}" data-otimer="${sec}">${n}</button>`).join('');
  $('lobby-rules').innerHTML = ruleCards(c, 'data-orule');
  if (document.activeElement !== $('lobby-vp')) $('lobby-vp').value = c.vpTarget;
  if (document.activeElement !== $('lobby-discard')) $('lobby-discard').value = c.discardLimit;
  $('lobby-vp-out').textContent = c.vpTarget; $('lobby-discard-out').textContent = c.discardLimit;
  const on = RULES.filter(r => c[r.key]).map(r => r.name);
  $('lobby-summary').textContent = `${MAP_BY_ID[c.map].name}${c.map === 'custom' && c.custom ? ` (${c.custom.seed})` : ''} · ${LAYOUTS[c.layout]} numbers · ${c.vpTarget} points to win · discard above ${c.discardLimit}${c.turnTimer ? ` · ${c.turnTimer}s turns` : ''}${on.length ? ' · ' + on.join(', ') : ''}${room.seats.length >= 5 ? ' · 5–6 player rules' : ''}`;
}
function copyInvite() {
  const link = `${location.origin}${location.pathname}?room=${app.net.code}`;
  (navigator.clipboard?.writeText(link) || Promise.reject()).then(() => toast('Invite link copied.', 'good'), () => toast(`Share this link: ${esc(link)}`, '', 6));
}
function leaveOnline() {
  if (app.net) {
    if (app.online?.room?.status === 'lobby') app.net.lobby('leave').catch(() => {});
    app.net.leave();
    app.net = null;
  }
  app.online = null;
  history.replaceState(null, '', location.pathname);
  $('lobby').classList.add('hidden');
  backToSetup();
  switchTab('online');
}
$('btn-create').addEventListener('click', () => { sfx.unlock(); createRoom(); });
$('btn-join').addEventListener('click', () => { sfx.unlock(); joinRoom($('on-code').value); });
$('on-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('on-code').value); });
$('btn-rejoin').addEventListener('click', () => joinRoom(OnlineClient.savedRoom()));
$('btn-copy').addEventListener('click', copyInvite);
$('btn-leave').addEventListener('click', leaveOnline);
$('btn-lobby-start').addEventListener('click', () => app.net.lobby('start').catch(err => toast(esc(err.message), 'err')));
['vp', 'discard'].forEach(k => {
  $(`lobby-${k}`).addEventListener('input', (e) => { $(`lobby-${k}-out`).textContent = e.target.value; });
  $(`lobby-${k}`).addEventListener('change', (e) => {
    app.net.lobby('config', { config: { [k === 'vp' ? 'vpTarget' : 'discardLimit']: Number(e.target.value) } }).catch(err => toast(esc(err.message), 'err'));
  });
});
$('on-name').addEventListener('change', () => { if (app.net?.code && app.online?.room?.status === 'lobby') app.net.lobby('profile', { name: $('on-name').value }).catch(() => {}); });

// ================================================================== accounts, friends, leaderboard, chat
app.auth = (() => { try { return JSON.parse(localStorage.getItem('terrahex.auth') || 'null'); } catch { return null; } })();
OnlineClient.authToken = app.auth?.token || null;
app.hasServer = false;
function setAuth(auth) {
  app.auth = auth;
  OnlineClient.authToken = auth?.token || null;
  try { if (auth) localStorage.setItem('terrahex.auth', JSON.stringify(auth)); else localStorage.removeItem('terrahex.auth'); } catch { /* ignore */ }
  renderAccountButton();
  if (auth) heartbeat();
  if (!app.mode) renderSetup();
}
function renderAccountButton() {
  const b = $('btn-account');
  b.classList.toggle('hidden', !app.hasServer);
  b.textContent = app.auth ? `${app.auth.profile.username} · ${app.auth.profile.rating}` : 'Sign in';
  const nm = $('on-name');
  if (app.auth) { nm.value = app.auth.profile.username; nm.disabled = true; nm.title = 'Signed in: your username is used'; }
  else { nm.disabled = false; nm.title = ''; }
}
async function refreshProfile() {
  if (!app.auth) return;
  try { const r = await accountCall('account/me', null, app.auth.token, 'GET'); setAuth({ ...app.auth, profile: r.profile }); }
  catch (err) { if (err.status === 401) { setAuth(null); toast('Your sign-in expired. Please sign in again.', 'err'); } }
}
async function heartbeat() {
  if (!app.auth || !app.hasServer) return;
  try {
    const r = await accountCall('presence', { room: app.net?.code || null }, app.auth.token);
    (r.invites || []).forEach(showInvite);
  } catch (err) { if (err.status === 401) setAuth(null); }
}
setInterval(heartbeat, 30000);
function showInvite(inv) {
  sfx.yourTurn();
  const el = document.createElement('div');
  el.className = 'invite-card panel';
  el.innerHTML = `<div><b>${esc(inv.from)}</b> invited you to room <b>${esc(inv.room)}</b></div><button class="btn small primary" data-joininvite="${esc(inv.room)}">Join</button><button class="btn small ghost" data-dismiss>✕</button>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 60000);
}
function timeAgo(t) {
  if (!t) return 'not seen yet';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
async function openAccount(tab) {
  const signedIn = !!app.auth;
  tab = tab || (signedIn ? 'profile' : 'signin');
  const tabs = signedIn ? [['profile', 'Profile'], ['friends', 'Friends'], ['leaderboard', 'Leaderboard']] : [['signin', 'Sign in'], ['register', 'Create account'], ['leaderboard', 'Leaderboard']];
  const head = `<h2>${signedIn ? esc(app.auth.profile.username) : 'Your Terra Hex account'}</h2><div class="acct-tabs">${tabs.map(([k, n]) => `<button class="${k === tab ? 'on' : ''}" data-acct="${k}">${n}</button>`).join('')}</div>`;
  openModal('account', head + '<p class="empty-note">Loading…</p>', true);
  let body = '';
  try {
    if (tab === 'signin' || tab === 'register') {
      body = `<p>${tab === 'register' ? 'An account keeps your rating, match history and friends list on this server. Only online games count toward the leaderboard.' : 'Sign in to track your rating and see which friends are online.'}</p>
        <div class="grid2"><div class="field"><label for="acct-user">Username</label><input type="text" id="acct-user" maxlength="16" autocomplete="username" placeholder="3–16 letters or digits"></div>
        <div class="field"><label for="acct-pass">Password</label><input type="password" id="acct-pass" autocomplete="${tab === 'register' ? 'new-password' : 'current-password'}" placeholder="at least 6 characters" style="font:inherit;color:var(--parchment);background:var(--walnut-3);border:1px solid var(--walnut-line);border-radius:8px;padding:6px 8px"></div></div>
        <p class="empty-note" style="margin-top:10px">Accounts live on the server you are playing on. If it is reachable from the internet, put it behind HTTPS so passwords are not sent in the clear.</p>
        <div class="actions-row"><button class="btn primary" data-acctgo="${tab}">${tab === 'register' ? 'Create account' : 'Sign in'}</button></div>`;
    } else if (tab === 'profile') {
      const p = (await accountCall('account/me', null, app.auth.token, 'GET')).profile;
      setAuth({ ...app.auth, profile: p });
      const rate = p.games ? Math.round((p.wins / p.games) * 100) : 0;
      body = `<div class="statgrid"><div><b>${p.rating}</b><span>Rating</span></div><div><b>${p.games}</b><span>Online games</span></div><div><b>${p.wins}</b><span>Wins</span></div><div><b>${rate}%</b><span>Win rate</span></div></div>
        <div class="label">Recent games</div>
        ${p.history.length ? `<table class="scores"><thead><tr><th>When</th><th>Map</th><th>Mode</th><th>Place</th><th>Points</th><th>Rating</th></tr></thead><tbody>${p.history.map(h => `<tr><td>${timeAgo(h.at)}</td><td>${esc(MAP_BY_ID[h.map]?.name || h.map)}</td><td>${{ classic: 'Classic', ck: 'Cities & Knights', sea: 'Seafarers' }[h.mode] || h.mode}</td><td>${h.place} of ${h.of}${h.win ? ' 🏆' : ''}</td><td>${h.vp}</td><td style="color:${h.change >= 0 ? '#b6e3a0' : '#ffb4a3'}">${h.change >= 0 ? '+' : ''}${h.change}</td></tr>`).join('')}</tbody></table>` : '<p class="empty-note">No online games yet. Your rating starts at 1000.</p>'}
        <div class="actions-row"><button class="btn danger" data-signout>Sign out</button></div>`;
    } else if (tab === 'friends') {
      const list = (await accountCall('friends', null, app.auth.token, 'GET')).friends;
      const myLobby = app.online?.room?.status === 'lobby' ? app.net?.code : null;
      body = `<div class="row" style="flex-wrap:nowrap"><input type="text" id="friend-name" maxlength="16" placeholder="Friend's username" style="flex:1"><button class="btn primary" data-addfriend>Add friend</button></div>
        <div class="responses">${list.length ? list.map(f => `<div class="friend"><span class="dot${f.online ? '' : ' off'}"></span><div class="who">${esc(f.username)} <span class="tag">${f.rating}</span><small>${f.online ? (f.room ? (f.status === 'lobby' ? `In lobby ${esc(f.room)}` : 'Playing a game') : 'Online') : `Last seen ${timeAgo(f.lastSeen)}`}</small></div>
          ${f.online && f.room && f.status === 'lobby' && f.room !== app.net?.code ? `<button class="btn small primary" data-joininvite="${esc(f.room)}">Join</button>` : ''}
          ${myLobby && f.online ? `<button class="btn small" data-invitefriend="${f.id}">Invite</button>` : ''}
          <button class="btn small ghost" data-unfriend="${f.id}" title="Remove friend">✕</button></div>`).join('') : '<p class="empty-note">No friends yet. Add someone by their username.</p>'}</div>
        ${myLobby ? '' : '<p class="empty-note" style="margin-top:10px">Create an online room to invite friends straight into it.</p>'}`;
    } else if (tab === 'leaderboard') {
      const list = (await accountCall('leaderboard', null, null, 'GET')).players;
      body = list.length ? `<table class="scores"><thead><tr><th>#</th><th>Player</th><th>Rating</th><th>Wins</th><th>Games</th><th>Win rate</th></tr></thead><tbody>${list.map(p => `<tr${app.auth && p.id === app.auth.profile.id ? ' style="background:rgba(232,197,111,.12)"' : ''}><td>${p.rank}</td><td><span class="dot${p.online ? '' : ' off'}" style="display:inline-block;margin-right:6px"></span>${esc(p.username)}</td><td class="total">${p.rating}</td><td>${p.wins}</td><td>${p.games}</td><td>${Math.round((p.wins / p.games) * 100)}%</td></tr>`).join('')}</tbody></table>`
        : '<p class="empty-note">Nobody has finished a rated online game yet. Play an online room while signed in to get on the board.</p>';
      body += '<p class="empty-note" style="margin-top:10px">Ratings move after each online game: beating higher-rated players earns more. AI seats count as 1000.</p>';
    }
  } catch (err) { body = `<p class="warn">${esc(err.message)}</p>`; }
  if (app.modal !== 'account') return;
  $('modal-body').innerHTML = head + body + `<div class="actions-row"><button class="btn" data-close>Close</button></div>`;
  app.acctTab = tab;
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.acct) openAccount(d.acct);
    else if (d.acctgo) {
      const r = await accountCall(`account/${d.acctgo === 'register' ? 'register' : 'login'}`, { username: $('acct-user').value, password: $('acct-pass').value });
      setAuth(r); toast(`Signed in as ${esc(r.profile.username)}.`, 'good'); openAccount('profile');
    } else if ('signout' in d) { try { await accountCall('account/logout', {}, app.auth.token); } catch { /* ignore */ } setAuth(null); closeModal(); toast('Signed out.'); }
    else if ('addfriend' in d) { await accountCall('friends/add', { username: $('friend-name').value }, app.auth.token); openAccount('friends'); }
    else if (d.unfriend) { await accountCall('friends/remove', { id: d.unfriend }, app.auth.token); openAccount('friends'); }
    else if (d.invitefriend) { await accountCall('friends/invite', { id: d.invitefriend, room: app.net.code }, app.auth.token); toast('Invite sent.', 'good'); }
    else if (d.joininvite) {
      t.closest('.invite-card')?.remove();
      if (app.mode) { toast('Leave your current game first (Menu → Leave room / New game).', 'err', 4); return; }
      closeModal(); switchTab('online'); await joinRoom(d.joininvite);
    } else if ('dismiss' in d) t.closest('.invite-card')?.remove();
    else if (d.emote) sendChat(d.emote);
    else if (d.logtab) setLogTab(d.logtab);
    else if (d.gfx) { app.gfx = d.gfx; try { localStorage.setItem('terrahex.gfx', d.gfx); } catch { /* ignore */ } scene?.setQuality(d.gfx); app.hlKey = ''; openMenu(); refresh(); }
  } catch (err) { toast(esc(err.message), 'err'); }
});
$('btn-account').addEventListener('click', () => openAccount());
// chat
app.chatSeen = 0;
function setLogTab(tab) {
  app.logTab = tab;
  document.querySelectorAll('[data-logtab]').forEach(b => b.classList.toggle('on', b.dataset.logtab === tab));
  $('log').classList.toggle('hidden', tab !== 'log');
  $('chatbox').classList.toggle('hidden', tab !== 'chat');
  if (tab === 'chat') { app.chatSeen = (app.online?.chat || []).length; renderChat(); setTimeout(() => $('chatinput').focus(), 50); }
}
function renderChat() {
  const msgs = app.mode === 'online' ? (app.online?.chat || []) : [];
  $('tab-chat').classList.toggle('hidden', app.mode !== 'online');
  if (app.mode !== 'online' && app.logTab === 'chat') setLogTab('log');
  const unread = app.logTab === 'chat' ? 0 : Math.max(0, msgs.length - app.chatSeen);
  $('chat-unread').textContent = unread; $('chat-unread').classList.toggle('hidden', !unread);
  if (app.logTab === 'chat') app.chatSeen = msgs.length;
  const el = $('chatlog');
  const key = msgs.length + (msgs.at(-1)?.at || 0);
  if (el.dataset.key === String(key)) return;
  el.dataset.key = key;
  el.innerHTML = msgs.map(m => `<div class="m"><b style="color:${m.color === '#e8e1cf' ? '#f6f0de' : m.color}">${esc(m.name)}</b> ${esc(m.text)}<span class="t">${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') || '<span class="empty-note">Say hello. Quick emotes are below.</span>';
  el.scrollTop = el.scrollHeight;
}
async function sendChat(text) {
  text = String(text || '').trim();
  if (!text || app.mode !== 'online') return;
  try { await app.net.chat(text); $('chatinput').value = ''; } catch (err) { toast(esc(err.message), 'err'); }
}
$('btn-chat-send').addEventListener('click', () => sendChat($('chatinput').value));
$('chatinput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat($('chatinput').value); } e.stopPropagation(); });
// graphics + FPS overlay
app.gfx = (() => { try { return localStorage.getItem('terrahex.gfx') || 'auto'; } catch { return 'auto'; } })();
if (scene) {
  scene.setQuality(app.gfx);
  scene.onQuality = (k) => { if (app.gfx === 'auto' && app.mode) toast(`Graphics set to ${QUALITY[k].label} to keep the game smooth.`, '', 3); };
}
setInterval(() => {
  const el = $('fps');
  el.classList.toggle('hidden', !app.display.fps || !scene);
  if (app.display.fps && scene) { const st = scene.stats(); el.textContent = `${st.fps} fps · ${QUALITY[st.quality].label} · ${st.calls} draws · ${Math.round(st.triangles / 1000)}k tris`; }
}, 1000);

// ================================================================== boot
(function boot() {
  renderSetup();
  renderOnlineColors();
  serverAvailable().then(ok => { app.hasServer = ok; renderAccountButton(); if (ok && app.auth) refreshProfile(); });
  try { const n = localStorage.getItem('terrahex.name'); if (n) $('on-name').value = n; } catch { /* ignore */ }
  $('on-name').addEventListener('input', () => { try { localStorage.setItem('terrahex.name', $('on-name').value); } catch { /* ignore */ } });
  // The chosen map is shown behind the setup screen (renderSetup → updateSetupPreview).
  // Test hook: ?still=1 renders only on demand (headless browsers are slow at continuous 3D).
  if (scene && new URLSearchParams(location.search).get('still')) {
    scene.renderer.setAnimationLoop(null);
    window.__sceneRef = scene;
    window.__renderOnce = () => { scene.time.value += 0.3; scene._frame && (scene.clock.getDelta(), 0); const d = scene.camera.position.distanceTo(scene.controls.target); scene.scene.fog.near = d + 8; scene.scene.fog.far = d + 34; if (scene.seaUniforms) { scene.seaUniforms.uFogNear.value = d + 8; scene.seaUniforms.uFogFar.value = d + 34; } scene.controls.update(); scene.anims.forEach(a => a.fn(1)); scene.anims = []; scene.renderer.shadowMap.needsUpdate = true; scene.renderer.render(scene.scene, scene.camera); };
  }
  const room = new URLSearchParams(location.search).get('room');
  if (room) { switchTab('online'); $('on-code').value = room.toUpperCase(); }
})();
