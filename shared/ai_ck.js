// Terra Hex — AI for Cities & Knights. Returns an action, or undefined to fall back to the base AI.
import { RESOURCES, TERRAIN_RESOURCE, pips } from './board.js';
import { canAfford, handSize, victoryPoints, legalRobberHexes, robberVictims, legalRoadEdges, CKH, kinds } from './engine.js';
import { TRACKS, CK_COSTS, PROGRESS, BARBARIAN_STEPS } from './ck.js';

const COMMODITY_TRACK = { cloth: 'trade', coin: 'politics', paper: 'science' };

function hexValue(s, hid) { const h = s.board.hexes[hid]; return h.id === s.robber ? 0 : pips(h.number); }
function vertexProd(s, v) { return s.board.vertices[v].hexes.reduce((a, h) => a + hexValue(s, h), 0); }
function myTiles(s, pid) { return s.board.hexes.filter(h => h.vertices.some(v => s.vOwner[v] === pid)); }
function production(s, pid) {
  const out = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  s.vOwner.forEach((o, v) => {
    if (o !== pid) return;
    const k = s.vType[v] === 'city' ? 2 : 1;
    s.board.vertices[v].hexes.forEach(h => { const r = TERRAIN_RESOURCE[s.board.hexes[h].terrain]; if (r) out[r] += hexValue(s, h) * k; });
  });
  return out;
}
/** The card we would miss least (used for discards and gifts). */
function leastNeeded(s, pid, hand, n) {
  const h = { ...hand };
  const prod = production(s, pid);
  const keepCity = { wheat: 2, ore: 3 }, keepKnight = { sheep: 1, ore: 1 };
  const out = {};
  for (let i = 0; i < n; i++) {
    let best = null, bestScore = -Infinity;
    Object.keys(h).forEach(r => {
      if (!h[r]) return;
      let score = h[r] * 2 + (prod[r] || 0) * 0.15;
      score -= (keepCity[r] || 0) + (keepKnight[r] || 0) * 0.5;
      if (r === 'paper' || r === 'cloth' || r === 'coin') score -= 2.5; // commodities are precious
      if (score > bestScore) { bestScore = score; best = r; }
    });
    if (!best) break;
    h[best]--; out[best] = (out[best] || 0) + 1;
  }
  return out;
}
function mostWanted(s, pid, options) {
  const hand = s.players[pid].hand;
  return options.slice().sort((a, b) => (hand[a] || 0) - (hand[b] || 0))[0];
}
function cardValue(type) {
  const rank = { alchemist: 3, merchant: 6, resourceMonopoly: 7, warlord: 6, smith: 5, roadBuilding: 6, medicine: 5, irrigation: 5, mining: 6, wedding: 6, masterMerchant: 6, spy: 4, bishop: 4, deserter: 5, diplomat: 4, intrigue: 4, saboteur: 4, commercialHarbor: 4, crane: 4, engineer: 4, inventor: 3, merchantFleet: 4, tradeMonopoly: 5 };
  return rank[type] || 3;
}

function answerPrompt(s, pid, p, level) {
  const H = CKH;
  const opts = p.options || [];
  const pickBy = (fn) => opts.slice().sort((a, b) => fn(b) - fn(a))[0];
  const val = (v) => ({ type: 'answer', id: p.id, value: v });
  switch (p.purpose) {
    case 'progressDiscard': return val(pickBy(i => -cardValue(s.players[pid].prog[i].type)));
    case 'pillage': return val(pickBy(v => -vertexProd(s, v)));
    case 'defenderDeck': return val(['trade', 'politics', 'science'].sort((a, b) => s.players[pid].improve[b] - s.players[pid].improve[a])[0]);
    case 'aqueduct': return val(mostWanted(s, pid, opts));
    case 'metropolis': case 'engineer': return val(pickBy(v => vertexProd(s, v)));
    case 'medicine': return val(pickBy(v => vertexProd(s, v)));
    case 'smith': return val(opts.length ? pickBy(v => s.kLevel[v]) : null);
    case 'relocateKnight': case 'deserterPlace':
      return val(opts.length ? pickBy(v => s.board.vertices[v].hexes.reduce((a, h) => a + (h === s.robber ? 3 : 0), 0) + s.board.vertices[v].edges.filter(e => s.eOwner[e] === pid).length) : null);
    case 'inventor1': {
      const mine = opts.filter(h => s.board.hexes[h].vertices.some(v => s.vOwner[v] === pid));
      const pool = mine.length ? mine : opts;
      return val(pool.sort((a, b) => pips(s.board.hexes[a].number) - pips(s.board.hexes[b].number))[0]);
    }
    case 'inventor2': {
      const notMine = opts.filter(h => !s.board.hexes[h].vertices.some(v => s.vOwner[v] === pid));
      const pool = notMine.length ? notMine : opts;
      return val(pool.sort((a, b) => pips(s.board.hexes[b].number) - pips(s.board.hexes[a].number))[0]);
    }
    case 'bishop': return val(pickBy(h => s.board.hexes[h].vertices.reduce((a, v) => a + (s.vOwner[v] !== null && s.vOwner[v] !== pid ? 2 : s.vOwner[v] === pid ? -4 : 0), 0) + pips(s.board.hexes[h].number) * 0.2));
    case 'deserter': return val(pickBy(o => H.defenseOf(s, o) + H.knightsOf(s, o).length));
    case 'deserterRemove': return val(pickBy(v => -(s.kLevel[v] * 2 + (s.kActive[v] ? 1 : 0))));
    case 'diplomat': return val(pickBy(e => { const o = s.eOwner[e]; return o === pid ? -10 : (s.longestRoad === o ? 5 : 1) + s.players[o].roadLength * 0.1; }));
    case 'diplomatPlace': return val(opts.length ? opts[0] : null);
    case 'intrigue': return val(pickBy(v => s.kLevel[v]));
    case 'spy': return val(pickBy(o => s.players[o].prog.length));
    case 'spyTake': return val(pickBy(i => cardValue(p.reveal.prog[i].type)));
    case 'masterMerchant': return val(pickBy(o => handSize(s.players[o].hand)));
    case 'masterMerchantTake': {
      const src = p.reveal.hand, out = {};
      const order = ['coin', 'cloth', 'paper', 'ore', 'wheat', 'sheep', 'brick', 'wood'];
      let left = p.count;
      for (const r of order) while (left > 0 && (src[r] || 0) > (out[r] || 0)) { out[r] = (out[r] || 0) + 1; left--; }
      return val(out);
    }
    case 'discardHalf': case 'giveCards': return val(leastNeeded(s, pid, s.players[pid].hand, p.count));
    case 'chGive': {
      const h = s.players[pid].hand;
      const r = RESOURCES.filter(x => h[x] > 0).sort((a, b) => h[b] - h[a])[0];
      return val(r ? { [r]: 1 } : null);
    }
    case 'chReturn': {
      const h = s.players[pid].hand;
      const r = ['paper', 'cloth', 'coin'].filter(x => h[x] > 0).sort((a, b) => h[b] - h[a])[0];
      return val({ [r]: 1 });
    }
    case 'merchant': return val(pickBy(h => pips(s.board.hexes[h].number) + (production(s, pid)[TERRAIN_RESOURCE[s.board.hexes[h].terrain]] || 0) * 0.3));
    case 'fleet': { const h = s.players[pid].hand; return val(opts.slice().sort((a, b) => (h[b] || 0) - (h[a] || 0))[0]); }
    case 'resMonopoly': {
      const counts = Object.fromEntries(RESOURCES.map(r => [r, s.players.reduce((a, o) => a + (o.id !== pid && o.hand ? o.hand[r] : 0), 0)]));
      return val(RESOURCES.slice().sort((a, b) => counts[b] - counts[a] || (s.players[pid].hand[a] - s.players[pid].hand[b]))[0]);
    }
    case 'tradeMonopoly': {
      const best = ['trade', 'politics', 'science'].sort((a, b) => s.players[pid].improve[b] - s.players[pid].improve[a])[0];
      return val(TRACKS[best]);
    }
    default:
      if (p.kind === 'cards') return val(leastNeeded(s, pid, s.players[pid].hand, p.count));
      return val(opts.length ? opts[0] : null);
  }
}

/** Main entry: C&K-specific decisions. */
export function ckDecide(s, pid, memo, level) {
  const H = CKH;
  if (s.prompts && s.prompts.length) return s.prompts[0].pid === pid ? answerPrompt(s, pid, s.prompts[0], level) : null;
  if (s.current !== pid) return undefined;
  const me = s.players[pid];
  const hand = me.hand;
  const rand = memo.rand;

  if (s.phase === 'roll') {
    const ai = me.prog.findIndex(c => c.type === 'alchemist');
    if (ai >= 0 && level >= 1 && !s.forcedDice) {
      // Choose the total that pays us most (never 7).
      let best = 8, bestV = -1;
      [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].forEach(t => {
        const v = myTiles(s, pid).filter(h => h.number === t && h.id !== s.robber).length;
        if (v > bestV) { bestV = v; best = t; }
      });
      if (bestV > 0) {
        const maxLvl = Math.max(...Object.values(me.improve));
        let red = Math.min(6, Math.max(1, Math.min(maxLvl + 1, best - 1)));
        let yellow = best - red;
        if (yellow > 6) { yellow = 6; red = best - 6; }
        if (yellow < 1) { yellow = 1; red = best - 1; }
        return { type: 'playProgress', index: ai, red, yellow };
      }
    }
    return undefined;
  }
  if (s.phase !== 'main' && s.phase !== 'specialBuild') return undefined;
  const main = s.phase === 'main';
  memo.ckTurn = memo.ckTurn === s.turn ? memo.ckTurn : s.turn;
  if (memo.ckTurn !== memo.ckTurnSeen) { memo.ckTurnSeen = memo.ckTurn; memo.tried = {}; }
  const once = (key) => { if (memo.tried[key]) return false; memo.tried[key] = true; return true; };

  // --- Barbarian defence
  const strength = s.vType.filter((t, v) => t === 'city' && s.vOwner[v] !== null).length;
  const myDef = H.defenseOf(s, pid);
  const danger = s.barb.pos >= BARBARIAN_STEPS - (level >= 2 ? 4 : 3);
  const myCities = H.plainCities(s, pid).length;
  // Aim to cover the whole attack between us, and never be the weakest city owner.
  const need = myCities ? Math.max(1, Math.ceil(strength / s.players.length) + (level >= 1 ? 1 : 0)) : 0;
  if (danger && myDef < need + (level >= 2 ? 1 : 0)) {
    const inactive = H.knightsOf(s, pid).filter(v => !s.kActive[v]);
    if (inactive.length && canAfford(hand, CK_COSTS.activate)) return { type: 'activateKnight', vertex: inactive.sort((a, b) => s.kLevel[b] - s.kLevel[a])[0] };
    const spots = H.knightSpots(s, pid);
    if (H.knightPieces(s, pid, 1) > 0 && spots.length && canAfford(hand, CK_COSTS.knight)) return { type: 'buildKnight', vertex: spots[Math.floor(rand() * spots.length)] };
  }

  // --- Progress cards (main phase only)
  if (main) {
    for (let i = 0; i < me.prog.length; i++) {
      const t = me.prog[i].type;
      if (!once(`card${t}${i}`)) continue;
      const opp = s.players.filter(o => o.id !== pid);
      const myVp = victoryPoints(s, pid, false);
      let play = false;
      switch (t) {
        case 'warlord': play = H.knightsOf(s, pid).filter(v => !s.kActive[v]).length >= 1 && s.barb.pos >= 3; break;
        case 'irrigation': play = myTiles(s, pid).filter(h => h.terrain === 'fields').length >= 1; break;
        case 'mining': play = myTiles(s, pid).filter(h => h.terrain === 'mountains').length >= 1; break;
        case 'resourceMonopoly': case 'tradeMonopoly': case 'merchant': play = true; break;
        case 'bishop': play = s.barb.attacked; break;
        case 'spy': play = opp.some(o => o.prog && o.prog.length); break;
        case 'intrigue': play = H.intrigueTargets(s, pid).length > 0; break;
        case 'deserter': play = opp.some(o => H.knightsOf(s, o.id).length); break;
        case 'roadBuilding': play = legalRoadEdges(s, pid).length > 0; break;
        case 'smith': play = H.knightsOf(s, pid).some(v => H.canPromote(s, pid, v)); break;
        case 'engineer': play = H.cities(s, pid).some(v => !s.vWall[v]) && H.wallsOf(s, pid) < 3; break;
        case 'medicine': play = canAfford(hand, { ore: 2, wheat: 1 }) && s.vType.some((x, v) => x === 'settlement' && s.vOwner[v] === pid); break;
        case 'crane': play = ['trade', 'politics', 'science'].some(tr => me.improve[tr] < 5 && (hand[TRACKS[tr]] || 0) === me.improve[tr]); break;
        case 'wedding': case 'masterMerchant': play = opp.some(o => victoryPoints(s, o.id, false) > myVp); break;
        case 'saboteur': play = opp.some(o => victoryPoints(s, o.id, false) >= myVp && handSize(o.hand) >= 6); break;
        case 'diplomat': play = s.longestRoad !== null && s.longestRoad !== pid; break;
        case 'commercialHarbor': play = RESOURCES.some(r => hand[r] > 1); break;
        case 'merchantFleet': play = kinds(s).some(r => (hand[r] || 0) >= 4); break;
        case 'inventor': play = level >= 1; break;
        default: play = false;
      }
      if (play) return { type: 'playProgress', index: i };
    }
  }

  // --- City improvements (commodities)
  const tracks = ['science', 'politics', 'trade'].sort((a, b) => (hand[TRACKS[b]] || 0) - (hand[TRACKS[a]] || 0) || me.improve[b] - me.improve[a]);
  for (const tr of tracks) {
    if (me.improve[tr] >= 5 || !H.cities(s, pid).length) continue;
    const cost = H.improvementCost(s, pid, tr);
    if (canAfford(hand, cost) && once(`imp${tr}${me.improve[tr]}`)) return { type: 'improveCity', track: tr };
  }

  // --- Knight upkeep and actions
  if (main) {
    const robberNearMe = s.board.hexes[s.robber].vertices.some(v => s.vOwner[v] === pid) && s.board.hexes[s.robber].number;
    if (robberNearMe && s.barb.attacked) {
      const chaser = H.knightsOf(s, pid).find(v => s.kActive[v] && s.kActivated[v] !== s.turn && s.kActed[v] !== s.turn && s.board.vertices[v].hexes.includes(s.robber));
      if (chaser !== undefined && once(`chase${chaser}`)) return { type: 'chaseRobber', vertex: chaser };
    }
  }
  if (canAfford(hand, CK_COSTS.promote) && handSize(hand) >= 6) {
    const k = H.knightsOf(s, pid).find(v => H.canPromote(s, pid, v));
    if (k !== undefined && once(`promote${k}`)) return { type: 'promoteKnight', vertex: k };
  }
  if (!H.knightsOf(s, pid).length && H.knightSpots(s, pid).length && canAfford(hand, CK_COSTS.knight) && s.turn > 6 && once('firstKnight')) {
    const spots = H.knightSpots(s, pid);
    return { type: 'buildKnight', vertex: spots.sort((a, b) => vertexProd(s, b) - vertexProd(s, a))[0] };
  }
  // --- Walls when holding many cards
  if (handSize(hand) >= 7 && canAfford(hand, CK_COSTS.wall) && H.wallsOf(s, pid) < 3) {
    const c = H.cities(s, pid).find(v => !s.vWall[v]);
    if (c !== undefined && once(`wall${c}`)) return { type: 'buildWall', vertex: c };
  }
  return undefined;
}
