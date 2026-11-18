import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology, coastalEdges, generateBoard, NUMBER_TOKENS, TERRAIN_COUNTS } from '../shared/board.js';
import {
  createGame, applyAction, legalRoadEdges, legalSettlementVertices, longestRoadFor, tradeRatio,
  victoryPoints, viewFor, checkInvariants, eventsFor, robberVictims, piecesLeft
} from '../shared/engine.js';
import { decide, respondToTrade, createAIMemory } from '../shared/ai.js';

const P = (n = 4) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000000' }));
const empty = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

/** A game with setup skipped: player 0 to act in the main phase. */
function mainGame(n = 4, seed = 7, layout = 'beginner') {
  const s = createGame({ seed, players: P(n), config: { layout } });
  s.phase = 'main'; s.current = 0; s.turn = 5; s.rolled = true;
  return s;
}
function give(s, pid, hand) {
  Object.entries(hand).forEach(([r, k]) => { s.players[pid].hand[r] += k; s.bank[r] -= k; });
}
function ok(s, pid, a) {
  const r = applyAction(s, pid, a);
  assert.ok(r.ok, `${a.type} should succeed: ${r.error}`);
  return r.state;
}
function bad(s, pid, a, pattern) {
  const r = applyAction(s, pid, a);
  assert.equal(r.ok, false, `${a.type} should fail`);
  if (pattern) assert.match(r.error, pattern);
}
/** Walk the perimeter of a hex: returns its vertices and edges in order. */
function ringOf(s, hid) {
  const h = s.board.hexes[hid];
  const vs = h.vertices;
  const es = vs.map((v, i) => s.board.edges.find(e => e.v.includes(v) && e.v.includes(vs[(i + 1) % 6])).id);
  return { vs, es };
}
function place(s, pid, vid, type = 'settlement') { s.vOwner[vid] = pid; s.vType[vid] = type; }

// ------------------------------------------------------------------ board
test('topology of the classic island', () => {
  const t = buildTopology();
  assert.equal(t.hexes.length, 19);
  assert.equal(t.vertices.length, 54);
  assert.equal(t.edges.length, 72);
  assert.equal(coastalEdges(t).length, 30);
  t.vertices.forEach(v => { assert.ok(v.adj.length >= 2 && v.adj.length <= 3); });
});

test('every layout has the correct tiles, tokens, harbours and no touching red numbers', () => {
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const layout of ['beginner', 'balanced', 'random']) {
    for (let i = 0; i < 150; i++) {
      const b = generateBoard(layout, rand);
      const counts = {};
      b.hexes.forEach(h => { counts[h.terrain] = (counts[h.terrain] || 0) + 1; });
      assert.deepEqual(counts, { ...TERRAIN_COUNTS, ...counts });
      Object.entries(TERRAIN_COUNTS).forEach(([t, n]) => assert.equal(counts[t], n));
      const nums = b.hexes.filter(h => h.number).map(h => h.number).sort((a, c) => a - c);
      assert.deepEqual(nums, NUMBER_TOKENS.slice().sort((a, c) => a - c));
      assert.equal(b.hexes[b.desert].number, null);
      assert.equal(b.ports.length, 9);
      const portVerts = b.ports.flatMap(p => p.vertices);
      assert.equal(new Set(portVerts).size, 18, 'harbours never share an intersection');
      const types = b.ports.map(p => p.type).sort();
      assert.deepEqual(types, ['any', 'any', 'any', 'any', 'brick', 'ore', 'sheep', 'wheat', 'wood']);
      b.ports.forEach(p => assert.equal(b.edges[p.edge].hexes.length, 1, 'harbours sit on the coast'));
      b.hexes.forEach(h => {
        if (h.number === 6 || h.number === 8) {
          h.neighbors.forEach(n => assert.ok(![6, 8].includes(b.hexes[n].number), `${layout}: red numbers touch`));
        }
      });
    }
  }
});

test('same seed gives the same game', () => {
  const a = createGame({ seed: 99, players: P() });
  const b = createGame({ seed: 99, players: P() });
  assert.deepEqual(a.board.hexes.map(h => [h.terrain, h.number]), b.board.hexes.map(h => [h.terrain, h.number]));
  assert.deepEqual(a.devDeck, b.devDeck);
  assert.equal(a.devDeck.length, 25);
});

// ------------------------------------------------------------------ setup
test('setup follows the snake order and pays out the second settlement', () => {
  let s = createGame({ seed: 3, players: P(3), config: { layout: 'beginner' } });
  const order = s.setup.order;
  assert.equal(order.length, 6);
  assert.deepEqual(order.slice(3), order.slice(0, 3).reverse());
  const seen = [];
  for (let k = 0; k < 6; k++) {
    const pid = s.current;
    seen.push(pid);
    bad(s, pid, { type: 'buildRoad', edge: 0 }, /settlement first/);
    const spots = legalSettlementVertices(s, pid);
    // choose a spot touching three land hexes for the payout check
    const v = spots.find(x => s.board.vertices[x].hexes.length === 3 && !s.board.vertices[x].hexes.includes(s.board.desert)) ?? spots[0];
    const before = { ...s.players[pid].hand };
    s = ok(s, pid, { type: 'buildSettlement', vertex: v });
    const gained = Object.keys(before).reduce((a, r) => a + s.players[pid].hand[r] - before[r], 0);
    assert.equal(gained, k >= 3 ? s.board.vertices[v].hexes.filter(h => s.board.hexes[h].terrain !== 'desert').length : 0);
    // adjacent intersection is now illegal (distance rule)
    const adj = s.board.vertices[v].adj[0];
    const other = (pid + 1) % 3;
    assert.ok(!legalSettlementVertices(s, other, true).includes(adj));
    const farEdge = s.board.edges.find(e => !e.v.includes(v) && s.eOwner[e.id] === null).id;
    bad(s, pid, { type: 'buildRoad', edge: farEdge }, /touch the settlement/);
    s = ok(s, pid, { type: 'buildRoad', edge: legalRoadEdges(s, pid)[0] });
  }
  assert.deepEqual(seen, order);
  assert.equal(s.phase, 'roll');
  assert.equal(s.current, order[0]);
  assert.deepEqual(checkInvariants(s), []);
});

// ------------------------------------------------------------------ building
test('roads must connect, and cannot pass through an opponent building', () => {
  let s = mainGame();
  const { vs, es } = ringOf(s, 9);
  place(s, 0, vs[0]);
  s.eOwner[es[0]] = 0; // vs0-vs1
  give(s, 0, { wood: 5, brick: 5 });
  assert.ok(legalRoadEdges(s, 0).includes(es[1]));
  place(s, 1, vs[1]); // opponent settles at the far end of our road (setting up the block directly)
  assert.ok(!legalRoadEdges(s, 0).includes(es[1]), 'blocked by opponent settlement');
  bad(s, 0, { type: 'buildRoad', edge: es[1] }, /opponent/);
  bad(s, 0, { type: 'buildRoad', edge: es[3] }, /connect/);
  s = ok(s, 0, { type: 'buildRoad', edge: es[5] }); // from our settlement the other way
  assert.equal(s.players[0].hand.wood, 4);
  bad(s, 0, { type: 'buildRoad', edge: es[5] }, /already a road/);
});

test('settlements need an own road and respect the distance rule; cities replace own settlements', () => {
  let s = mainGame();
  const { vs, es } = ringOf(s, 9);
  place(s, 0, vs[0]);
  s.eOwner[es[0]] = 0; s.eOwner[es[1]] = 0;
  give(s, 0, { wood: 3, brick: 3, sheep: 3, wheat: 5, ore: 6 });
  bad(s, 0, { type: 'buildSettlement', vertex: vs[1] }, /Too close/);
  bad(s, 0, { type: 'buildSettlement', vertex: vs[4] }, /touch one of your roads/);
  s = ok(s, 0, { type: 'buildSettlement', vertex: vs[2] });
  bad(s, 1, { type: 'buildCity', vertex: vs[2] }, /not your turn/);
  s = ok(s, 0, { type: 'buildCity', vertex: vs[2] });
  assert.equal(s.vType[vs[2]], 'city');
  bad(s, 0, { type: 'buildCity', vertex: vs[2] }, /own settlements/);
  assert.equal(victoryPoints(s, 0), 3);
});

test('piece limits are enforced', () => {
  let s = mainGame();
  give(s, 0, { wood: 4, brick: 4, sheep: 4, wheat: 4 });
  let count = 0;
  s.board.vertices.forEach(v => {
    if (count < 5 && v.adj.every(a => s.vOwner[a] === null) && s.vOwner[v.id] === null) { place(s, 0, v.id); count++; }
  });
  assert.equal(piecesLeft(s, 0, 'settlement'), 0);
  const v = legalSettlementVertices(s, 0, true)[0];
  s.eOwner[s.board.vertices[v].edges[0]] = 0;
  bad(s, 0, { type: 'buildSettlement', vertex: v }, /no settlements left/);
  for (let i = 0; i < 15; i++) s.eOwner[s.board.edges.findIndex((e, k) => s.eOwner[k] === null)] = 0;
  bad(s, 0, { type: 'buildRoad', edge: legalRoadEdges(s, 0)[0] ?? 0 }, /no roads left/);
});

// ------------------------------------------------------------------ dice & production
function rollTo(s, total) {
  // find an rng state that produces the wanted total on the next roll
  for (let k = 1; k < 100000; k++) {
    const t = { ...s, rng: k };
    const r = applyAction({ ...s, rng: k }, s.current, { type: 'roll' });
    if (r.ok && r.state.dice[0] + r.state.dice[1] === total) return r;
    void t;
  }
  throw new Error('no seed');
}

test('production: settlements 1, cities 2, robber blocks, no production on 7', () => {
  const s = mainGame();
  s.phase = 'roll'; s.rolled = false;
  const hex = s.board.hexes.find(h => h.number === 6);
  place(s, 0, hex.vertices[0]);
  place(s, 1, hex.vertices[2], 'city');
  const res = { forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore' }[hex.terrain];
  let r = rollTo(s, 6);
  const other6 = s.board.hexes.filter(h => h.number === 6 && h.id !== hex.id);
  const sameRes = other6.some(h => h.vertices.some(v => s.vOwner[v] !== null));
  assert.ok(!sameRes);
  assert.equal(r.state.players[0].hand[res], 1);
  assert.equal(r.state.players[1].hand[res], 2);
  assert.equal(r.state.phase, 'main');
  s.robber = hex.id;
  r = rollTo(s, 6);
  assert.equal(r.state.players[0].hand[res], 0, 'robber blocks the tile');
  assert.equal(r.events.find(e => e.type === 'produce').blockedHex, hex.id);
});

test('bank shortage: nobody collects when several players are owed more than the bank has', () => {
  const s = mainGame();
  s.phase = 'roll'; s.rolled = false;
  const hex = s.board.hexes.find(h => h.number === 6);
  const res = { forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore' }[hex.terrain];
  place(s, 0, hex.vertices[0]); place(s, 1, hex.vertices[2]);
  give(s, 2, { [res]: 18 }); // bank has 1 left, 2 are owed
  let r = rollTo(s, 6);
  assert.equal(r.state.players[0].hand[res], 0);
  assert.equal(r.state.players[1].hand[res], 0);
  s.vOwner[hex.vertices[2]] = null; s.vType[hex.vertices[2]] = null;
  place(s, 0, hex.vertices[2], 'city'); // single player owed 3, bank has 1
  r = rollTo(s, 6);
  assert.equal(r.state.players[0].hand[res], 1, 'a single player takes what is left');
  assert.deepEqual(checkInvariants(r.state), []);
});

test('rolling 7: discard half (rounded down) above 7 cards, then move robber and steal', () => {
  const s = mainGame(3);
  s.phase = 'roll'; s.rolled = false;
  give(s, 0, { wood: 3, ore: 5 });   // 8 → discard 4
  give(s, 1, { sheep: 7 });          // 7 → safe
  give(s, 2, { wheat: 9 });          // 9 → discard 4
  let r = rollTo(s, 7);
  let t = r.state;
  assert.equal(t.phase, 'discard');
  assert.deepEqual(t.discards, { 0: 4, 2: 4 });
  bad(t, 1, { type: 'discard', cards: { sheep: 3 } }, /do not need/);
  bad(t, 0, { type: 'discard', cards: { ore: 3 } }, /exactly 4/);
  bad(t, 0, { type: 'discard', cards: { wood: 4 } }, /do not hold/);
  bad(t, 0, { type: 'moveRobber', hex: 0 }, /discard/);
  t = ok(t, 0, { type: 'discard', cards: { ore: 4 } });
  t = ok(t, 2, { type: 'discard', cards: { wheat: 4 } });
  assert.equal(t.phase, 'robber');
  bad(t, 0, { type: 'moveRobber', hex: t.robber }, /different tile/);
  const hex = t.board.hexes.find(h => h.id !== t.robber);
  place(t, 1, hex.vertices[0]);
  place(t, 2, hex.vertices[3]);
  assert.deepEqual(robberVictims(t, hex.id, 0), [1, 2]);
  bad(t, 0, { type: 'moveRobber', hex: hex.id }, /steal/);
  bad(t, 0, { type: 'moveRobber', hex: hex.id, victim: 0 }, /steal/);
  t.players[2].hand = { ...empty }; t.bank.wheat += 5;
  assert.deepEqual(robberVictims(t, hex.id, 0), [1], 'players with no cards cannot be robbed');
  t = ok(t, 0, { type: 'moveRobber', hex: hex.id, victim: 1 });
  assert.equal(t.players[1].hand.sheep, 6);
  assert.equal(t.phase, 'main');
  assert.deepEqual(checkInvariants(t), []);
  // others never see what was stolen
  const ev = eventsFor([{ type: 'steal', pid: 0, victim: 1, res: 'sheep' }], 2)[0];
  assert.equal(ev.res, null);
});

// ------------------------------------------------------------------ development cards
test('development cards: purchase timing, one per turn, VP cards hidden', () => {
  let s = mainGame();
  s.devDeck = ['victoryPoint', 'knight', 'monopoly', 'yearOfPlenty', 'roadBuilding', 'knight'];
  give(s, 0, { sheep: 3, wheat: 3, ore: 3 });
  s = ok(s, 0, { type: 'buyDev' }); // knight
  bad(s, 0, { type: 'playDev', card: 'knight' }, /next turn/);
  s = ok(s, 0, { type: 'buyDev' }); // roadBuilding
  s = ok(s, 0, { type: 'buyDev' }); // yearOfPlenty
  // pass the turn around
  s.turn += 4; s.phase = 'roll'; s.rolled = false;
  s = ok(s, 0, { type: 'playDev', card: 'knight' });
  assert.equal(s.phase, 'robber');
  assert.equal(s.returnPhase, 'roll', 'a knight before rolling returns to the roll');
  bad(s, 0, { type: 'roll' }, /robber/);
  s = ok(s, 0, { type: 'moveRobber', hex: (s.robber + 1) % 19, victim: robberVictims(s, (s.robber + 1) % 19, 0)[0] ?? null });
  assert.equal(s.phase, 'roll');
  bad(s, 0, { type: 'playDev', card: 'yearOfPlenty', resources: ['ore', 'ore'] }, /one development card/);
  bad(s, 0, { type: 'playDev', card: 'victoryPoint' }, /hidden/);
});

test('Road Building, Year of Plenty and Monopoly', () => {
  let s = mainGame();
  const { vs, es } = ringOf(s, 9);
  place(s, 0, vs[0]);
  s.players[0].dev = [{ type: 'roadBuilding', turn: 1 }, { type: 'yearOfPlenty', turn: 1 }, { type: 'monopoly', turn: 1 }];
  s = ok(s, 0, { type: 'playDev', card: 'roadBuilding' });
  assert.equal(s.phase, 'roadBuilding');
  bad(s, 0, { type: 'endTurn' }, /free roads/);
  s = ok(s, 0, { type: 'buildRoad', edge: es[0] });
  s = ok(s, 0, { type: 'buildRoad', edge: es[1] });
  assert.equal(s.phase, 'main');
  assert.deepEqual(s.players[0].hand, empty, 'roads were free');
  s.devPlayed = false;
  s.bank.ore = 1;
  bad(s, 0, { type: 'playDev', card: 'yearOfPlenty', resources: ['ore', 'ore'] }, /bank/);
  s.bank.ore = 19;
  s = ok(s, 0, { type: 'playDev', card: 'yearOfPlenty', resources: ['ore', 'wheat'] });
  assert.equal(s.players[0].hand.ore, 1);
  s.devPlayed = false;
  give(s, 1, { wheat: 3 }); give(s, 2, { wheat: 2, ore: 1 });
  s = ok(s, 0, { type: 'playDev', card: 'monopoly', resource: 'wheat' });
  assert.equal(s.players[0].hand.wheat, 6);
  assert.equal(s.players[1].hand.wheat, 0);
  assert.equal(s.players[2].hand.ore, 1);
});

// ------------------------------------------------------------------ longest road / largest army
test('longest road handles chains, branches, loops and blocking', () => {
  const s = mainGame();
  const { vs, es } = ringOf(s, 9); // centre hex
  es.slice(0, 5).forEach(e => { s.eOwner[e] = 0; });
  assert.equal(longestRoadFor(s, 0), 5);
  s.eOwner[es[5]] = 0;
  assert.equal(longestRoadFor(s, 0), 6, 'a closed loop counts every segment once');
  // branch: a spoke leaving the loop adds one
  const spoke = s.board.vertices[vs[0]].edges.find(e => !es.includes(e));
  s.eOwner[spoke] = 0;
  assert.equal(longestRoadFor(s, 0), 7);
  // an opponent settlement on the loop splits it
  s.eOwner[es[5]] = null; s.eOwner[spoke] = null;
  place(s, 1, vs[2]);
  assert.equal(longestRoadFor(s, 0), 3);
  // own settlement does not split
  s.vOwner[vs[2]] = 0;
  assert.equal(longestRoadFor(s, 0), 5);
});

test('longest road award: 5 minimum, holder keeps ties, a broken road passes it on', () => {
  let s = mainGame();
  const a = ringOf(s, 18);
  place(s, 0, a.vs[0]);
  a.es.slice(0, 4).forEach(e => { s.eOwner[e] = 0; });
  give(s, 0, { wood: 2, brick: 2 });
  s = ok(s, 0, { type: 'buildRoad', edge: a.es[4] });
  assert.equal(s.longestRoad, 0, '5 segments claim it');
  assert.equal(victoryPoints(s, 0), 3);
  // Player 1: an open chain of 5 on the far side of the island
  const b = ringOf(s, 0);
  b.es.slice(0, 5).forEach(e => { s.eOwner[e] = 1; });
  s.current = 1;
  give(s, 1, { wood: 2, brick: 2 });
  // tie at 5: building elsewhere does not move the award
  const side = legalRoadEdges(s, 1).find(e => !b.es.includes(e) && s.board.edges[e].v.some(v => b.vs.slice(1, 5).includes(v)));
  s = ok(s, 1, { type: 'buildRoad', edge: side });
  assert.equal(s.players[1].roadLength, 5, 'a branch does not lengthen the trail');
  assert.equal(s.longestRoad, 0, 'the holder keeps a tie');
  const end = legalRoadEdges(s, 1).find(e => !b.es.includes(e) && s.board.edges[e].v.includes(b.vs[5]) && e !== side)
    ?? legalRoadEdges(s, 1).find(e => !b.es.includes(e) && s.board.edges[e].v.includes(b.vs[0]) && e !== side);
  s = ok(s, 1, { type: 'buildRoad', edge: end });
  assert.equal(s.players[1].roadLength, 6);
  assert.equal(s.longestRoad, 1, 'a longer road takes it');
  // Player 2 settles in the middle of player 1's trail
  s.current = 2;
  give(s, 2, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  const mid = [b.vs[2], b.vs[3]].find(v => s.board.vertices[v].adj.every(x => s.vOwner[x] === null) &&
    s.board.vertices[v].edges.some(e => s.eOwner[e] === null));
  s.eOwner[s.board.vertices[mid].edges.find(e => s.eOwner[e] === null)] = 2;
  s = ok(s, 2, { type: 'buildSettlement', vertex: mid });
  assert.ok(s.players[1].roadLength < 5);
  assert.equal(s.longestRoad, 0, 'the only remaining 5+ road takes it');
});

test('largest army needs 3 knights and must be strictly exceeded', () => {
  let s = mainGame();
  s.players[0].knights = 2;
  s.players[0].dev = [{ type: 'knight', turn: 1 }];
  s = ok(s, 0, { type: 'playDev', card: 'knight' });
  assert.equal(s.largestArmy, 0);
  s = ok(s, 0, { type: 'moveRobber', hex: (s.robber + 1) % 19, victim: robberVictims(s, (s.robber + 1) % 19, 0)[0] ?? null });
  s.current = 1; s.devPlayed = false; s.players[1].knights = 2;
  s.players[1].dev = [{ type: 'knight', turn: 1 }, { type: 'knight', turn: 1 }];
  s = ok(s, 1, { type: 'playDev', card: 'knight' });
  assert.equal(s.largestArmy, 0, 'a tie does not take it');
  s = ok(s, 1, { type: 'moveRobber', hex: (s.robber + 1) % 19, victim: robberVictims(s, (s.robber + 1) % 19, 1)[0] ?? null });
  s.devPlayed = false;
  s = ok(s, 1, { type: 'playDev', card: 'knight' });
  assert.equal(s.largestArmy, 1);
});

// ------------------------------------------------------------------ trading
test('harbour ratios only apply to the owner', () => {
  let s = mainGame();
  const generic = s.board.ports.find(p => p.type === 'any');
  const ore = s.board.ports.find(p => p.type === 'ore');
  assert.equal(tradeRatio(s, 0, 'wood'), 4);
  place(s, 1, generic.vertices[0]);
  assert.equal(tradeRatio(s, 0, 'wood'), 4, 'other player\u2019s harbour does not help');
  assert.equal(tradeRatio(s, 1, 'wood'), 3);
  place(s, 1, ore.vertices[1], 'city');
  assert.equal(tradeRatio(s, 1, 'ore'), 2);
  assert.equal(tradeRatio(s, 1, 'wheat'), 3);
  s.current = 1;
  give(s, 1, { ore: 4, wood: 2 });
  bad(s, 1, { type: 'bankTrade', give: 'wood', get: 'ore' }, /need 3/);
  bad(s, 1, { type: 'bankTrade', give: 'ore', get: 'ore' }, /different/);
  s = ok(s, 1, { type: 'bankTrade', give: 'ore', get: 'brick', count: 2 });
  assert.equal(s.players[1].hand.ore, 0);
  assert.equal(s.players[1].hand.brick, 2);
  assert.deepEqual(checkInvariants(s), []);
});

test('player trades: offers, counteroffers, acceptance and validation', () => {
  let s = mainGame();
  give(s, 0, { wood: 2 }); give(s, 1, { ore: 2 }); give(s, 2, { sheep: 1 });
  bad(s, 1, { type: 'offerTrade', give: { ore: 1 }, get: { wood: 1 } }, /not your turn/);
  bad(s, 0, { type: 'offerTrade', give: { wood: 1 }, get: {} }, /no gifts/);
  bad(s, 0, { type: 'offerTrade', give: { wood: 1 }, get: { wood: 1 } }, /same resource/);
  bad(s, 0, { type: 'offerTrade', give: { wood: 3 }, get: { ore: 1 } }, /do not hold/);
  s.phase = 'roll';
  bad(s, 0, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } }, /Roll/);
  s.phase = 'main';
  s = ok(s, 0, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } });
  const id = s.trade.id;
  bad(s, 2, { type: 'respondTrade', id, answer: 'accept' }, /do not hold/);
  bad(s, 0, { type: 'acceptTrade', id, partner: 1 }, /not agreed/);
  s = ok(s, 2, { type: 'respondTrade', id, answer: 'counter', give: { wood: 2 }, get: { sheep: 1 } });
  s = ok(s, 1, { type: 'respondTrade', id, answer: 'accept' });
  s = ok(s, 0, { type: 'acceptTrade', id, partner: 1 });
  assert.equal(s.players[0].hand.ore, 1);
  assert.equal(s.players[1].hand.wood, 1);
  assert.equal(s.trade, null);
  bad(s, 0, { type: 'acceptTrade', id, partner: 2 }, /no longer open/);
  // counteroffer path
  s = ok(s, 0, { type: 'offerTrade', give: { wood: 1 }, get: { sheep: 1 } });
  s = ok(s, 2, { type: 'respondTrade', id: s.trade.id, answer: 'counter', give: { wood: 1, ore: 1 }, get: { sheep: 1 } });
  s = ok(s, 0, { type: 'acceptTrade', id: s.trade.id, partner: 2 });
  assert.equal(s.players[2].hand.wood, 1);
  assert.equal(s.players[0].hand.sheep, 1);
  assert.deepEqual(checkInvariants(s), []);
});

// ------------------------------------------------------------------ victory & turns
test('victory only on your own turn; hidden VP cards count', () => {
  let s = mainGame();
  s.config.vpTarget = 4;
  const { vs, es } = ringOf(s, 9);
  place(s, 0, vs[0]); place(s, 0, vs[2]);
  s.eOwner[es[2]] = 0; s.eOwner[es[3]] = 0;
  s.players[0].dev = [{ type: 'victoryPoint', turn: 1 }];
  give(s, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  s = ok(s, 0, { type: 'buildSettlement', vertex: vs[4] });
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  bad(s, 0, { type: 'endTurn' }, /over/);
  // a player at the target on another player's turn wins when their turn starts
  let t = mainGame();
  t.config.vpTarget = 2;
  place(t, 1, vs[0]); place(t, 1, vs[3]);
  t = ok(t, 0, { type: 'endTurn' });
  assert.equal(t.phase, 'over');
  assert.equal(t.winner, 1);
});

test('turn order, rolling once, and ending the turn', () => {
  let s = mainGame(3);
  s.phase = 'roll'; s.rolled = false;
  bad(s, 0, { type: 'endTurn' }, /Roll/);
  bad(s, 1, { type: 'roll' }, /not your turn/);
  s = ok(s, 0, { type: 'roll' });
  if (s.phase === 'main') {
    bad(s, 0, { type: 'roll' }, /cannot|Roll|robber/);
    s = ok(s, 0, { type: 'endTurn' });
    assert.equal(s.current, 1);
    assert.equal(s.phase, 'roll');
  }
});

test('views hide other players\u2019 hands, cards and the deck', () => {
  const s = mainGame();
  give(s, 1, { ore: 3 });
  s.players[1].dev = [{ type: 'victoryPoint', turn: 1 }];
  const v = viewFor(s, 0);
  assert.equal(v.players[1].hand, null);
  assert.equal(v.players[1].handCount, 3);
  assert.equal(v.players[1].dev, null);
  assert.equal(v.players[1].devCount, 1);
  assert.equal(v.devDeck, undefined);
  assert.equal(v.rng, undefined);
  assert.ok(v.players[0].hand);
});

test('rejected actions never change the state', () => {
  const s = mainGame();
  const snapshot = JSON.stringify(s);
  applyAction(s, 0, { type: 'buildCity', vertex: 0 });
  applyAction(s, 0, { type: 'nonsense' });
  applyAction(s, 0, { type: 'buildRoad', edge: 9999 });
  assert.equal(JSON.stringify(s), snapshot);
});

// ------------------------------------------------------------------ full games
test('complete AI games finish with a legal winner and conserved resources', () => {
  for (let g = 0; g < 40; g++) {
    const n = 3 + (g % 2);
    const levels = ['easy', 'normal', 'hard'];
    let s = createGame({
      seed: 500 + g,
      players: Array.from({ length: n }, (_, i) => ({ name: `AI${i}`, isAI: true, ai: levels[(i + g) % 3] })),
      config: { layout: ['balanced', 'random', 'beginner'][g % 3] }
    });
    const mem = s.players.map((_, i) => createAIMemory(g * 7 + i));
    let steps = 0, lastTurn = -1, perTurn = 0;
    while (s.phase !== 'over') {
      assert.ok(++steps < 20000, 'game should finish');
      if (s.turn !== lastTurn) { lastTurn = s.turn; perTurn = 0; }
      if (s.trade) s.players.forEach(p => { const a = respondToTrade(s, p.id, mem[p.id]); if (a) s = ok(s, p.id, a); });
      const pid = s.phase === 'discard' ? Number(Object.keys(s.discards)[0]) : s.current;
      let a = decide(s, pid, mem[pid]);
      if (++perTurn > 80 && s.phase === 'main') a = { type: 'endTurn' };
      if (a.type === 'wait') a = { type: 'cancelTrade' };
      s = ok(s, pid, a);
      assert.deepEqual(checkInvariants(s), []);
    }
    assert.ok(victoryPoints(s, s.winner, true) >= 10);
    assert.equal(s.winner, s.current, 'winner is the active player');
  }
});
