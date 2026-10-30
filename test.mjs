// End-to-end test: starts the real server and plays a full heist with real WebSocket clients.
// Run with `npm test` (needs Node 22+, which has a built-in WebSocket client).

import assert from 'node:assert/strict';
import { startServer } from './server.js';
import { LEVEL } from './level.js';
import * as C from './constants.js';
import { cameraDir, cameraSees, moveAndCollide } from './physics.js';

if (typeof WebSocket === 'undefined') {
  console.error('This test needs Node 22 or newer (built-in WebSocket client).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (label) => { passed++; console.log(`  ✓ ${label}`); };

class Bot {
  constructor(url, name) {
    this.url = url; this.name = name; this.msgs = []; this.waiters = []; this.items = null; this.id = null; this.p = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'items') this.items = m.items;
        if (m.t === 'joined') { this.id = m.you; this.items = m.items; this.code = m.code; this.p = m.players.find((p) => p.id === m.you).p; }
        if (m.t === 'reset') { this.items = m.items; this.p = m.spawns[this.id]; }
        if (m.t === 'corr') this.p = m.p;
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 3000, label = 'message') {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => { clearTimeout(timer); this.msgs.splice(this.msgs.indexOf(m), 1); resolve(m); } };
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error(`${this.name}: timed out waiting for ${label}`)); }, ms);
      this.waiters.push(w);
    });
  }
  clear() { this.msgs = []; }
  /** Walk in a straight line at a legal speed, sending 20 updates per second like the real client. */
  async walkTo(target, speed = 10) {
    const dt = 1 / C.CLIENT_SEND_RATE;
    for (;;) {
      const d = [target[0] - this.p[0], target[1] - this.p[1], target[2] - this.p[2]];
      const dist = Math.hypot(d[0], d[2]);
      const stepLen = speed * dt;
      if (dist <= stepLen) { this.p = [...target]; this.sendState(); await sleep(dt * 1000); return; }
      const k = stepLen / dist;
      this.p = [this.p[0] + d[0] * k, this.p[1] + d[1] * k, this.p[2] + d[2] * k];
      this.sendState(Math.atan2(d[0], d[2]));
      await sleep(dt * 1000);
    }
  }
  sendState(r = 0) { this.send({ t: 's', p: this.p, r, g: 1, m: 1 }); }
  async hold(seconds) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) { this.sendState(); await sleep(50); }
  }
  item(id) { return this.items.find((i) => i.id === id); }
  close() { this.ws.close(); }
}

async function main() {
  console.log('Physics');
  {
    const climb = (start, dir, seconds) => {
      const s = { p: [...start], v: [0, 0, 0], grounded: false };
      let maxY = 0;
      for (let t = 0; t < seconds; t += 1 / 60) {
        s.v[0] = dir[0] * C.WALK_SPEED; s.v[2] = dir[1] * C.WALK_SPEED;
        if (s.grounded) s.v[1] = C.JUMP_VELOCITY;
        s.v[1] -= C.GRAVITY / 60;
        moveAndCollide(s, 1 / 60);
        maxY = Math.max(maxY, s.p[1]);
      }
      return maxY;
    };
    assert.ok(climb([3, 0, 9.5], [1, 0], 8) >= 10, 'staircase should reach the counter top');
    ok('a jumping player can climb the staircase onto the checkout counter');
    assert.ok(climb([-19, 0, 16], [-1, 0], 1.6) >= 4, 'can + box should reach the display table');
    ok('a jumping player can climb the can and box onto the display table');
    const wall = { p: [38, 0, 20], v: [0, 0, 0], grounded: true };
    for (let i = 0; i < 120; i++) { wall.v[0] = 9; wall.v[1] -= C.GRAVITY / 60; moveAndCollide(wall, 1 / 60); }
    assert.ok(wall.p[0] < LEVEL.bounds.maxX, 'walls stop the player');
    ok('walls stop the player');
  }

  const server = await startServer(0);
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const wsUrl = `ws://localhost:${port}/ws`;

  console.log('Static files');
  for (const path of ['/', '/style.css', '/main.js', '/game.js', '/level.js', '/physics.js']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
  }
  ok('serves the client and shared modules');
  const trav = await fetch(base + '/..%2f..%2f..%2fetc%2fpasswd');
  assert.notEqual(trav.status, 200);
  ok('blocks path traversal');

  console.log('Rooms');
  const a = new Bot(wsUrl, 'Alice');
  const b = new Bot(wsUrl, 'Bob');
  await a.open(); await b.open();
  a.send({ t: 'create', name: 'Alice' });
  const ja = await a.wait((m) => m.t === 'joined');
  assert.match(ja.code, /^[A-Z]{4}$/);
  ok(`Alice created room ${ja.code}`);

  b.send({ t: 'join', name: 'Bob', code: 'ZZZZ' === ja.code ? 'YYYY' : 'ZZZZ' });
  await b.wait((m) => m.t === 'err');
  ok('joining a wrong code is rejected with an error');

  b.send({ t: 'join', name: '  Bob<script>  ', code: ja.code.toLowerCase() });
  const jb = await b.wait((m) => m.t === 'joined');
  assert.equal(jb.players.length, 2);
  assert.equal(jb.players.find((p) => p.id === b.id).name, 'Bobscript');
  const pj = await a.wait((m) => m.t === 'pj');
  assert.equal(pj.player.id, b.id);
  ok('Bob joined (lower-case code accepted, name sanitised) and Alice was told');

  console.log('Movement sync');
  await a.walkTo([4, 0, 12]);
  const snap = await b.wait((m) => m.t === 'snap' && m.pl.some(([id, x, , z]) => id === a.id && Math.abs(x - 4) < 0.05 && Math.abs(z - 12) < 0.05), 2000, 'Alice position in snapshot');
  assert.ok(snap.st > 0);
  ok("Bob's snapshots show Alice's new position");
  a.send({ t: 'j' });
  await b.wait((m) => m.t === 'j' && m.id === a.id);
  ok('jumps are relayed to other players');
  const before = [...a.p];
  a.p = [-35, 0, -20];
  a.sendState();
  const corr = await a.wait((m) => m.t === 'corr');
  assert.deepEqual(corr.p.map(Math.round), before.map(Math.round));
  ok('teleporting is rejected and corrected by the server');

  console.log('Valuables');
  b.clear(); a.clear();
  await a.walkTo([-20.6, 0, -5]);
  a.send({ t: 'e' });
  await b.wait((m) => m.t === 'ev' && m.kind === 'pickup' && m.item === 'watch');
  await sleep(100);
  assert.equal(b.item('watch').holder, a.id);
  ok('Alice picked up the golden watch and Bob saw it');

  await b.walkTo([-20.4, 0, -5.2]);
  b.send({ t: 'e' });
  await sleep(300);
  assert.equal(a.item('watch').holder, a.id);
  assert.ok(!b.msgs.some((m) => m.t === 'ev' && m.kind === 'pickup'));
  ok('Bob cannot grab the watch Alice is holding (no duplicates)');

  await a.walkTo([-12, 0, 12]);
  a.send({ t: 'e' });
  await b.wait((m) => m.t === 'ev' && m.kind === 'drop');
  await sleep(100);
  const dropped = b.item('watch');
  assert.equal(dropped.holder, null);
  assert.equal(dropped.pos[1], 0);
  ok(`Alice dropped the watch on the floor at (${dropped.pos[0].toFixed(1)}, ${dropped.pos[2].toFixed(1)})`);

  await b.walkTo([dropped.pos[0] + 0.5, 0, dropped.pos[2]]);
  b.send({ t: 'e' });
  await a.wait((m) => m.t === 'ev' && m.kind === 'pickup' && m.who === b.id);
  ok('Bob picked the dropped watch back up');

  console.log('Escape zone');
  await b.walkTo([6, 0, 24]);
  await a.wait((m) => m.t === 'ev' && m.kind === 'deliver' && m.item === 'watch', 2000, 'delivery');
  await sleep(100);
  assert.equal(a.items.filter((i) => i.delivered).length, 1);
  ok('carrying the watch into the escape zone delivers it (1 / 3)');

  console.log('Security camera');
  const cam = LEVEL.securityCamera;
  // Find a floor spot the camera sees well at one end of its sweep (where it lingers longest).
  let spot = null;
  for (const yaw of [cam.baseYaw - cam.sweep, cam.baseYaw + cam.sweep]) {
    const dir = cameraDir(yaw);
    for (let f = 1; f > 0.5 && !spot; f -= 0.05) {
      const t = (cam.pos[1] / -dir[1]) * f;
      const p = [cam.pos[0] + dir[0] * t, 0, cam.pos[2] + dir[2] * t];
      if (cameraSees(yaw, [p[0], 0.5, p[2]])) spot = p;
    }
    if (spot) break;
  }
  assert.ok(spot, 'there should be a visible floor spot');
  a.clear(); b.clear();
  await a.walkTo(spot);
  const alarmPromise = b.wait((m) => m.t === 'alarm' && m.on, 14000, 'alarm');
  const holding = a.hold(14);
  const alarm = await alarmPromise;
  assert.equal(alarm.by, a.id);
  ok('standing in the camera cone triggers ALARM TRIGGERED for everyone');
  await holding.catch(() => {});
  await a.walkTo([30, 0, 20]); // out of sight

  console.log('Completing the heist');
  // Phone: on the display table (y = 4)
  await b.walkTo([-22, 0, 16]);
  await b.walkTo([-27.8, 4, 16]);
  b.send({ t: 'e' });
  await a.wait((m) => m.t === 'ev' && m.kind === 'pickup' && m.item === 'phone');
  await b.walkTo([-22, 0, 20]);
  await b.walkTo([5, 0, 23]);
  b.send({ t: 'e' }); // dropping inside the zone also delivers
  await a.wait((m) => m.t === 'ev' && m.kind === 'deliver' && m.item === 'phone');
  ok('Bob carried the phone down and stashed it (2 / 3)');

  // Jewels: on the checkout counter (y = 10)
  await a.walkTo([16, 10, 9.6]);
  await a.walkTo([21.2, 10, 9.6]);
  a.send({ t: 'e' });
  await b.wait((m) => m.t === 'ev' && m.kind === 'pickup' && m.item === 'jewels');
  await a.walkTo([14, 0, 16]);
  const donePromise = b.wait((m) => m.t === 'done', 8000, 'heist complete');
  await a.walkTo([8, 0, 24]);
  const done = await donePromise;
  assert.ok(done.time > 0);
  assert.ok(done.alarms >= 1);
  ok(`HEIST COMPLETE in ${(done.time / 1000).toFixed(1)}s with ${done.alarms} alarm(s)`);

  a.clear();
  a.send({ t: 'e' });
  await sleep(200);
  assert.ok(!a.msgs.some((m) => m.t === 'ev' && m.kind === 'pickup'));
  ok('no more interactions after completion');

  console.log('Restart and disconnects');
  b.send({ t: 'restart' });
  const reset = await a.wait((m) => m.t === 'reset');
  assert.equal(reset.items.filter((i) => i.delivered).length, 0);
  ok('"Plan another heist" resets the store for everyone');

  const c = new Bot(wsUrl, 'Cara');
  await c.open();
  c.send({ t: 'join', name: 'Cara', code: ja.code });
  await c.wait((m) => m.t === 'joined');
  ok('a third player can join mid-session');

  await b.walkTo([-20.6, 0, -5]);
  b.send({ t: 'e' });
  await a.wait((m) => m.t === 'ev' && m.kind === 'pickup' && m.who === b.id);
  b.close();
  const left = await a.wait((m) => m.t === 'pl' && m.id === b.id);
  assert.equal(left.name, 'Bobscript');
  await sleep(100);
  assert.equal(a.item('watch').holder, null);
  ok('when a carrier disconnects, the others see them leave and the item is dropped');

  a.close(); c.close();
  await sleep(200);
  const health = await (await fetch(base + '/health')).json();
  assert.equal(health.rooms, 0);
  ok('empty rooms are cleaned up');

  server.close();
  console.log(`\nAll ${passed} checks passed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
