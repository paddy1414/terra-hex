import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, checkInvariants, victoryPoints, viewFor, tradeRatio, discardLimitFor, legalRoadEdges, longestRoadFor, pendingActors } from '../shared/engine.js';
import { decide, respondToTrade, createAIMemory } from '../shared/ai.js';

const P = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000000' }));
function ok(s, pid, a) { const r = applyAction(s, pid, a); assert.ok(r.ok, `${a.type}: ${r.error}`); return r; }
function bad(s, pid, a, re) { const r = applyAction(s, pid, a); assert.equal(r.ok, false, `${a.type} should fail`); if (re) assert.match(r.error, re); }
function game(n = 3) {
  const s = createGame({ seed: 21, players: P(n), config: { ck: true, layout: 'beginner', vpTarget: 13 } });
  s.phase = 'main'; s.current = 0; s.turn = 5; s.rolled = true;
  return s;
}
const give = (s, pid, h) => Object.entries(h).forEach(([r, k]) => { s.players[pid].hand[r] += k; s.bank[r] -= k; });
const place = (s, pid, v, t = 'settlement') => { s.vOwner[v] = pid; s.vType[v] = t; };
function rollTo(s, total, event) {
  for (let k = 1; k < 200000; k++) {
    const r = applyAction({ ...s, rng: k }, s.current, { type: 'roll' });
    if (r.ok && r.state.dice[0] + r.state.dice[1] === total && (!event || r.state.eventDie === event)) return r;
  }
  throw new Error('no seed');
}
const freeSpots = (s, n, avoid = []) => {
  const out = [];
  s.board.vertices.forEach(v => { if (out.length < n && s.vOwner[v.id] === null && !avoid.includes(v.id) && v.adj.every(a => s.vOwner[a] === null && !out.includes(a))) out.push(v.id); });
  return out;
};

test('C&K setup: the second piece is a city; 8 card types; no development cards', () => {
  let s = createGame({ seed: 4, players: P(3), config: { ck: true, layout: 'beginner' } });
  assert.deepEqual(Object.keys(s.bank), ['wood', 'brick', 'sheep', 'wheat', 'ore', 'paper', 'cloth', 'coin']);
  assert.equal(s.devDeck.length, 0);
  for (let k = 0; k < 6; k++) {
    const pid = s.current;
    const v = freeSpots(s, 1)[0];
    s = ok(s, pid, { type: 'buildSettlement', vertex: v }).state;
    assert.equal(s.vType[v], k >= 3 ? 'city' : 'settlement');
    const e = s.board.vertices[v].edges.find(x => s.eOwner[x] === null);
    s = ok(s, pid, { type: 'buildRoad', edge: e }).state;
  }
  assert.equal(s.phase, 'roll');
  bad(s, s.current, { type: 'buyDev' });
  assert.deepEqual(checkInvariants(s), []);
});

test('cities produce commodities from forest, pasture and mountains', () => {
  const s = game();
  s.phase = 'roll'; s.rolled = false;
  const forest = s.board.hexes.find(h => h.terrain === 'forest' && h.number && h.id !== s.robber);
  place(s, 0, forest.vertices[0], 'city');
  place(s, 1, forest.vertices[2], 'settlement');
  const r = rollTo(s, forest.number, 'trade');
  const others = s.board.hexes.filter(h => h.number === forest.number && h.id !== forest.id);
  assert.ok(others.every(h => !h.vertices.some(v => s.vOwner[v] !== null)));
  assert.equal(r.state.players[0].hand.wood, 1);
  assert.equal(r.state.players[0].hand.paper, 1);
  assert.equal(r.state.players[1].hand.wood, 1);
  const fields = s.board.hexes.find(h => h.terrain === 'fields' && h.number);
  const t = game(); t.phase = 'roll'; t.rolled = false;
  place(t, 0, fields.vertices[0], 'city');
  assert.equal(rollTo(t, fields.number, 'trade').state.players[0].hand.wheat, 2, 'fields cities give 2 wheat');
});

test('the robber stays put until the first barbarian attack', () => {
  const s = game();
  s.phase = 'roll'; s.rolled = false;
  give(s, 1, { wood: 5, ore: 4 });
  const r = rollTo(s, 7, 'trade');
  assert.equal(r.state.phase, 'discard');
  const after = ok(r.state, 1, { type: 'discard', cards: { wood: 4 } }).state;
  assert.equal(after.phase, 'main', 'no robber move before the barbarians arrive');
  assert.equal(after.robber, s.robber);
});

test('city walls raise the discard limit by 2 (3 at most) and need a city', () => {
  let s = game();
  const [a, b, c, d] = freeSpots(s, 4);
  [a, b, c, d].forEach(v => place(s, 0, v, 'city'));
  give(s, 0, { brick: 8 });
  bad(s, 0, { type: 'buildWall', vertex: freeSpots(s, 1)[0] }, /own cities/);
  s = ok(s, 0, { type: 'buildWall', vertex: a }).state;
  bad(s, 0, { type: 'buildWall', vertex: a }, /already/);
  s = ok(s, 0, { type: 'buildWall', vertex: b }).state;
  s = ok(s, 0, { type: 'buildWall', vertex: c }).state;
  bad(s, 0, { type: 'buildWall', vertex: d }, /no walls left/);
  assert.equal(discardLimitFor(s, 0), 13);
});

test('barbarians: defenders win → Defender of Catan; knights go inactive; the robber is freed', () => {
  let s = game();
  const [c1, k1, k2] = freeSpots(s, 3);
  place(s, 1, c1, 'city');
  s.kOwner[k1] = 0; s.kLevel[k1] = 2; s.kActive[k1] = true;
  s.kOwner[k2] = 2; s.kLevel[k2] = 1; s.kActive[k2] = true;
  s.barb.pos = 6; s.phase = 'roll'; s.rolled = false;
  const r = rollTo(s, 8, 'ship');
  const t = r.state;
  const att = r.events.find(e => e.type === 'barbarianAttack');
  assert.ok(att.won);
  assert.equal(att.defender, 0);
  assert.equal(t.players[0].defender, 1);
  assert.equal(victoryPoints(t, 0, true), 1);
  assert.ok(t.kActive.every(a => !a));
  assert.equal(t.barb.pos, 0);
  assert.ok(t.barb.attacked);
});

test('barbarians: losing pillages the weakest city owner; metropolises are safe', () => {
  let s = game();
  const [c0, c1, c1b, c2, k] = freeSpots(s, 5);
  place(s, 0, c0, 'city'); place(s, 1, c1, 'city'); place(s, 1, c1b, 'city'); place(s, 2, c2, 'city');
  s.vMetro[c2] = 'science'; s.metropolis.science = 2;
  s.kOwner[k] = 0; s.kLevel[k] = 1; s.kActive[k] = true;
  s.vWall[c1] = true;
  s.barb.pos = 6; s.phase = 'roll'; s.rolled = false;
  let r = rollTo(s, 8, 'ship');
  const att = r.events.find(e => e.type === 'barbarianAttack');
  assert.equal(att.won, false);
  assert.deepEqual(att.losers, [1], 'player 2 only has a metropolis, player 0 has a knight');
  assert.equal(pendingActors(r.state)[0], 1, 'player 1 chooses which city to lose');
  const p = r.state.prompts[0];
  r = ok(r.state, 1, { type: 'answer', id: p.id, value: c1 });
  assert.equal(r.state.vType[c1], 'settlement');
  assert.equal(r.state.vWall[c1], false, 'its wall is lost too');
  assert.ok(r.events.some(e => e.type === 'produce'), 'resources are paid after the choice');
  assert.deepEqual(checkInvariants(r.state), []);
});

test('progress cards are drawn when red ≤ level + 1 on the matching gate; hand limit 4', () => {
  let s = game();
  s.players[0].improve.science = 2;
  s.phase = 'roll'; s.rolled = false;
  const r = rollTo(s, 7 + 1, 'science');
  const red = r.state.dice[0];
  assert.equal(r.state.players[0].prog.length + r.state.players[0].progVP.length, red <= 3 ? 1 : 0);
  // hand limit
  const t = game();
  t.players[0].improve.trade = 5;
  t.prog.trade = ['merchant', 'merchant', 'merchant', 'merchant', 'merchant', 'merchant', ...t.prog.trade.filter(x => x !== 'merchant')];
  t.players[0].prog = ['spy', 'spy', 'bishop', 'wedding'].map(type => ({ type, deck: 'politics', turn: 1 }));
  ['spy', 'spy', 'bishop', 'wedding'].forEach(c => t.prog.politics.splice(t.prog.politics.indexOf(c), 1));
  t.phase = 'roll'; t.rolled = false;
  const r2 = rollTo(t, 5, 'trade');
  assert.equal(r2.state.players[0].prog.length, 5);
  assert.equal(r2.state.prompts[0].purpose, 'progressDiscard');
  const done = ok(r2.state, 0, { type: 'answer', id: r2.state.prompts[0].id, value: 0 }).state;
  assert.equal(done.players[0].prog.length, 4);
  assert.deepEqual(checkInvariants(done), []);
});

test('city improvements, metropolis race and level-3 abilities', () => {
  let s = game();
  const [c0, c1, c1b] = freeSpots(s, 3);
  place(s, 0, c0, 'city'); place(s, 1, c1, 'city'); place(s, 1, c1b, 'city');
  give(s, 0, { coin: 10 }); give(s, 1, { coin: 12 });
  for (let l = 1; l <= 4; l++) s = ok(s, 0, { type: 'improveCity', track: 'politics' }).state;
  assert.equal(s.vMetro[c0], 'politics');
  assert.equal(victoryPoints(s, 0, false), 4);
  s.current = 1;
  for (let l = 1; l <= 4; l++) s = ok(s, 1, { type: 'improveCity', track: 'politics' }).state;
  assert.equal(s.metropolis.politics, 0, 'reaching level 4 second does not take it');
  bad(s, 1, { type: 'improveCity', track: 'politics' }, /costs 5 coin/);
  give(s, 1, { coin: 3 });
  let r = ok(s, 1, { type: 'improveCity', track: 'politics' });
  s = r.state;
  if (s.prompts.length) s = ok(s, 1, { type: 'answer', id: s.prompts[0].id, value: c1 }).state;
  assert.equal(s.metropolis.politics, 1, 'level 5 first takes the metropolis');
  assert.equal(s.vMetro[c0], null);
  // Trading House
  const t = game();
  place(t, 0, t.board.vertices.find(v => v.port === null).id, 'city');
  assert.equal(tradeRatio(t, 0, 'cloth'), 4);
  t.players[0].improve.trade = 3;
  assert.equal(tradeRatio(t, 0, 'cloth'), 2);
  assert.equal(tradeRatio(t, 0, 'wood'), 4);
});

test('knights: build on your road, block opponents, activate, act a turn later, promote with the Fortress', () => {
  let s = game();
  const city = freeSpots(s, 1)[0];
  place(s, 0, city, 'city');
  const e0 = s.board.vertices[city].edges[0];
  s.eOwner[e0] = 0;
  const ed = s.board.edges[e0];
  const spot = ed.v[0] === city ? ed.v[1] : ed.v[0];
  give(s, 0, { sheep: 5, ore: 5, wheat: 3 });
  bad(s, 0, { type: 'buildKnight', vertex: freeSpots(s, 1, [spot, city])[0] }, /your roads/);
  s = ok(s, 0, { type: 'buildKnight', vertex: spot }).state;
  // an opponent cannot build a road through the knight
  const beyond = s.board.vertices[spot].edges.find(x => x !== e0);
  s.eOwner[beyond] = 1;
  const further = s.board.vertices[spot].edges.find(x => x !== e0 && x !== beyond);
  if (further !== undefined) assert.ok(!legalRoadEdges({ ...s, current: 1 }, 1).includes(further) || s.board.edges[further].v.some(v => v !== spot && s.board.vertices[v].edges.some(x => s.eOwner[x] === 1 && x !== further)));
  s = ok(s, 0, { type: 'activateKnight', vertex: spot }).state;
  s.robber = s.board.vertices[spot].hexes[0]; s.barb.attacked = true;
  bad(s, 0, { type: 'chaseRobber', vertex: spot }, /turn it was activated/);
  s = ok(s, 0, { type: 'promoteKnight', vertex: spot }).state;
  bad(s, 0, { type: 'promoteKnight', vertex: spot }, /once per turn|Fortress/);
  s.turn++;
  bad(s, 0, { type: 'promoteKnight', vertex: spot }, /Fortress/);
  s = ok(s, 0, { type: 'chaseRobber', vertex: spot }).state;
  assert.equal(s.phase, 'robber');
  assert.equal(s.kActive[spot], false);
});

test('displacing a weaker knight makes its owner move it', () => {
  let s = game();
  const city = freeSpots(s, 1)[0];
  place(s, 0, city, 'city');
  // a road of two segments from the city
  const e1 = s.board.vertices[city].edges[0]; s.eOwner[e1] = 0;
  const v1 = s.board.edges[e1].v.find(v => v !== city);
  const e2 = s.board.vertices[v1].edges.find(x => x !== e1); s.eOwner[e2] = 0;
  const v2 = s.board.edges[e2].v.find(v => v !== v1);
  s.kOwner[v1] = 0; s.kLevel[v1] = 2; s.kActive[v1] = true; s.kActivated[v1] = 1;
  s.kOwner[v2] = 1; s.kLevel[v2] = 1; s.kActive[v2] = true;
  // player 1 has a road somewhere for the relocation
  const other = freeSpots(s, 1, [city, v1, v2])[0];
  s.eOwner[s.board.vertices[other].edges[0]] = 1;
  const r = ok(s, 0, { type: 'displaceKnight', vertex: v1, target: v2 });
  assert.equal(r.state.kOwner[v2], 0);
  assert.equal(r.state.prompts[0].pid, 1);
  const spot = r.state.prompts[0].options[0];
  const t = ok(r.state, 1, { type: 'answer', id: r.state.prompts[0].id, value: spot }).state;
  assert.equal(t.kOwner[spot], 1);
  assert.equal(t.kLevel[spot], 1);
});

test('progress cards: monopoly, wedding, spy (private), merchant and alchemist', () => {
  let s = game();
  const take = (type) => { const d = s.prog.politics.includes(type) ? 'politics' : s.prog.trade.includes(type) ? 'trade' : 'science'; s.prog[d].splice(s.prog[d].indexOf(type), 1); s.players[0].prog.push({ type, deck: d, turn: 1 }); };
  give(s, 1, { ore: 3 }); give(s, 2, { ore: 1 });
  take('resourceMonopoly');
  let r = ok(s, 0, { type: 'playProgress', card: 'resourceMonopoly' });
  r = ok(r.state, 0, { type: 'answer', id: r.state.prompts[0].id, value: 'ore' });
  assert.equal(r.state.players[0].hand.ore, 3);
  assert.equal(r.state.players[1].hand.ore, 1);
  s = r.state;
  // wedding: richer players give 2 cards of their choice
  place(s, 1, freeSpots(s, 1)[0], 'city');
  take('wedding');
  r = ok(s, 0, { type: 'playProgress', card: 'wedding' });
  assert.equal(r.state.prompts[0].pid, 1);
  r = ok(r.state, 1, { type: 'answer', id: r.state.prompts[0].id, value: { ore: 1 } });
  assert.equal(r.state.players[0].hand.ore, 4);
  s = r.state;
  // spy: the revealed cards are only visible to the spy
  s.players[2].prog.push({ type: 'bishop', deck: 'politics', turn: 1 }); s.prog.politics.splice(s.prog.politics.indexOf('bishop'), 1);
  take('spy');
  r = ok(s, 0, { type: 'playProgress', card: 'spy' });
  r = ok(r.state, 0, { type: 'answer', id: r.state.prompts[0].id, value: 2 });
  assert.ok(viewFor(r.state, 0).prompts[0].reveal);
  assert.equal(viewFor(r.state, 1).prompts[0].reveal, undefined);
  assert.equal(viewFor(r.state, 1).players[0].prog, null);
  r = ok(r.state, 0, { type: 'answer', id: r.state.prompts[0].id, value: 0 });
  assert.ok(r.state.players[0].prog.some(c => c.type === 'bishop'));
  s = r.state;
  // merchant: +1 point and 2:1 for that tile's resource
  place(s, 0, freeSpots(s, 1)[0], 'settlement');
  const mine = s.board.hexes.find(h => h.vertices.some(v => s.vOwner[v] === 0) && h.terrain !== 'desert');
  take('merchant');
  const before = victoryPoints(s, 0, false);
  r = ok(s, 0, { type: 'playProgress', card: 'merchant' });
  r = ok(r.state, 0, { type: 'answer', id: r.state.prompts[0].id, value: mine.id });
  assert.equal(victoryPoints(r.state, 0, false), before + 1);
  const res = { forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore' }[mine.terrain];
  assert.equal(tradeRatio(r.state, 0, res), 2);
  // alchemist before rolling fixes the dice
  const t = game(); t.phase = 'roll'; t.rolled = false;
  t.prog.science.splice(t.prog.science.indexOf('alchemist'), 1); t.players[0].prog.push({ type: 'alchemist', deck: 'science', turn: 1 });
  bad(t, 0, { type: 'playProgress', card: 'alchemist', red: 7, yellow: 1 }, /dice/);
  let u = ok(t, 0, { type: 'playProgress', card: 'alchemist', red: 2, yellow: 6 }).state;
  u = ok(u, 0, { type: 'roll' }).state;
  assert.deepEqual(u.dice, [2, 6]);
  assert.deepEqual(checkInvariants(u), []);
});

test('pending choices block other moves until answered', () => {
  let s = game();
  s.prog.trade.splice(s.prog.trade.indexOf('merchantFleet'), 1); s.players[0].prog.push({ type: 'merchantFleet', deck: 'trade', turn: 1 });
  const r = ok(s, 0, { type: 'playProgress', card: 'merchantFleet' });
  bad(r.state, 0, { type: 'endTurn' }, /Answer/);
  bad(r.state, 1, { type: 'answer', id: r.state.prompts[0].id, value: 'wood' }, /another player/);
  bad(r.state, 0, { type: 'answer', id: r.state.prompts[0].id, value: 'gold' }, /options/);
  const t = ok(r.state, 0, { type: 'answer', id: r.state.prompts[0].id, value: 'wood' }).state;
  assert.equal(tradeRatio(t, 0, 'wood'), 2);
  const u = ok(t, 0, { type: 'endTurn' }).state;
  assert.equal(tradeRatio(u, 0, 'wood'), 4, 'Merchant Fleet lasts one turn');
});

test('complete Cities & Knights AI games, 3–6 players', () => {
  const levels = ['easy', 'normal', 'hard'];
  for (const n of [3, 4, 6]) {
    let s = createGame({ seed: 70 + n, players: Array.from({ length: n }, (_, i) => ({ name: `AI${i}`, isAI: true, ai: levels[i % 3] })), config: { ck: true, vpTarget: 13, map: n === 6 ? 'pangea' : 'classic' } });
    const mem = s.players.map((_, i) => createAIMemory(i + 9));
    let steps = 0, lastTurn = -1, perTurn = 0;
    while (s.phase !== 'over') {
      assert.ok(++steps < 80000, 'game should finish');
      if (s.turn !== lastTurn) { lastTurn = s.turn; perTurn = 0; }
      if (s.trade && !s.prompts.length) s.players.forEach(p => { const a = respondToTrade(s, p.id, mem[p.id]); if (a) { const r = applyAction(s, p.id, a); if (r.ok) s = r.state; } });
      const pid = pendingActors(s)[0];
      let a = decide(s, pid, mem[pid]);
      if (++perTurn > 150 && ['main', 'specialBuild'].includes(s.phase) && !s.prompts.length) a = { type: 'endTurn' };
      if (!a || a.type === 'wait') a = { type: s.trade ? 'cancelTrade' : 'endTurn' };
      let r = applyAction(s, pid, a);
      if (!r.ok) r = applyAction(s, pid, { type: s.phase === 'roll' ? 'roll' : 'endTurn' });
      assert.ok(r.ok, r.error);
      s = r.state;
      assert.deepEqual(checkInvariants(s), []);
    }
    assert.ok(victoryPoints(s, s.winner, true) >= 13);
  }
});
