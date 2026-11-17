/**
 * CubeCoders AMP Generic Module — Node.js server for Terra Hex
 * Serves the game and relays multiplayer rooms (no extra npm packages needed).
 * Run with argument: server.js --port 7779 (or your assigned AMP Application Port 1)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const args = process.argv.slice(2);
let port = parseInt(process.env.PORT, 10) || 7779;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    const parsed = parseInt(args[i + 1], 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) port = parsed;
  }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

// ============================================================================
// Multiplayer room relay
// ============================================================================
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_HUMANS = 6;
const MAX_ROOMS = 200;
const ROOM_IDLE_MS = 12 * 60 * 60 * 1000;
const SEAT_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4'];
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const UID_RE = /^[A-Za-z0-9_-]{4,64}$/;

/** code -> { data, clients:Set<res>, touched } */
const rooms = new Map();

function cleanMember(m) {
  if (!m || typeof m !== 'object' || !UID_RE.test(String(m.uid || ''))) return null;
  const name = String(m.name || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || 'Player';
  const color = /^#[0-9a-fA-F]{6}$/.test(String(m.color || '')) ? m.color : SEAT_COLORS[0];
  return { uid: m.uid, name, color };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (_) {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function broadcastRoom(room) {
  room.touched = Date.now();
  const msg = `data: ${JSON.stringify(room.data)}\n\n`;
  for (const client of room.clients) client.write(msg);
}

async function handleApi(req, res, parts) {
  // parts: ['api', ...]
  if (parts[1] === 'health' && parts.length === 2) {
    return sendJson(res, 200, { ok: true, rooms: rooms.size });
  }
  if (parts[1] !== 'rooms' || !parts[2]) return sendJson(res, 404, { error: 'Not found' });

  const code = parts[2].toUpperCase();
  if (!CODE_RE.test(code)) return sendJson(res, 400, { error: 'Bad room code' });
  const action = parts[3] || '';
  const room = rooms.get(code);

  // Create room
  if (req.method === 'POST' && action === '') {
    if (room) return sendJson(res, 409, { error: 'Room code in use' });
    if (rooms.size >= MAX_ROOMS) return sendJson(res, 503, { error: 'Server has too many rooms' });
    const body = await readJson(req);
    const host = cleanMember((body.members || [])[0]);
    if (!host || host.uid !== body.hostUid) return sendJson(res, 400, { error: 'Missing host' });
    const data = {
      code,
      hostUid: host.uid,
      status: 'LOBBY',
      members: [host],
      config: body.config && typeof body.config === 'object' ? body.config : {},
      syncVersion: 0,
      lastWriter: null,
      snapshotJson: null
    };
    rooms.set(code, { data, clients: new Set(), touched: Date.now() });
    console.log(`[Terra Hex] Room ${code} created by ${host.name}`);
    return sendJson(res, 200, data);
  }

  if (!room) return sendJson(res, 404, { error: 'Room not found' });

  // Read room
  if (req.method === 'GET' && action === '') return sendJson(res, 200, room.data);

  // Live updates (Server-Sent Events)
  if (req.method === 'GET' && action === 'events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify(room.data)}\n\n`);
    room.clients.add(res);
    room.touched = Date.now();
    req.on('close', () => room.clients.delete(res));
    return;
  }

  // Join
  if (req.method === 'POST' && action === 'join') {
    const body = await readJson(req);
    const member = cleanMember(body.member);
    if (!member) return sendJson(res, 400, { error: 'Bad player details' });
    const members = room.data.members;
    const existing = members.find(m => m.uid === member.uid);
    if (existing) {
      existing.name = member.name; // rejoining (e.g. after a page reload) keeps the seat
    } else {
      if (room.data.status !== 'LOBBY') return sendJson(res, 409, { error: 'Game already started' });
      if (members.length >= MAX_HUMANS) return sendJson(res, 409, { error: 'Room is full' });
      const used = new Set(members.map(m => m.color.toLowerCase()));
      if (used.has(member.color.toLowerCase())) {
        member.color = SEAT_COLORS.find(c => !used.has(c)) || member.color;
      }
      members.push(member);
      console.log(`[Terra Hex] ${member.name} joined room ${code}`);
    }
    broadcastRoom(room);
    return sendJson(res, 200, room.data);
  }

  // Game state update (only seated players may write)
  if (req.method === 'POST' && action === 'update') {
    const body = await readJson(req);
    const uid = String(body.uid || '');
    if (!room.data.members.some(m => m.uid === uid)) return sendJson(res, 403, { error: 'Not a member of this room' });
    const patch = body.patch || {};
    if (patch.status === 'PLAYING' || patch.status === 'FINISHED') room.data.status = patch.status;
    if (typeof patch.snapshotJson === 'string') {
      room.data.snapshotJson = patch.snapshotJson;
      room.data.syncVersion += 1;
      room.data.lastWriter = uid;
    }
    if (patch.config && typeof patch.config === 'object' && uid === room.data.hostUid) room.data.config = patch.config;
    broadcastRoom(room);
    return sendJson(res, 200, { syncVersion: room.data.syncVersion });
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}

// Heartbeat keeps live connections open through proxies; idle rooms are cleaned up.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const client of room.clients) client.write(': ping\n\n');
    if (room.clients.size === 0 && now - room.touched > ROOM_IDLE_MS) {
      rooms.delete(code);
      console.log(`[Terra Hex] Room ${code} expired`);
    }
  }
}, 20000).unref();

// ============================================================================
// Static files
// ============================================================================
function serveIndex(res) {
  fs.readFile(path.join(ROOT, 'index.html'), (err, html) => {
    if (err) send(res, 404, 'Terra Hex Server: index.html not found.');
    else send(res, 200, html, mimeTypes['.html']);
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (pathname === '/' || pathname === '') return serveIndex(res);

  // Block path traversal (e.g. /../../etc/passwd) and hidden files
  const filePath = path.resolve(ROOT, '.' + path.posix.normalize(pathname));
  if (!filePath.startsWith(ROOT + path.sep) || pathname.split('/').some(seg => seg.startsWith('.'))) {
    return send(res, 403, 'Forbidden');
  }

  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (error, content) => {
    if (!error) return send(res, 200, content, mimeTypes[ext] || 'application/octet-stream');
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      // Missing asset files get a real 404; extension-less paths fall back to the game page.
      return ext ? send(res, 404, 'Not found') : serveIndex(res);
    }
    send(res, 500, 'Server error: ' + error.code);
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    return send(res, 400, 'Bad request');
  }

  // API routes work whether the game is at "/" or under a sub-path (e.g. "/terrahex/api/...")
  const parts = pathname.split('/').filter(Boolean);
  const apiIdx = parts.indexOf('api');
  if (apiIdx !== -1) {
    try {
      return await handleApi(req, res, parts.slice(apiIdx));
    } catch (err) {
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
      if (!err.status) console.error('[Terra Hex] API error:', err);
      return;
    }
  }

  serveStatic(req, res, pathname);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Terra Hex AMP Server] Port ${port} is already in use. Check the AMP Application Port setting.`);
  } else {
    console.error('[Terra Hex AMP Server] Server error:', err);
  }
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[Terra Hex AMP Server] Running on port ${port} (game + multiplayer rooms)`);
});

// Let AMP's Stop button shut down cleanly
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[Terra Hex AMP Server] ${sig} received, shutting down.`);
    for (const room of rooms.values()) for (const c of room.clients) c.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
