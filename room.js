// One heist room: the server is the source of truth for loot, deliveries, the camera, the alarm,
// the police timer, the cat and the mousetraps. Clients own their own movement (for responsiveness)
// but the server sanity-checks it.

import * as C from './constants.js';
import { LEVEL, VALUABLE_BY_ID, MAIN_VALUABLES } from './level.js';
import { cameraYawAt, cameraSees, dropPosition, findPickupTarget, inEscapeZone } from './physics.js';
import { Cat } from './cat.js';

const PLAYER_COLORS = ['#ff5fa2', '#4fc3ff', '#ffd23f', '#7ee081'];
const r2 = (n) => Math.round(n * 100) / 100;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let nextPlayerId = 1;

export class Room {
  /** options: { cat, camera, policeSeconds } — used by tests to switch systems off. */
  constructor(code, onEmpty, options = {}) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.options = { cat: true, camera: true, policeSeconds: C.POLICE_SECONDS, ...options };
    this.players = new Map();
    this.cat = new Cat(this.options.cat);
    this.resetHeist();
  }

  resetHeist() {
    // Fresh random layout every heist.
    const normal = shuffle(LEVEL.spots.normal.map((s) => [...s]));
    const floor = shuffle(LEVEL.spots.floor.map((s) => [...s]));
    const secret = shuffle(LEVEL.spots.secret.map((s) => [...s]));
    const spotFor = (v) => (v.heavy ? floor.pop() : v.rare ? secret.pop() : normal.pop());
    this.items = LEVEL.valuables.map((v) => {
      const s = spotFor(v);
      return { id: v.id, pos: [s[0], s[1], s[2]], ry: s[3], holders: [], delivered: false };
    });
    this.traps = LEVEL.traps.map((t, i) => ({ id: i, pos: t, armed: true, rearmAt: 0 }));
    this.alarm = { on: false, until: 0, count: 0, by: null };
    this.startTime = Date.now();
    this.completed = null;
    this.failed = false;
    this.cameraOff = false;
    this.cat.reset();
  }

  get full() { return this.players.size >= C.MAX_PLAYERS; }
  get over() { return !!this.completed || this.failed; }

  addPlayer(ws, name) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
    const spawn = this._freeSpawn();
    const player = {
      id: `p${nextPlayerId++}`,
      name, color, ws,
      p: [...spawn], ry: LEVEL.spawnYaw, g: 1, m: 0,
      sus: 0,
      trappedUntil: 0,
      immuneUntil: 0,
      budget: C.MOVE_BUDGET_MAX,
      lastMove: Date.now(),
      msgTokens: 60, lastMsg: Date.now(),
    };
    this.players.set(player.id, player);
    this.send(player, { t: 'joined', st: Date.now(), code: this.code, you: player.id, ...this._fullState() });
    this.broadcast({ t: 'pj', player: this._publicPlayer(player) }, player.id);
    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    this._releaseAll(player);
    this.players.delete(id);
    this.broadcast({ t: 'pl', id, name: player.name });
    this._sendItems();
    if (this.players.size === 0) this.onEmpty(this);
  }

  handle(player, msg) {
    // Flood protection: about 60 messages per second per player.
    const now = Date.now();
    player.msgTokens = Math.min(80, player.msgTokens + ((now - player.lastMsg) / 1000) * 60);
    player.lastMsg = now;
    if (player.msgTokens < 1) return;
    player.msgTokens -= 1;

    switch (msg.t) {
      case 's': return this._onState(player, msg, now);
      case 'j': return this.broadcast({ t: 'j', id: player.id }, player.id);
      case 'e': return this._onInteract(player, now);
      case 'restart': return this._onRestart();
      default: return undefined;
    }
  }

  _onState(player, msg, now) {
    const p = msg.p;
    if (!Array.isArray(p) || p.length !== 3 || !p.every(finite)) return;
    const elapsed = Math.min(1, (now - player.lastMove) / 1000);
    player.lastMove = now;
    player.budget = Math.min(C.MOVE_BUDGET_MAX, player.budget + elapsed * C.MOVE_ALLOWANCE_SPEED);
    const dist = Math.hypot(p[0] - player.p[0], p[2] - player.p[2]);
    const b = LEVEL.bounds;
    const outside = p[0] < b.minX - 1 || p[0] > b.maxX + 1 || p[2] < b.minZ - 1 || p[2] > b.maxZ + 1 || p[1] < -1 || p[1] > b.height;
    const stuck = player.trappedUntil > now && dist > 0.3;
    if (dist > player.budget + 0.5 || outside || stuck) {
      this.send(player, { t: 'corr', p: player.p.map(r2) }); // snap back to the last valid spot
      return;
    }
    player.budget -= dist;
    player.p = [p[0], Math.max(0, p[1]), p[2]];
    if (finite(msg.r)) player.ry = msg.r;
    player.g = msg.g ? 1 : 0;
    player.m = msg.m === 2 ? 2 : msg.m === 1 ? 1 : 0;
    if (player.m === 2 && player.g) this.cat.hear(player.p[0], player.p[2], C.CAT_HEAR_SPRINT);
  }

  _onInteract(player, now) {
    if (this.over || player.trappedUntil > now) return;

    // 1. Free a trapped friend
    for (const other of this.players.values()) {
      if (other === player || !(other.trappedUntil > now)) continue;
      if (Math.hypot(other.p[0] - player.p[0], other.p[2] - player.p[2]) < C.RESCUE_RANGE) {
        other.trappedUntil = 0;
        this.broadcast({ t: 'ev', kind: 'rescue', who: player.id, other: other.id });
        return;
      }
    }

    // 2. Drop (or stash) what I'm holding
    const held = this.items.find((it) => it.holders.includes(player.id));
    if (held) {
      held.holders = held.holders.filter((h) => h !== player.id);
      if (held.holders.length === 0) {
        held.ry = player.ry;
        if (inEscapeZone(player.p)) { this._deliver(held, player); return; }
        held.pos = dropPosition(player.p, player.ry);
        this.cat.hear(held.pos[0], held.pos[2], C.CAT_HEAR_NOISE);
      }
      this.broadcast({ t: 'ev', kind: 'drop', who: player.id, item: held.id });
      this._sendItems();
      return;
    }

    // 3. Pick up
    const target = findPickupTarget(this.items, player.p, player.id);
    if (!target) return;
    target.holders.push(player.id);
    this.broadcast({ t: 'ev', kind: 'pickup', who: player.id, item: target.id });
    this._sendItems();
  }

  _releaseAll(player) {
    let changed = false;
    for (const it of this.items) {
      if (!it.holders.includes(player.id)) continue;
      it.holders = it.holders.filter((h) => h !== player.id);
      if (!it.holders.length) { it.pos = dropPosition(player.p, player.ry); it.ry = player.ry; }
      changed = true;
    }
    return changed;
  }

  _deliver(item, player) {
    const n = this.items.filter((i) => i.delivered).length;
    const slot = LEVEL.deliverySlots[n % LEVEL.deliverySlots.length];
    item.holders = [];
    item.delivered = true;
    item.pos = [slot[0] + (n >= 3 ? 1.5 : 0), slot[1], slot[2] - (n >= 3 ? 1.8 : 0)];
    item.ry = slot[3];
    this.broadcast({ t: 'ev', kind: 'deliver', who: player.id, item: item.id });
    this._sendItems();
    if (MAIN_VALUABLES.every((id) => this.items.find((i) => i.id === id).delivered)) {
      this.completed = {
        time: Date.now() - this.startTime,
        alarms: this.alarm.count,
        money: this._money(),
        rare: this.items.some((i) => i.delivered && VALUABLE_BY_ID[i.id].rare),
      };
      this.alarm.on = false;
      this.broadcast({ t: 'done', ...this.completed });
    }
  }

  _money() {
    return this.items.filter((i) => i.delivered).reduce((sum, i) => sum + VALUABLE_BY_ID[i.id].value, 0);
  }

  _onRestart() {
    if (!this.over) return;
    this.resetHeist();
    const spawns = {};
    let i = 0;
    for (const pl of this.players.values()) {
      pl.p = [...LEVEL.spawns[i++ % LEVEL.spawns.length]];
      pl.ry = LEVEL.spawnYaw;
      pl.sus = 0;
      pl.trappedUntil = 0;
      pl.budget = C.MOVE_BUDGET_MAX;
      spawns[pl.id] = pl.p;
    }
    this.broadcast({ t: 'reset', spawns, ...this._fullState() });
  }

  tick(now, dt) {
    if (!this.players.size) return;
    const players = [...this.players.values()];
    let itemsChanged = false;

    // Carried loot follows its carriers; heavy loot sits between the two of them.
    for (const it of this.items) {
      if (!it.holders.length || it.delivered) continue;
      const hs = it.holders.map((id) => this.players.get(id)).filter(Boolean);
      if (!hs.length) continue;
      if (hs.length === 2 && Math.hypot(hs[0].p[0] - hs[1].p[0], hs[0].p[2] - hs[1].p[2]) > C.HEAVY_MAX_APART) {
        const mid = [(hs[0].p[0] + hs[1].p[0]) / 2, 0, (hs[0].p[2] + hs[1].p[2]) / 2];
        it.pos = dropPosition([mid[0], Math.min(hs[0].p[1], hs[1].p[1]), mid[2]], 0);
        it.holders = [];
        this.broadcast({ t: 'ev', kind: 'drop', who: hs[0].id, item: it.id, apart: true });
        itemsChanged = true;
        continue;
      }
      it.pos = [
        hs.reduce((s, h) => s + h.p[0], 0) / hs.length,
        Math.min(...hs.map((h) => h.p[1])),
        hs.reduce((s, h) => s + h.p[2], 0) / hs.length,
      ];
      if (!this.over && inEscapeZone(it.pos)) this._deliver(it, hs[0]);
    }

    if (!this.over) {
      // Mousetraps
      for (const tr of this.traps) {
        if (!tr.armed) { if (now >= tr.rearmAt) { tr.armed = true; itemsChanged = true; } continue; }
        for (const pl of players) {
          if (pl.p[1] > 0.3 || Math.hypot(pl.p[0] - tr.pos[0], pl.p[2] - tr.pos[2]) > 0.75) continue;
          tr.armed = false;
          tr.rearmAt = now + C.TRAP_REARM_SECONDS * 1000;
          pl.trappedUntil = now + C.TRAP_STUCK_SECONDS * 1000;
          this.broadcast({ t: 'ev', kind: 'trap', who: pl.id, trap: tr.id });
          this.cat.hear(tr.pos[0], tr.pos[2], C.CAT_HEAR_NOISE);
          itemsChanged = true;
          break;
        }
      }

      // Camera switch: anyone standing on it turns the camera off.
      const sw = LEVEL.cameraSwitch;
      const off = players.some((pl) => pl.p[1] < 0.5 && Math.abs(pl.p[0] - sw.x) < sw.w / 2 && Math.abs(pl.p[2] - sw.z) < sw.d / 2);
      if (off !== this.cameraOff) { this.cameraOff = off; this.broadcast({ t: 'cam', off }); }

      // Security camera detection
      const yaw = cameraYawAt(now / 1000);
      for (const pl of players) {
        const seen = this.options.camera && !this.cameraOff && !this.alarm.on &&
          cameraSees(yaw, [pl.p[0], pl.p[1] + C.PLAYER_HEIGHT * 0.5, pl.p[2]]);
        pl.sus = Math.max(0, Math.min(1, pl.sus + (seen ? dt / C.DETECT_SECONDS : -dt * C.DETECT_DECAY)));
        if (pl.sus >= 1 && !this.alarm.on) this._startAlarm(pl, now);
      }

      // Police arrive
      if (this.alarm.on && now >= this.alarm.until) {
        this.failed = true;
        this.alarm.on = false;
        for (const pl of players) this._releaseAll(pl);
        this.broadcast({ t: 'fail', money: this._money() });
        itemsChanged = true;
      }

      // The cat
      if (!this.over) {
        const caughtId = this.cat.update(dt, players, now);
        if (caughtId) this._caught(this.players.get(caughtId), now);
      }
    }

    if (itemsChanged) this._sendItems();

    this.broadcast({
      t: 'snap',
      st: now,
      pl: players.map((pl) => [pl.id, r2(pl.p[0]), r2(pl.p[1]), r2(pl.p[2]), r2(pl.ry), pl.g, pl.m, r2(pl.sus), pl.trappedUntil > now ? 1 : 0]),
      cat: [r2(this.cat.x), r2(this.cat.z), r2(this.cat.ry), this.cat.state],
    });
  }

  _caught(pl, now) {
    if (!pl) return;
    this._releaseAll(pl);
    pl.p = [...this._freeSpawn(pl.id)];
    pl.budget = C.MOVE_BUDGET_MAX;
    pl.trappedUntil = 0;
    pl.immuneUntil = now + C.CAUGHT_IMMUNITY * 1000;
    this.send(pl, { t: 'corr', p: pl.p });
    this.broadcast({ t: 'ev', kind: 'caught', who: pl.id });
    this._sendItems();
  }

  _startAlarm(pl, now) {
    this.alarm.on = true;
    this.alarm.until = now + this.options.policeSeconds * 1000;
    this.alarm.count += 1;
    this.alarm.by = pl.id;
    this.broadcast({ t: 'alarm', on: true, by: pl.id, count: this.alarm.count, until: this.alarm.until, st: now });
    this.cat.alarm([...this.players.values()]);
  }

  _freeSpawn(exceptId = null) {
    const taken = [...this.players.values()].filter((p) => p.id !== exceptId).map((p) => p.p);
    return LEVEL.spawns.find((s) => !taken.some((t) => Math.hypot(t[0] - s[0], t[2] - s[2]) < 1)) || LEVEL.spawns[0];
  }

  _publicPlayer(p) {
    return { id: p.id, name: p.name, color: p.color, p: p.p.map(r2), ry: r2(p.ry), g: p.g, m: p.m };
  }

  _itemsState() {
    return this.items.map((it) => ({ id: it.id, pos: it.pos.map(r2), ry: r2(it.ry), holders: [...it.holders], delivered: it.delivered }));
  }

  _trapsState() {
    return this.traps.map((t) => ({ id: t.id, pos: t.pos, armed: t.armed }));
  }

  _fullState() {
    return {
      players: [...this.players.values()].map((p) => this._publicPlayer(p)),
      items: this._itemsState(),
      traps: this._trapsState(),
      alarm: { on: this.alarm.on, count: this.alarm.count, until: this.alarm.until },
      cameraOff: this.cameraOff,
      completed: this.completed,
      failed: this.failed,
    };
  }

  _sendItems() {
    this.broadcast({ t: 'items', items: this._itemsState(), traps: this._trapsState() });
  }

  send(player, obj) {
    player.ws.send(JSON.stringify(obj));
  }

  broadcast(obj, exceptId = null) {
    const text = JSON.stringify(obj);
    for (const pl of this.players.values()) if (pl.id !== exceptId) pl.ws.send(text);
  }
}
