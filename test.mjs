// End-to-end test: starts the real server and plays a full heist with real WebSocket clients.
// Run with `npm test` (needs Node 22+, which has a built-in WebSocket client).

import assert from 'node:assert/strict';
import { startServer } from './server.js';
import { LEVEL } from './level.js';
import * as C from './constants.js';
import { cameraDir, cameraSees, moveAndCollide, vacuumAt, blockedAt } from './physics.js';

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
    this.p = [this.p[0], Math.max(this.p[1], 0.5), this.p[2]]; // hop over mousetraps while travelling
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


async function room(url, names) {
  const bots = [];
  for (const n of names) { const b = new Bot(url, n); await b.open(); bots.push(b); }
  bots[0].send({ t: 'create', name: names[0] });
  const j = await bots[0].wait((m) => m.t === 'joined');
  for (const b of bots.slice(1)) { b.send({ t: 'join', name: b.name, code: j.code }); await b.wait((m) => m.t === 'joined'); }
  return bots;
}

function climb(start, dir, seconds) {
  const s = { p: [...start], v: [0, 0, 0], grounded: false };
  let maxY = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    s.v[0] = dir[0] * C.WALK_SPEED; s.v[2] = dir[1] * C.WALK_SPEED;
    if (s.grounded) s.v[1] = C.JUMP_VELOCITY;
    s.v[1] -= C.GRAVITY / 60;
    moveAndCollide(s, 1 / 60);
    if (s.landedOn && s.landedOn.bounce) { s.v[1] = s.landedOn.bounce; s.grounded = false; }
    maxY = Math.max(maxY, s.p[1]);
  }
  return { maxY, p: s.p };
}

async function main() {
  console.log('Physics and level');
  assert.ok(climb([3, 0, 9.5], [1, 0], 8).maxY >= 10); ok('staircase reaches the checkout counter');
  assert.ok(climb([-19, 0, 16], [-1, 0], 1.6).maxY >= 4); ok('can + box reach the display table');
  { const r = climb([26.4, 0.5, -21], [0, 0], 1.2); assert.ok(r.maxY > 5.2); ok(`crate trampoline launches you to ${r.maxY.toFixed(1)} (crate top is 5)`); }
  { const r = climb([25, 0.5, 15.6], [0, 0], 1.5); assert.ok(r.maxY > 10.2); ok(`counter trampoline launches you to ${r.maxY.toFixed(1)} (counter top is 10)`); }
  { let bad = 0; for (let t = 0; t < 30; t += 0.05) { const v = vacuumAt(t); if (blockedAt(v.x, 0, v.z, LEVEL.colliders, LEVEL.vacuum.half, LEVEL.vacuum.height)) bad++; } assert.equal(bad, 0); ok('robot vacuum route never drives through furniture'); }
  for (const kind of Object.keys(LEVEL.spots)) for (const s of LEVEL.spots[kind]) assert.ok(!blockedAt(s[0], s[1], s[2]), `spot ${s}`);
  ok('every loot spot has room for a thief to stand');

  // ---------------- Server 1: core heist (cat and camera off so the bots are not disturbed) ----------------
  const server = await startServer(0, { cat: false, camera: false });
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const url = `ws://localhost:${port}/ws`;

  console.log('Static files');
  for (const path of ['/', '/style.css', '/main.js', '/game.js', '/props.js', '/level.js', '/physics.js']) assert.equal((await fetch(base + path)).status, 200, path);
  ok('serves the game files');
  assert.notEqual((await fetch(base + '/..%2f..%2f..%2fetc%2fpasswd')).status, 200);
  ok('blocks path traversal');

  console.log('Rooms and movement');
  const [a, b] = await room(url, ['Alice', 'Bob']);
  const err = new Bot(url, 'X'); await err.open();
  err.send({ t: 'join', name: 'X', code: a.code === 'ZZZZ' ? 'YYYY' : 'ZZZZ' });
  await err.wait((m) => m.t === 'err'); err.close();
  ok(`room ${a.code}: wrong codes are rejected, Bob joined`);
  await a.walkTo([4, 0, 12]);
  await b.wait((m) => m.t === 'snap' && m.pl.some(([id, x, , z]) => id === a.id && Math.abs(x - 4) < 0.05 && Math.abs(z - 12) < 0.05), 2000, 'position');
  ok("Bob sees Alice move");
  a.p = [-35, 0, -20]; a.sendState();
  await a.wait((m) => m.t === 'corr');
  ok('teleporting is corrected');

  console.log('Loot');
  assert.equal(a.items.length, 5);
  const spotsUsed = new Set(a.items.map((i) => i.pos.join(',')));
  assert.equal(spotsUsed.size, 5);
  ok('5 pieces of loot placed on 5 different random spots');
  const watch = a.item('watch');
  a.clear(); b.clear();
  await a.walkTo(watch.pos);
  a.send({ t: 'e' });
  await b.wait((m) => m.t === 'ev' && m.kind === 'pickup' && m.item === 'watch');
  await b.walkTo([watch.pos[0] + 0.3, watch.pos[1], watch.pos[2]]);
  b.send({ t: 'e' });
  await sleep(300);
  assert.deepEqual(a.item('watch').holders, [a.id]);
  ok('only one thief can hold the watch (no duplicates)');
  await a.walkTo([6, 0, 23.5]);
  await b.wait((m) => m.t === 'ev' && m.kind === 'deliver' && m.item === 'watch');
  ok('watch delivered by walking into the escape zone');

  console.log('Heavy gold bar');
  const gold = a.item('gold');
  await a.walkTo([gold.pos[0] - 0.8, gold.pos[1] + 0.5, gold.pos[2]]);
  await b.walkTo([gold.pos[0] + 0.8, gold.pos[1] + 0.5, gold.pos[2]]);
  a.send({ t: 'e' }); await sleep(150); b.send({ t: 'e' }); await sleep(300);
  assert.equal(a.item('gold').holders.length, 2);
  ok('two thieves are holding the gold bar together');
  // walk apart -> it falls
  await b.walkTo([gold.pos[0] + 6, gold.pos[1] + 0.5, gold.pos[2]]);
  await a.wait((m) => m.t === 'ev' && m.kind === 'drop' && m.apart, 3000, 'apart drop');
  ok('walking too far apart drops it');
  const g2 = a.item('gold');
  await a.walkTo([g2.pos[0] - 0.8, g2.pos[1] + 0.5, g2.pos[2]]);
  await b.walkTo([g2.pos[0] + 0.8, g2.pos[1] + 0.5, g2.pos[2]]);
  a.send({ t: 'e' }); await sleep(150); b.send({ t: 'e' }); await sleep(300);
  assert.equal(a.item('gold').holders.length, 2);
  await Promise.all([a.walkTo([5.5, 0.5, 15], 5), b.walkTo([7.5, 0.5, 15], 5)]);
  await Promise.all([a.walkTo([5.5, 0, 24], 5), b.walkTo([7.5, 0, 24], 5)]);
  await a.wait((m) => m.t === 'ev' && m.kind === 'deliver' && m.item === 'gold', 3000, 'gold delivered');
  ok('carried together into the escape zone: +$5,000');

  console.log('Mousetraps and the camera switch');
  const trap = LEVEL.traps[1];
  a.clear(); b.clear();
  await a.walkTo([trap[0] + 2, 0.5, trap[2]]);
  await a.walkTo([trap[0], 0, trap[2]]);
  await b.wait((m) => m.t === 'ev' && m.kind === 'trap' && m.who === a.id, 2000, 'trap');
  ok('Alice stepped in a mousetrap');
  a.p = [trap[0] + 0.5, 0, trap[2]]; a.sendState();
  await a.wait((m) => m.t === 'corr', 1000, 'stuck');
  ok('a trapped thief cannot walk away');
  await b.walkTo([trap[0] + 1, 0.5, trap[2]]);
  b.send({ t: 'e' });
  await a.wait((m) => m.t === 'ev' && m.kind === 'rescue' && m.other === a.id, 2000, 'rescue');
  ok('Bob freed Alice');
  const sw = LEVEL.cameraSwitch;
  await b.walkTo([sw.x, 0, sw.z]);
  await a.wait((m) => m.t === 'cam' && m.off === true, 2000, 'camera off');
  await b.walkTo([sw.x - 4, 0.5, sw.z]);
  await a.wait((m) => m.t === 'cam' && m.off === false, 2000, 'camera on');
  ok('standing on the switch turns the camera off, leaving turns it back on');

  console.log('Finishing the heist');
  for (const id of ['phone', 'ring', 'jewels']) {
    const it = a.item(id);
    await a.walkTo([it.pos[0], it.pos[1] + 0.5, it.pos[2]]);
    await a.walkTo([it.pos[0] - 0.5, it.pos[1], it.pos[2]]);
    a.send({ t: 'e' });
    await b.wait((m) => m.t === 'ev' && m.kind === 'pickup' && m.item === id, 2000, `pickup ${id}`);
    await a.walkTo([6, 0.5, 16]);
    if (id === 'jewels') {
      const done = b.wait((m) => m.t === 'done', 4000, 'done');
      await a.walkTo([6, 0, 23.5]);
      const d = await done;
      assert.equal(d.money, 1200 + 5000 + 8000 + 900 + 2500);
      assert.equal(d.rare, true);
      ok(`HEIST COMPLETE with $${d.money.toLocaleString('en-US')} (including the secret diamond ring)`);
    } else {
      await a.walkTo([6, 0, 23.5]);
      await b.wait((m) => m.t === 'ev' && m.kind === 'deliver' && m.item === id, 2000, `deliver ${id}`);
    }
  }
  b.send({ t: 'restart' });
  const reset = await a.wait((m) => m.t === 'reset');
  assert.equal(reset.items.filter((i) => i.delivered).length, 0);
  ok('restart puts all loot back (on new random spots)');
  b.close();
  await a.wait((m) => m.t === 'pl');
  a.close();
  ok('disconnects are handled');

  // ---------------- Server 2: alarm and police ----------------
  console.log('Alarm and police');
  const s2 = await startServer(0, { cat: false, policeSeconds: 2 });
  const [p1] = await room(`ws://localhost:${s2.address().port}/ws`, ['Pat']);
  const cam = LEVEL.securityCamera;
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
  await p1.walkTo([spot[0], 0.5, spot[2]]);
  await p1.walkTo(spot);
  const alarmP = p1.wait((m) => m.t === 'alarm' && m.on, 14000, 'alarm');
  const hold = p1.hold(14);
  const al = await alarmP;
  assert.ok(al.until > Date.now() - 100);
  ok('the camera triggers the alarm and starts the police countdown');
  const fail = await p1.wait((m) => m.t === 'fail', 4000, 'busted');
  assert.equal(fail.money, 0);
  ok('when the countdown runs out: BUSTED');
  await hold;
  p1.close();
  s2.close();

  // ---------------- Server 3: the cat ----------------
  console.log('The cat');
  const s3 = await startServer(0, { camera: false });
  const [k] = await room(`ws://localhost:${s3.address().port}/ws`, ['Kit']);
  const bed = LEVEL.catBed;
  await k.walkTo([bed[0] + 6, 0.5, bed[2] + 8]);
  await k.walkTo([bed[0] + 6, 0, bed[2] + 8]);
  for (let i = 0; i < 10; i++) { k.send({ t: 's', p: k.p, r: 0, g: 1, m: 2 }); await sleep(50); } // sprinting = noise
  await k.wait((m) => m.t === 'snap' && m.cat && m.cat[3] !== 0, 3000, 'cat awake');
  ok('sprinting near the sleeping cat wakes it up');
  const caught = k.wait((m) => m.t === 'ev' && m.kind === 'caught' && m.who === k.id, 15000, 'caught');
  const standStill = k.hold(15);
  await caught;
  const corr = await k.wait((m) => m.t === 'corr', 1000);
  assert.ok(corr.p[2] > 15, 'sent back to the entrance');
  ok('the cat hunted the thief down and swatted them back to the entrance');
  await standStill.catch(() => {});
  k.close();
  s3.close();

  server.close();
  console.log(`\nAll ${passed} checks passed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
