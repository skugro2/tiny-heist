// One heist room: the server is the source of truth for valuables, deliveries, the camera and the alarm.
// Clients own their own movement (for responsiveness) but the server sanity-checks it.

import * as C from './constants.js';
import { LEVEL } from './level.js';
import { cameraYawAt, cameraSees, dropPosition, findPickupTarget, inEscapeZone } from './physics.js';

const PLAYER_COLORS = ['#ff5fa2', '#4fc3ff', '#ffd23f', '#7ee081'];
const r2 = (n) => Math.round(n * 100) / 100;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

let nextPlayerId = 1;

export class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.players = new Map();
    this.resetHeist();
  }

  resetHeist() {
    this.items = LEVEL.valuables.map((v) => ({ id: v.id, pos: [...v.pos], ry: v.ry, holder: null, delivered: false }));
    this.alarm = { on: false, until: 0, count: 0, by: null };
    this.startTime = Date.now();
    this.completed = null;
  }

  get full() { return this.players.size >= C.MAX_PLAYERS; }

  addPlayer(ws, name) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
    const spawn = this._freeSpawn();
    const player = {
      id: `p${nextPlayerId++}`,
      name, color, ws,
      p: [...spawn], ry: LEVEL.spawnYaw, g: 1, m: 0,
      sus: 0,
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
    this.players.delete(id);
    for (const it of this.items) {
      if (it.holder === id) {
        it.holder = null;
        it.pos = dropPosition(player.p, player.ry);
        it.ry = player.ry;
      }
    }
    this.broadcast({ t: 'pl', id, name: player.name });
    this._sendItems();
    if (this.players.size === 0) this.onEmpty(this);
  }

  handle(player, msg) {
    // Simple flood protection: about 60 messages per second per player.
    const now = Date.now();
    player.msgTokens = Math.min(80, player.msgTokens + ((now - player.lastMsg) / 1000) * 60);
    player.lastMsg = now;
    if (player.msgTokens < 1) return;
    player.msgTokens -= 1;

    switch (msg.t) {
      case 's': return this._onState(player, msg, now);
      case 'j': return this.broadcast({ t: 'j', id: player.id }, player.id);
      case 'e': return this._onInteract(player);
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
    if (dist > player.budget + 0.5 || outside) {
      this.send(player, { t: 'corr', p: player.p.map(r2) }); // snap them back to the last valid spot
      return;
    }
    player.budget -= dist;
    player.p = [p[0], Math.max(0, p[1]), p[2]];
    if (finite(msg.r)) player.ry = msg.r;
    player.g = msg.g ? 1 : 0;
    player.m = msg.m === 2 ? 2 : msg.m === 1 ? 1 : 0;
  }

  _onInteract(player) {
    if (this.completed) return;
    const held = this.items.find((it) => it.holder === player.id);
    if (held) {
      held.holder = null;
      held.ry = player.ry;
      if (inEscapeZone(player.p)) {
        this._deliver(held, player);
      } else {
        held.pos = dropPosition(player.p, player.ry);
        this.broadcast({ t: 'ev', kind: 'drop', who: player.id, item: held.id });
        this._sendItems();
      }
      return;
    }
    const target = findPickupTarget(this.items, player.p);
    if (!target) return;
    target.holder = player.id;
    this.broadcast({ t: 'ev', kind: 'pickup', who: player.id, item: target.id });
    this._sendItems();
  }

  _deliver(item, player) {
    const slot = LEVEL.deliverySlots[this.items.filter((i) => i.delivered).length] || LEVEL.deliverySlots[0];
    item.holder = null;
    item.delivered = true;
    item.pos = [slot[0], slot[1], slot[2]];
    item.ry = slot[3];
    this.broadcast({ t: 'ev', kind: 'deliver', who: player.id, item: item.id });
    this._sendItems();
    if (this.items.every((i) => i.delivered)) {
      this.completed = { time: Date.now() - this.startTime, alarms: this.alarm.count };
      if (this.alarm.on) this._endAlarm();
      this.broadcast({ t: 'done', ...this.completed });
    }
  }

  _onRestart() {
    if (!this.completed) return;
    this.resetHeist();
    const spawns = {};
    let i = 0;
    for (const pl of this.players.values()) {
      pl.p = [...LEVEL.spawns[i++ % LEVEL.spawns.length]];
      pl.ry = LEVEL.spawnYaw;
      pl.sus = 0;
      pl.budget = C.MOVE_BUDGET_MAX;
      spawns[pl.id] = pl.p;
    }
    this.broadcast({ t: 'reset', spawns, ...this._fullState() });
  }

  tick(now, dt) {
    if (!this.players.size) return;

    // Carrying a valuable into the escape zone banks it automatically.
    for (const it of this.items) {
      if (!it.holder) continue;
      const holder = this.players.get(it.holder);
      if (holder && inEscapeZone(holder.p)) this._deliver(it, holder);
    }

    const yaw = cameraYawAt(now / 1000);
    if (!this.completed) {
      for (const pl of this.players.values()) {
        const seen = cameraSees(yaw, [pl.p[0], pl.p[1] + C.PLAYER_HEIGHT * 0.5, pl.p[2]]);
        pl.sus = Math.max(0, Math.min(1, pl.sus + (seen ? dt / C.DETECT_SECONDS : -dt * C.DETECT_DECAY)));
        if (pl.sus >= 1 && !this.alarm.on) this._startAlarm(pl, now);
      }
    }
    if (this.alarm.on && now >= this.alarm.until) this._endAlarm();

    this.broadcast({
      t: 'snap',
      st: now,
      pl: [...this.players.values()].map((pl) => [pl.id, r2(pl.p[0]), r2(pl.p[1]), r2(pl.p[2]), r2(pl.ry), pl.g, pl.m, r2(pl.sus)]),
    });
  }

  _startAlarm(pl, now) {
    this.alarm.on = true;
    this.alarm.until = now + C.ALARM_SECONDS * 1000;
    this.alarm.count += 1;
    this.alarm.by = pl.id;
    this.broadcast({ t: 'alarm', on: true, by: pl.id, count: this.alarm.count, ms: C.ALARM_SECONDS * 1000 });
  }

  _endAlarm() {
    this.alarm.on = false;
    for (const pl of this.players.values()) pl.sus = 0;
    this.broadcast({ t: 'alarm', on: false, count: this.alarm.count });
  }

  _freeSpawn() {
    const taken = [...this.players.values()].map((p) => p.p);
    return LEVEL.spawns.find((s) => !taken.some((t) => Math.hypot(t[0] - s[0], t[2] - s[2]) < 1)) || LEVEL.spawns[0];
  }

  _publicPlayer(p) {
    return { id: p.id, name: p.name, color: p.color, p: p.p.map(r2), ry: r2(p.ry), g: p.g, m: p.m };
  }

  _itemsState() {
    return this.items.map((it) => ({ id: it.id, pos: it.pos.map(r2), ry: r2(it.ry), holder: it.holder, delivered: it.delivered }));
  }

  _fullState() {
    return {
      players: [...this.players.values()].map((p) => this._publicPlayer(p)),
      items: this._itemsState(),
      alarm: { on: this.alarm.on, count: this.alarm.count, msLeft: Math.max(0, this.alarm.until - Date.now()) },
      completed: this.completed,
    };
  }

  _sendItems() {
    this.broadcast({ t: 'items', items: this._itemsState() });
  }

  send(player, obj) {
    player.ws.send(JSON.stringify(obj));
  }

  broadcast(obj, exceptId = null) {
    const text = JSON.stringify(obj);
    for (const pl of this.players.values()) if (pl.id !== exceptId) pl.ws.send(text);
  }
}
