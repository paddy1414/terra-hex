// Terra Hex — Cities & Knights rules.
// Installed into the engine with installCK(api); it adds actions and answers engine hooks.
// Nothing here imports the engine, so there are no circular imports.

import { RESOURCES, TERRAIN_RESOURCE, pips } from './board.js';

export const COMMODITY_OF = { forest: 'paper', pasture: 'cloth', mountains: 'coin' };
export const TRACKS = { trade: 'cloth', politics: 'coin', science: 'paper' };
export const TRACK_NAMES = { trade: 'Trade', politics: 'Politics', science: 'Science' };
export const TRACK_ABILITY = {
  trade: { name: 'Trading House', text: 'Trade commodities with the bank at 2:1.' },
  politics: { name: 'Fortress', text: 'Promote strong knights to mighty knights.' },
  science: { name: 'Aqueduct', text: 'When a roll (other than 7) gives you nothing, take one resource of your choice.' }
};
export const CK_COSTS = {
  knight: { sheep: 1, ore: 1 }, promote: { sheep: 1, ore: 1 }, activate: { wheat: 1 }, wall: { brick: 2 }
};
export const KNIGHT_NAMES = { 1: 'Basic knight', 2: 'Strong knight', 3: 'Mighty knight' };
export const BARBARIAN_STEPS = 7;

export const PROGRESS = {
  // Science (green)
  alchemist: { deck: 'science', n: 2, name: 'Alchemist', text: 'Before rolling, choose the results of the red and yellow dice.', before: true },
  inventor: { deck: 'science', n: 2, name: 'Inventor', text: 'Swap two number tokens (not 2, 12, 6 or 8).' },
  crane: { deck: 'science', n: 2, name: 'Crane', text: 'Your next city improvement this turn costs one commodity less.' },
  irrigation: { deck: 'science', n: 2, name: 'Irrigation', text: 'Take 2 wheat for each fields tile next to your buildings.' },
  engineer: { deck: 'science', n: 1, name: 'Engineer', text: 'Build a city wall for free.' },
  medicine: { deck: 'science', n: 2, name: 'Medicine', text: 'Upgrade a settlement to a city for 2 ore and 1 wheat.' },
  mining: { deck: 'science', n: 2, name: 'Mining', text: 'Take 2 ore for each mountains tile next to your buildings.' },
  printer: { deck: 'science', n: 1, name: 'Printer', text: 'Worth 1 victory point, played as soon as you draw it.', vp: true },
  roadBuilding: { deck: 'science', n: 2, name: 'Road Building', text: 'Build two roads for free.' },
  smith: { deck: 'science', n: 2, name: 'Smith', text: 'Promote up to two knights for free.' },
  // Politics (blue)
  bishop: { deck: 'politics', n: 2, name: 'Bishop', text: 'Move the robber and steal one card from every player next to its new tile.' },
  constitution: { deck: 'politics', n: 1, name: 'Constitution', text: 'Worth 1 victory point, played as soon as you draw it.', vp: true },
  deserter: { deck: 'politics', n: 2, name: 'Deserter', text: 'An opponent removes one of their knights; you may place one of equal strength.' },
  diplomat: { deck: 'politics', n: 2, name: 'Diplomat', text: 'Remove an open road. If it is yours, you may rebuild it elsewhere.' },
  intrigue: { deck: 'politics', n: 2, name: 'Intrigue', text: 'Displace an opponent’s knight that touches one of your roads.' },
  saboteur: { deck: 'politics', n: 2, name: 'Saboteur', text: 'Everyone with as many points as you or more discards half their cards.' },
  spy: { deck: 'politics', n: 3, name: 'Spy', text: 'Look at an opponent’s progress cards and take one.' },
  warlord: { deck: 'politics', n: 2, name: 'Warlord', text: 'Activate all your knights for free.' },
  wedding: { deck: 'politics', n: 2, name: 'Wedding', text: 'Everyone with more points than you gives you 2 cards of their choice.' },
  // Trade (yellow)
  commercialHarbor: { deck: 'trade', n: 2, name: 'Commercial Harbor', text: 'Offer each opponent a resource; each must give you a commodity in return.' },
  masterMerchant: { deck: 'trade', n: 2, name: 'Master Merchant', text: 'Look at the hand of a player with more points and take 2 cards.' },
  merchant: { deck: 'trade', n: 6, name: 'Merchant', text: 'Place the merchant next to your building: 2:1 trades for that tile’s resource, and 1 point while you hold it.' },
  merchantFleet: { deck: 'trade', n: 2, name: 'Merchant Fleet', text: 'This turn, trade one resource or commodity of your choice with the bank at 2:1.' },
  resourceMonopoly: { deck: 'trade', n: 4, name: 'Resource Monopoly', text: 'Name a resource; every opponent gives you up to 2 of it.' },
  tradeMonopoly: { deck: 'trade', n: 2, name: 'Trade Monopoly', text: 'Name a commodity; every opponent gives you 1 of it.' }
};
export const DECK_TRACK = { trade: 'trade', politics: 'politics', science: 'science' };

export function installCK(api) {
  const {
    fail, log, handlers, pay, gain, canAfford, piecesLeft, legalRoadEdges, robberVictims, legalRobberHexes,
    updateLongestRoad, checkWin, randInt, shuffleInPlace, requireTurn, requirePhase, victoryPoints,
    handSize, kinds, discardLimitFor, robberLocked, settlementSpotFree, clone
  } = api;

  // ---------------------------------------------------------------- helpers
  const commodityTypes = ['paper', 'cloth', 'coin'];
  const cities = (s, pid) => s.vOwner.map((o, v) => (o === pid && s.vType[v] === 'city' ? v : -1)).filter(v => v >= 0);
  const plainCities = (s, pid) => cities(s, pid).filter(v => !s.vMetro[v]);
  const knightsOf = (s, pid) => s.kOwner.map((o, v) => (o === pid ? v : -1)).filter(v => v >= 0);
  const knightPieces = (s, pid, level) => 2 - knightsOf(s, pid).filter(v => s.kLevel[v] === level).length;
  const wallsOf = (s, pid) => s.vWall.filter((w, v) => w && s.vOwner[v] === pid).length;
  const vertexFree = (s, v) => s.vOwner[v] === null && s.kOwner[v] === null;
  const touchesOwnRoad = (s, pid, v) => s.board.vertices[v].edges.some(e => s.eOwner[e] === pid);
  const defenseOf = (s, pid) => knightsOf(s, pid).reduce((a, v) => a + (s.kActive[v] ? s.kLevel[v] : 0), 0);
  const name = (s, pid) => s.players[pid].name;

  function prompt(s, p, front = false) {
    p.id = ++s.promptSeq;
    if (front) s.prompts.unshift(p); else s.prompts.push(p);
    return p;
  }
  function takeCards(s, from, to, bundle) {
    Object.entries(bundle).forEach(([r, n]) => { s.players[from].hand[r] -= n; s.players[to].hand[r] += n; });
  }
  function randomCard(s, pid) {
    const pool = [];
    kinds(s).forEach(r => { for (let i = 0; i < s.players[pid].hand[r]; i++) pool.push(r); });
    return pool.length ? pool[randInt(s, pool.length)] : null;
  }
  /** Empty intersections reachable along a player's roads from vertex `from` (not through opponents). */
  function reachable(s, pid, from) {
    const seen = new Set([from]);
    const out = new Set();
    const queue = [from];
    while (queue.length) {
      const v = queue.shift();
      for (const e of s.board.vertices[v].edges) {
        if (s.eOwner[e] !== pid) continue;
        const ed = s.board.edges[e];
        const w = ed.v[0] === v ? ed.v[1] : ed.v[0];
        if (seen.has(w)) continue;
        seen.add(w);
        const ob = s.vOwner[w], ok = s.kOwner[w];
        if ((ob !== null && ob !== pid) || (ok !== null && ok !== pid)) { out.add(w); continue; } // can reach, not pass
        out.add(w);
        queue.push(w);
      }
    }
    return out;
  }
  function knightSpots(s, pid) {
    return s.board.vertices.filter(v => vertexFree(s, v.id) && touchesOwnRoad(s, pid, v.id)).map(v => v.id);
  }
  function improvementCost(s, pid, track) {
    const lvl = s.players[pid].improve[track];
    let n = lvl + 1;
    if (s.crane === pid) n = Math.max(0, n - 1);
    return { [TRACKS[track]]: n };
  }

  function drawProgress(s, pid, deck, events) {
    const card = s.prog[deck].shift();
    if (!card) { log(s, `The ${deck} deck is empty.`); return; }
    const p = s.players[pid];
    if (PROGRESS[card].vp) {
      p.progVP.push(card);
      log(s, `@${pid} drew ${PROGRESS[card].name} (+1 point).`);
      events.push({ type: 'progressVP', pid, card });
      return;
    }
    p.prog.push({ type: card, deck, turn: s.turn });
    events.push({ type: 'progressDrawn', pid, deck, card });
    log(s, `@${pid} drew a ${deck} progress card.`);
    if (p.prog.length > 4) {
      prompt(s, { pid, kind: 'progress', purpose: 'progressDiscard', title: 'Too many progress cards', text: 'You may hold 4. Choose one to put back.', options: p.prog.map((_, i) => i) });
    }
  }
  function returnCard(s, type) { s.prog[PROGRESS[type].deck].push(type); }

  // ---------------------------------------------------------------- engine hooks
  const CK = {
    init(s) {
      const n = s.board.vertices.length;
      s.kOwner = Array(n).fill(null); s.kLevel = Array(n).fill(0); s.kActive = Array(n).fill(false);
      s.kActivated = Array(n).fill(-1); s.kActed = Array(n).fill(-1); s.kPromoted = Array(n).fill(-1);
      s.vWall = Array(n).fill(false); s.vMetro = Array(n).fill(null);
      s.metropolis = { trade: null, politics: null, science: null };
      s.barb = { pos: 0, attacks: 0, attacked: false, last: null };
      s.prog = { trade: [], politics: [], science: [] };
      Object.entries(PROGRESS).forEach(([t, c]) => { for (let i = 0; i < c.n; i++) s.prog[c.deck].push(t); });
      Object.values(s.prog).forEach(d => shuffleInPlace(s, d));
      s.progTotal = 54;
      s.prompts = []; s.promptSeq = 0;
      s.merchant = null; s.crane = null; s.fleet = null; s.forcedDice = null; s.pendingRoll = null;
      s.players.forEach(p => { p.improve = { trade: 0, politics: 0, science: 0 }; p.prog = []; p.progVP = []; p.defender = 0; });
    },
    extraPoints(s, pid) {
      let vp = 0;
      s.vMetro.forEach((m, v) => { if (m && s.vOwner[v] === pid) vp += 2; });
      const p = s.players[pid];
      vp += (p.defender || 0) + (p.progVP ? p.progVP.length : 0);
      if (s.merchant && s.merchant.owner === pid) vp += 1;
      return vp;
    },
    tradeRatio(s, pid, res, ratio) {
      if (commodityTypes.includes(res) && s.players[pid].improve.trade >= 3) ratio = 2;
      if (s.merchant && s.merchant.owner === pid && TERRAIN_RESOURCE[s.board.hexes[s.merchant.hex].terrain] === res) ratio = 2;
      if (s.fleet && s.fleet.pid === pid && s.fleet.res === res) ratio = 2;
      return ratio;
    },
    endTurn(s) { s.crane = null; s.fleet = null; s.forcedDice = null; },
    invariants(s) {
      const out = [];
      const inDecks = Object.values(s.prog).reduce((a, d) => a + d.length, 0);
      const held = s.players.reduce((a, p) => a + p.prog.length + p.progVP.length, 0);
      if (inDecks + held !== 54) out.push(`progress cards ${inDecks + held}`);
      s.players.forEach(p => {
        [1, 2, 3].forEach(l => { if (knightPieces(s, p.id, l) < 0) out.push(`p${p.id} too many level ${l} knights`); });
        if (wallsOf(s, p.id) > 3) out.push(`p${p.id} too many walls`);
      });
      s.kOwner.forEach((o, v) => { if (o !== null && s.vOwner[v] !== null) out.push(`knight and building at ${v}`); });
      s.vWall.forEach((w, v) => { if (w && s.vType[v] !== 'city') out.push(`wall without city at ${v}`); });
      return out;
    },

    roll(s, pid, events) {
      const red = s.forcedDice ? s.forcedDice[0] : randInt(s, 6) + 1;
      const yellow = s.forcedDice ? s.forcedDice[1] : randInt(s, 6) + 1;
      s.forcedDice = null;
      const face = randInt(s, 6);
      const event = face < 3 ? 'ship' : ['trade', 'politics', 'science'][face - 3];
      const total = red + yellow;
      s.dice = [red, yellow];
      s.eventDie = event;
      s.rolled = true;
      s.stats.rolls[total]++;
      events.push({ type: 'roll', pid, dice: [red, yellow], event });
      log(s, `@${pid} rolled ${total} (${event === 'ship' ? 'the barbarian ship' : `a ${event} gate`}).`);
      // 1. Event die
      if (event === 'ship') {
        s.barb.pos++;
        events.push({ type: 'barbarians', pos: s.barb.pos });
        if (s.barb.pos >= BARBARIAN_STEPS) barbarianAttack(s, events);
      } else {
        for (let i = 0; i < s.players.length; i++) {
          const q = (s.current + i) % s.players.length;
          const lvl = s.players[q].improve[event];
          if (lvl >= 1 && red <= lvl + 1) drawProgress(s, q, event, events);
        }
      }
      // 2. Resources (after any choices the event caused, such as which city the barbarians pillage)
      s.pendingRoll = total;
      s.phase = 'main';
      if (!s.prompts.length) finishRoll(s, events);
    },
    afterPrompts(s, events) { if (s.pendingRoll && !s.prompts.length) finishRoll(s, events); }
  };

  function finishRoll(s, events) {
    const total = s.pendingRoll;
    s.pendingRoll = null;
    if (total === 7) { api.startSevenDiscards(s, events); return; }
    const owed = {};
    s.board.hexes.forEach(h => {
      if (h.number !== total || h.id === s.robber) return;
      const res = TERRAIN_RESOURCE[h.terrain];
      if (!res) return;
      h.vertices.forEach(v => {
        const o = s.vOwner[v];
        if (o === null) return;
        const add = (r, n) => { ((owed[r] ||= {})[o] ||= []).push({ hex: h.id, n }); };
        if (s.vType[v] === 'city') {
          const c = COMMODITY_OF[h.terrain];
          if (c) { add(res, 1); add(c, 1); } else add(res, 2);
        } else add(res, 1);
      });
    });
    const gains = [], shortages = [], got = new Set();
    Object.entries(owed).forEach(([res, byPid]) => {
      const pids = Object.keys(byPid).map(Number);
      const need = pids.reduce((a, p) => a + byPid[p].reduce((x, y) => x + y.n, 0), 0);
      if (need > s.bank[res] && pids.length > 1) { shortages.push(res); return; }
      pids.forEach(p => byPid[p].forEach(({ hex, n }) => {
        const give = Math.min(n, s.bank[res]);
        if (give > 0) { gain(s, p, res, give); gains.push({ pid: p, res, n: give, hex }); got.add(p); }
      }));
    });
    const blocked = s.board.hexes[s.robber].number === total;
    events.push({ type: 'produce', gains, shortages, blockedHex: blocked ? s.robber : null, number: total });
    shortages.forEach(r => log(s, `The bank ran short of :${r}:, so nobody collects it this roll.`));
    // Aqueduct: science level 3+ and nothing collected → one resource of choice.
    s.players.forEach(p => {
      if (p.improve.science >= 3 && !got.has(p.id)) {
        const options = RESOURCES.filter(r => s.bank[r] > 0);
        if (options.length) prompt(s, { pid: p.id, kind: 'resource', purpose: 'aqueduct', title: 'Aqueduct', text: 'This roll gave you nothing. Take one resource of your choice.', options });
      }
    });
  }

  function barbarianAttack(s, events) {
    const strength = s.vType.filter((t, v) => t === 'city' && s.vOwner[v] !== null).length;
    const defense = s.players.map(p => defenseOf(s, p.id));
    const total = defense.reduce((a, b) => a + b, 0);
    s.barb.pos = 0; s.barb.attacks++;
    const first = !s.barb.attacked;
    s.barb.attacked = true;
    const result = { strength, defense: total, perPlayer: defense, won: total >= strength, losers: [], defender: null, tied: [] };
    if (result.won) {
      const best = Math.max(...defense);
      if (best > 0) {
        const tops = s.players.filter(p => defense[p.id] === best).map(p => p.id);
        if (tops.length === 1) {
          s.players[tops[0]].defender++;
          result.defender = tops[0];
          log(s, `The barbarians are driven off (${total} vs ${strength}). @${tops[0]} is the Defender of Catan (+1 point).`);
        } else {
          result.tied = tops;
          log(s, `The barbarians are driven off (${total} vs ${strength}). The top defenders each draw a progress card.`);
          tops.forEach(pid => prompt(s, { pid, kind: 'deck', purpose: 'defenderDeck', title: 'Defender of Catan', text: 'You tied for the strongest defence. Draw a progress card from:', options: ['trade', 'politics', 'science'] }));
        }
      } else log(s, `The barbarians land, but there are no cities to attack.`);
    } else {
      const withCities = s.players.filter(p => plainCities(s, p.id).length);
      if (withCities.length) {
        const low = Math.min(...withCities.map(p => defense[p.id]));
        const losers = withCities.filter(p => defense[p.id] === low).map(p => p.id);
        result.losers = losers;
        log(s, `The barbarians win (${strength} vs ${total}) and pillage a city of ${losers.map(l => `@${l}`).join(', ')}.`);
        losers.forEach(pid => {
          const opts = plainCities(s, pid);
          if (opts.length === 1) pillage(s, pid, opts[0], events);
          else prompt(s, { pid, kind: 'vertex', purpose: 'pillage', title: 'The barbarians pillage a city', text: 'Choose which of your cities becomes a settlement again.', options: opts });
        });
      } else log(s, `The barbarians win (${strength} vs ${total}), but only metropolises stand, and those cannot be pillaged.`);
    }
    s.kActive = s.kActive.map(() => false);
    if (first) log(s, 'The robber may now be moved.');
    events.push({ type: 'barbarianAttack', ...result, first });
  }
  function pillage(s, pid, v, events) {
    if (piecesLeft(s, pid, 'settlement') <= 0) { s.vOwner[v] = null; s.vType[v] = null; log(s, `@${pid} had no settlement left, so the city was lost entirely.`); }
    else s.vType[v] = 'settlement';
    s.vWall[v] = false;
    events.push({ type: 'pillage', pid, vertex: v });
    updateLongestRoad(s, events);
  }

  function claimMetropolis(s, pid, track, events) {
    const lvl = s.players[pid].improve[track];
    const holder = s.metropolis[track];
    if (lvl < 4) return;
    if (holder === pid) return;
    if (holder !== null && !(lvl === 5 && s.players[holder].improve[track] < 5)) return;
    const opts = plainCities(s, pid);
    if (!opts.length) return;
    if (holder !== null) {
      const v = s.vMetro.findIndex(m => m === track);
      if (v >= 0) s.vMetro[v] = null;
      log(s, `@${pid} takes the ${TRACK_NAMES[track]} metropolis from @${holder}.`);
    }
    s.metropolis[track] = pid;
    if (opts.length === 1) placeMetro(s, pid, track, opts[0], events);
    else prompt(s, { pid, kind: 'vertex', purpose: 'metropolis', title: `${TRACK_NAMES[track]} metropolis`, text: 'Choose which city becomes your metropolis.', options: opts, data: { track } }, true);
  }
  function placeMetro(s, pid, track, v, events) {
    s.vMetro[v] = track;
    events.push({ type: 'metropolis', pid, track, vertex: v });
    log(s, `@${pid} builds the ${TRACK_NAMES[track]} metropolis (+2 points).`);
  }

  function startRelocate(s, owner, level, active, from, events) {
    const spots = knightSpots(s, owner).filter(v => v !== from);
    if (!spots.length) { log(s, `@${owner}'s displaced knight had nowhere to go and was removed.`); return; }
    prompt(s, { pid: owner, kind: 'vertex', purpose: 'relocateKnight', title: 'Your knight was displaced', text: 'Move it to an empty intersection on your roads.', options: spots, data: { level, active } }, true);
  }

  // ---------------------------------------------------------------- actions
  function requireCK(s) { if (!s.config.ck) fail('That is a Cities & Knights action.'); }
  function requireBuildPhase(s) { requirePhase(s, 'main', 'specialBuild'); }
  function ownKnight(s, pid, v) {
    if (!Number.isInteger(v) || s.kOwner[v] !== pid) fail('Choose one of your knights.');
  }

  Object.assign(handlers, {
    buildKnight(s, pid, { vertex }, events) {
      requireCK(s); requireTurn(s, pid); requireBuildPhase(s);
      if (knightPieces(s, pid, 1) <= 0) fail('You have no basic knights left (2 maximum). Promote one to free a piece.');
      if (!canAfford(s.players[pid].hand, CK_COSTS.knight)) fail('A knight costs 1 sheep and 1 ore.');
      if (!Number.isInteger(vertex) || !vertexFree(s, vertex)) fail('Knights need an empty intersection.');
      if (!touchesOwnRoad(s, pid, vertex)) fail('Knights must stand on one of your roads.');
      pay(s, pid, CK_COSTS.knight);
      s.kOwner[vertex] = pid; s.kLevel[vertex] = 1; s.kActive[vertex] = false;
      events.push({ type: 'build', kind: 'knight', id: vertex, pid });
      log(s, `@${pid} raised a basic knight.`);
      updateLongestRoad(s, events);
    },
    activateKnight(s, pid, { vertex }, events) {
      requireCK(s); requireTurn(s, pid); requireBuildPhase(s); ownKnight(s, pid, vertex);
      if (s.kActive[vertex]) fail('That knight is already active.');
      if (!canAfford(s.players[pid].hand, CK_COSTS.activate)) fail('Activating a knight costs 1 wheat.');
      pay(s, pid, CK_COSTS.activate);
      s.kActive[vertex] = true; s.kActivated[vertex] = s.turn;
      events.push({ type: 'knight', what: 'activate', id: vertex, pid });
      log(s, `@${pid} activated a knight.`);
    },
    promoteKnight(s, pid, { vertex, free = false }, events) {
      requireCK(s); requireTurn(s, pid); requireBuildPhase(s); ownKnight(s, pid, vertex);
      promote(s, pid, vertex, false, events);
    },
    moveKnight(s, pid, { vertex, to }, events) {
      requireCK(s); requireTurn(s, pid); requirePhase(s, 'main'); ownKnight(s, pid, vertex);
      readyToAct(s, vertex);
      if (!Number.isInteger(to) || !vertexFree(s, to) || !reachable(s, pid, vertex).has(to)) fail('Knights move along your own roads to an empty intersection.');
      moveKnightPiece(s, vertex, to);
      s.kActive[to] = false; s.kActed[to] = s.turn;
      events.push({ type: 'knight', what: 'move', id: to, from: vertex, pid });
      log(s, `@${pid} moved a knight.`);
      updateLongestRoad(s, events);
    },
    displaceKnight(s, pid, { vertex, target }, events) {
      requireCK(s); requireTurn(s, pid); requirePhase(s, 'main'); ownKnight(s, pid, vertex);
      readyToAct(s, vertex);
      const victim = s.kOwner[target];
      if (!Number.isInteger(target) || victim === null || victim === pid) fail('Choose an opponent’s knight.');
      if (s.kLevel[target] >= s.kLevel[vertex]) fail('You can only displace a weaker knight.');
      if (!reachable(s, pid, vertex).has(target)) fail('That knight is not reachable along your roads.');
      const level = s.kLevel[target], active = s.kActive[target];
      s.kOwner[target] = null; s.kLevel[target] = 0; s.kActive[target] = false;
      moveKnightPiece(s, vertex, target);
      s.kActive[target] = false; s.kActed[target] = s.turn;
      events.push({ type: 'knight', what: 'displace', id: target, from: vertex, pid, victim });
      log(s, `@${pid} displaced a knight of @${victim}.`);
      startRelocate(s, victim, level, active, target, events);
      updateLongestRoad(s, events);
    },
    chaseRobber(s, pid, { vertex }, events) {
      requireCK(s); requireTurn(s, pid); requirePhase(s, 'main'); ownKnight(s, pid, vertex);
      readyToAct(s, vertex);
      if (robberLocked(s)) fail('The robber cannot be moved until the barbarians first attack.');
      if (!s.board.vertices[vertex].hexes.includes(s.robber)) fail('The knight must stand next to the robber.');
      s.kActive[vertex] = false; s.kActed[vertex] = s.turn;
      s.returnPhase = 'main'; s.phase = 'robber';
      events.push({ type: 'knight', what: 'chase', id: vertex, pid });
      log(s, `@${pid}'s knight chases the robber away.`);
    },
    buildWall(s, pid, { vertex }, events) {
      requireCK(s); requireTurn(s, pid); requireBuildPhase(s);
      buildWallAt(s, pid, vertex, false, events);
    },
    improveCity(s, pid, { track }, events) {
      requireCK(s); requireTurn(s, pid); requireBuildPhase(s);
      if (!TRACKS[track]) fail('Unknown improvement.');
      const p = s.players[pid];
      if (!cities(s, pid).length) fail('City improvements need at least one city.');
      if (p.improve[track] >= 5) fail('That track is complete.');
      if (p.improve[track] >= 3 && !plainCities(s, pid).length && s.metropolis[track] !== pid) fail('Levels 4 and 5 need a city that can become a metropolis.');
      const cost = improvementCost(s, pid, track);
      if (!canAfford(p.hand, cost)) fail(`That improvement costs ${Object.values(cost)[0]} ${TRACKS[track]}.`);
      pay(s, pid, cost);
      if (s.crane === pid) s.crane = null;
      p.improve[track]++;
      events.push({ type: 'improve', pid, track, level: p.improve[track] });
      log(s, `@${pid} raised ${TRACK_NAMES[track]} to level ${p.improve[track]}.`);
      if (p.improve[track] === 3) log(s, `@${pid} gains the ${TRACK_ABILITY[track].name}.`);
      claimMetropolis(s, pid, track, events);
    },
    playProgress(s, pid, { index, red, yellow, card }, events) {
      requireCK(s); requireTurn(s, pid);
      const p = s.players[pid];
      if (!Number.isInteger(index)) index = p.prog.findIndex(c => c.type === card);
      const entry = p.prog[index];
      if (!entry) fail('You do not have that card.');
      const def = PROGRESS[entry.type];
      if (def.before) requirePhase(s, 'roll'); else requirePhase(s, 'main');
      // Validate before changing anything.
      const opp = s.players.filter(o => o.id !== pid);
      const myVp = victoryPoints(s, pid, false);
      switch (entry.type) {
        case 'alchemist':
          if (![red, yellow].every(d => Number.isInteger(d) && d >= 1 && d <= 6)) fail('Choose both dice (1–6).');
          break;
        case 'roadBuilding': if (piecesLeft(s, pid, 'road') <= 0 || !legalRoadEdges(s, pid).length) fail('You have nowhere to build a road.'); break;
        case 'engineer': if (wallsOf(s, pid) >= 3 || !cities(s, pid).some(v => !s.vWall[v])) fail('You have no city that can take a wall.'); break;
        case 'medicine':
          if (!canAfford(p.hand, { ore: 2, wheat: 1 })) fail('Medicine still costs 2 ore and 1 wheat.');
          if (piecesLeft(s, pid, 'city') <= 0 || !s.vType.some((t, v) => t === 'settlement' && s.vOwner[v] === pid)) fail('You have no settlement to upgrade.');
          break;
        case 'smith': if (!knightsOf(s, pid).some(v => canPromote(s, pid, v))) fail('None of your knights can be promoted.'); break;
        case 'bishop': if (robberLocked(s)) fail('The robber cannot be moved until the barbarians first attack.'); break;
        case 'deserter': if (!opp.some(o => knightsOf(s, o.id).length)) fail('No opponent has a knight.'); break;
        case 'diplomat': if (!openRoads(s).length) fail('There is no open road to remove.'); break;
        case 'intrigue': if (!intrigueTargets(s, pid).length) fail('No opponent knight touches your roads.'); break;
        case 'spy': if (!opp.some(o => o.prog.length)) fail('No opponent holds progress cards.'); break;
        case 'commercialHarbor': if (!RESOURCES.some(r => p.hand[r] > 0)) fail('You need a resource to offer.'); break;
        case 'masterMerchant': if (!opp.some(o => victoryPoints(s, o.id, false) > myVp && handSize(o.hand))) fail('Nobody with more points has cards.'); break;
        case 'merchant': if (!merchantHexes(s, pid).length) fail('You have no building next to a land tile.'); break;
        default: break;
      }
      p.prog.splice(index, 1);
      returnCard(s, entry.type);
      events.push({ type: 'progressPlayed', pid, card: entry.type });
      log(s, `@${pid} played ${def.name}.`);
      const ask = (q) => prompt(s, { pid, ...q });
      switch (entry.type) {
        case 'alchemist': s.forcedDice = [red, yellow]; break;
        case 'inventor': {
          const opts = s.board.hexes.filter(h => [3, 4, 5, 9, 10, 11].includes(h.number)).map(h => h.id);
          ask({ kind: 'hex', purpose: 'inventor1', title: 'Inventor', text: 'Choose the first number token to swap.', options: opts });
          break;
        }
        case 'crane': s.crane = pid; break;
        case 'irrigation': case 'mining': {
          const terrain = entry.type === 'irrigation' ? 'fields' : 'mountains', res = entry.type === 'irrigation' ? 'wheat' : 'ore';
          const tiles = s.board.hexes.filter(h => h.terrain === terrain && h.vertices.some(v => s.vOwner[v] === pid)).length;
          const n = Math.min(tiles * 2, s.bank[res]);
          if (n) { gain(s, pid, res, n); events.push({ type: 'gain', pid, resources: Array(n).fill(res) }); }
          log(s, `@${pid} took ${n} :${res}:.`);
          break;
        }
        case 'engineer': ask({ kind: 'vertex', purpose: 'engineer', title: 'Engineer', text: 'Choose a city for a free wall.', options: cities(s, pid).filter(v => !s.vWall[v]) }); break;
        case 'medicine': ask({ kind: 'vertex', purpose: 'medicine', title: 'Medicine', text: 'Choose a settlement to upgrade for 2 ore and 1 wheat.', options: s.vType.map((t, v) => (t === 'settlement' && s.vOwner[v] === pid ? v : -1)).filter(v => v >= 0) }); break;
        case 'roadBuilding': s.returnPhase = 'main'; s.phase = 'roadBuilding'; s.freeRoads = Math.min(2, piecesLeft(s, pid, 'road')); break;
        case 'smith': ask({ kind: 'vertex', purpose: 'smith', title: 'Smith', text: 'Choose a knight to promote for free (1 of 2).', options: knightsOf(s, pid).filter(v => canPromote(s, pid, v)), optional: true, data: { left: 2 } }); break;
        case 'bishop': ask({ kind: 'hex', purpose: 'bishop', title: 'Bishop', text: 'Move the robber. You steal one card from every player next to it.', options: legalRobberHexes(s, pid) }); break;
        case 'deserter': ask({ kind: 'player', purpose: 'deserter', title: 'Deserter', text: 'Choose an opponent. They remove one of their knights.', options: opp.filter(o => knightsOf(s, o.id).length).map(o => o.id) }); break;
        case 'diplomat': ask({ kind: 'edge', purpose: 'diplomat', title: 'Diplomat', text: 'Choose an open road to remove.', options: openRoads(s) }); break;
        case 'intrigue': ask({ kind: 'vertex', purpose: 'intrigue', title: 'Intrigue', text: 'Choose an opponent’s knight to displace.', options: intrigueTargets(s, pid) }); break;
        case 'saboteur':
          opp.filter(o => victoryPoints(s, o.id, false) >= myVp && handSize(o.hand) > 1).forEach(o => {
            prompt(s, { pid: o.id, kind: 'cards', purpose: 'discardHalf', title: 'Saboteur', text: `Discard ${Math.floor(handSize(o.hand) / 2)} cards.`, count: Math.floor(handSize(o.hand) / 2), types: kinds(s) });
          });
          break;
        case 'spy': ask({ kind: 'player', purpose: 'spy', title: 'Spy', text: 'Choose whose progress cards to look at.', options: opp.filter(o => o.prog.length).map(o => o.id) }); break;
        case 'warlord':
          knightsOf(s, pid).forEach(v => { if (!s.kActive[v]) { s.kActive[v] = true; s.kActivated[v] = s.turn; } });
          events.push({ type: 'knight', what: 'warlord', pid });
          break;
        case 'wedding':
          opp.filter(o => victoryPoints(s, o.id, false) > myVp && handSize(o.hand)).forEach(o => {
            const n = Math.min(2, handSize(o.hand));
            prompt(s, { pid: o.id, kind: 'cards', purpose: 'giveCards', title: 'Wedding', text: `Give ${n} card${n > 1 ? 's' : ''} of your choice to ${name(s, pid)}.`, count: n, types: kinds(s), data: { to: pid } });
          });
          break;
        case 'commercialHarbor':
          opp.forEach(o => {
            if (!commodityTypes.some(c => o.hand[c] > 0)) return;
            ask({ kind: 'cards', purpose: 'chGive', title: 'Commercial Harbor', text: `Choose a resource to give ${o.name}. They give you a commodity back.`, count: 1, types: RESOURCES, optional: true, data: { to: o.id } });
          });
          break;
        case 'masterMerchant': ask({ kind: 'player', purpose: 'masterMerchant', title: 'Master Merchant', text: 'Choose a player with more points. You take 2 of their cards.', options: opp.filter(o => victoryPoints(s, o.id, false) > myVp && handSize(o.hand)).map(o => o.id) }); break;
        case 'merchant': ask({ kind: 'hex', purpose: 'merchant', title: 'Merchant', text: 'Place the merchant on a tile next to one of your buildings.', options: merchantHexes(s, pid) }); break;
        case 'merchantFleet': ask({ kind: 'resource', purpose: 'fleet', title: 'Merchant Fleet', text: 'Choose what to trade at 2:1 this turn.', options: kinds(s) }); break;
        case 'resourceMonopoly': ask({ kind: 'resource', purpose: 'resMonopoly', title: 'Resource Monopoly', text: 'Name a resource. Every opponent gives you up to 2.', options: RESOURCES }); break;
        case 'tradeMonopoly': ask({ kind: 'resource', purpose: 'tradeMonopoly', title: 'Trade Monopoly', text: 'Name a commodity. Every opponent gives you 1.', options: commodityTypes }); break;
        default: break;
      }
      checkWin(s, events);
    },

    answer(s, pid, { id, value }, events) {
      requireCK(s);
      const p = s.prompts[0];
      if (!p || p.id !== id) fail('That question has already been answered.');
      if (p.pid !== pid) fail('That choice belongs to another player.');
      const skip = value === null || value === undefined;
      if (skip && !p.optional) fail('Make a choice.');
      if (!skip) {
        if (['vertex', 'edge', 'hex', 'player', 'resource', 'deck', 'progress'].includes(p.kind) && !p.options.includes(value)) fail('That is not one of the options.');
        if (p.kind === 'cards') {
          const b = {};
          (p.types || kinds(s)).forEach(t => { const n = Math.floor(Number(value[t]) || 0); if (n < 0) fail('Invalid amount.'); if (n) b[t] = n; });
          const total = Object.values(b).reduce((a, n) => a + n, 0);
          const source = p.reveal && p.reveal.hand ? s.players[p.data.from].hand : s.players[pid].hand;
          if (total !== p.count) fail(`Choose exactly ${p.count} card${p.count === 1 ? '' : 's'}.`);
          if (!canAfford(source, b)) fail('Those cards are not available.');
          value = b;
        }
      }
      s.prompts.shift();
      resolve(s, pid, p, skip ? null : value, events);
      CK.afterPrompts(s, events);
      checkWin(s, events);
    }
  });

  function readyToAct(s, v) {
    if (!s.kActive[v]) fail('Only an active knight can act. Activate it with 1 wheat.');
    if (s.kActivated[v] === s.turn) fail('A knight cannot act on the turn it was activated.');
    if (s.kActed[v] === s.turn) fail('That knight has already acted this turn.');
  }
  function moveKnightPiece(s, from, to) {
    s.kOwner[to] = s.kOwner[from]; s.kLevel[to] = s.kLevel[from]; s.kActive[to] = s.kActive[from];
    s.kActivated[to] = s.kActivated[from]; s.kPromoted[to] = s.kPromoted[from];
    s.kOwner[from] = null; s.kLevel[from] = 0; s.kActive[from] = false;
  }
  function canPromote(s, pid, v) {
    const l = s.kLevel[v];
    if (l >= 3 || s.kPromoted[v] === s.turn) return false;
    if (l === 2 && s.players[pid].improve.politics < 3) return false;
    return knightPieces(s, pid, l + 1) > 0;
  }
  function promote(s, pid, v, free, events) {
    const l = s.kLevel[v];
    if (l >= 3) fail('That knight is already mighty.');
    if (s.kPromoted[v] === s.turn) fail('A knight can be promoted once per turn.');
    if (l === 2 && s.players[pid].improve.politics < 3) fail('Mighty knights need the Fortress (Politics level 3).');
    if (knightPieces(s, pid, l + 1) <= 0) fail(`You have no ${KNIGHT_NAMES[l + 1].toLowerCase()}s left (2 maximum).`);
    if (!free) {
      if (!canAfford(s.players[pid].hand, CK_COSTS.promote)) fail('Promoting a knight costs 1 sheep and 1 ore.');
      pay(s, pid, CK_COSTS.promote);
    }
    s.kLevel[v] = l + 1; s.kPromoted[v] = s.turn;
    events.push({ type: 'knight', what: 'promote', id: v, pid, level: l + 1 });
    log(s, `@${pid} promoted a knight to ${KNIGHT_NAMES[l + 1].toLowerCase()}.`);
  }
  function buildWallAt(s, pid, v, free, events) {
    if (!Number.isInteger(v) || s.vOwner[v] !== pid || s.vType[v] !== 'city') fail('Walls go under your own cities.');
    if (s.vWall[v]) fail('That city already has a wall.');
    if (wallsOf(s, pid) >= 3) fail('You have no walls left (3 maximum).');
    if (!free) {
      if (!canAfford(s.players[pid].hand, CK_COSTS.wall)) fail('A city wall costs 2 brick.');
      pay(s, pid, CK_COSTS.wall);
    }
    s.vWall[v] = true;
    events.push({ type: 'build', kind: 'wall', id: v, pid });
    log(s, `@${pid} built a city wall (+2 card limit on a 7).`);
  }
  function openRoads(s) {
    return s.board.edges.filter(e => {
      const o = s.eOwner[e.id];
      if (o === null) return false;
      return e.v.some(v => s.vOwner[v] !== o && s.kOwner[v] !== o && !s.board.vertices[v].edges.some(x => x !== e.id && s.eOwner[x] === o));
    }).map(e => e.id);
  }
  function intrigueTargets(s, pid) {
    return s.kOwner.map((o, v) => (o !== null && o !== pid && touchesOwnRoad(s, pid, v) ? v : -1)).filter(v => v >= 0);
  }
  function merchantHexes(s, pid) {
    return s.board.hexes.filter(h => h.terrain !== 'desert' && h.vertices.some(v => s.vOwner[v] === pid)).map(h => h.id);
  }

  // ---------------------------------------------------------------- prompt answers
  function resolve(s, pid, p, value, events) {
    const ask = (q, front = true) => prompt(s, { pid, ...q }, front);
    switch (p.purpose) {
      case 'progressDiscard': {
        const card = s.players[pid].prog.splice(value, 1)[0];
        returnCard(s, card.type);
        log(s, `@${pid} put a progress card back.`);
        break;
      }
      case 'pillage': pillage(s, pid, value, events); break;
      case 'defenderDeck': drawProgress(s, pid, value, events); break;
      case 'aqueduct': if (s.bank[value] > 0) { gain(s, pid, value, 1); events.push({ type: 'gain', pid, resources: [value] }); log(s, `@${pid}'s aqueduct provides :${value}:.`); } break;
      case 'metropolis': placeMetro(s, pid, p.data.track, value, events); break;
      case 'relocateKnight':
        if (value === null) break;
        s.kOwner[value] = pid; s.kLevel[value] = p.data.level; s.kActive[value] = p.data.active;
        events.push({ type: 'knight', what: 'place', id: value, pid });
        updateLongestRoad(s, events);
        break;
      case 'inventor1': {
        const opts = p.options.filter(h => h !== value);
        ask({ kind: 'hex', purpose: 'inventor2', title: 'Inventor', text: 'Choose the second number token.', options: opts, data: { first: value } });
        break;
      }
      case 'inventor2': {
        const a = s.board.hexes[p.data.first], b = s.board.hexes[value];
        [a.number, b.number] = [b.number, a.number];
        events.push({ type: 'tokens', hexes: [a.id, b.id] });
        log(s, `@${pid} swapped the ${b.number} and ${a.number} tokens.`);
        break;
      }
      case 'engineer': buildWallAt(s, pid, value, true, events); break;
      case 'medicine':
        if (s.vOwner[value] !== pid || s.vType[value] !== 'settlement') fail('Choose one of your settlements.');
        pay(s, pid, { ore: 2, wheat: 1 });
        s.vType[value] = 'city';
        events.push({ type: 'build', kind: 'city', id: value, pid });
        log(s, `@${pid} upgraded a settlement to a city with Medicine.`);
        break;
      case 'smith': {
        if (value === null) break;
        promote(s, pid, value, true, events);
        const left = p.data.left - 1;
        const opts = knightsOf(s, pid).filter(v => canPromote(s, pid, v));
        if (left > 0 && opts.length) ask({ kind: 'vertex', purpose: 'smith', title: 'Smith', text: 'Choose a second knight to promote, or skip.', options: opts, optional: true, data: { left } });
        break;
      }
      case 'bishop': {
        const from = s.robber;
        s.robber = value;
        events.push({ type: 'robber', pid, hex: value, from });
        const victims = robberVictims(s, value, pid);
        victims.forEach(vpid => {
          const r = randomCard(s, vpid);
          if (r) { s.players[vpid].hand[r]--; s.players[pid].hand[r]++; events.push({ type: 'steal', pid, victim: vpid, res: r }); }
        });
        log(s, `@${pid} moved the robber and robbed ${victims.length} player${victims.length === 1 ? '' : 's'}.`);
        break;
      }
      case 'deserter': {
        const target = value;
        prompt(s, { pid: target, kind: 'vertex', purpose: 'deserterRemove', title: 'Deserter', text: `${name(s, pid)} played Deserter. Choose one of your knights to remove.`, options: knightsOf(s, target), data: { thief: pid } }, true);
        break;
      }
      case 'deserterRemove': {
        const level = s.kLevel[value];
        s.kOwner[value] = null; s.kLevel[value] = 0; s.kActive[value] = false;
        events.push({ type: 'knight', what: 'removed', id: value, pid });
        log(s, `@${pid} lost a knight to a deserter.`);
        const thief = p.data.thief;
        const spots = knightSpots(s, thief);
        if (knightPieces(s, thief, level) > 0 && spots.length) {
          prompt(s, { pid: thief, kind: 'vertex', purpose: 'deserterPlace', title: 'Deserter', text: `Place your new ${KNIGHT_NAMES[level].toLowerCase()} (inactive), or skip.`, options: spots, optional: true, data: { level } }, true);
        }
        updateLongestRoad(s, events);
        break;
      }
      case 'deserterPlace':
        if (value === null) break;
        s.kOwner[value] = pid; s.kLevel[value] = p.data.level; s.kActive[value] = false;
        events.push({ type: 'build', kind: 'knight', id: value, pid });
        updateLongestRoad(s, events);
        break;
      case 'diplomat': {
        const owner = s.eOwner[value];
        s.eOwner[value] = null;
        events.push({ type: 'roadRemoved', id: value, pid: owner });
        log(s, `@${pid} removed a road of @${owner}.`);
        updateLongestRoad(s, events);
        if (owner === pid) {
          const opts = legalRoadEdges(s, pid).filter(e => e !== value);
          if (opts.length) ask({ kind: 'edge', purpose: 'diplomatPlace', title: 'Diplomat', text: 'Rebuild your road somewhere else, or skip.', options: opts, optional: true });
        }
        break;
      }
      case 'diplomatPlace':
        if (value === null) break;
        s.eOwner[value] = pid;
        events.push({ type: 'build', kind: 'road', id: value, pid, free: true });
        updateLongestRoad(s, events);
        break;
      case 'intrigue': {
        const victim = s.kOwner[value];
        const level = s.kLevel[value], active = s.kActive[value];
        s.kOwner[value] = null; s.kLevel[value] = 0; s.kActive[value] = false;
        events.push({ type: 'knight', what: 'displaced', id: value, pid: victim });
        log(s, `@${pid} displaced a knight of @${victim} with Intrigue.`);
        startRelocate(s, victim, level, active, value, events);
        updateLongestRoad(s, events);
        break;
      }
      case 'discardHalf': api.payToBank(s, pid, value); events.push({ type: 'discard', pid, n: p.count }); log(s, `@${pid} discarded ${p.count} cards.`); break;
      case 'giveCards': takeCards(s, pid, p.data.to, value); events.push({ type: 'cardsMoved', from: pid, to: p.data.to, cards: value }); log(s, `@${pid} gave ${p.count} card${p.count > 1 ? 's' : ''} to @${p.data.to}.`); break;
      case 'spy': {
        const target = value;
        ask({ kind: 'progress', purpose: 'spyTake', title: 'Spy', text: `${name(s, target)}'s progress cards. Take one.`, options: s.players[target].prog.map((_, i) => i), reveal: { prog: clone(s.players[target].prog) }, data: { from: target } });
        break;
      }
      case 'spyTake': {
        const card = s.players[p.data.from].prog.splice(value, 1)[0];
        s.players[pid].prog.push({ ...card, turn: s.turn });
        log(s, `@${pid}'s spy took a progress card from @${p.data.from}.`);
        if (s.players[pid].prog.length > 4) ask({ kind: 'progress', purpose: 'progressDiscard', title: 'Too many progress cards', text: 'You may hold 4. Choose one to put back.', options: s.players[pid].prog.map((_, i) => i) });
        break;
      }
      case 'chGive': {
        if (value === null) break;
        const to = p.data.to;
        takeCards(s, pid, to, value);
        events.push({ type: 'cardsMoved', from: pid, to, cards: value });
        const opts = commodityTypes.filter(c => s.players[to].hand[c] > 0);
        if (opts.length) prompt(s, { pid: to, kind: 'cards', purpose: 'chReturn', title: 'Commercial Harbor', text: `${name(s, pid)} gave you a resource. Give a commodity back.`, count: 1, types: commodityTypes, data: { to: pid } }, true);
        break;
      }
      case 'chReturn': takeCards(s, pid, p.data.to, value); events.push({ type: 'cardsMoved', from: pid, to: p.data.to, cards: value }); break;
      case 'masterMerchant': {
        const target = value;
        const n = Math.min(2, handSize(s.players[target].hand));
        ask({ kind: 'cards', purpose: 'masterMerchantTake', title: 'Master Merchant', text: `${name(s, target)}'s hand. Take ${n} card${n > 1 ? 's' : ''}.`, count: n, types: kinds(s), reveal: { hand: clone(s.players[target].hand) }, data: { from: target } });
        break;
      }
      case 'masterMerchantTake': takeCards(s, p.data.from, pid, value); events.push({ type: 'cardsMoved', from: p.data.from, to: pid, cards: value }); log(s, `@${pid} took ${p.count} cards from @${p.data.from}.`); break;
      case 'merchant': {
        const prev = s.merchant ? s.merchant.owner : null;
        s.merchant = { hex: value, owner: pid };
        events.push({ type: 'merchant', pid, hex: value, from: prev });
        log(s, `@${pid} placed the merchant (+1 point).`);
        break;
      }
      case 'fleet': s.fleet = { pid, res: value }; log(s, `@${pid} may trade :${value}: at 2:1 this turn.`); break;
      case 'resMonopoly': case 'tradeMonopoly': {
        const per = p.purpose === 'resMonopoly' ? 2 : 1;
        let total = 0;
        s.players.forEach(o => {
          if (o.id === pid) return;
          const n = Math.min(per, o.hand[value]);
          if (n) { o.hand[value] -= n; s.players[pid].hand[value] += n; total += n; events.push({ type: 'cardsMoved', from: o.id, to: pid, cards: { [value]: n } }); }
        });
        log(s, `@${pid} collected ${total} :${value}:.`);
        break;
      }
      default: break;
    }
  }

  return { CK, helpers: { cities, plainCities, knightsOf, knightPieces, wallsOf, defenseOf, knightSpots, reachable, canPromote, improvementCost, openRoads, intrigueTargets, merchantHexes, vertexFree } };
}
