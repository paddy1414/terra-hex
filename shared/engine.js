// Terra Hex — deterministic rules engine for the classic base game.
//
// The whole game is one JSON-serialisable state object. Every change goes through
// applyAction(state, playerId, action), which validates the move first and returns a NEW state
// (the old one is never touched) plus a list of events the client can animate.
// Randomness comes from a seeded generator stored inside the state, so a game replays identically.

import { RESOURCES, TERRAIN_RESOURCE, generateBoard, pips, cleanCustom, MAPS } from './board.js';
const MAP_SEA = Object.fromEntries(MAPS.filter(m => m.sea).map(m => [m.id, true]));
import { installCK } from './ck.js';

export { RESOURCES, pips };
export const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
  ship: { wood: 1, sheep: 1 }
};
export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4, ship: 15 };
export const BANK_PER_RESOURCE = 19;
export const DEV_DECK = { knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 };
// The 5–6 player extension: a bigger bank, a bigger deck and a building phase between turns.
export const DEV_DECK_LARGE = { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 };
export const BANK_LARGE = 24;
export const DEV_NAMES = {
  knight: 'Knight', victoryPoint: 'Victory Point', roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly'
};
export const DEFAULT_CONFIG = {
  map: 'classic', layout: 'balanced', vpTarget: 10, discardLimit: 7, turnTimer: 0,
  friendlyRobber: false,  // cannot block or rob players on 2 points or fewer
  balancedDice: false,    // rolls dealt from a shuffled deck of all 36 outcomes, fewer streaks
  hiddenHands: false      // other players' card counts are hidden
};
export const LARGE_GAME = 5; // from this many players the 5–6 player rules apply

export class RuleError extends Error {}
const fail = (msg) => { throw new RuleError(msg); };

// ---------------------------------------------------------------- randomness
export function nextRandom(state) {
  let t = (state.rng = (state.rng + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (state, n) => Math.floor(nextRandom(state) * n);
function shuffleInPlace(state, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const emptyHand = (types = RESOURCES) => Object.fromEntries(types.map(t => [t, 0]));
export const handSize = (h) => Object.values(h || {}).reduce((a, n) => a + (n || 0), 0);
export const COMMODITIES = ['paper', 'cloth', 'coin'];
/** Card types in play: the 5 resources, plus 3 commodities in Cities & Knights. */
export const kinds = (state) => state.cardTypes || RESOURCES;
/** Card count for a player, working on full states and on redacted views alike. */
export const cardCount = (p) => (p.hand ? handSize(p.hand) : (p.handCount || 0));
export const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- creation
/**
 * players: [{ name, color, isAI, ai: 'easy'|'normal'|'hard' }]  (2–4; 3–4 is the classic game)
 */
export function createGame({ seed, players, config = {} }) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 6) fail('Games need 2–6 players.');
  const cfg = { ...DEFAULT_CONFIG, ...config };
  cfg.vpTarget = Math.max(3, Math.min(20, cfg.vpTarget | 0));
  cfg.discardLimit = Math.max(5, Math.min(20, cfg.discardLimit | 0));
  ['friendlyRobber', 'balancedDice', 'hiddenHands'].forEach(k => { cfg[k] = !!cfg[k]; });
  const large = players.length >= LARGE_GAME;
  cfg.specialBuild = large;
  cfg.ck = !!cfg.ck;
  cfg.sea = !!cfg.sea || !!MAP_SEA[cfg.map];
  if (cfg.sea && cfg.ck) fail('Seafarers and Cities & Knights cannot be combined yet.');
  const bankSize = large ? BANK_LARGE : BANK_PER_RESOURCE;
  const types = cfg.ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
  const bankSizes = Object.fromEntries(types.map(t => [t, COMMODITIES.includes(t) ? (large ? 16 : 12) : bankSize]));
  const state = {
    version: 0,
    rng: (seed >>> 0) || 1,
    seed: (seed >>> 0) || 1,
    config: cfg,
    board: null,
    robber: 0,
    vOwner: [], vType: [], eOwner: [],
    players: players.map((p, id) => ({
      id, name: String(p.name || `Player ${id + 1}`).slice(0, 16), color: p.color,
      isAI: !!p.isAI, ai: p.ai || 'normal',
      hand: emptyHand(types), dev: [], knights: 0, roadLength: 0
    })),
    bank: { ...bankSizes },
    bankSize, bankSizes, cardTypes: types,
    diceBag: [], rollHistory: [],
    sbp: null,
    devDeck: [],
    phase: 'setup',
    current: 0,
    turn: 0,
    setup: { order: [], index: 0, step: 'settlement', lastVertex: null },
    rolled: false, devPlayed: false, freeRoads: 0, returnPhase: null,
    dice: null, discards: {},
    trade: null, tradeSeq: 0,
    longestRoad: null, largestArmy: null,
    winner: null,
    log: [],
    stats: {
      rolls: Array(13).fill(0),
      gained: players.map(() => emptyHand(types)),
      stolen: players.map(() => 0), lostToRobber: players.map(() => 0),
      trades: players.map(() => 0), devBought: players.map(() => 0),
      startedAt: Date.now(), endedAt: null
    }
  };
  const rand = () => nextRandom(state);
  if (cfg.map === 'custom') cfg.custom = cleanCustom(cfg.custom);
  else delete cfg.custom;
  const board = generateBoard({ map: cfg.map, layout: cfg.layout, custom: cfg.custom, sea: cfg.sea }, rand);
  state.board = board;
  state.robber = board.desert ?? 0;
  if (cfg.sea) {
    state.sOwner = board.edges.map(() => null);
    state.sBuilt = board.edges.map(() => -1);
    state.pirate = board.pirate;
    state.shipMoved = -1;
    state.gold = {};
    state.players.forEach(p => { p.islands = []; p.islandVP = 0; });
  }
  state.vOwner = board.vertices.map(() => null);
  state.vType = board.vertices.map(() => null);
  state.eOwner = board.edges.map(() => null);
  if (!cfg.ck) Object.entries(large ? DEV_DECK_LARGE : DEV_DECK).forEach(([t, n]) => { for (let i = 0; i < n; i++) state.devDeck.push(t); });
  state.devTotal = state.devDeck.length;
  if (cfg.ck) CK.init(state);
  shuffleInPlace(state, state.devDeck);

  const n = players.length;
  const start = randInt(state, n);
  const fwd = Array.from({ length: n }, (_, i) => (start + i) % n);
  state.setup.order = [...fwd, ...fwd.slice().reverse()];
  state.current = state.setup.order[0];
  log(state, `@${start} was chosen to place first.`);
  return state;
}

function log(state, msg) {
  state.log.push({ i: state.log.length ? state.log[state.log.length - 1].i + 1 : 0, turn: state.turn, msg });
  if (state.log.length > 250) state.log.splice(0, state.log.length - 250);
}

// ---------------------------------------------------------------- queries
export function piecesLeft(state, pid, kind) {
  if (kind === 'road') return PIECE_LIMITS.road - state.eOwner.filter(o => o === pid).length;
  if (kind === 'ship') return PIECE_LIMITS.ship - (state.sOwner || []).filter(o => o === pid).length;
  let n = 0;
  state.vOwner.forEach((o, v) => { if (o === pid && state.vType[v] === kind) n++; });
  return PIECE_LIMITS[kind] - n;
}

export function canAfford(hand, cost) { return Object.entries(cost).every(([r, n]) => (hand[r] || 0) >= n); }

function settlementSpotFree(state, vid) {
  if (state.vOwner[vid] !== null) return false;
  if (state.kOwner && state.kOwner[vid] !== null) return false;
  return state.board.vertices[vid].adj.every(a => state.vOwner[a] === null);
}

// ---------------------------------------------------------------- Seafarers helpers
export const isSeaTile = (state, hid) => state.board.hexes[hid].terrain === 'sea';
const touchesLand = (state, vid) => state.board.vertices[vid].hexes.some(h => !isSeaTile(state, h));
const edgeOnLand = (state, eid) => state.board.edges[eid].hexes.some(h => !isSeaTile(state, h));
const edgeAtSea = (state, eid) => state.board.edges[eid].hexes.some(h => isSeaTile(state, h));
const edgeFree = (state, eid) => state.eOwner[eid] === null && (!state.sOwner || state.sOwner[eid] === null);
const islandOfVertex = (state, vid) => { const h = state.board.vertices[vid].hexes.find(x => !isSeaTile(state, x)); return h === undefined ? -1 : state.board.hexes[h].island; };
/** Ships link from your own settlement/city, or from another of your ships through an intersection no opponent holds. */
function shipConnects(state, pid, vid, viaEdge) {
  const o = state.vOwner[vid];
  if (o === pid) return true;
  if (o !== null) return false;
  return state.board.vertices[vid].edges.some(e => e !== viaEdge && state.sOwner[e] === pid);
}
export function legalShipEdges(state, pid) {
  if (!state.config.sea) return [];
  if (state.phase === 'setup') {
    const lv = state.setup.lastVertex;
    if (lv === null || state.setup.step !== 'road') return [];
    return state.board.vertices[lv].edges.filter(e => edgeFree(state, e) && edgeAtSea(state, e));
  }
  return state.board.edges
    .filter(e => edgeFree(state, e.id) && edgeAtSea(state, e.id) && !e.hexes.includes(state.pirate) && e.v.some(v => shipConnects(state, pid, v, e.id)))
    .map(e => e.id);
}
/** A ship can move if it sits at the open end of a route, was not built this turn, and the pirate is not beside it. */
export function movableShips(state, pid) {
  if (!state.config.sea || state.shipMoved === state.turn) return [];
  return state.sOwner.map((o, e) => (o === pid ? e : -1)).filter(e => {
    if (e < 0 || state.sBuilt[e] === state.turn || state.board.edges[e].hexes.includes(state.pirate)) return false;
    return state.board.edges[e].v.some(v => state.vOwner[v] !== pid && !state.board.vertices[v].edges.some(x => x !== e && state.sOwner[x] === pid));
  });
}

export function legalSettlementVertices(state, pid, isSetup = state.phase === 'setup') {
  const out = [];
  const sea = state.config.sea;
  state.board.vertices.forEach(v => {
    if (!settlementSpotFree(state, v.id)) return;
    if (sea && !touchesLand(state, v.id)) return;
    if (isSetup && sea && !state.board.homeIslands.includes(islandOfVertex(state, v.id))) return;
    if (!isSetup && !v.edges.some(e => state.eOwner[e] === pid || (sea && state.sOwner[e] === pid))) return;
    out.push(v.id);
  });
  return out;
}

/** A road may extend from a vertex the player builds on, or through a vertex no opponent occupies. */
function vertexConnects(state, pid, vid, viaEdge) {
  const o = state.vOwner[vid];
  if (o === pid) return true;
  if (o !== null) return false; // an opponent's building cuts the network here
  if (state.kOwner && state.kOwner[vid] !== null && state.kOwner[vid] !== pid) return false; // so does an opponent's knight
  return state.board.vertices[vid].edges.some(e => e !== viaEdge && state.eOwner[e] === pid);
}

export function legalRoadEdges(state, pid) {
  if (state.phase === 'setup') {
    const lv = state.setup.lastVertex;
    if (lv === null || state.setup.step !== 'road') return [];
    return state.board.vertices[lv].edges.filter(e => edgeFree(state, e) && (!state.config.sea || edgeOnLand(state, e)));
  }
  return state.board.edges
    .filter(e => edgeFree(state, e.id) && (!state.config.sea || edgeOnLand(state, e.id)) && e.v.some(v => vertexConnects(state, pid, v, e.id)))
    .map(e => e.id);
}

export function legalCityVertices(state, pid) {
  const out = [];
  state.vOwner.forEach((o, v) => { if (o === pid && state.vType[v] === 'settlement') out.push(v); });
  return out;
}

/** Friendly Robber: players on 2 points or fewer (counting only visible points) are protected. */
export function isProtected(state, pid) {
  return !!state.config.friendlyRobber && victoryPoints(state, pid, false) <= 2;
}
function touchesProtected(state, hexId, thief) {
  if (state.config.sea && isSeaTile(state, hexId)) {
    return state.board.hexes[hexId].edges.some(e => { const o = state.sOwner[e]; return o !== null && o !== thief && isProtected(state, o); });
  }
  return state.board.hexes[hexId].vertices.some(v => {
    const o = state.vOwner[v];
    return o !== null && o !== thief && isProtected(state, o);
  });
}
export function legalRobberHexes(state, thief = state.current) {
  // Seafarers: land tiles take the robber, sea spaces take the pirate.
  const all = state.board.hexes.filter(h => (h.terrain === 'sea' ? state.config.sea && h.id !== state.pirate : h.id !== state.robber)).map(h => h.id);
  if (!state.config.friendlyRobber) return all;
  const ok = all.filter(h => !touchesProtected(state, h, thief));
  return ok.length ? ok : all; // if every tile is protected, any tile is allowed
}

/** Players the thief may pick at a tile. With hidden hands, anyone there can be picked (an empty hand yields nothing). */
export function robberVictims(state, hexId, thief) {
  const set = new Set();
  if (state.config.sea && isSeaTile(state, hexId)) {
    state.board.hexes[hexId].edges.forEach(e => {
      const o = state.sOwner[e];
      if (o === null || o === thief || isProtected(state, o)) return;
      if (state.config.hiddenHands || cardCount(state.players[o]) > 0) set.add(o);
    });
    return [...set].sort((a, b) => a - b);
  }
  state.board.hexes[hexId].vertices.forEach(v => {
    const o = state.vOwner[v];
    if (o === null || o === thief || isProtected(state, o)) return;
    if (state.config.hiddenHands || cardCount(state.players[o]) > 0) set.add(o);
  });
  return [...set].sort((a, b) => a - b);
}

/** Best bank ratio for giving away `res`: 2 with a matching harbour, 3 with a generic one, else 4. */
export function tradeRatio(state, pid, res) {
  let ratio = 4;
  if (state.config.ck) ratio = CK.tradeRatio(state, pid, res, ratio);
  state.board.ports.forEach(p => {
    if (!p.vertices.some(v => state.vOwner[v] === pid)) return;
    if (p.type === res) ratio = Math.min(ratio, 2);
    else if (p.type === 'any') ratio = Math.min(ratio, 3);
  });
  return ratio;
}
export function tradeRatios(state, pid) { return Object.fromEntries(kinds(state).map(r => [r, tradeRatio(state, pid, r)])); }
export function ownedPorts(state, pid) {
  return state.board.ports.filter(p => p.vertices.some(v => state.vOwner[v] === pid)).map(p => p.id);
}

/** Longest single trail of the player's roads; opponents' buildings stop a trail passing through. */
export function longestRoadFor(state, pid) {
  const { vertices, edges } = state.board;
  // 1 = road, 2 = ship (Seafarers: roads and ships form one trade route, joined only at your own building)
  const mine = state.eOwner.map((o, e) => (o === pid ? 1 : state.sOwner && state.sOwner[e] === pid ? 2 : 0));
  if (!mine.some(Boolean)) return 0;
  const used = new Uint8Array(edges.length);
  let best = 0;
  const walk = (vid, len, kind) => {
    if (len > best) best = len;
    if (len > 0) {
      const o = state.vOwner[vid];
      if (o !== null && o !== pid) return; // can end here but not pass through
      if (state.kOwner && state.kOwner[vid] !== null && state.kOwner[vid] !== pid) return;
    }
    for (const eid of vertices[vid].edges) {
      if (!mine[eid] || used[eid]) continue;
      if (kind && mine[eid] !== kind && state.vOwner[vid] !== pid) continue;
      used[eid] = 1;
      const e = edges[eid];
      walk(e.v[0] === vid ? e.v[1] : e.v[0], len + 1, mine[eid]);
      used[eid] = 0;
    }
  };
  const starts = new Set();
  edges.forEach(e => { if (mine[e.id]) { starts.add(e.v[0]); starts.add(e.v[1]); } });
  starts.forEach(v => walk(v, 0, 0));
  return best;
}

export function victoryPoints(state, pid, includeHidden) {
  let vp = 0;
  state.vOwner.forEach((o, v) => { if (o === pid) vp += state.vType[v] === 'city' ? 2 : 1; });
  if (state.longestRoad === pid) vp += 2;
  if (state.largestArmy === pid) vp += 2;
  if (state.config.ck) vp += CK.extraPoints(state, pid);
  if (state.config.sea) vp += state.players[pid].islandVP || 0;
  if (includeHidden) {
    const p = state.players[pid];
    if (Array.isArray(p.dev)) vp += p.dev.filter(c => c.type === 'victoryPoint').length;
  }
  return vp;
}

export function playableDevCards(state, pid) {
  if (state.current !== pid || state.devPlayed) return [];
  if (state.phase !== 'roll' && state.phase !== 'main') return [];
  const p = state.players[pid];
  const types = new Set();
  p.dev.forEach(c => {
    if (c.type === 'victoryPoint') return;
    if (c.turn >= state.turn) return; // bought this turn
    types.add(c.type);
  });
  return [...types];
}

/** Players who must act before the game can move on. */
export function pendingActors(state) {
  if (state.phase === 'over') return [];
  if (state.gold && Object.keys(state.gold).length) return Object.keys(state.gold).map(Number);
  if (state.prompts && state.prompts.length) return [state.prompts[0].pid];
  if (state.phase === 'discard') return Object.keys(state.discards).map(Number);
  return [state.current];
}

// ---------------------------------------------------------------- awards
function updateLongestRoad(state, events) {
  state.players.forEach(p => { p.roadLength = longestRoadFor(state, p.id); });
  const holder = state.longestRoad;
  const best = Math.max(...state.players.map(p => p.roadLength));
  let next = null;
  if (best >= 5) {
    if (holder !== null && state.players[holder].roadLength === best) next = holder; // holder keeps ties
    else {
      const leaders = state.players.filter(p => p.roadLength === best);
      if (leaders.length === 1) next = leaders[0].id; // a tie among challengers: nobody holds it
    }
  }
  if (next === holder) return;
  state.longestRoad = next;
  if (next !== null) log(state, `@${next} takes the Longest Road (${best} segments).`);
  else log(state, `@${holder} loses the Longest Road; nobody holds it now.`);
  events.push({ type: 'award', award: 'longestRoad', pid: next, from: holder });
}

function updateLargestArmy(state, events) {
  if (state.config.ck) return;
  const holder = state.largestArmy;
  const p = state.players[state.current];
  if (p.knights < 3) return;
  if (holder === p.id) return;
  if (holder !== null && state.players[holder].knights >= p.knights) return; // must strictly exceed
  state.largestArmy = p.id;
  log(state, `@${p.id} takes the Largest Army (${p.knights} knights).`);
  events.push({ type: 'award', award: 'largestArmy', pid: p.id, from: holder });
}

function checkWin(state, events) {
  if (state.phase === 'over' || state.phase === 'setup' || state.phase === 'specialBuild') return;
  const pid = state.current;
  const vp = victoryPoints(state, pid, true);
  if (vp >= state.config.vpTarget) {
    state.phase = 'over';
    state.winner = pid;
    state.trade = null;
    state.stats.endedAt = Date.now();
    log(state, `@${pid} wins with ${vp} victory points!`);
    events.push({ type: 'win', pid, vp });
  }
}

// ---------------------------------------------------------------- helpers
function pay(state, pid, cost) {
  const h = state.players[pid].hand;
  Object.entries(cost).forEach(([r, n]) => { h[r] -= n; state.bank[r] += n; });
}
function gain(state, pid, res, n) {
  state.players[pid].hand[res] += n;
  state.bank[res] -= n;
  state.stats.gained[pid][res] += n;
}
function cleanBundle(b, types = RESOURCES) {
  const out = {};
  if (!b || typeof b !== 'object') return out;
  types.forEach(r => {
    const n = Math.floor(Number(b[r]) || 0);
    if (n < 0) fail('Amounts cannot be negative.');
    if (n > 0) out[r] = n;
  });
  return out;
}
const bundleSize = (b) => Object.values(b).reduce((a, n) => a + n, 0);
const bundleText = (b) => Object.keys(b).filter(r => b[r]).map(r => `${b[r]} :${r}:`).join(' ');
function requireTurn(state, pid) { if (state.current !== pid) fail('It is not your turn.'); }
function requirePhase(state, ...phases) {
  if (!phases.includes(state.phase)) {
    const why = {
      roll: 'Roll the dice first.', discard: 'Waiting for players to discard.', robber: 'Move the robber first.',
      specialBuild: 'Only building is allowed between turns.',
      setup: 'Finish placing your starting pieces.', roadBuilding: 'Place your free roads first.', over: 'The game is over.'
    };
    fail(why[state.phase] || 'You cannot do that now.');
  }
}
function requireVertex(state, v) {
  if (!Number.isInteger(v) || v < 0 || v >= state.board.vertices.length) fail('Unknown intersection.');
}
function requireEdge(state, e) {
  if (!Number.isInteger(e) || e < 0 || e >= state.board.edges.length) fail('Unknown path.');
}

/** Robber stays in the desert until the first barbarian attack in Cities & Knights. */
function robberLocked(state) { return !!state.config.ck && !state.barb?.attacked; }
export { robberLocked };
/** Discard limit for a player: the house limit, plus 2 per city wall in Cities & Knights. */
export function discardLimitFor(state, pid) {
  let limit = state.config.discardLimit;
  if (state.config.ck && state.vWall) state.vWall.forEach((w, v) => { if (w && state.vOwner[v] === pid) limit += 2; });
  return limit;
}
/** A 7: everyone over their limit discards half; then the robber moves (if it may). */
function startSevenDiscards(state, events = []) {
  state.discards = {};
  state.players.forEach(p => {
    const n = handSize(p.hand);
    if (n > discardLimitFor(state, p.id)) state.discards[p.id] = Math.floor(n / 2);
  });
  state.returnPhase = 'main';
  if (Object.keys(state.discards).length) {
    state.phase = 'discard';
    events.push({ type: 'discardStart', discards: { ...state.discards } });
  } else {
    state.phase = robberLocked(state) ? 'main' : 'robber';
  }
  if (robberLocked(state)) log(state, 'The robber stays put until the barbarians first reach the island.');
}

function advanceSetup(state, events) {
  state.setup.index++;
  state.setup.lastVertex = null;
  state.setup.step = 'settlement';
  if (state.setup.index >= state.setup.order.length) {
    state.phase = 'roll';
    state.turn = 1;
    state.current = state.setup.order[0];
    log(state, `Setup complete. @${state.current} rolls first.`);
    events.push({ type: 'turn', pid: state.current, turn: 1 });
  } else {
    state.current = state.setup.order[state.setup.index];
  }
}
function endFreeRoad(state, pid) {
  state.freeRoads--;
  const roadsLeft = piecesLeft(state, pid, 'road') > 0 && legalRoadEdges(state, pid).length > 0;
  const shipsLeft = state.config.sea && piecesLeft(state, pid, 'ship') > 0 && legalShipEdges(state, pid).length > 0;
  if (state.freeRoads <= 0 || (!roadsLeft && !shipsLeft)) {
    state.freeRoads = 0;
    state.phase = state.returnPhase || 'main';
    state.returnPhase = null;
  }
}
function buildRoadMain(state, pid, edge, events) {
  if (piecesLeft(state, pid, 'road') <= 0) fail('You have no roads left (15 maximum).');
  if (state.eOwner[edge] !== null) fail('There is already a road there.');
  if (!state.board.edges[edge].v.some(v => vertexConnects(state, pid, v, edge))) {
    fail('Roads must connect to your own road, settlement or city (and cannot pass through an opponent\u2019s building).');
  }
  const free = state.phase === 'roadBuilding';
  if (!free) {
    if (!canAfford(state.players[pid].hand, COSTS.road)) fail('A road costs 1 wood and 1 brick.');
    pay(state, pid, COSTS.road);
  }
  state.eOwner[edge] = pid;
  events.push({ type: 'build', kind: 'road', id: edge, pid, free });
  log(state, free ? `@${pid} placed a free road.` : `@${pid} built a road.`);
  updateLongestRoad(state, events);
  if (free) endFreeRoad(state, pid);
  checkWin(state, events);
}
/** Seafarers: the first settlement a player founds on each island beyond home is worth 2 extra points. */
function islandBonus(state, pid, vertex, events) {
  if (!state.config.sea) return;
  const isl = islandOfVertex(state, vertex);
  const p = state.players[pid];
  if (isl < 0 || state.board.homeIslands.includes(isl) || p.islands.includes(isl)) return;
  p.islands.push(isl);
  p.islandVP += 2;
  events.push({ type: 'island', pid, island: isl });
  log(state, `@${pid} settled a new island (+2 points).`);
}

// ---------------------------------------------------------------- actions
const handlers = {
  buildSettlement(state, pid, { vertex }, events) {
    requireTurn(state, pid);
    requireVertex(state, vertex);
    if (state.phase === 'setup') {
      if (state.setup.step !== 'settlement') fail('Place your road next to the settlement you just built.');
      if (!settlementSpotFree(state, vertex)) fail('Too close: settlements need at least two road lengths between them.');
      if (state.config.sea && !legalSettlementVertices(state, pid, true).includes(vertex)) fail('Starting settlements go on your home island.');
      const second = state.setup.index >= state.players.length;
      const kind = second && state.config.ck ? 'city' : 'settlement'; // Cities & Knights: the second piece is a city
      state.vOwner[vertex] = pid; state.vType[vertex] = kind;
      state.setup.lastVertex = vertex;
      state.setup.step = 'road';
      events.push({ type: 'build', kind, id: vertex, pid });
      if (second) {
        const got = [];
        state.board.vertices[vertex].hexes.forEach(hid => {
          const res = TERRAIN_RESOURCE[state.board.hexes[hid].terrain];
          if (res && state.bank[res] > 0) { gain(state, pid, res, 1); got.push({ pid, res, n: 1, hex: hid }); }
          if (state.board.hexes[hid].terrain === 'gold') state.gold[pid] = (state.gold[pid] || 0) + 1;
        });
        if (got.length) events.push({ type: 'produce', gains: got, setup: true });
        log(state, `@${pid} placed a second ${kind} and collected ${got.map(g => `:${g.res}:`).join(' ') || 'nothing'}.`);
      } else {
        log(state, `@${pid} placed a settlement.`);
      }
      updateLongestRoad(state, events);
      return;
    }
    requirePhase(state, 'main', 'specialBuild');
    if (piecesLeft(state, pid, 'settlement') <= 0) fail('You have no settlements left (5 maximum). Upgrade one to a city.');
    if (!canAfford(state.players[pid].hand, COSTS.settlement)) fail('A settlement costs 1 wood, 1 brick, 1 sheep and 1 wheat.');
    if (state.vOwner[vertex] !== null) fail('That intersection is taken.');
    if (!settlementSpotFree(state, vertex)) fail('Too close: settlements need at least two road lengths between them.');
    if (!state.board.vertices[vertex].edges.some(e => state.eOwner[e] === pid || (state.config.sea && state.sOwner[e] === pid))) fail(state.config.sea ? 'A new settlement must touch one of your roads or ships.' : 'A new settlement must touch one of your roads.');
    if (state.config.sea && !touchesLand(state, vertex)) fail('Settlements are built on land.');
    pay(state, pid, COSTS.settlement);
    state.vOwner[vertex] = pid; state.vType[vertex] = 'settlement';
    events.push({ type: 'build', kind: 'settlement', id: vertex, pid });
    islandBonus(state, pid, vertex, events);
    log(state, `@${pid} built a settlement.`);
    updateLongestRoad(state, events);
    checkWin(state, events);
  },

  buildRoad(state, pid, { edge }, events) {
    requireTurn(state, pid);
    requireEdge(state, edge);
    if (state.phase === 'setup') {
      if (state.setup.step !== 'road') fail('Place a settlement first.');
      if (!legalRoadEdges(state, pid).includes(edge)) fail(state.config.sea && !edgeOnLand(state, edge) ? 'That path is open sea: place a ship there instead.' : 'Your starting road must touch the settlement you just placed.');
      state.eOwner[edge] = pid;
      events.push({ type: 'build', kind: 'road', id: edge, pid });
      updateLongestRoad(state, events);
      advanceSetup(state, events);
      return;
    }
    requirePhase(state, 'main', 'roadBuilding', 'specialBuild');
    if (state.config.sea && !edgeOnLand(state, edge)) fail('Roads are built on land. Build a ship on the water.');
    if (state.config.sea && state.sOwner[edge] !== null) fail('There is a ship there.');
    return buildRoadMain(state, pid, edge, events);
  },

  buildShip(state, pid, { edge }, events) {
    requireTurn(state, pid);
    requireEdge(state, edge);
    if (!state.config.sea) fail('Ships are part of Seafarers.');
    if (state.phase === 'setup') {
      if (state.setup.step !== 'road') fail('Place a settlement first.');
      if (!legalShipEdges(state, pid).includes(edge)) fail('Your starting ship must touch the settlement you just placed, on the water.');
      state.sOwner[edge] = pid;
      events.push({ type: 'build', kind: 'ship', id: edge, pid });
      updateLongestRoad(state, events);
      advanceSetup(state, events);
      return;
    }
    requirePhase(state, 'main', 'roadBuilding', 'specialBuild');
    if (piecesLeft(state, pid, 'ship') <= 0) fail('You have no ships left (15 maximum).');
    if (!edgeFree(state, edge)) fail('That path is taken.');
    if (!edgeAtSea(state, edge)) fail('Ships sail on water: build a road on land.');
    if (state.board.edges[edge].hexes.includes(state.pirate)) fail('The pirate blocks ships next to him.');
    if (!state.board.edges[edge].v.some(v => shipConnects(state, pid, v, edge))) fail('Ships must link to your settlement, city or another of your ships.');
    const free = state.phase === 'roadBuilding';
    if (!free) {
      if (!canAfford(state.players[pid].hand, COSTS.ship)) fail('A ship costs 1 wood and 1 sheep.');
      pay(state, pid, COSTS.ship);
    }
    state.sOwner[edge] = pid;
    state.sBuilt[edge] = state.turn;
    events.push({ type: 'build', kind: 'ship', id: edge, pid, free });
    log(state, free ? `@${pid} launched a free ship.` : `@${pid} built a ship.`);
    updateLongestRoad(state, events);
    if (free) endFreeRoad(state, pid);
    checkWin(state, events);
  },

  moveShip(state, pid, { from, to }, events) {
    requireTurn(state, pid);
    requirePhase(state, 'main');
    if (!state.config.sea) fail('Ships are part of Seafarers.');
    if (state.shipMoved === state.turn) fail('You can move one ship per turn.');
    if (!movableShips(state, pid).includes(from)) fail('Only a ship at the open end of a route can move (not one built this turn, nor one beside the pirate).');
    state.sOwner[from] = null;
    const ok = Number.isInteger(to) && to !== from && legalShipEdges(state, pid).includes(to);
    if (!ok) { state.sOwner[from] = pid; fail('A ship must move to another open water path linked to your route.'); }
    state.sOwner[to] = pid;
    state.sBuilt[to] = state.sBuilt[from];
    state.sBuilt[from] = -1;
    state.shipMoved = state.turn;
    events.push({ type: 'shipMoved', pid, from, to });
    log(state, `@${pid} moved a ship.`);
    updateLongestRoad(state, events);
    checkWin(state, events);
  },

  pickGold(state, pid, { cards }, events) {
    const need = state.gold && state.gold[pid];
    if (!need) fail('You have no gold to spend.');
    const b = cleanBundle(cards, RESOURCES);
    const n = Object.values(b).reduce((a, x) => a + x, 0);
    if (n !== need) fail(`Choose exactly ${need} resource${need === 1 ? '' : 's'}.`);
    if (!Object.entries(b).every(([r, k]) => state.bank[r] >= k)) fail('The bank does not have those resources.');
    Object.entries(b).forEach(([r, k]) => gain(state, pid, r, k));
    delete state.gold[pid];
    events.push({ type: 'gain', pid, resources: Object.entries(b).flatMap(([r, k]) => Array(k).fill(r)) });
    log(state, `@${pid} panned gold for ${bundleText(b)}.`);
  },

  buildCity(state, pid, { vertex }, events) {
    requireTurn(state, pid);
    requirePhase(state, 'main', 'specialBuild');
    requireVertex(state, vertex);
    if (state.vOwner[vertex] !== pid || state.vType[vertex] !== 'settlement') fail('Cities can only replace one of your own settlements.');
    if (piecesLeft(state, pid, 'city') <= 0) fail('You have no cities left (4 maximum).');
    if (!canAfford(state.players[pid].hand, COSTS.city)) fail('A city costs 2 wheat and 3 ore.');
    pay(state, pid, COSTS.city);
    state.vType[vertex] = 'city';
    events.push({ type: 'build', kind: 'city', id: vertex, pid });
    log(state, `@${pid} upgraded a settlement to a city.`);
    checkWin(state, events);
  },

  buyDev(state, pid, _a, events) {
    requireTurn(state, pid);
    if (state.config.ck) fail('Cities & Knights uses progress cards instead of development cards.');
    requirePhase(state, 'main', 'specialBuild');
    if (!state.devDeck.length) fail('The development deck is empty.');
    if (!canAfford(state.players[pid].hand, COSTS.dev)) fail('A development card costs 1 sheep, 1 wheat and 1 ore.');
    pay(state, pid, COSTS.dev);
    const type = state.devDeck.pop();
    state.players[pid].dev.push({ type, turn: state.turn });
    state.stats.devBought[pid]++;
    events.push({ type: 'devBought', pid, card: type });
    log(state, `@${pid} bought a development card.`);
    checkWin(state, events);
  },

  roll(state, pid, _a, events) {
    requireTurn(state, pid);
    requirePhase(state, 'roll');
    if (state.config.ck) return CK.roll(state, pid, events);
    let d1, d2;
    if (state.config.balancedDice) {
      // Deal from a shuffled deck of all 36 outcomes, reshuffled before it runs low,
      // and usually re-deal a total that has just come up, to break streaks.
      if (!state.diceBag || state.diceBag.length <= 8) {
        state.diceBag = [];
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) state.diceBag.push([a, b]);
        shuffleInPlace(state, state.diceBag);
      }
      let pick = state.diceBag.pop();
      const repeats = state.rollHistory.slice(-3).filter(t => t === pick[0] + pick[1]).length;
      if (repeats && nextRandom(state) < 0.4 + 0.25 * repeats) {
        state.diceBag.splice(randInt(state, state.diceBag.length - 1), 0, pick);
        pick = state.diceBag.pop();
      }
      [d1, d2] = pick;
    } else {
      d1 = randInt(state, 6) + 1; d2 = randInt(state, 6) + 1;
    }
    const total = d1 + d2;
    state.rollHistory = [...(state.rollHistory || []).slice(-11), total];
    state.dice = [d1, d2];
    state.rolled = true;
    state.stats.rolls[total]++;
    events.push({ type: 'roll', pid, dice: [d1, d2] });
    if (total === 7) {
      log(state, `@${pid} rolled 7. The robber stirs.`);
      startSevenDiscards(state, events);
      return;
    }
    // Production. If the bank cannot pay everyone a resource, nobody gets it,
    // unless only one player is owed it (they take what is left).
    const owed = {};
    state.board.hexes.forEach(h => {
      if (h.number !== total || h.id === state.robber) return;
      if (h.terrain === 'gold') {
        h.vertices.forEach(v => { const o = state.vOwner[v]; if (o !== null) state.gold[o] = (state.gold[o] || 0) + (state.vType[v] === 'city' ? 2 : 1); });
        events.push({ type: 'goldField', hex: h.id });
        return;
      }
      const res = TERRAIN_RESOURCE[h.terrain];
      if (!res) return;
      h.vertices.forEach(v => {
        const o = state.vOwner[v];
        if (o === null) return;
        const amt = state.vType[v] === 'city' ? 2 : 1;
        ((owed[res] ||= {})[o] ||= []).push({ hex: h.id, n: amt });
      });
    });
    const gains = [];
    const shortages = [];
    Object.entries(owed).forEach(([res, byPid]) => {
      const pids = Object.keys(byPid).map(Number);
      const need = pids.reduce((a, p) => a + byPid[p].reduce((s, x) => s + x.n, 0), 0);
      if (need > state.bank[res] && pids.length > 1) { shortages.push(res); return; }
      pids.forEach(p => {
        byPid[p].forEach(({ hex, n }) => {
          const give = Math.min(n, state.bank[res]);
          if (give > 0) { gain(state, p, res, give); gains.push({ pid: p, res, n: give, hex }); }
        });
      });
    });
    const blocked = state.board.hexes[state.robber].number === total;
    events.push({ type: 'produce', gains, shortages, blockedHex: blocked ? state.robber : null, number: total });
    log(state, `@${pid} rolled ${total}.`);
    shortages.forEach(r => log(state, `The bank ran short of :${r}:, so nobody collects it this roll.`));
    state.phase = 'main';
  },

  discard(state, pid, { cards }, events) {
    requirePhase(state, 'discard');
    const need = state.discards[pid];
    if (!need) fail('You do not need to discard.');
    const b = cleanBundle(cards, kinds(state));
    if (bundleSize(b) !== need) fail(`Choose exactly ${need} card${need === 1 ? '' : 's'} to discard.`);
    if (!canAfford(state.players[pid].hand, b)) fail('You do not hold those cards.');
    pay(state, pid, b);
    delete state.discards[pid];
    events.push({ type: 'discard', pid, n: need });
    log(state, `@${pid} discarded ${need} card${need === 1 ? '' : 's'}.`);
    if (!Object.keys(state.discards).length) state.phase = robberLocked(state) ? (state.returnPhase || 'main') : 'robber';
  },

  moveRobber(state, pid, { hex, victim = null }, events) {
    requireTurn(state, pid);
    requirePhase(state, 'robber');
    if (!Number.isInteger(hex) || hex < 0 || hex >= state.board.hexes.length) fail('Unknown tile.');
    if (hex === state.robber) fail('The robber must move to a different tile.');
    if (state.config.sea && hex === state.pirate) fail('The pirate must move to a different sea space.');
    if (!state.config.sea && state.board.hexes[hex].terrain === 'sea') fail('The robber stays on land.');
    if (!legalRobberHexes(state, pid).includes(hex)) fail('Friendly Robber: that tile touches a player on 2 points or fewer.');
    const victims = robberVictims(state, hex, pid);
    if (victims.length && !victims.includes(victim)) fail('Choose which player to steal from.');
    if (!victims.length && victim !== null && victim !== undefined) fail('Nobody there can be robbed.');
    const pirate = state.config.sea && isSeaTile(state, hex);
    const from = pirate ? state.pirate : state.robber;
    if (pirate) state.pirate = hex; else state.robber = hex;
    events.push({ type: pirate ? 'pirate' : 'robber', pid, hex, from });
    log(state, pirate ? `@${pid} moved the pirate.` : `@${pid} moved the robber.`);
    if (victims.length) {
      const vh = state.players[victim].hand;
      const pool = [];
      kinds(state).forEach(r => { for (let i = 0; i < vh[r]; i++) pool.push(r); });
      if (!pool.length) {
        events.push({ type: 'steal', pid, victim, res: null, empty: true });
        log(state, `@${pid} tried to rob @${victim}, who had no cards.`);
        state.phase = state.returnPhase || 'main';
        state.returnPhase = null;
        checkWin(state, events);
        return;
      }
      const res = pool[randInt(state, pool.length)];
      vh[res]--; state.players[pid].hand[res]++;
      state.stats.stolen[pid]++; state.stats.lostToRobber[victim]++;
      events.push({ type: 'steal', pid, victim, res });
      log(state, `@${pid} stole a card from @${victim}.`);
    }
    state.phase = state.returnPhase || 'main';
    state.returnPhase = null;
    checkWin(state, events);
  },

  playDev(state, pid, { card, resources, resource }, events) {
    requireTurn(state, pid);
    requirePhase(state, 'roll', 'main');
    if (card === 'victoryPoint') fail('Victory Point cards stay hidden and count automatically.');
    if (!DEV_DECK[card]) fail('Unknown card.');
    if (state.devPlayed) fail('You can only play one development card per turn.');
    const p = state.players[pid];
    const idx = p.dev.findIndex(c => c.type === card && c.turn < state.turn);
    if (idx < 0) {
      if (p.dev.some(c => c.type === card)) fail('Cards bought this turn cannot be played until your next turn.');
      fail('You do not have that card.');
    }
    // Validate card-specific input before changing anything.
    let yop = null;
    if (card === 'yearOfPlenty') {
      if (!Array.isArray(resources) || resources.length !== 2 || !resources.every(r => RESOURCES.includes(r))) fail('Pick two resources.');
      const want = {};
      resources.forEach(r => { want[r] = (want[r] || 0) + 1; });
      if (!Object.entries(want).every(([r, n]) => state.bank[r] >= n)) fail('The bank does not have those resources.');
      yop = resources;
    }
    if (card === 'monopoly' && !RESOURCES.includes(resource)) fail('Pick a resource to monopolise.');
    if (card === 'roadBuilding' && (piecesLeft(state, pid, 'road') <= 0 || !legalRoadEdges(state, pid).length) && !(state.config.sea && piecesLeft(state, pid, 'ship') > 0 && legalShipEdges(state, pid).length)) {
      fail('You have nowhere to build a road.');
    }

    p.dev.splice(idx, 1);
    state.devPlayed = true;
    (p.played ||= []).push(card);
    events.push({ type: 'devPlayed', pid, card });

    if (card === 'knight') {
      p.knights++;
      log(state, `@${pid} played a Knight.`);
      updateLargestArmy(state, events);
      state.returnPhase = state.phase;
      state.phase = 'robber';
      checkWin(state, events);
    } else if (card === 'roadBuilding') {
      state.returnPhase = state.phase;
      state.phase = 'roadBuilding';
      state.freeRoads = Math.min(2, piecesLeft(state, pid, 'road') + (state.config.sea ? piecesLeft(state, pid, 'ship') : 0));
      log(state, `@${pid} played Road Building.`);
    } else if (card === 'yearOfPlenty') {
      yop.forEach(r => gain(state, pid, r, 1));
      events.push({ type: 'gain', pid, resources: yop });
      log(state, `@${pid} played Year of Plenty and took :${yop[0]}: :${yop[1]}:.`);
    } else if (card === 'monopoly') {
      let total = 0;
      state.players.forEach(o => {
        if (o.id === pid) return;
        const n = o.hand[resource];
        if (n) { o.hand[resource] = 0; p.hand[resource] += n; total += n; }
      });
      events.push({ type: 'monopoly', pid, resource, total });
      log(state, `@${pid} played Monopoly on :${resource}: and collected ${total}.`);
    }
  },

  bankTrade(state, pid, { give, get, count = 1 }, events) {
    requireTurn(state, pid);
    requirePhase(state, 'main');
    if (!kinds(state).includes(give) || !kinds(state).includes(get)) fail('Unknown resource.');
    if (give === get) fail('Pick two different resources.');
    const n = Math.floor(Number(count));
    if (!(n >= 1 && n <= 19)) fail('Invalid amount.');
    const ratio = tradeRatio(state, pid, give);
    const hand = state.players[pid].hand;
    if (hand[give] < ratio * n) fail(`You need ${ratio * n} ${give} for that trade (${ratio}:1).`);
    if (state.bank[get] < n) fail(`The bank only has ${state.bank[get]} ${get}.`);
    hand[give] -= ratio * n; state.bank[give] += ratio * n;
    hand[get] += n; state.bank[get] -= n;
    state.stats.trades[pid]++;
    events.push({ type: 'bankTrade', pid, give, get, ratio, count: n });
    log(state, `@${pid} traded ${ratio * n} :${give}: with the ${ratio === 4 ? 'bank' : 'harbour'} for ${n} :${get}:.`);
  },

  offerTrade(state, pid, { give, get, to = null }, events) {
    requireTurn(state, pid);
    requirePhase(state, 'main');
    const g = cleanBundle(give, kinds(state)), w = cleanBundle(get, kinds(state));
    if (!bundleSize(g) || !bundleSize(w)) fail('A trade needs cards on both sides (no gifts).');
    if (kinds(state).some(r => g[r] && w[r])) fail('You cannot give and ask for the same resource.');
    if (!canAfford(state.players[pid].hand, g)) fail('You do not hold the cards you are offering.');
    let targets = null;
    if (Array.isArray(to) && to.length) {
      targets = [...new Set(to.map(Number))].filter(t => t !== pid && state.players[t]);
      if (!targets.length) fail('Pick at least one other player.');
    }
    state.trade = { id: ++state.tradeSeq, from: pid, give: g, get: w, to: targets, responses: {} };
    events.push({ type: 'tradeOffer', trade: clone(state.trade) });
    log(state, `@${pid} offers ${bundleText(g)} for ${bundleText(w)}.`);
  },

  respondTrade(state, pid, { id, answer, give, get }, events) {
    requirePhase(state, 'main');
    const t = state.trade;
    if (!t || t.id !== id) fail('That offer is no longer open.');
    if (pid === t.from) fail('You made this offer.');
    if (t.to && !t.to.includes(pid)) fail('This offer was not made to you.');
    if (answer === 'accept') {
      if (!canAfford(state.players[pid].hand, t.get)) fail('You do not hold the cards asked for.');
      t.responses[pid] = { answer: 'accept' };
    } else if (answer === 'reject') {
      t.responses[pid] = { answer: 'reject' };
    } else if (answer === 'counter') {
      const g = cleanBundle(give, kinds(state)), w = cleanBundle(get, kinds(state)); // from the offerer's point of view
      if (!bundleSize(g) || !bundleSize(w)) fail('A counteroffer needs cards on both sides.');
      if (kinds(state).some(r => g[r] && w[r])) fail('You cannot give and ask for the same resource.');
      if (!canAfford(state.players[pid].hand, w)) fail('You do not hold the cards you are offering.');
      t.responses[pid] = { answer: 'counter', give: g, get: w };
    } else fail('Unknown answer.');
    events.push({ type: 'tradeResponse', pid, id, answer });
    if (answer === 'counter') {
      const r = t.responses[pid];
      log(state, `@${pid} counters: ${bundleText(r.get)} for ${bundleText(r.give)}.`);
    }
  },

  acceptTrade(state, pid, { id, partner }, events) {
    requireTurn(state, pid);
    requirePhase(state, 'main');
    const t = state.trade;
    if (!t || t.id !== id) fail('That offer is no longer open.');
    const r = t.responses[partner];
    if (!r || (r.answer !== 'accept' && r.answer !== 'counter')) fail('That player has not agreed to a trade.');
    const give = r.answer === 'counter' ? r.give : t.give;
    const get = r.answer === 'counter' ? r.get : t.get;
    const me = state.players[pid].hand, them = state.players[partner].hand;
    if (!canAfford(me, give)) fail('You no longer hold the cards for this trade.');
    if (!canAfford(them, get)) fail('They no longer hold the cards for this trade.');
    Object.entries(give).forEach(([res, n]) => { me[res] -= n; them[res] += n; });
    Object.entries(get).forEach(([res, n]) => { them[res] -= n; me[res] += n; });
    state.stats.trades[pid]++; state.stats.trades[partner]++;
    state.trade = null;
    events.push({ type: 'trade', pid, partner, give, get });
    log(state, `@${pid} traded ${bundleText(give)} to @${partner} for ${bundleText(get)}.`);
  },

  cancelTrade(state, pid, _a, events) {
    requireTurn(state, pid);
    if (!state.trade) return;
    state.trade = null;
    events.push({ type: 'tradeCancel', pid });
  },

  endTurn(state, pid, _a, events) {
    requireTurn(state, pid);
    requirePhase(state, 'main', 'specialBuild');
    state.trade = null;
    if (state.config.ck) CK.endTurn(state);
    const n = state.players.length;
    if (state.config.specialBuild) {
      // 5–6 players: after each turn, every other player in order may build (no trading, no cards played).
      if (state.phase === 'main') {
        state.sbp = { owner: pid, queue: Array.from({ length: n - 1 }, (_, i) => (pid + 1 + i) % n) };
      }
      const next = state.sbp.queue.shift();
      if (next !== undefined) {
        state.phase = 'specialBuild';
        state.current = next;
        events.push({ type: 'specialBuild', pid: next });
        return;
      }
      state.current = state.sbp.owner;
      state.sbp = null;
    }
    state.current = (state.current + 1) % n;
    state.turn++;
    state.rolled = false;
    state.devPlayed = false;
    state.dice = null;
    state.phase = 'roll';
    events.push({ type: 'turn', pid: state.current, turn: state.turn });
    checkWin(state, events); // a player who reached the target on someone else's turn wins now
  }
};

// Cities & Knights adds its actions to `handlers` and answers the CK.* hooks used above.
const { CK, helpers: CKH } = installCK({
  fail, log, handlers, pay, gain, canAfford, piecesLeft, legalRoadEdges, robberVictims, legalRobberHexes,
  updateLongestRoad, checkWin, randInt, shuffleInPlace, requireTurn, requirePhase, victoryPoints, handSize, kinds,
  discardLimitFor, robberLocked, settlementSpotFree, clone, startSevenDiscards, payToBank: pay
});
export { CKH };
export const ACTION_TYPES = Object.keys(handlers);

/**
 * Applies one action. Never mutates `state`.
 * Returns { ok: true, state, events } or { ok: false, error }.
 */
export function applyAction(state, pid, action) {
  if (!action || typeof action !== 'object' || !handlers[action.type]) return { ok: false, error: 'Unknown action.' };
  if (!Number.isInteger(pid) || !state.players[pid]) return { ok: false, error: 'Unknown player.' };
  if (state.phase === 'over') return { ok: false, error: 'The game is over.' };
  if (state.gold && Object.keys(state.gold).length && !['pickGold', 'respondTrade'].includes(action.type)) {
    return { ok: false, error: state.gold[pid] ? 'Choose your gold-field resources first.' : 'Waiting for players to choose their gold.' };
  }
  if (state.prompts && state.prompts.length && action.type !== 'answer') {
    const p = state.prompts[0];
    if (!(action.type === 'respondTrade')) return { ok: false, error: p.pid === pid ? 'Answer the question on screen first.' : `Waiting for ${state.players[p.pid].name} to choose.` };
  }
  const next = clone(state);
  const events = [];
  try {
    handlers[action.type](next, pid, action, events);
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, error: err.message };
    throw err;
  }
  next.version = state.version + 1;
  return { ok: true, state: next, events };
}

// ---------------------------------------------------------------- views
/** What player `pid` may see: own hand and cards; for others only counts. pid = null → spectator. */
export function viewFor(state, pid) {
  const v = clone(state);
  delete v.rng;
  delete v.seed;
  v.devDeckCount = state.devDeck.length;
  delete v.devDeck;
  delete v.diceBag; // would reveal upcoming rolls
  if (state.config.ck) {
    v.progCounts = Object.fromEntries(Object.entries(state.prog).map(([d, cards]) => [d, cards.length]));
    delete v.prog;
    delete v.forcedDice;
    (v.prompts || []).forEach(p => { if (p.pid !== pid) delete p.reveal; });
  }
  v.players.forEach(p => {
    p.handCount = handSize(p.hand);
    p.devCount = p.dev.length;
    p.vp = victoryPoints(state, p.id, false);
    if (p.id !== pid && state.phase !== 'over') {
      p.hand = null;
      p.dev = null;
      if (state.config.hiddenHands) p.handCount = null;
    }
    if (state.config.ck) {
      p.progCount = (state.players[p.id].prog || []).length;
      if (p.id !== pid && state.phase !== 'over') p.prog = null;
    }
  });
  if (state.phase === 'over') v.players.forEach(p => { p.vpTotal = victoryPoints(state, p.id, true); });
  return v;
}

/** Hides private details of events from players who should not see them. */
export function eventsFor(events, pid) {
  return events.map(e => {
    if (e.type === 'steal' && e.pid !== pid && e.victim !== pid) return { ...e, res: null };
    if (e.type === 'devBought' && e.pid !== pid) return { ...e, card: null };
    return e;
  });
}

/** Invariant check used by tests and the server: resources are conserved, pieces within limits. */
export function checkInvariants(state) {
  const problems = [];
  kinds(state).forEach(r => {
    const total = state.bank[r] + state.players.reduce((a, p) => a + p.hand[r], 0);
    const want = state.bankSizes ? state.bankSizes[r] : state.bankSize;
    if (total !== want) problems.push(`${r} total ${total}`);
    if (state.bank[r] < 0) problems.push(`bank ${r} negative`);
    state.players.forEach(p => { if (p.hand[r] < 0) problems.push(`p${p.id} ${r} negative`); });
  });
  const devTotal = state.devDeck.length + state.players.reduce((a, p) => a + p.dev.length + (p.played || []).length, 0);
  if (devTotal !== state.devTotal) problems.push(`dev cards ${devTotal}`);
  state.players.forEach(p => {
    ['road', 'settlement', 'city'].forEach(k => { if (piecesLeft(state, p.id, k) < 0) problems.push(`p${p.id} too many ${k}s`); });
  });
  state.board.vertices.forEach(v => {
    if (state.vOwner[v.id] !== null && v.adj.some(a => state.vOwner[a] !== null)) problems.push(`distance rule at ${v.id}`);
  });
  if (state.config.ck) problems.push(...CK.invariants(state));
  if (state.config.sea) {
    state.players.forEach(p => { if (piecesLeft(state, p.id, 'ship') < 0) problems.push(`p${p.id} too many ships`); });
    state.sOwner.forEach((o, e) => { if (o !== null && state.eOwner[e] !== null) problems.push(`road and ship on ${e}`); });
    state.vOwner.forEach((o, v) => { if (o !== null && !touchesLand(state, v)) problems.push(`building at sea ${v}`); });
    if (!isSeaTile(state, state.pirate)) problems.push('pirate on land');
    if (isSeaTile(state, state.robber)) problems.push('robber at sea');
  }
  return problems;
}
