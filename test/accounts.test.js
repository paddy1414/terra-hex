import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { decide, createAIMemory } from '../shared/ai.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
async function call(p, body, token, method = 'POST') {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
function listen(code, uid, token) {
  const box = { latest: null, waiters: [] };
  box.req = http.get(`${BASE}/api/rooms/${code}/events?uid=${uid}&token=${token}`, res => {
    let buf = '';
    res.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data: ')); buf = buf.slice(i + 2); if (line) { box.latest = JSON.parse(line.slice(6)); box.waiters.splice(0).forEach(w => w()); } } });
  });
  box.next = () => new Promise(r => { box.waiters.push(r); setTimeout(r, 300); });
  return box;
}

test('accounts: sign-up, friends, presence, invites, chat, and a rated online game', { timeout: 240000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'terrahex-acc-'));
  const proc = spawn(process.execPath, ['server.js', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, TERRAHEX_DATA: data, TERRAHEX_AI_SPEED: '0.01' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
    // accounts
    assert.equal((await call('/api/account/register', { username: 'x', password: 'secret1' })).status, 400);
    assert.equal((await call('/api/account/register', { username: 'tiernan', password: '123' })).status, 400);
    const a = (await call('/api/account/register', { username: 'Tiernan', password: 'secret1' })).data;
    assert.ok(a.token); assert.equal(a.profile.rating, 1000);
    assert.equal((await call('/api/account/register', { username: 'tiernan', password: 'secret1' })).status, 409, 'usernames are unique regardless of case');
    const b = (await call('/api/account/register', { username: 'Wally', password: 'hunter22' })).data;
    assert.equal((await call('/api/account/login', { username: 'Tiernan', password: 'wrong' })).status, 401);
    const relog = (await call('/api/account/login', { username: 'tiernan', password: 'secret1' })).data;
    assert.ok(relog.token);
    assert.equal((await call('/api/account/me', {}, 'bogus', 'GET')).status, 401);
    const stored = fs.existsSync(path.join(data, 'accounts.json')) ? fs.readFileSync(path.join(data, 'accounts.json'), 'utf8') : '';
    assert.ok(!stored.includes('secret1'), 'passwords are never stored in plain text');
    // friends + presence
    assert.equal((await call('/api/friends/add', { username: 'nobody' }, a.token)).status, 404);
    let fr = (await call('/api/friends/add', { username: 'wally' }, a.token)).data.friends;
    assert.equal(fr[0].username, 'Wally'); assert.equal(fr[0].online, false);
    await call('/api/presence', {}, b.token);
    fr = (await call('/api/friends', null, a.token, 'GET')).data.friends;
    assert.equal(fr[0].online, true);
    assert.equal((await call('/api/friends', null, b.token, 'GET')).data.friends[0].username, 'Tiernan', 'friendships go both ways');
    // a room tied to the account; invite the friend
    const host = (await call('/api/rooms', { name: 'ignored' }, a.token)).data;
    for (let i = 0; i < 3; i++) await call(`/api/rooms/${host.code}/lobby`, { uid: host.uid, token: host.token, op: 'addAI', ai: 'normal' });
    await call('/api/presence', { room: host.code }, a.token);
    assert.equal((await call('/api/friends', null, b.token, 'GET')).data.friends[0].room, host.code, 'friends see which room you are in');
    assert.equal((await call('/api/friends/invite', { id: fr[0].id, room: host.code }, a.token)).status, 200);
    const inv = (await call('/api/presence', {}, b.token)).data.invites;
    assert.equal(inv[0].room, host.code); assert.equal(inv[0].from, 'Tiernan');
    // chat
    const sse = listen(host.code, host.uid, host.token);
    await call(`/api/rooms/${host.code}/chat`, { uid: host.uid, token: host.token, text: 'good luck <b>all</b>' });
    for (let i = 0; i < 10 && !(sse.latest && sse.latest.chat && sse.latest.chat.length); i++) await sse.next();
    assert.equal(sse.latest.chat[0].text, 'good luck ball/b', 'chat text is cleaned of markup');
    assert.equal(sse.latest.room.seats[0].name, 'Tiernan', 'seats use the account name');
    // play the game out
    await call(`/api/rooms/${host.code}/lobby`, { uid: host.uid, token: host.token, op: 'start' });
    const mem = createAIMemory(3);
    for (let guard = 0; guard < 8000; guard++) {
      await sse.next();
      const v = sse.latest && sse.latest.view;
      if (!v) continue;
      if (v.phase === 'over') break;
      const me = sse.latest.you;
      const mine = v.phase === 'discard' ? v.discards[me] : v.current === me;
      const tradeForMe = v.trade && v.trade.from !== me && !v.trade.responses[me];
      if (!mine && !tradeForMe) continue;
      let act = decide(v, me, mem);
      if (!act || act.type === 'wait') act = v.trade && v.trade.from === me ? { type: 'cancelTrade' } : null;
      if (!act) continue;
      const r = await call(`/api/rooms/${host.code}/action`, { uid: host.uid, token: host.token, action: act });
      if (r.status === 422 && v.phase === 'main') await call(`/api/rooms/${host.code}/action`, { uid: host.uid, token: host.token, action: { type: 'endTurn' } });
    }
    assert.equal(sse.latest.view.phase, 'over');
    assert.ok(Array.isArray(sse.latest.ratings), 'rating changes are sent with the result');
    const me = (await call('/api/account/me', null, a.token, 'GET')).data.profile;
    assert.equal(me.games, 1);
    assert.equal(me.history.length, 1);
    assert.notEqual(me.rating, 1000, 'rating moved');
    assert.equal(me.wins, sse.latest.view.winner === 0 ? 1 : 0);
    const lb = (await call('/api/leaderboard', null, null, 'GET')).data.players;
    assert.equal(lb.length, 1, 'only players with rated games appear');
    assert.equal(lb[0].username, 'Tiernan');
    await call('/api/account/logout', {}, a.token);
    assert.equal((await call('/api/account/me', null, a.token, 'GET')).status, 401);
    sse.req.destroy();
  } finally { proc.kill('SIGTERM'); }
});
