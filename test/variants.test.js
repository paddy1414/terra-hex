import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, MAPS, coastalEdges, buildTopology, CUSTOM_OPTIONS, cleanCustom, resourceBalance } from '../shared/board.js';
import {
  createGame, applyAction, legalRobberHexes, robberVictims, viewFor, checkInvariants, victoryPoints, pendingActors
} from '../shared/engine.js';
import { decide, respondToTrade, createAIMemory } from '../shared/ai.js';

const P = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000000' }));
function ok(s, pid, a) { const r = applyAction(s, pid, a); assert.ok(r.ok, `${a.type}: ${r.error}`); return r.state; }
function bad(s, pid, a, re) { const r = applyAction(s, pid, a); assert.equal(r.ok, false, `${a.type} should fail`); if (re) assert.match(r.error, re); }
function mainGame(n, config = {}) {
  const s = createGame({ seed: 11, players: P(n), config: { layout: 'beginner', ...config } });
  s.phase = 'main'; s.current = 0; s.turn = 5; s.rolled = true;
  return s;
}
const place = (s, pid, v, t = 'settlement') => { s.vOwner[v] = pid; s.vType[v] = t; };

test('all built-in maps generate valid boards with every number layout', () => {
  assert.equal(MAPS.length, 12);
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const m of MAPS) {
    for (const layout of ['balanced', 'random', 'unrestricted']) {
      for (let i = 0; i < 15; i++) {
        const b = generateBoard({ map: m.id, layout, custom: { seed: `t${i}` } }, rand);
        assert.equal(b.map, m.id);
        assert.ok(b.hexes.some(h => h.terrain === 'desert'), `${m.id}: has a desert for the robber`);
        b.hexes.forEach(h => assert.equal(!!h.number, h.terrain !== 'desert' && h.terrain !== 'sea'));
        assert.ok(b.ports.length >= 5 && b.ports.length <= 12);
        const pv = b.ports.flatMap(p => p.vertices);
        assert.equal(new Set(pv).size, pv.length, 'harbours never share an intersection');
        b.ports.forEach(p => {
          if (b.sea) assert.ok(b.edges[p.edge].hexes.some(x => b.hexes[x].terrain === 'sea') && b.edges[p.edge].hexes.some(x => b.hexes[x].terrain !== 'sea'), 'harbours face the sea');
          else assert.equal(b.edges[p.edge].hexes.length, 1, 'harbours sit on the coast');
          // never on a lake shore
          const e = b.edges[p.edge], h = b.hexes[e.hexes[0]];
          const ox = 2 * e.x - h.x, oy = 2 * e.y - h.y;
          assert.ok(!b.lakes.some(l => Math.hypot(l.x - ox, l.y - oy) < 0.01), `${m.id}: harbour on a lake`);
        });
        if (layout !== 'unrestricted') {
          b.hexes.forEach(h => {
            if (h.number === 6 || h.number === 8) h.neighbors.forEach(n => assert.ok(![6, 8].includes(b.hexes[n].number), `${m.id}/${layout}: reds touch`));
          });
        }
      }
    }
  }
});

test('lakes and channels: map shapes have the expected features', () => {
  let seed = 9;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  assert.equal(generateBoard({ map: 'lakes' }, rand).lakes.length, 3);
  assert.equal(generateBoard({ map: 'gear' }, rand).lakes.length, 1);
  assert.equal(generateBoard({ map: 'pangea' }, rand).hexes.length, 37);
  const oasis = generateBoard({ map: 'oasis' }, rand);
  const centre = oasis.hexes.find(h => h.q === 0 && h.r === 0);
  assert.equal(centre.terrain, 'desert');
  oasis.hexes.filter(h => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) === 1)
    .forEach(h => assert.ok(['mountains', 'fields', 'pasture'].includes(h.terrain), 'rich ring'));
  const w1 = generateBoard({ map: 'wild' }, rand), w2 = generateBoard({ map: 'wild' }, rand);
  assert.notDeepEqual(w1.hexes.map(h => `${h.q},${h.r}`), w2.hexes.map(h => `${h.q},${h.r}`), 'wild frontier changes shape');
  assert.equal(coastalEdges(buildTopology()).length, 30);
});

test('5–6 players use the larger bank and deck', () => {
  const s4 = createGame({ seed: 1, players: P(4) });
  const s6 = createGame({ seed: 1, players: P(6) });
  assert.equal(s4.bank.wood, 19); assert.equal(s4.devDeck.length, 25); assert.equal(s4.config.specialBuild, false);
  assert.equal(s6.bank.wood, 24); assert.equal(s6.devDeck.length, 34); assert.equal(s6.config.specialBuild, true);
  assert.equal(s6.devDeck.filter(c => c === 'knight').length, 20);
  assert.equal(s6.setup.order.length, 12);
  assert.throws(() => createGame({ seed: 1, players: P(7) }));
});

test('Special Building Phase: everyone else may build, in order, then the next turn starts', () => {
  let s = mainGame(5);
  s.players.forEach((p, i) => { p.hand.wheat += 2; p.hand.ore += 3; s.bank.wheat -= 2; s.bank.ore -= 3; });
  // give players 1..4 a settlement each to upgrade
  const spots = []; s.board.vertices.forEach(v => { if (spots.length < 5 && v.adj.every(a => s.vOwner[a] === null) && s.vOwner[v.id] === null) { place(s, spots.length, v.id); spots.push(v.id); } });
  s = ok(s, 0, { type: 'endTurn' });
  assert.equal(s.phase, 'specialBuild');
  assert.equal(s.current, 1);
  bad(s, 1, { type: 'roll' });
  bad(s, 1, { type: 'offerTrade', give: { ore: 1 }, get: { wood: 1 } });
  s.devDeck.splice(s.devDeck.indexOf('knight'), 1); s.players[1].dev = [{ type: 'knight', turn: 1 }];
  bad(s, 1, { type: 'playDev', card: 'knight' });
  bad(s, 2, { type: 'buildCity', vertex: spots[2] }, /not your turn/);
  s = ok(s, 1, { type: 'buildCity', vertex: spots[1] });
  s = ok(s, 1, { type: 'endTurn' });
  assert.equal(s.current, 2);
  s = ok(s, 2, { type: 'endTurn' });
  s = ok(s, 3, { type: 'endTurn' });
  s = ok(s, 4, { type: 'endTurn' });
  assert.equal(s.phase, 'roll');
  assert.equal(s.current, 1, 'the player after the turn owner rolls next');
  assert.equal(s.turn, 6);
  assert.deepEqual(checkInvariants(s), []);
});

test('Special Building Phase: you cannot win during it, only at the start of your turn', () => {
  let s = mainGame(5);
  s.config.vpTarget = 3;
  const spots = []; s.board.vertices.forEach(v => { if (spots.length < 3 && v.adj.every(a => s.vOwner[a] === null) && s.vOwner[v.id] === null) { spots.push(v.id); } });
  place(s, 2, spots[0]); place(s, 2, spots[1]);
  s.players[2].hand.wheat = 2; s.players[2].hand.ore = 3; s.bank.wheat -= 2; s.bank.ore -= 3;
  s = ok(s, 0, { type: 'endTurn' });
  s = ok(s, 1, { type: 'endTurn' });
  s = ok(s, 2, { type: 'buildCity', vertex: spots[0] });
  assert.equal(victoryPoints(s, 2, true), 3);
  assert.notEqual(s.phase, 'over');
  s = ok(s, 2, { type: 'endTurn' }); s = ok(s, 3, { type: 'endTurn' }); s = ok(s, 4, { type: 'endTurn' });
  // player 1's turn now; player 2 must wait for their own turn
  assert.equal(s.current, 1); assert.notEqual(s.phase, 'over');
  s.phase = 'main';
  s = ok(s, 1, { type: 'endTurn' });
  for (const p of s.sbp.queue.slice()) { void p; }
  while (s.phase === 'specialBuild') s = ok(s, s.current, { type: 'endTurn' });
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 2);
});

test('Friendly Robber protects players on 2 points or fewer', () => {
  let s = mainGame(3, { friendlyRobber: true });
  s.phase = 'robber'; s.returnPhase = 'main';
  const hex = s.board.hexes.find(h => h.id !== s.robber);
  place(s, 1, hex.vertices[0]);
  s.players[1].hand.ore = 3; s.bank.ore -= 3;
  assert.ok(!legalRobberHexes(s).includes(hex.id), 'blocked: player 1 has only 1 point');
  bad(s, 0, { type: 'moveRobber', hex: hex.id, victim: 1 }, /Friendly Robber/);
  // with 3 points, they can be robbed
  const extra = s.board.vertices.filter(v => v.adj.every(a => s.vOwner[a] === null) && s.vOwner[v.id] === null && !hex.vertices.includes(v.id)).slice(0, 1);
  place(s, 1, extra[0].id, 'city');
  assert.ok(legalRobberHexes(s).includes(hex.id));
  assert.deepEqual(robberVictims(s, hex.id, 0), [1]);
  s = ok(s, 0, { type: 'moveRobber', hex: hex.id, victim: 1 });
  assert.equal(s.players[1].hand.ore, 2);
  // without the rule, nobody is protected
  const t = mainGame(3);
  t.phase = 'robber';
  place(t, 1, hex.vertices[0]);
  assert.ok(legalRobberHexes(t).includes(hex.id));
});

test('Balanced Dice: deterministic, every total possible, upcoming rolls never sent to players', () => {
  const roll = (seed) => {
    let s = createGame({ seed, players: P(3), config: { balancedDice: true } });
    s.phase = 'roll'; s.current = 0; s.turn = 1;
    const totals = [];
    for (let i = 0; i < 72; i++) {
      s = ok(s, s.current, { type: 'roll' });
      totals.push(s.dice[0] + s.dice[1]);
      s.phase = 'roll'; s.discards = {};
    }
    return { totals, s };
  };
  const a = roll(5), b = roll(5);
  assert.deepEqual(a.totals, b.totals);
  for (let t = 2; t <= 12; t++) assert.ok(a.totals.includes(t), `total ${t} occurs`);
  // fewer immediate repeats than chance would give over many rolls
  let rep = 0; a.totals.forEach((t, i) => { if (i && t === a.totals[i - 1]) rep++; });
  assert.ok(rep < 10);
  assert.equal(viewFor(a.s, 0).diceBag, undefined);
});

test('Hidden Hands hides card counts, and robbing an empty hand takes nothing', () => {
  let s = mainGame(3, { hiddenHands: true });
  s.players[1].hand.ore = 2; s.bank.ore -= 2;
  const v = viewFor(s, 0);
  assert.equal(v.players[1].handCount, null);
  assert.equal(v.players[0].handCount, 0, 'you still see your own count');
  s.phase = 'robber'; s.returnPhase = 'main';
  const hex = s.board.hexes.find(h => h.id !== s.robber);
  place(s, 2, hex.vertices[0]); // player 2 has no cards
  assert.deepEqual(robberVictims(s, hex.id, 0), [2], 'empty hands can be picked when counts are hidden');
  s = ok(s, 0, { type: 'moveRobber', hex: hex.id, victim: 2 });
  assert.equal(s.phase, 'main');
  assert.deepEqual(checkInvariants(s), []);
});

test('complete AI games on every map, with 5 and 6 players and house rules on', () => {
  const levels = ['easy', 'normal', 'hard'];
  for (const m of MAPS) {
    for (const n of [5, 6]) {
      let s = createGame({ seed: 900 + n, players: Array.from({ length: n }, (_, i) => ({ name: `AI${i}`, isAI: true, ai: levels[i % 3] })),
        config: { map: m.id, friendlyRobber: true, balancedDice: true, hiddenHands: n === 6 } });
      const mem = s.players.map((_, i) => createAIMemory(i + 1));
      let steps = 0, lastTurn = -1, perTurn = 0;
      while (s.phase !== 'over') {
        assert.ok(++steps < 40000, `${m.id}/${n} should finish`);
        if (s.turn !== lastTurn) { lastTurn = s.turn; perTurn = 0; }
        if (s.trade) s.players.forEach(p => { const a = respondToTrade(s, p.id, mem[p.id]); if (a) s = ok(s, p.id, a); });
        const pid = pendingActors(s)[0];
        let a = decide(s, pid, mem[pid]);
        if (++perTurn > 120 && s.phase === 'main') a = { type: 'endTurn' };
        if (!a || a.type === 'wait') a = { type: s.trade ? 'cancelTrade' : 'endTurn' };
        s = ok(s, pid, a);
      }
      assert.deepEqual(checkInvariants(s), []);
      assert.ok(victoryPoints(s, s.winner, true) >= 10);
    }
  }
});

test('map generator: same seed, same island; every size and shape stays balanced', () => {
  const opts = { seed: 'harbor-reef-7', size: 'large', shape: 'archipelago', water: 'lots', resources: 'rocky' };
  const a = generateBoard({ map: 'custom', custom: opts }, Math.random);
  const b = generateBoard({ map: 'custom', custom: opts }, Math.random);
  assert.deepEqual(a.hexes.map(h => [h.q, h.r, h.terrain, h.number]), b.hexes.map(h => [h.q, h.r, h.terrain, h.number]));
  assert.deepEqual(a.ports.map(p => [p.edge, p.type]), b.ports.map(p => [p.edge, p.type]));
  const c = generateBoard({ map: 'custom', custom: { ...opts, seed: 'other' } }, Math.random);
  assert.notDeepEqual(a.hexes.map(h => h.terrain), c.hexes.map(h => h.terrain));
  for (const size of Object.keys(CUSTOM_OPTIONS.size)) {
    for (const shape of CUSTOM_OPTIONS.shape) {
      for (const resources of Object.keys(CUSTOM_OPTIONS.resources)) {
        const g = generateBoard({ map: 'custom', custom: { seed: `${size}${shape}${resources}`, size, shape, resources, water: 'some' } }, Math.random);
        const [lo, hi] = CUSTOM_OPTIONS.size[size];
        assert.ok(g.hexes.length + g.lakes.length >= lo - 1 && g.hexes.length + g.lakes.length <= hi, `${size}: ${g.hexes.length + g.lakes.length} cells`);
        const bal = resourceBalance(g.hexes);
        const numbered = g.hexes.filter(h => h.number).length;
        assert.equal(Object.keys(bal.tiles).length, 5, 'all five resources present');
        Object.values(bal.tiles).forEach(t => assert.ok(t / numbered >= 0.1, 'each resource on at least a tenth of the tiles'));
        assert.ok(bal.err < 0.002, `production balanced (${bal.err})`);
        g.hexes.forEach(h => { if (h.number === 6 || h.number === 8) h.neighbors.forEach(n => assert.ok(![6, 8].includes(g.hexes[n].number))); });
        const pv = g.ports.flatMap(p => p.vertices);
        assert.equal(new Set(pv).size, pv.length);
      }
    }
  }
});

test('map generator settings are cleaned', () => {
  const c = cleanCustom({ seed: '<script>x', size: 'galactic', shape: 'ring', deserts: 9, biome: 'winter', trees: 'dense' });
  assert.equal(c.seed, 'scriptx'); assert.equal(c.size, 'medium'); assert.equal(c.shape, 'ring');
  assert.equal(c.deserts, -1); assert.equal(c.biome, 'winter'); assert.equal(c.trees, 'dense');
  const s = createGame({ seed: 1, players: P(3), config: { map: 'custom', custom: { seed: 'abc', size: 'small', deserts: 0 } } });
  assert.equal(s.config.custom.seed, 'abc');
  assert.equal(s.board.hexes.filter(h => h.terrain === 'desert').length, 0);
  assert.equal(s.robber, 0, 'with no desert the robber starts on a tile');
});

test('complete AI games on generated maps of every shape', () => {
  for (const shape of CUSTOM_OPTIONS.shape) {
    let s = createGame({ seed: 5, players: Array.from({ length: 4 }, (_, i) => ({ name: `AI${i}`, isAI: true, ai: 'normal' })), config: { map: 'custom', custom: { seed: shape, shape, size: 'medium', water: 'lots' } } });
    const mem = s.players.map((_, i) => createAIMemory(i + 3));
    let steps = 0, lastTurn = -1, perTurn = 0;
    while (s.phase !== 'over') {
      assert.ok(++steps < 30000, `${shape} should finish`);
      if (s.turn !== lastTurn) { lastTurn = s.turn; perTurn = 0; }
      if (s.trade) s.players.forEach(p => { const a = respondToTrade(s, p.id, mem[p.id]); if (a) s = ok(s, p.id, a); });
      const pid = pendingActors(s)[0];
      let a = decide(s, pid, mem[pid]);
      if (++perTurn > 120 && s.phase === 'main') a = { type: 'endTurn' };
      if (!a || a.type === 'wait') a = { type: s.trade ? 'cancelTrade' : 'endTurn' };
      s = ok(s, pid, a);
    }
    assert.deepEqual(checkInvariants(s), []);
  }
});
