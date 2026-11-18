// Terra Hex — AI opponents. Each call returns ONE action for the engine (or null).
// Levels: easy (loose, random-ish), normal (solid fundamentals), hard (scarcity, ports, army race, trading).

import { RESOURCES, TERRAIN_RESOURCE, pips } from './board.js';
import { ckDecide } from './ai_ck.js';
import {
  COSTS, canAfford, handSize, cardCount, legalSettlementVertices, legalRoadEdges, legalCityVertices,
  legalRobberHexes, robberVictims, tradeRatio, piecesLeft, victoryPoints, playableDevCards,
  legalShipEdges
} from './engine.js';

const LEVEL = { easy: 0, normal: 1, hard: 2 };

function makeRand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Memory kept between calls by the controller (one per AI seat). */
export function createAIMemory(seed = Date.now()) {
  return { rand: makeRand(seed), offersThisTurn: 0, turn: -1, tradeSkip: {} };
}

// ---------------------------------------------------------------- evaluation
function resourcePips(state) {
  const out = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  state.board.hexes.forEach(h => { const r = TERRAIN_RESOURCE[h.terrain]; if (r) out[r] += pips(h.number); });
  return out;
}

function productionOf(state, pid) {
  const out = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  state.vOwner.forEach((o, v) => {
    if (o !== pid) return;
    const mult = state.vType[v] === 'city' ? 2 : 1;
    state.board.vertices[v].hexes.forEach(hid => {
      const h = state.board.hexes[hid];
      const r = TERRAIN_RESOURCE[h.terrain];
      if (r && hid !== state.robber) out[r] += pips(h.number) * mult;
    });
  });
  return out;
}

function vertexValue(state, pid, vid, level) {
  const v = state.board.vertices[vid];
  const scarcity = resourcePips(state);
  const prod = productionOf(state, pid);
  const early = state.phase === 'setup' || state.turn < 25;
  let score = 0;
  const seen = new Set();
  v.hexes.forEach(hid => {
    const h = state.board.hexes[hid];
    const r = TERRAIN_RESOURCE[h.terrain];
    if (h.terrain === 'gold') { score += pips(h.number) * 1.35 * (hid === state.robber ? 0.4 : 1) + 0.6; return; }
    if (!r) return;
    let w = 1;
    if (level >= 1) {
      if (early && (r === 'wood' || r === 'brick')) w += 0.15;
      if (!early && (r === 'wheat' || r === 'ore')) w += 0.2;
      if (prod[r] === 0) w += 0.35; // diversity
    }
    if (level >= 2) w *= 1 + Math.max(-0.25, Math.min(0.4, (11 - scarcity[r]) / 20)); // scarce resources matter more
    const p = pips(h.number) * (hid === state.robber ? 0.4 : 1);
    score += p * w;
    if (!seen.has(r)) { seen.add(r); score += 0.4; }
  });
  if (v.port !== null) {
    const port = state.board.ports[v.port];
    if (port.type === 'any') score += level >= 1 ? 1.2 : 0.5;
    else score += (prod[port.type] + v.hexes.filter(h => TERRAIN_RESOURCE[state.board.hexes[h].terrain] === port.type).length * 3) > 4 ? 2.5 : 0.6;
  }
  return score;
}

function deficit(hand, cost) {
  return Object.entries(cost).reduce((a, [r, n]) => a + Math.max(0, n - (hand[r] || 0)), 0);
}

/** BFS over buildable edges from the player's network to find the best reachable settlement spot. */
function roadPlan(state, pid, level, maxDepth = 3) {
  const { vertices, edges } = state.board;
  const start = new Set();
  edges.forEach(e => { if (state.eOwner[e.id] === pid) e.v.forEach(v => { const o = state.vOwner[v]; if (o === null || o === pid) start.add(v); }); });
  state.vOwner.forEach((o, v) => { if (o === pid) start.add(v); });
  const dist = new Map(), firstEdge = new Map();
  const queue = [];
  start.forEach(v => { dist.set(v, 0); queue.push(v); });
  while (queue.length) {
    const v = queue.shift();
    const d = dist.get(v);
    if (d >= maxDepth) continue;
    const o = state.vOwner[v];
    if (o !== null && o !== pid && d > 0) continue;
    for (const eid of vertices[v].edges) {
      if (state.eOwner[eid] !== null) continue;
      if (state.config.sea && (state.sOwner[eid] !== null || !edges[eid].hexes.some(h => state.board.hexes[h].terrain !== 'sea'))) continue;
      const e = edges[eid];
      const w = e.v[0] === v ? e.v[1] : e.v[0];
      if (dist.has(w)) continue;
      dist.set(w, d + 1);
      firstEdge.set(w, d === 0 ? eid : firstEdge.get(v));
      queue.push(w);
    }
  }
  let best = null;
  dist.forEach((d, v) => {
    if (d === 0) return;
    if (state.vOwner[v] !== null || vertices[v].adj.some(a => state.vOwner[a] !== null)) return;
    const val = vertexValue(state, pid, v, level) / (1 + 0.6 * (d - 1));
    if (!best || val > best.val) best = { val, vertex: v, edge: firstEdge.get(v), dist: d };
  });
  return best;
}

function bestRoadEdge(state, pid, level) {
  const legal = legalRoadEdges(state, pid);
  if (!legal.length) return null;
  const plan = roadPlan(state, pid, level);
  if (plan && legal.includes(plan.edge)) return plan.edge;
  // No target: extend toward open land / longest road.
  let best = legal[0], bestVal = -Infinity;
  legal.forEach(eid => {
    const e = state.board.edges[eid];
    const val = e.v.reduce((a, v) => a + (state.vOwner[v] === null ? vertexValue(state, pid, v, level) * 0.3 : 0), 0) + e.hexes.length;
    if (val > bestVal) { bestVal = val; best = eid; }
  });
  return best;
}

/** Seafarers: the best settlement spot reachable by ship, preferring islands we have not settled. */
function shipPlan(state, pid, level, maxDepth = 6) {
  if (!state.config.sea) return null;
  const { vertices, edges, hexes } = state.board;
  const sea = (h) => hexes[h].terrain === 'sea';
  const dist = new Map(), first = new Map(), queue = [];
  state.vOwner.forEach((o, v) => { if (o === pid) { dist.set(v, 0); queue.push(v); } });
  state.sOwner.forEach((o, e) => { if (o === pid) edges[e].v.forEach(v => { if (!dist.has(v) && state.vOwner[v] === null) { dist.set(v, 0); queue.push(v); } }); });
  while (queue.length) {
    const v = queue.shift(), d = dist.get(v);
    if (d >= maxDepth) continue;
    if (d > 0 && state.vOwner[v] !== null && state.vOwner[v] !== pid) continue;
    for (const eid of vertices[v].edges) {
      const e = edges[eid];
      if (state.eOwner[eid] !== null || state.sOwner[eid] !== null || !e.hexes.some(sea) || e.hexes.includes(state.pirate)) continue;
      const w = e.v[0] === v ? e.v[1] : e.v[0];
      if (dist.has(w)) continue;
      dist.set(w, d + 1); first.set(w, d === 0 ? eid : first.get(v)); queue.push(w);
    }
  }
  const me = state.players[pid];
  let best = null;
  dist.forEach((d, v) => {
    if (d === 0 || state.vOwner[v] !== null || vertices[v].adj.some(a => state.vOwner[a] !== null)) return;
    const land = vertices[v].hexes.find(h => !sea(h));
    if (land === undefined) return;
    const isl = hexes[land].island;
    const bonus = !state.board.homeIslands.includes(isl) && !me.islands.includes(isl) ? 5 : 0;
    const val = (vertexValue(state, pid, v, level) + bonus) / (1 + 0.45 * (d - 1));
    if (!best || val > best.val) best = { val, vertex: v, edge: first.get(v), dist: d };
  });
  return best;
}

/** What the AI is saving for right now. */
function chooseGoal(state, pid, level) {
  const settleSpots = legalSettlementVertices(state, pid, false);
  const canSettle = piecesLeft(state, pid, 'settlement') > 0;
  const goals = [];
  if (legalCityVertices(state, pid).length && piecesLeft(state, pid, 'city') > 0) goals.push({ kind: 'city', cost: COSTS.city, weight: 1.15 });
  if (canSettle && settleSpots.length) goals.push({ kind: 'settlement', cost: COSTS.settlement, weight: 1.25 });
  if (canSettle && !settleSpots.length && piecesLeft(state, pid, 'road') > 0) {
    const plan = roadPlan(state, pid, level);
    if (plan) goals.push({ kind: 'road', cost: COSTS.road, weight: 1.0, plan });
  }
  if (state.config.sea && canSettle && piecesLeft(state, pid, 'ship') > 0) {
    const sp = shipPlan(state, pid, level);
    if (sp && (!settleSpots.length || sp.val > 9)) goals.push({ kind: 'ship', cost: COSTS.ship, weight: 1.05, plan: sp });
  }
  if ((state.devDeck ? state.devDeck.length : state.devDeckCount) > 0) goals.push({ kind: 'dev', cost: COSTS.dev, weight: level >= 2 ? 0.85 : 0.7 });
  if (!goals.length) return null;
  const hand = state.players[pid].hand;
  goals.forEach(g => { g.score = g.weight * 10 - deficit(hand, g.cost) * 3; });
  goals.sort((a, b) => b.score - a.score);
  return goals[0];
}

function surplus(hand, cost) {
  const out = {};
  RESOURCES.forEach(r => { out[r] = Math.max(0, (hand[r] || 0) - (cost[r] || 0)); });
  return out;
}

// ---------------------------------------------------------------- decisions
function pickTop(list, scoreFn, level, rand) {
  const scored = list.map(x => ({ x, s: scoreFn(x) })).sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  if (level === 0 && scored.length > 1 && rand() < 0.45) return scored[Math.floor(rand() * Math.min(3, scored.length))].x;
  return scored[0].x;
}

function chooseRobber(state, pid, level, rand) {
  const leaderVp = Math.max(...state.players.filter(p => p.id !== pid).map(p => victoryPoints(state, p.id, false)));
  const hexScore = (hid) => {
    const h = state.board.hexes[hid];
    let s = 0;
    if (h.terrain === 'sea') {
      h.edges.forEach(e => { const o = state.sOwner[e]; if (o === null) return; s += o === pid ? -4 : 1.2; });
      return s - 1;
    }
    h.vertices.forEach(v => {
      const o = state.vOwner[v];
      if (o === null) return;
      const mult = state.vType[v] === 'city' ? 2 : 1;
      if (o === pid) s -= 6 * mult;
      else {
        const vp = victoryPoints(state, o, false);
        s += pips(h.number) * mult * (level >= 1 && vp === leaderVp ? 1.6 : 1) + (cardCount(state.players[o]) > 0 ? 1 : 0);
      }
    });
    return s;
  };
  const hex = pickTop(legalRobberHexes(state), hexScore, level, rand);
  const victims = robberVictims(state, hex, pid);
  let victim = null;
  if (victims.length) {
    victim = victims.slice().sort((a, b) =>
      (victoryPoints(state, b, false) - victoryPoints(state, a, false)) ||
      (cardCount(state.players[b]) - cardCount(state.players[a])))[0];
  }
  return { type: 'moveRobber', hex, victim };
}

function chooseDiscard(state, pid, level) {
  const need = state.discards[pid];
  const hand = { ...state.players[pid].hand };
  const goal = chooseGoal(state, pid, level);
  const keep = goal ? goal.cost : {};
  const out = {};
  for (let i = 0; i < need; i++) {
    let pick = null, best = -Infinity;
    Object.keys(hand).forEach(r => {
      if (!hand[r]) return;
      const extra = hand[r] - (keep[r] || 0);
      const s = extra * 2 + hand[r] * 0.1 - (['paper', 'cloth', 'coin'].includes(r) ? 2.5 : 0);
      if (s > best) { best = s; pick = r; }
    });
    hand[pick]--; out[pick] = (out[pick] || 0) + 1;
  }
  return { type: 'discard', cards: out };
}

function setupDecision(state, pid, level, rand) {
  if (state.setup.step === 'settlement') {
    const legal = legalSettlementVertices(state, pid, true);
    const vertex = pickTop(legal, v => vertexValue(state, pid, v, level), level, rand);
    return { type: 'buildSettlement', vertex };
  }
  const lv = state.setup.lastVertex;
  const legal = legalRoadEdges(state, pid);
  const edge = pickTop(legal, eid => {
    const e = state.board.edges[eid];
    const far = e.v[0] === lv ? e.v[1] : e.v[0];
    let best = 0;
    state.board.vertices[far].adj.forEach(w => {
      if (w === lv) return;
      if (state.vOwner[w] === null && state.board.vertices[w].adj.every(a => state.vOwner[a] === null)) {
        best = Math.max(best, vertexValue(state, pid, w, level));
      }
    });
    return best + (rand() * 0.01);
  }, level, rand);
  return { type: 'buildRoad', edge };
}

function tradeValue(state, pid, hand, level) {
  const goal = chooseGoal(state, pid, level);
  let v = handSize(hand) * 0.35;
  if (goal) v -= deficit(hand, goal.cost) * 2.2;
  if (handSize(hand) > state.config.discardLimit) v -= (handSize(hand) - state.config.discardLimit) * 0.5;
  return v;
}

/** Should `pid` accept the offer currently on the table? Returns an action or null. */
export function respondToTrade(state, pid, memo) {
  const t = state.trade;
  if (!t || t.from === pid || t.responses[pid]) return null;
  if (t.to && !t.to.includes(pid)) return null;
  const p = state.players[pid];
  const level = LEVEL[p.ai] ?? 1;
  const rand = memo?.rand || Math.random;
  if (!canAfford(p.hand, t.get)) return { type: 'respondTrade', id: t.id, answer: 'reject' };
  const theirVp = victoryPoints(state, t.from, false);
  if (theirVp >= state.config.vpTarget - 2 && level >= 1) return { type: 'respondTrade', id: t.id, answer: 'reject' };
  const after = { ...p.hand };
  Object.entries(t.get).forEach(([r, n]) => { after[r] -= n; });
  Object.entries(t.give).forEach(([r, n]) => { after[r] += n; });
  const gainV = tradeValue(state, pid, after, level) - tradeValue(state, pid, p.hand, level);
  const threshold = level === 0 ? -0.5 + rand() : level === 1 ? 0.3 : 0.6;
  return { type: 'respondTrade', id: t.id, answer: gainV > threshold ? 'accept' : 'reject' };
}

/** The next action for AI player `pid`, or null if it has nothing to do. */
export function decide(state, pid, memo = createAIMemory()) {
  const p = state.players[pid];
  const level = LEVEL[p.ai] ?? 1;
  const rand = memo.rand;
  if (memo.turn !== state.turn) { memo.turn = state.turn; memo.offersThisTurn = 0; }

  if (state.phase === 'over') return null;
  if (state.config.ck) {
    const a = ckDecide(state, pid, memo, level);
    if (a !== undefined) return a;
  }
  if (state.gold && state.gold[pid]) {
    const goal = chooseGoal(state, pid, level);
    const want = [];
    if (goal) Object.entries(goal.cost).forEach(([r, n]) => { for (let i = state.players[pid].hand[r]; i < n; i++) want.push(r); });
    ['ore', 'wheat', 'sheep', 'brick', 'wood'].forEach(r => want.push(r));
    const cards = {};
    let left = state.gold[pid];
    for (const r of want) { if (left <= 0) break; if (state.bank[r] - (cards[r] || 0) > 0) { cards[r] = (cards[r] || 0) + 1; left--; } }
    return { type: 'pickGold', cards };
  }
  if (state.gold && Object.keys(state.gold).length) return null;
  if (state.phase === 'discard') return state.discards[pid] ? chooseDiscard(state, pid, level) : null;
  if (state.current !== pid) return respondToTrade(state, pid, memo);
  if (state.phase === 'setup') return setupDecision(state, pid, level, rand);
  if (state.phase === 'robber') return chooseRobber(state, pid, level, rand);
  if (state.phase === 'roadBuilding') {
    const sp = shipPlan(state, pid, level);
    if (sp && legalShipEdges(state, pid).includes(sp.edge) && !legalSettlementVertices(state, pid, false).length) return { type: 'buildShip', edge: sp.edge };
    const edge = bestRoadEdge(state, pid, level);
    if (edge !== null) return { type: 'buildRoad', edge };
    const ships = legalShipEdges(state, pid);
    return ships.length ? { type: 'buildShip', edge: ships[0] } : null;
  }

  const hand = p.hand;
  const playable = playableDevCards(state, pid);
  const robberOnMe = state.board.hexes[state.robber].vertices.some(v => state.vOwner[v] === pid) && state.board.hexes[state.robber].number;

  if (state.phase === 'specialBuild') {
    // Between turns (5–6 players): build only if it is clearly worth it, then pass.
    if (canAfford(hand, COSTS.city) && piecesLeft(state, pid, 'city') > 0 && legalCityVertices(state, pid).length) {
      return { type: 'buildCity', vertex: pickTop(legalCityVertices(state, pid), v => vertexValue(state, pid, v, level), level, rand) };
    }
    const spots = legalSettlementVertices(state, pid, false);
    if (canAfford(hand, COSTS.settlement) && piecesLeft(state, pid, 'settlement') > 0 && spots.length) {
      return { type: 'buildSettlement', vertex: pickTop(spots, v => vertexValue(state, pid, v, level), level, rand) };
    }
    if (canAfford(hand, COSTS.road) && piecesLeft(state, pid, 'road') > 0 && !spots.length && roadPlan(state, pid, level)) {
      const edge = bestRoadEdge(state, pid, level);
      if (edge !== null) return { type: 'buildRoad', edge };
    }
    if (handSize(hand) > state.config.discardLimit && canAfford(hand, COSTS.dev) && (state.devDeck ? state.devDeck.length : state.devDeckCount) > 0) return { type: 'buyDev' };
    return { type: 'endTurn' };
  }

  if (state.phase === 'roll') {
    if (playable.includes('knight') && level >= 1 && robberOnMe) return { type: 'playDev', card: 'knight' };
    return { type: 'roll' };
  }

  // ----- main phase
  // 1. Finish an open trade we proposed.
  if (state.trade && state.trade.from === pid) {
    const t = state.trade;
    const accepted = Object.entries(t.responses).find(([, r]) => r.answer === 'accept');
    if (accepted) return { type: 'acceptTrade', id: t.id, partner: Number(accepted[0]) };
    // Weigh counteroffers: take the best one that improves our hand.
    let bestCounter = null, bestGain = level === 0 ? 0 : 0.2;
    Object.entries(t.responses).forEach(([who, r]) => {
      if (r.answer !== 'counter' || !canAfford(hand, r.give)) return;
      if (level >= 1 && victoryPoints(state, Number(who), false) >= state.config.vpTarget - 2) return;
      const after = { ...hand };
      Object.entries(r.give).forEach(([res, n]) => { after[res] -= n; });
      Object.entries(r.get).forEach(([res, n]) => { after[res] += n; });
      const g = tradeValue(state, pid, after, level) - tradeValue(state, pid, hand, level);
      if (g > bestGain) { bestGain = g; bestCounter = Number(who); }
    });
    if (bestCounter !== null) return { type: 'acceptTrade', id: t.id, partner: bestCounter };
    const others = state.players.filter(o => o.id !== pid && (!t.to || t.to.includes(o.id)));
    const humansPending = others.some(o => !o.isAI && !t.responses[o.id]);
    memo.tradeWait = (memo.tradeWait || 0) + 1;
    if (humansPending && memo.tradeWait < 8) return { type: 'wait' };
    memo.tradeWait = 0;
    return { type: 'cancelTrade' };
  }

  // 2. Development cards.
  if (playable.length && !state.devPlayed) {
    if (playable.includes('knight') && (robberOnMe || (level >= 2 && p.knights + 1 >= 3 &&
      (state.largestArmy === null || state.players[state.largestArmy].knights <= p.knights)))) {
      return { type: 'playDev', card: 'knight' };
    }
    if (playable.includes('monopoly')) {
      let best = null, bestN = 0;
      RESOURCES.forEach(r => {
        const n = state.players.reduce((a, o) => a + (o.id === pid ? 0 : o.hand ? o.hand[r] : (o.handCount || 0) / 5), 0);
        if (n > bestN) { bestN = n; best = r; }
      });
      if (best && bestN >= (level >= 2 ? 3 : 4)) return { type: 'playDev', card: 'monopoly', resource: best };
    }
    if (playable.includes('yearOfPlenty')) {
      const goal = chooseGoal(state, pid, level);
      const want = [];
      if (goal) {
        Object.entries(goal.cost).forEach(([r, n]) => { for (let i = hand[r]; i < n; i++) want.push(r); });
      }
      while (want.length < 2) want.push(['ore', 'wheat', 'sheep', 'wood', 'brick'][want.length]);
      const pick = want.slice(0, 2);
      const need = {};
      pick.forEach(r => { need[r] = (need[r] || 0) + 1; });
      if (Object.entries(need).every(([r, n]) => state.bank[r] >= n)) return { type: 'playDev', card: 'yearOfPlenty', resources: pick };
    }
    if (playable.includes('roadBuilding') && piecesLeft(state, pid, 'road') >= 1 && legalRoadEdges(state, pid).length &&
      (!legalSettlementVertices(state, pid, false).length || level === 0)) {
      return { type: 'playDev', card: 'roadBuilding' };
    }
  }

  // 3. Build.
  if (canAfford(hand, COSTS.city) && piecesLeft(state, pid, 'city') > 0) {
    const spots = legalCityVertices(state, pid);
    if (spots.length) return { type: 'buildCity', vertex: pickTop(spots, v => vertexValue(state, pid, v, level), level, rand) };
  }
  if (canAfford(hand, COSTS.settlement) && piecesLeft(state, pid, 'settlement') > 0) {
    const spots = legalSettlementVertices(state, pid, false);
    if (spots.length) return { type: 'buildSettlement', vertex: pickTop(spots, v => vertexValue(state, pid, v, level), level, rand) };
  }
  const goal = chooseGoal(state, pid, level);
  if (state.config.sea && goal && goal.kind === 'ship' && canAfford(hand, COSTS.ship) && legalShipEdges(state, pid).includes(goal.plan.edge)) {
    return { type: 'buildShip', edge: goal.plan.edge };
  }
  if (canAfford(hand, COSTS.road) && piecesLeft(state, pid, 'road') > 0) {
    const hasSpot = legalSettlementVertices(state, pid, false).length > 0;
    const plan = roadPlan(state, pid, level);
    const wantRoad = (!hasSpot && plan) ||
      (level >= 2 && state.longestRoad !== pid && p.roadLength >= 4) ||
      (goal && goal.kind === 'road');
    if (wantRoad && !(goal && goal.kind === 'city' && deficit(hand, COSTS.city) <= 1)) {
      const edge = bestRoadEdge(state, pid, level);
      if (edge !== null) return { type: 'buildRoad', edge };
    }
  }
  if (canAfford(hand, COSTS.dev) && (state.devDeck ? state.devDeck.length : state.devDeckCount) > 0) {
    const savingCity = goal && goal.kind === 'city' && deficit(hand, COSTS.city) <= 1;
    const savingSettle = goal && goal.kind === 'settlement' && deficit(hand, COSTS.settlement) <= 1;
    if (!savingCity && !savingSettle) return { type: 'buyDev' };
  }

  // 4. Trade toward the goal.
  if (goal) {
    const missing = RESOURCES.filter(r => (goal.cost[r] || 0) > hand[r]);
    const spare = surplus(hand, goal.cost);
    // Bank / harbour.
    if (missing.length && (level >= 1 || rand() < 0.5)) {
      for (const want of missing) {
        if (state.bank[want] < 1) continue;
        const giveRes = RESOURCES
          .filter(r => r !== want && spare[r] >= tradeRatio(state, pid, r))
          .sort((a, b) => (spare[b] - tradeRatio(state, pid, b)) - (spare[a] - tradeRatio(state, pid, a)))[0];
        if (giveRes) return { type: 'bankTrade', give: giveRes, get: want, count: 1 };
      }
    }
    // Other players: one offer per turn (two for hard).
    const maxOffers = level === 0 ? 0 : level === 1 ? 1 : 2;
    if (missing.length && memo.offersThisTurn < maxOffers) {
      const want = missing[0];
      const giveRes = RESOURCES.filter(r => r !== want && spare[r] > 0).sort((a, b) => spare[b] - spare[a])[0];
      if (giveRes) {
        memo.offersThisTurn++;
        return { type: 'offerTrade', give: { [giveRes]: 1 }, get: { [want]: 1 } };
      }
    }
  }
  return { type: 'endTurn' };
}
