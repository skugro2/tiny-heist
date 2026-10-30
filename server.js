// Tiny Heist server (server.js): serves the game files and runs multiplayer rooms over WebSockets on /ws.
// Run with `npm start`. Set PORT to change the port (hosting services set it for you).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocketServer } from './ws.js';
import { Room } from './room.js';
import * as C from './constants.js';

// Everything lives in one folder, so the game files are served straight from it.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIRS = [{ prefix: '/', dir: ROOT }];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const rooms = new Map();

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const mount = STATIC_DIRS.find((m) => pathname.startsWith(m.prefix));
  const file = path.normalize(path.join(mount.dir, pathname.slice(mount.prefix.length)));
  if (!file.startsWith(mount.dir)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < C.ROOM_CODE_LENGTH; i++) code += C.ROOM_CODE_LETTERS[Math.floor(Math.random() * C.ROOM_CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('No free room codes');
}

function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, C.NAME_MAX_LENGTH);
  return name || 'Thief';
}

function onConnection(ws) {
  let room = null;
  let player = null;
  const fail = (msg) => ws.send(JSON.stringify({ t: 'err', msg }));

  ws.on('message', (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (!player) {
      if (msg.t === 'create') {
        const code = makeRoomCode();
        room = new Room(code, (r) => rooms.delete(r.code));
        rooms.set(code, room);
        player = room.addPlayer(ws, cleanName(msg.name));
        console.log(`[room ${code}] created by ${player.name}`);
      } else if (msg.t === 'join') {
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z]/g, '');
        const target = rooms.get(code);
        if (!target) return fail(`Room ${code || '(empty)'} doesn't exist. Check the code, or create a new room.`);
        if (target.full) return fail(`Room ${code} is full (${C.MAX_PLAYERS} thieves max).`);
        room = target;
        player = room.addPlayer(ws, cleanName(msg.name));
        console.log(`[room ${code}] ${player.name} joined (${room.players.size} players)`);
      }
      return;
    }
    room.handle(player, msg);
  });

  ws.on('close', () => {
    if (room && player) {
      console.log(`[room ${room.code}] ${player.name} left`);
      room.removePlayer(player.id);
    }
  });
}

export function startServer(port = Number(process.env.PORT) || 3000) {
  const server = http.createServer(serveStatic);
  attachWebSocketServer(server, '/ws', onConnection);

  // Heartbeat: drop connections that stopped answering (closed laptops, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const pl of room.players.values()) {
        if (!pl.ws.isAlive) { pl.ws.terminate(); continue; }
        pl.ws.isAlive = false;
        pl.ws.ping();
      }
    }
  }, 15000);

  let last = Date.now();
  const ticker = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    for (const room of rooms.values()) room.tick(now, dt);
  }, 1000 / C.SERVER_TICK_RATE);

  server.on('close', () => { clearInterval(heartbeat); clearInterval(ticker); });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      console.log(`Tiny Heist server running at http://localhost:${actual}`);
      resolve(server);
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) startServer();
