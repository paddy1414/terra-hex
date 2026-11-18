import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, checkInvariants, victoryPoints, viewFor, legalShipEdges, legalRoadEdges, legalSettlementVertices, longestRoadFor, movableShips, legalRobberHexes, robberVictims, pendingActors } from '../shared/engine.js';
import { decide, respondToTrade, createAIMemory } from '../shared/ai.js';

const P = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000000' }));
function ok(s, pid, a) { const r = applyAction(s, pid, a); assert.ok(r.ok, `${a.type}: ${r.error}`); return r; }
function bad(s, pid, a, re) { const r = applyAction(s, pid, a); assert.equal(r.ok, false, `${a.type} should fail`); if (re) assert.match(r.error, re); }
function game() {
  const s = createGame({ seed: 8, players: P(3), config: { map: 'newshores', friendlyRobber: false } });
  s.phase = 'main'; s.current = 0; s.turn = 5; s.rolled = true;
  return s;
}
const give = (s, pid, h) => Object.entries(h).forEach(([r, k]) => { s.players[pid].hand[r] += k; s.bank[r] -= k; });
const sea = (s, h) => s.board.hexes[h].terrain === 'sea';
const coastVertex = (s) => s.board.vertices.find(v => v.hexes.some(h => sea(s, h)) && v.hexes.some(h => !sea(s, h)) && s.board.homeIslands.includes(s.board.hexes[v.hexes.find(h => !sea(s, h))].island) && v.edges.some(e => s.board.edges[e].hexes.every(h => sea(s, h)) || s.board.edges[e].hexes.length === 1 && sea(s, s.board.edges[e].hexes[0])));

test('Seafarers board: sea spaces, home island, foreign islands with gold, pirate at sea', () => {
  const s = game();
  assert.ok(s.config.sea);
  assert.ok(s.board.hexes.filter(h => h.terrain === 'sea').length > 40);
  assert.deepEqual(s.board.homeIslands, [0]);
  assert.equal(s.board.islandSizes.length, 4);
  assert.equal(s.board.hexes.filter(h => h.terrain === 'gold').length, 3);
  assert.ok(sea(s, s.pirate));
  // setup only on the home island
  const t = createGame({ seed: 8, players: P(3), config: { map: 'newshores' } });
  const spots = legalSettlementVertices(t, t.current, true);
  assert.ok(spots.length > 0);
  spots.forEach(v => assert.equal(t.board.hexes[t.board.vertices[v].hexes.find(h => !sea(t, h))].island, 0));
  assert.deepEqual(checkInvariants(s), []);
});

test('ships: built on water, linked to your settlement or ships, never straight off a road', () => {
  let s = game();
  const v = coastVertex(s);
  s.vOwner[v.id] = 0; s.vType[v.id] = 'settlement';
  give(s, 0, { wood: 4, sheep: 3, brick: 2 });
  const shipEdges = legalShipEdges(s, 0);
  assert.ok(shipEdges.length > 0);
  shipEdges.forEach(e => assert.ok(s.board.edges[e].hexes.some(h => sea(s, h))));
  legalRoadEdges(s, 0).forEach(e => assert.ok(s.board.edges[e].hexes.some(h => !sea(s, h)), 'roads stay on land'));
  const open = shipEdges.find(e => s.board.edges[e].hexes.every(h => sea(s, h)));
  if (open !== undefined) bad(s, 0, { type: 'buildRoad', edge: open }, /ship/);
  const e1 = shipEdges[0];
  s = ok(s, 0, { type: 'buildShip', edge: e1 }).state;
  assert.equal(s.players[0].hand.wood, 3); assert.equal(s.players[0].hand.sheep, 2);
  // the next ship links from the first one
  const far = s.board.edges[e1].v.find(x => x !== v.id);
  const next = legalShipEdges(s, 0).find(e => s.board.edges[e].v.includes(far));
  assert.ok(next !== undefined);
  s = ok(s, 0, { type: 'buildShip', edge: next }).state;
  // a road ending next to the water does not let a ship start there
  const roadOnly = { ...s, sOwner: s.sOwner.map(() => null), vOwner: s.vOwner.map(() => null) };
  roadOnly.eOwner = s.eOwner.map(() => null);
  const coastRoad = s.board.edges.find(e => e.hexes.length === 2 && e.hexes.some(h => sea(s, h)) && e.hexes.some(h => !sea(s, h)));
  roadOnly.eOwner[coastRoad.id] = 0;
  assert.equal(legalShipEdges(roadOnly, 0).length, 0, 'ships connect only through your settlements, not your roads');
  assert.deepEqual(checkInvariants(s), []);
});

test('moving a ship: once per turn, from the open end, not on the turn it was built', () => {
  let s = game();
  const v = coastVertex(s);
  s.vOwner[v.id] = 0; s.vType[v.id] = 'settlement';
  give(s, 0, { wood: 3, sheep: 3 });
  const e1 = legalShipEdges(s, 0)[0];
  s = ok(s, 0, { type: 'buildShip', edge: e1 }).state;
  assert.deepEqual(movableShips(s, 0), [], 'not on the turn it was built');
  s.turn++;
  assert.deepEqual(movableShips(s, 0), [e1]);
  const target = legalShipEdges({ ...s, sOwner: s.sOwner.map((o, e) => (e === e1 ? null : o)) }, 0).find(e => e !== e1);
  s = ok(s, 0, { type: 'moveShip', from: e1, to: target }).state;
  assert.equal(s.sOwner[target], 0); assert.equal(s.sOwner[e1], null);
  bad(s, 0, { type: 'moveShip', from: target, to: e1 }, /one ship per turn/);
});

test('trade route: roads and ships count together, joined only at your own settlement', () => {
  const s = game();
  const v = coastVertex(s);
  const landEdge = s.board.vertices[v.id].edges.find(e => s.board.edges[e].hexes.every(h => !sea(s, h)) && s.board.edges[e].hexes.length === 2) ?? s.board.vertices[v.id].edges.find(e => s.board.edges[e].hexes.some(h => !sea(s, h)));
  const seaEdge = s.board.vertices[v.id].edges.find(e => e !== landEdge && s.board.edges[e].hexes.some(h => sea(s, h)));
  s.eOwner[landEdge] = 0; s.sOwner[seaEdge] = 0;
  assert.equal(longestRoadFor(s, 0), 1, 'without a settlement the road and ship do not join');
  s.vOwner[v.id] = 0; s.vType[v.id] = 'settlement';
  assert.equal(longestRoadFor(s, 0), 2);
});

test('gold fields: you choose the resources before play goes on', () => {
  let s = game();
  const gold = s.board.hexes.find(h => h.terrain === 'gold');
  s.vOwner[gold.vertices[0]] = 1; s.vType[gold.vertices[0]] = 'city';
  s.phase = 'roll'; s.rolled = false;
  let r;
  for (let k = 1; k < 100000; k++) { r = applyAction({ ...s, rng: k }, 0, { type: 'roll' }); if (r.ok && r.state.dice[0] + r.state.dice[1] === gold.number) break; }
  const others = s.board.hexes.filter(h => h.number === gold.number && h.id !== gold.id && h.vertices.some(v => s.vOwner[v] !== null));
  assert.equal(others.length, 0);
  assert.deepEqual(r.state.gold, { 1: 2 });
  assert.deepEqual(pendingActors(r.state), [1]);
  bad(r.state, 0, { type: 'endTurn' }, /gold/);
  bad(r.state, 1, { type: 'pickGold', cards: { ore: 3 } }, /exactly 2/);
  const t = ok(r.state, 1, { type: 'pickGold', cards: { ore: 1, wheat: 1 } }).state;
  assert.equal(t.players[1].hand.ore, 1); assert.equal(t.players[1].hand.wheat, 1);
  ok(t, 0, { type: 'endTurn' });
  assert.deepEqual(checkInvariants(t), []);
});

test('pirate: moves on a 7 instead of the robber, robs ship owners and blocks ships', () => {
  let s = game();
  const v = coastVertex(s);
  s.vOwner[v.id] = 1; s.vType[v.id] = 'settlement';
  const shipEdge = s.board.vertices[v.id].edges.find(e => s.board.edges[e].hexes.some(h => sea(s, h)));
  s.sOwner[shipEdge] = 1;
  give(s, 1, { ore: 2 });
  const seaHex = s.board.edges[shipEdge].hexes.find(h => sea(s, h) && h !== s.pirate);
  s.phase = 'robber'; s.returnPhase = 'main';
  assert.ok(legalRobberHexes(s).includes(seaHex));
  assert.deepEqual(robberVictims(s, seaHex, 0), [1]);
  const robberBefore = s.robber;
  s = ok(s, 0, { type: 'moveRobber', hex: seaHex, victim: 1 }).state;
  assert.equal(s.pirate, seaHex); assert.equal(s.robber, robberBefore);
  assert.equal(s.players[1].hand.ore, 1);
  // ships cannot be built or moved next to the pirate
  assert.ok(legalShipEdges({ ...s, current: 1 }, 1).every(e => !s.board.edges[e].hexes.includes(seaHex)));
  assert.ok(!movableShips({ ...s, turn: 9 }, 1).includes(shipEdge));
  assert.deepEqual(checkInvariants(s), []);
});

test('settling a new island earns 2 points, once per island', () => {
  let s = game();
  const foreign = s.board.hexes.find(h => h.terrain !== 'sea' && !s.board.homeIslands.includes(h.island));
  const v = foreign.vertices.find(x => s.board.vertices[x].edges.some(e => s.board.edges[e].hexes.some(h => sea(s, h))));
  const e = s.board.vertices[v].edges.find(x => s.board.edges[x].hexes.some(h => sea(s, h)));
  s.sOwner[e] = 0;
  give(s, 0, { wood: 2, brick: 2, sheep: 2, wheat: 2 });
  const before = victoryPoints(s, 0, false);
  s = ok(s, 0, { type: 'buildSettlement', vertex: v }).state;
  assert.equal(victoryPoints(s, 0, false), before + 3);
  assert.deepEqual(s.players[0].islands, [foreign.island]);
  assert.equal(viewFor(s, 1).players[0].islandVP, 2, 'island points are public');
});

test('complete Seafarers AI games on several maps', () => {
  for (const [map, n] of [['newshores', 3], ['twinisles', 4], ['classic', 4]]) {
    let s = createGame({ seed: 41 + n, players: Array.from({ length: n }, (_, i) => ({ name: `AI${i}`, isAI: true, ai: ['easy', 'normal', 'hard'][i % 3] })), config: { map, sea: true, vpTarget: 13 } });
    const mem = s.players.map((_, i) => createAIMemory(i + 4));
    let steps = 0, lastTurn = -1, perTurn = 0;
    while (s.phase !== 'over') {
      assert.ok(++steps < 60000, `${map} should finish`);
      if (s.turn !== lastTurn) { lastTurn = s.turn; perTurn = 0; }
      if (s.trade && !Object.keys(s.gold).length) s.players.forEach(p => { const a = respondToTrade(s, p.id, mem[p.id]); if (a) { const r = applyAction(s, p.id, a); if (r.ok) s = r.state; } });
      const pid = pendingActors(s)[0];
      let a = decide(s, pid, mem[pid]);
      if (++perTurn > 150 && s.phase === 'main' && !Object.keys(s.gold).length) a = { type: 'endTurn' };
      if (!a || a.type === 'wait') a = { type: s.trade ? 'cancelTrade' : 'endTurn' };
      s = ok(s, pid, a).state;
      assert.deepEqual(checkInvariants(s), []);
    }
    assert.ok(victoryPoints(s, s.winner, true) >= 13);
  }
});
