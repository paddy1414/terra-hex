import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => ({})) }; };

test('online rooms: six seats, every map and the house rules', { timeout: 30000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'terrahex-'));
  const proc = spawn(process.execPath, ['server.js', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, TERRAHEX_DATA: data, TERRAHEX_AI_SPEED: '0.01' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
    const host = (await post('/api/rooms', { name: 'Host' })).data;
    const lobby = (op, extra = {}) => post(`/api/rooms/${host.code}/lobby`, { uid: host.uid, token: host.token, op, ...extra });
    const guest = (await post(`/api/rooms/${host.code}/join`, { name: 'Guest' })).data;
    assert.ok(guest.token);
    for (let i = 0; i < 4; i++) assert.equal((await lobby('addAI', { ai: 'normal' })).status, 200);
    assert.equal((await lobby('addAI', { ai: 'easy' })).status, 409, 'a 7th seat is refused');
    assert.equal((await post(`/api/rooms/${host.code}/join`, { name: 'Late' })).status, 409);
    await lobby('config', { config: { map: 'isles', layout: 'beginner', friendlyRobber: true, balancedDice: true, hiddenHands: true, vpTarget: 12, discardLimit: 9, turnTimer: 300 } });
    await lobby('config', { config: { map: 'nowhere', vpTarget: 99, turnTimer: 7 } }); // ignored or clamped
    assert.equal((await lobby('start')).status, 200);
    const saveWait = () => new Promise(r => setTimeout(r, 5600));
    await saveWait();
    const room = JSON.parse(fs.readFileSync(path.join(data, 'rooms.json'), 'utf8')).find(r => r.code === host.code);
    const s = room.state;
    assert.equal(s.players.length, 6);
    assert.equal(s.board.map, 'isles');
    assert.equal(s.config.layout, 'balanced', 'beginner numbers only exist on the classic map');
    assert.equal(s.config.vpTarget, 20, 'points are clamped to 3–20');
    assert.equal(s.config.discardLimit, 9);
    assert.equal(s.config.turnTimer, 300, 'an invalid timer value is ignored');
    assert.ok(s.config.friendlyRobber && s.config.balancedDice && s.config.hiddenHands && s.config.specialBuild);
    assert.equal(s.bankSize, 24);
    assert.equal(s.devTotal, 34);
  } finally { proc.kill('SIGTERM'); }
});
