// Terra Hex — accounts, ratings, friends, presence and invites (server side).
// Stored in data/accounts.json. Passwords are hashed with scrypt; sessions are random tokens stored hashed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
const SESSION_DAYS = 90;
const ONLINE_MS = 75 * 1000;
const START_RATING = 1000;

export function createAccounts(dataDir) {
  const file = path.join(dataDir, 'accounts.json');
  let db = { accounts: {}, byName: {}, sessions: {} };
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  db.accounts ||= {}; db.byName ||= {}; db.sessions ||= {};
  const presence = new Map(); // id -> { at, room, status }
  const invites = new Map();  // id -> [{ from, room, at }]
  const attempts = new Map(); // ip -> { n, at }
  let dirty = false;

  const save = () => {
    if (!dirty) return;
    dirty = false;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(db));
      fs.renameSync(file + '.tmp', file);
    } catch (err) { console.warn('Could not save accounts:', err.message); }
  };
  setInterval(save, 5000).unref();

  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
  const checkPassword = (pw, stored) => {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
  };
  const err = (status, message) => Object.assign(new Error(message), { status });

  function publicProfile(a, full = false) {
    const s = a.stats;
    const p = { id: a.id, username: a.username, rating: Math.round(a.rating), games: s.games, wins: s.wins, created: a.created };
    if (full) Object.assign(p, { stats: s, history: a.history.slice(-15).reverse(), friends: a.friends.length });
    return p;
  }
  function newSession(a) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions[sha(token)] = { id: a.id, expires: Date.now() + SESSION_DAYS * 86400000 };
    dirty = true;
    return token;
  }
  function limit(ip) {
    const now = Date.now();
    const rec = attempts.get(ip) || { n: 0, at: now };
    if (now - rec.at > 10 * 60 * 1000) { rec.n = 0; rec.at = now; }
    rec.n++;
    attempts.set(ip, rec);
    if (rec.n > 20) throw err(429, 'Too many attempts. Wait a few minutes and try again.');
  }

  const api = {
    register(username, password, ip) {
      limit(ip);
      username = String(username || '').trim();
      if (!USER_RE.test(username)) throw err(400, 'Usernames are 3–16 letters, digits or underscores.');
      if (String(password || '').length < 6) throw err(400, 'Passwords need at least 6 characters.');
      if (db.byName[username.toLowerCase()]) throw err(409, 'That username is taken.');
      const id = crypto.randomBytes(8).toString('hex');
      const a = {
        id, username, pass: hashPassword(String(password)), created: Date.now(), rating: START_RATING,
        stats: { games: 0, wins: 0, points: 0, byMode: {} }, history: [], friends: []
      };
      db.accounts[id] = a; db.byName[username.toLowerCase()] = id; dirty = true;
      return { token: newSession(a), profile: publicProfile(a, true) };
    },
    login(username, password, ip) {
      limit(ip);
      const id = db.byName[String(username || '').trim().toLowerCase()];
      const a = id && db.accounts[id];
      if (!a || !checkPassword(String(password || ''), a.pass)) throw err(401, 'Wrong username or password.');
      return { token: newSession(a), profile: publicProfile(a, true) };
    },
    logout(token) { delete db.sessions[sha(String(token || ''))]; dirty = true; },
    /** The account behind a bearer token, or null. */
    fromToken(token) {
      if (!token) return null;
      const s = db.sessions[sha(String(token))];
      if (!s) return null;
      if (s.expires < Date.now()) { delete db.sessions[sha(String(token))]; dirty = true; return null; }
      return db.accounts[s.id] || null;
    },
    me(a) { return publicProfile(a, true); },
    leaderboard(limitN = 50) {
      return Object.values(db.accounts)
        .filter(a => a.stats.games > 0)
        .sort((x, y) => y.rating - x.rating || y.stats.wins - x.stats.wins)
        .slice(0, limitN)
        .map((a, i) => ({ rank: i + 1, ...publicProfile(a), online: api.isOnline(a.id) }));
    },
    isOnline(id) { const p = presence.get(id); return !!p && Date.now() - p.at < ONLINE_MS; },
    heartbeat(a, room, status) {
      presence.set(a.id, { at: Date.now(), room: room || null, status: status || null });
      const mine = invites.get(a.id) || [];
      invites.delete(a.id);
      return { invites: mine.filter(i => Date.now() - i.at < 10 * 60 * 1000) };
    },
    friends(a) {
      return a.friends.map(fid => db.accounts[fid]).filter(Boolean).map(f => {
        const p = presence.get(f.id);
        const online = api.isOnline(f.id);
        return { ...publicProfile(f), online, room: online ? p.room : null, status: online ? p.status : null, lastSeen: p ? p.at : null };
      }).sort((x, y) => Number(y.online) - Number(x.online) || x.username.localeCompare(y.username));
    },
    addFriend(a, username) {
      const id = db.byName[String(username || '').trim().toLowerCase()];
      if (!id) throw err(404, 'No player with that username.');
      if (id === a.id) throw err(400, 'That is you.');
      if (!a.friends.includes(id)) a.friends.push(id);
      const other = db.accounts[id];
      if (!other.friends.includes(a.id)) other.friends.push(a.id); // friendships go both ways
      dirty = true;
    },
    removeFriend(a, id) {
      a.friends = a.friends.filter(f => f !== id);
      const other = db.accounts[id];
      if (other) other.friends = other.friends.filter(f => f !== a.id);
      dirty = true;
    },
    invite(a, friendId, room) {
      if (!a.friends.includes(friendId)) throw err(403, 'You can only invite friends.');
      const list = invites.get(friendId) || [];
      list.push({ from: a.username, room, at: Date.now() });
      invites.set(friendId, list.slice(-5));
    },
    /**
     * Records a finished online game. seats: [{ accountId|null, isAI, vp, winner, name }].
     * Ratings: each pair of seats is a duel the higher finisher won (AI seats count as a fixed 1000).
     */
    recordGame(seats, meta) {
      const ranked = seats.map((s, i) => ({ ...s, i })).sort((x, y) => Number(y.winner) - Number(x.winner) || y.vp - x.vp);
      const place = new Map(ranked.map((s, k) => [s.i, k + 1]));
      const ratingOf = (s) => (s.accountId && db.accounts[s.accountId] ? db.accounts[s.accountId].rating : START_RATING);
      const delta = seats.map(() => 0);
      const K = 32 / Math.max(1, seats.length - 1);
      for (let x = 0; x < seats.length; x++) for (let y = 0; y < seats.length; y++) {
        if (x === y || !seats[x].accountId) continue;
        const px = place.get(x), py = place.get(y);
        const score = px < py ? 1 : px > py ? 0 : 0.5;
        const expect = 1 / (1 + Math.pow(10, (ratingOf(seats[y]) - ratingOf(seats[x])) / 400));
        delta[x] += K * (score - expect);
      }
      seats.forEach((s, i) => {
        const a = s.accountId && db.accounts[s.accountId];
        if (!a) return;
        a.rating = Math.max(100, a.rating + delta[i]);
        a.stats.games++; if (s.winner) a.stats.wins++;
        a.stats.points += s.vp;
        a.stats.byMode[meta.mode] = (a.stats.byMode[meta.mode] || 0) + 1;
        a.history.push({ at: Date.now(), map: meta.map, mode: meta.mode, place: place.get(i), of: seats.length, vp: s.vp, win: !!s.winner, change: Math.round(delta[i]), opponents: seats.filter((_, k) => k !== i).map(o => o.name) });
        if (a.history.length > 50) a.history.shift();
      });
      dirty = true;
      return delta.map(Math.round);
    },
    flush() { dirty = true; save(); },
    _db: () => db
  };
  return api;
}
