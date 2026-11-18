/**
 * Terra Hex server — serves the game and runs online rooms.
 * The server owns every room's game state: players send actions, the shared rules engine checks them,
 * and each player receives only what they are allowed to see. No npm packages needed.
 *
 *   node server.js --port 7779
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MAP_BY_ID, LAYOUTS, cleanCustom } from './shared/board.js';
import {
  createGame, applyAction, viewFor, eventsFor, pendingActors, DEFAULT_CONFIG, victoryPoints
} from './shared/engine.js';
import { decide, respondToTrade, createAIMemory } from './shared/ai.js';
import { createAccounts } from './accounts.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let port = parseInt(process.env.PORT, 10) || 7779;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    const n = parseInt(args[i + 1], 10);
    if (Number.isInteger(n) && n > 0 && n < 65536) port = n;
  }
}
const DATA_DIR = process.env.TERRAHEX_DATA || path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'rooms.json');
const accounts = createAccounts(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const PUBLIC_DIRS = ['client', 'shared'];
const MAX_BODY = 64 * 1024;
const MAX_ROOMS = 300;
const ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
const AWAY_MS = 45 * 1000;
const COLORS = ['#d94a3d', '#2f6fd6', '#e8e1cf', '#e48a1c', '#3c9a4e', '#8a5a3b', '#8b55c9', '#2aa7a0'];
const MAX_SEATS = 6;
const TIMER_STEPS = [0, 30, 45, 60, 90, 120, 180, 300];
const CODE_RE = /^[A-Z0-9]{6}$/;
const AI_LEVELS = ['easy', 'normal', 'hard'];
const AI_SPEED = Number(process.env.TERRAHEX_AI_SPEED) || 1; // tests use a tiny value

/** code -> room */
const rooms = new Map();
let dirty = false;

// ------------------------------------------------------------------ helpers
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), MIME['.json']);
const httpError = (status, msg) => Object.assign(new Error(msg), { status });

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
const cleanName = (n, fallback = 'Player') => String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || fallback;
const cleanColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? String(c) : null);
const newId = () => crypto.randomBytes(9).toString('base64url');
function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += chars[crypto.randomInt(chars.length)];
    if (!rooms.has(c)) return c;
  }
}

// ------------------------------------------------------------------ rooms
function publicRoom(room) {
  return {
    code: room.code, status: room.status, hostUid: room.hostUid, config: room.config,
    seats: room.seats.map(s => ({
      name: s.name, color: s.color, isAI: s.isAI, ai: s.ai, uid: s.uid ? s.uid.slice(0, 6) : null,
      online: s.uid ? isOnline(room, s.uid) : true
    }))
  };
}
function isOnline(room, uid) { return (room.clients.get(uid)?.size || 0) > 0; }
function seatOf(room, uid) { return room.seats.findIndex(s => s.uid === uid); }

function auth(room, body) {
  const uid = String(body.uid || '');
  if (!uid || room.tokens[uid] !== String(body.token || '')) throw httpError(403, 'Not a member of this room.');
  return uid;
}

function broadcast(room, events = []) {
  room.touched = Date.now();
  dirty = true;
  const pub = publicRoom(room);
  room.clients.forEach((set, uid) => {
    const seat = seatOf(room, uid);
    const payload = {
      room: pub, you: seat, isHost: uid === room.hostUid,
      view: room.state ? viewFor(room.state, seat >= 0 ? seat : null) : null,
      events: room.state ? eventsFor(events, seat) : [],
      deadline: room.deadline || null,
      chat: (room.chat || []).slice(-50),
      ratings: room.ratings || null
    };
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    set.forEach(res => { try { res.write(msg); } catch { /* closed */ } });
  });
}

function startGame(room) {
  const humans = room.seats.filter(s => !s.isAI).length;
  if (room.seats.length < 3 && humans < 2) throw httpError(400, 'Add players or AI to make at least 3 seats.');
  if (room.seats.length < 2) throw httpError(400, 'At least two seats are needed.');
  room.state = createGame({
    seed: crypto.randomInt(1, 2 ** 31),
    players: room.seats.map(s => ({ name: s.name, color: s.color, isAI: s.isAI, ai: s.ai })),
    config: room.config
  });
  room.status = 'playing';
  room.ai = room.seats.map((_, i) => createAIMemory(crypto.randomInt(1, 2 ** 31) + i));
  room.recentActions = {};
  resetClock(room);
  broadcast(room, [{ type: 'start' }]);
  scheduleAI(room);
}

/** Applies an action from seat `pid`. Throws on illegal moves. */
function act(room, pid, action) {
  const r = applyAction(room.state, pid, action);
  if (!r.ok) throw httpError(422, r.error);
  const prevKey = clockKey(room.state);
  room.state = r.state;
  if (room.state.phase === 'over') {
    room.status = 'over'; room.deadline = null;
    if (!room.recorded) {
      room.recorded = true;
      const s = room.state;
      const seats = room.seats.map((seat, i) => ({ accountId: seat.accountId || null, isAI: seat.isAI, name: seat.name, vp: victoryPoints(s, i, true), winner: s.winner === i }));
      if (seats.some(x => x.accountId)) room.ratings = accounts.recordGame(seats, { map: s.board.map, mode: s.config.ck ? 'ck' : s.config.sea ? 'sea' : 'classic' });
    }
  }
  else if (clockKey(room.state) !== prevKey) resetClock(room);
  broadcast(room, r.events);
  scheduleAI(room);
}

// ------------------------------------------------------------------ turn clock & absent players
function clockKey(s) { return `${s.current}|${s.turn}|${s.phase === 'discard' ? 'd' : s.phase}|${s.setup.index}|${s.prompts && s.prompts.length ? s.prompts[0].id : ''}`; }
function resetClock(room) {
  const t = Number(room.config.turnTimer) || 0;
  room.deadline = t > 0 ? Date.now() + t * 1000 : null;
  room.clockStarted = Date.now();
}

/** Plays a sensible move for a human who ran out of time or is disconnected. */
function autoPlay(room, pid) {
  const s = room.state;
  const mem = room.ai[pid] || (room.ai[pid] = createAIMemory(pid + 1));
  let a;
  const proxy = { ...s, players: s.players.map(p => (p.id === pid ? { ...p, ai: 'easy' } : p)) };
  const owesAnswer = s.prompts && s.prompts.length && s.prompts[0].pid === pid;
  if (!owesAnswer && (s.phase === 'main' || s.phase === 'specialBuild') && s.current === pid) a = s.trade ? { type: 'cancelTrade' } : { type: 'endTurn' };
  else a = decide(proxy, pid, mem);
  if (!a || a.type === 'wait') a = { type: 'endTurn' };
  try { act(room, pid, a); } catch { try { act(room, pid, { type: 'endTurn' }); } catch { /* nothing to do */ } }
}

setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => {
    if (room.status !== 'playing' || !room.state) return;
    const pending = pendingActors(room.state).filter(pid => !room.seats[pid].isAI);
    for (const pid of pending) {
      const seat = room.seats[pid];
      const timedOut = room.deadline && now > room.deadline;
      const away = !isOnline(room, seat.uid) && now - Math.max(room.clockStarted || 0, seat.leftAt || 0) > AWAY_MS;
      if (timedOut || away) {
        room.state.log.push({ i: (room.state.log.at(-1)?.i ?? 0) + 1, turn: room.state.turn, msg: `@${pid} ${timedOut ? 'ran out of time' : 'is away'}, so a move was made for them.` });
        autoPlay(room, pid);
        break;
      }
    }
  });
  // expire idle rooms
  rooms.forEach((room, code) => {
    if (now - room.touched > ROOM_IDLE_MS && ![...room.clients.values()].some(s => s.size)) { rooms.delete(code); dirty = true; }
  });
}, 1000).unref();

// ------------------------------------------------------------------ AI driver
function scheduleAI(room) {
  if (room.aiTimer || room.status !== 'playing') return;
  const s = room.state;
  const needsAI = (s.trade && room.seats.some((seat, i) => seat.isAI && i !== s.trade.from && !s.trade.responses[i])) ||
    pendingActors(s).some(pid => room.seats[pid].isAI);
  if (!needsAI) return;
  const delay = (s.phase === 'setup' ? 450 : s.phase === 'roll' ? 700 : 600) * AI_SPEED;
  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (room.status !== 'playing') return;
    try { stepAI(room); } catch (err) { console.error(`[${room.code}] AI error:`, err); }
    scheduleAI(room);
  }, delay);
}

function stepAI(room) {
  const s = room.state;
  // Trade answers first.
  if (s.trade && !(s.prompts && s.prompts.length)) {
    for (let i = 0; i < room.seats.length; i++) {
      if (!room.seats[i].isAI) continue;
      const a = respondToTrade(s, i, room.ai[i]);
      if (a) { act(room, i, a); return; }
    }
  }
  const pid = pendingActors(s).find(p => room.seats[p].isAI);
  if (pid === undefined) return;
  const mem = room.ai[pid];
  mem.actions = mem.turn === s.turn ? (mem.actions || 0) + 1 : 0;
  let a = decide(s, pid, mem);
  if (a && a.type === 'wait') {
    room.aiTimer = setTimeout(() => { room.aiTimer = null; scheduleAI(room); }, 1500 * AI_SPEED);
    return;
  }
  if (!a || (mem.actions > 120 && s.phase === 'main' && !(s.prompts && s.prompts.length))) a = { type: s.trade ? 'cancelTrade' : 'endTurn' };
  try { act(room, pid, a); } catch (err) {
    console.warn(`[${room.code}] AI move rejected (${err.message}); ending turn.`);
    if (s.phase === 'main') act(room, pid, { type: 'endTurn' });
  }
}

// ------------------------------------------------------------------ persistence
function saveRooms() {
  if (!dirty) return;
  dirty = false;
  const data = [...rooms.values()].map(r => ({
    code: r.code, hostUid: r.hostUid, status: r.status, config: r.config, seats: r.seats,
    tokens: r.tokens, state: r.state, created: r.created, touched: r.touched
  }));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SAVE_FILE + '.tmp', JSON.stringify(data));
    fs.renameSync(SAVE_FILE + '.tmp', SAVE_FILE);
  } catch (err) { console.warn('Could not save rooms:', err.message); }
}
function loadRooms() {
  try {
    const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    data.forEach(r => {
      rooms.set(r.code, {
        ...r, clients: new Map(), aiTimer: null, deadline: null,
        ai: (r.seats || []).map((_, i) => createAIMemory(Date.now() + i)), recentActions: {}
      });
    });
    rooms.forEach(room => { if (room.status === 'playing') { resetClock(room); scheduleAI(room); } });
    if (rooms.size) console.log(`Restored ${rooms.size} room(s) from ${SAVE_FILE}`);
  } catch { /* first run */ }
}
setInterval(saveRooms, 5000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { dirty = true; saveRooms(); accounts.flush(); process.exit(0); });

// ------------------------------------------------------------------ API
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api, rooms, CODE, verb
  if (parts[1] === 'health') return json(res, 200, { ok: true, rooms: rooms.size, version: 2, accounts: true });
  if (parts[1] === 'account' || parts[1] === 'friends' || parts[1] === 'leaderboard' || parts[1] === 'presence') return handleAccounts(req, res, parts, url);
  if (parts[1] !== 'rooms') throw httpError(404, 'Not found');

  // POST /api/rooms  → create
  if (parts.length === 2 && req.method === 'POST') {
    if (rooms.size >= MAX_ROOMS) throw httpError(503, 'The server is full. Try again later.');
    const body = await readJson(req);
    const account = accounts.fromToken(bearer(req, body));
    const uid = newId(), token = newId();
    const code = newCode();
    const room = {
      code, hostUid: uid, status: 'lobby', config: { ...DEFAULT_CONFIG, turnTimer: 0, friendlyRobber: true },
      seats: [{ uid, name: account ? account.username : cleanName(body.name, 'Host'), color: cleanColor(body.color) || COLORS[0], isAI: false, ai: null, accountId: account ? account.id : null }],
      chat: [],
      tokens: { [uid]: token }, state: null, clients: new Map(), created: Date.now(), touched: Date.now(),
      ai: [], aiTimer: null, recentActions: {}
    };
    rooms.set(code, room);
    dirty = true;
    return json(res, 200, { code, uid, token });
  }

  const code = String(parts[2] || '').toUpperCase();
  if (!CODE_RE.test(code)) throw httpError(400, 'Room codes are 6 letters or digits.');
  const room = rooms.get(code);
  if (!room) throw httpError(404, 'No room with that code. Check it and try again.');
  const verb = parts[3];

  // GET /api/rooms/CODE/events?uid&token  → live updates (Server-Sent Events)
  if (verb === 'events' && req.method === 'GET') {
    const uid = auth(room, { uid: url.searchParams.get('uid'), token: url.searchParams.get('token') });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    if (!room.clients.has(uid)) room.clients.set(uid, new Set());
    room.clients.get(uid).add(res);
    const seat = room.seats.find(s => s.uid === uid);
    if (seat) seat.leftAt = null;
    broadcast(room);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      room.clients.get(uid)?.delete(res);
      if (seat && !isOnline(room, uid)) seat.leftAt = Date.now();
      broadcast(room);
    });
    return;
  }
  if (req.method !== 'POST') throw httpError(405, 'Use POST.');
  const body = await readJson(req);

  if (verb === 'join') {
    // Rejoin with saved credentials, or take a new seat in the lobby.
    if (body.uid && room.tokens[body.uid] && room.tokens[body.uid] === body.token) {
      return json(res, 200, { code, uid: body.uid, token: body.token, rejoined: true });
    }
    if (room.status !== 'lobby') throw httpError(409, 'That game has already started.');
    if (room.seats.length >= MAX_SEATS) throw httpError(409, `That room is full (${MAX_SEATS} seats).`);
    const uid = newId(), token = newId();
    const used = new Set(room.seats.map(s => s.color));
    const want = cleanColor(body.color);
    const account = accounts.fromToken(bearer(req, body));
    if (account && room.seats.some(seat => seat.accountId === account.id)) throw httpError(409, 'You already have a seat in this room (rejoin from the device you joined with).');
    room.seats.push({ uid, name: account ? account.username : cleanName(body.name), color: want && !used.has(want) ? want : COLORS.find(c => !used.has(c)), isAI: false, ai: null, accountId: account ? account.id : null });
    room.tokens[uid] = token;
    broadcast(room);
    return json(res, 200, { code, uid, token });
  }

  const uid = auth(room, body);

  if (verb === 'lobby') {
    if (room.status !== 'lobby') throw httpError(409, 'The game has started.');
    const isHost = uid === room.hostUid;
    const op = body.op;
    if (op === 'profile') {
      const seat = room.seats.find(s => s.uid === uid);
      if (seat) {
        if (!seat.accountId) seat.name = cleanName(body.name, seat.name);
        const c = cleanColor(body.color);
        if (c && !room.seats.some(s => s !== seat && s.color === c)) seat.color = c;
      }
    } else if (op === 'leave') {
      room.seats = room.seats.filter(s => s.uid !== uid);
      delete room.tokens[uid];
      if (uid === room.hostUid) {
        const next = room.seats.find(s => !s.isAI);
        if (next) room.hostUid = next.uid; else { rooms.delete(code); dirty = true; return json(res, 200, { ok: true }); }
      }
    } else {
      if (!isHost) throw httpError(403, 'Only the host can change the room.');
      if (op === 'config') {
        const c = body.config || {};
        if (MAP_BY_ID[c.map]) room.config.map = c.map;
        if (c.custom && typeof c.custom === 'object') room.config.custom = cleanCustom({ ...(room.config.custom || {}), ...c.custom });
        if (room.config.map === 'custom' && !room.config.custom) room.config.custom = cleanCustom({ seed: Math.random().toString(36).slice(2, 8) });
        if (LAYOUTS.includes(c.layout)) room.config.layout = c.layout;
        if (room.config.layout === 'beginner' && room.config.map !== 'classic') room.config.layout = 'balanced';
        if (Number.isInteger(c.vpTarget)) room.config.vpTarget = Math.max(3, Math.min(20, c.vpTarget));
        if (Number.isInteger(c.discardLimit)) room.config.discardLimit = Math.max(5, Math.min(20, c.discardLimit));
        if (TIMER_STEPS.includes(c.turnTimer)) room.config.turnTimer = c.turnTimer;
        ['friendlyRobber', 'balancedDice', 'hiddenHands', 'ck', 'sea'].forEach(k => { if (typeof c[k] === 'boolean') room.config[k] = c[k]; });
        // Seafarers and Cities & Knights are either/or; the one just switched on wins.
        if (room.config.sea && room.config.ck) { if (c.sea === true) room.config.ck = false; else room.config.sea = false; }
        if (MAP_BY_ID[room.config.map]?.sea) { room.config.sea = true; room.config.ck = false; }
      } else if (op === 'addAI') {
        if (room.seats.length >= MAX_SEATS) throw httpError(409, `All ${MAX_SEATS} seats are taken.`);
        const used = new Set(room.seats.map(s => s.color));
        const ai = AI_LEVELS.includes(body.ai) ? body.ai : 'normal';
        const names = ['Ada', 'Bram', 'Cora', 'Dov', 'Ines', 'Jun'];
        const name = names.find(n => !room.seats.some(s => s.name === `${n} (AI)`)) || 'Bot';
        room.seats.push({ uid: null, name: `${name} (AI)`, color: COLORS.find(c => !used.has(c)), isAI: true, ai });
      } else if (op === 'removeSeat') {
        const i = Number(body.seat);
        const seat = room.seats[i];
        if (!seat || seat.uid === room.hostUid) throw httpError(400, 'Cannot remove that seat.');
        if (seat.uid) delete room.tokens[seat.uid];
        room.seats.splice(i, 1);
      } else if (op === 'start') {
        startGame(room);
        return json(res, 200, { ok: true });
      } else throw httpError(400, 'Unknown lobby operation.');
    }
    broadcast(room);
    return json(res, 200, { ok: true });
  }

  if (verb === 'chat') {
    const seat = room.seats.find(x => x.uid === uid);
    const text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 200);
    if (!seat || !text) throw httpError(400, 'Nothing to send.');
    const now = Date.now();
    seat.chatTimes = (seat.chatTimes || []).filter(t => now - t < 10000);
    if (seat.chatTimes.length >= 6) throw httpError(429, 'Slow down a little.');
    seat.chatTimes.push(now);
    (room.chat ||= []).push({ name: seat.name, color: seat.color, text, at: now });
    if (room.chat.length > 80) room.chat.splice(0, room.chat.length - 80);
    broadcast(room, [{ type: 'chat' }]);
    return json(res, 200, { ok: true });
  }

  if (verb === 'action') {
    // Duplicate protection first: a retried action (for example the move that just won the game)
    // is acknowledged instead of being reported as an error.
    const aid = String(body.actionId || '');
    const recent = (room.recentActions[uid] ||= []);
    if (aid && recent.includes(aid)) return json(res, 200, { ok: true, duplicate: true });
    if (room.status !== 'playing') throw httpError(409, room.status === 'over' ? 'The game is over.' : 'The game has not started.');
    const pid = seatOf(room, uid);
    if (pid < 0) throw httpError(403, 'You are not seated in this game.');
    const action = body.action;
    if (!action || typeof action !== 'object') throw httpError(400, 'Missing action.');
    // Stale protection: turn actions must be based on the latest state.
    const simultaneous = ['discard', 'respondTrade', 'answer'].includes(action.type);
    if (!simultaneous && Number.isInteger(body.version) && body.version !== room.state.version) {
      throw httpError(409, 'The game moved on before your action arrived. Try again.');
    }
    act(room, pid, action);
    if (aid) { recent.push(aid); if (recent.length > 50) recent.shift(); }
    return json(res, 200, { ok: true, version: room.state.version });
  }

  throw httpError(404, 'Not found');
}

// ------------------------------------------------------------------ accounts, friends, leaderboard
function bearer(req, body = {}) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7) : body.authToken;
}
async function handleAccounts(req, res, parts, url) {
  const ip = req.socket.remoteAddress || '';
  if (parts[1] === 'leaderboard' && req.method === 'GET') return json(res, 200, { players: accounts.leaderboard(50) });
  const body = req.method === 'POST' ? await readJson(req) : {};
  const verb = parts[2];
  if (parts[1] === 'account' && verb === 'register') return json(res, 200, accounts.register(body.username, body.password, ip));
  if (parts[1] === 'account' && verb === 'login') return json(res, 200, accounts.login(body.username, body.password, ip));
  const me = accounts.fromToken(bearer(req, body));
  if (!me) throw httpError(401, 'Please sign in again.');
  if (parts[1] === 'account' && verb === 'logout') { accounts.logout(bearer(req, body)); return json(res, 200, { ok: true }); }
  if (parts[1] === 'account' && verb === 'me') return json(res, 200, { profile: accounts.me(me) });
  if (parts[1] === 'presence') {
    // Only advertise a room the player really sits in.
    let room = null, status = null;
    const r = body.room && rooms.get(String(body.room).toUpperCase());
    if (r && r.seats.some(seat => seat.accountId === me.id)) { room = r.code; status = r.status; }
    return json(res, 200, accounts.heartbeat(me, room, status));
  }
  if (parts[1] === 'friends') {
    if (!verb && req.method === 'GET') return json(res, 200, { friends: accounts.friends(me) });
    if (verb === 'add') { accounts.addFriend(me, body.username); return json(res, 200, { friends: accounts.friends(me) }); }
    if (verb === 'remove') { accounts.removeFriend(me, String(body.id || '')); return json(res, 200, { friends: accounts.friends(me) }); }
    if (verb === 'invite') {
      const r = rooms.get(String(body.room || '').toUpperCase());
      if (!r || r.status !== 'lobby') throw httpError(409, 'Invites need an open lobby.');
      accounts.invite(me, String(body.id || ''), r.code);
      return json(res, 200, { ok: true });
    }
  }
  throw httpError(404, 'Not found');
}

// ------------------------------------------------------------------ static files
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (!rel.startsWith('/shared/')) rel = '/client' + rel; // the client folder is the site root
  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT) || !PUBLIC_DIRS.includes(top)) return send(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else send(res, 405, 'Method not allowed');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Server error.' : err.message });
  }
});

loadRooms();
server.listen(port, '0.0.0.0', () => console.log(`Terra Hex running on http://0.0.0.0:${port}`));
export { server, rooms };
