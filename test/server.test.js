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

async function post(p, body) {
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Minimal SSE reader keeping the latest payload. */
function listen(code, uid, token) {
  const box = { latest: null, waiters: [], req: null, all: [] };
  box.req = http.get(`${BASE}/api/rooms/${code}/events?uid=${uid}&token=${token}`, res => {
    let buf = '';
    res.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = block.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        box.latest = JSON.parse(line.slice(6));
        box.all.push(box.latest);
        box.waiters.splice(0).forEach(w => w());
      }
    });
  });
  box.next = () => new Promise(r => box.waiters.push(r));
  return box;
}

test('server: lobby, illegal moves, hidden information, and a full game to victory', { timeout: 240000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'terrahex-'));
  const proc = spawn(process.execPath, ['server.js', '--port', String(PORT)], {
    cwd: ROOT, env: { ...process.env, TERRAHEX_DATA: data, TERRAHEX_AI_SPEED: '0.01' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal((await fetch(BASE + '/')).status, 200, 'serves the client');
    assert.equal((await fetch(BASE + '/../server.js')).status, 404);

    const host = (await post('/api/rooms', { name: 'Host', color: '#d94a3d' })).data;
    assert.match(host.code, /^[A-Z0-9]{6}$/);
    const guest = (await post(`/api/rooms/${host.code}/join`, { name: 'Guest' })).data;
    assert.ok(guest.token);
    assert.equal((await post(`/api/rooms/${host.code}/lobby`, { uid: guest.uid, token: guest.token, op: 'start' })).status, 403, 'only the host starts');
    assert.equal((await post(`/api/rooms/${host.code}/lobby`, { uid: host.uid, token: 'wrong', op: 'start' })).status, 403);
    // guest leaves; host fills with AI
    await post(`/api/rooms/${host.code}/lobby`, { uid: guest.uid, token: guest.token, op: 'leave' });
    for (const ai of ['easy', 'normal', 'hard']) {
      assert.equal((await post(`/api/rooms/${host.code}/lobby`, { uid: host.uid, token: host.token, op: 'addAI', ai })).status, 200);
    }
    await post(`/api/rooms/${host.code}/lobby`, { uid: host.uid, token: host.token, op: 'config', config: { layout: 'random', vpTarget: 10 } });

    const sse = listen(host.code, host.uid, host.token);
    await sse.next();
    assert.equal(sse.latest.room.seats.length, 4);
    assert.equal((await post(`/api/rooms/${host.code}/lobby`, { uid: host.uid, token: host.token, op: 'start' })).status, 200);
    while (!sse.latest.view) await sse.next();

    const me = sse.latest.you;
    assert.equal(me, 0);
    const v0 = sse.latest.view;
    v0.players.forEach(p => { if (p.id !== me) assert.equal(p.hand, null, 'opponent hands are hidden'); });
    assert.equal(v0.devDeck, undefined);
    assert.equal(v0.rng, undefined);

    // Out-of-turn or illegal moves are rejected.
    const act = (action, extra = {}) => post(`/api/rooms/${host.code}/action`, { uid: host.uid, token: host.token, action, version: sse.latest.view.version, ...extra });
    // A move that breaks the rules is refused by the rules engine...
    let r = await post(`/api/rooms/${host.code}/action`, { uid: host.uid, token: host.token, action: { type: 'buildCity', vertex: 0 } });
    assert.equal(r.status, 422);
    assert.ok(r.data.error);
    r = await act({ type: 'roll' }, { version: -5 });
    assert.ok(r.status === 409 || r.status === 422);

    // Play the human seat with the AI policy, using only what the server shows us.
    const mem = createAIMemory(42);
    let guard = 0;
    let lastVersion = -1;
    while (sse.latest.view.phase !== 'over') {
      assert.ok(++guard < 6000, 'game should finish');
      const v = sse.latest.view;
      const mine = v.phase === 'discard' ? !!v.discards[me] : v.current === me;
      const tradeForMe = v.trade && v.trade.from !== me && !v.trade.responses[me];
      if ((!mine && !tradeForMe) || v.version === lastVersion) {
        await Promise.race([sse.next(), new Promise(res => setTimeout(res, 300))]);
        lastVersion = -1;
        continue;
      }
      let a = decide(v, me, mem);
      if (!a || a.type === 'wait') a = v.trade && v.trade.from === me ? { type: 'cancelTrade' } : null;
      if (!a) { await sse.next(); continue; }
      const id = `a${guard}`;
      r = await act(a, { actionId: id });
      if (r.status === 200) {
        const dup = await act(a, { actionId: id });
        assert.equal(dup.data.duplicate, true, 'duplicate action ids are ignored');
      } else if (r.status === 422 && v.phase === 'main') {
        await act({ type: 'endTurn' });
      }
      lastVersion = v.version;
      await Promise.race([sse.next(), new Promise(res => setTimeout(res, 200))]);
    }
    const end = sse.latest.view;
    assert.equal(end.phase, 'over');
    assert.ok(end.players[end.winner].vpTotal >= 10);
    end.players.forEach(p => assert.ok(p.hand, 'hands are revealed at the end'));

    // Saved to disk for recovery.
    await new Promise(res => setTimeout(res, 5500));
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'rooms.json'), 'utf8'));
    assert.equal(saved[0].code, host.code);
    // Rejoin with the same credentials restores the seat.
    const again = await post(`/api/rooms/${host.code}/join`, { uid: host.uid, token: host.token });
    assert.equal(again.data.rejoined, true);
    sse.req.destroy();
  } finally {
    proc.kill('SIGTERM');
    assert.ok(!/Error/.test(stderr.replace(/AI move rejected[^\n]*/g, '')), stderr);
  }
});
