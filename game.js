// The in-game session: owns the Three.js renderer, the local player, remote players, the cat,
// the vacuum, traps and loot. Everything authoritative comes from server messages.

import * as THREE from 'three';
import * as C from './constants.js';
import { LEVEL, VALUABLE_BY_ID, MAIN_VALUABLES, COLLIDERS } from './level.js';
import { cameraYawAt, findPickupTarget, inEscapeZone, vacuumAt, vacuumCollider } from './physics.js';
import { World } from './world.js';
import { Avatar, RemotePlayer } from './avatar.js';
import { ItemView } from './items.js';
import { CatView, VacuumView, TrapView } from './props.js';
import { LocalPlayer, ThirdPersonCamera } from './player.js';
import { Input } from './input.js';

const params = new URLSearchParams(location.search);
const money = (n) => `$${n.toLocaleString('en-US')}`;

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Game {
  constructor({ canvas, net, hud, sfx, joined }) {
    this.canvas = canvas;
    this.net = net;
    this.hud = hud;
    this.sfx = sfx;
    this.myId = joined.you;
    this.code = joined.code;
    this.lowQuality = params.get('low') === '1';

    // Renderer tuned for Chromebooks: capped pixel ratio, one shadow-casting light.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowQuality, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowQuality ? 1 : 1.5));
    this.renderer.shadowMap.enabled = !this.lowQuality;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.05, 260);
    this.world = new World(this.scene, { shadows: !this.lowQuality });

    // Players
    const me = joined.players.find((p) => p.id === this.myId);
    this.me = { id: me.id, name: me.name, color: me.color };
    this.local = new LocalPlayer(me.p, me.ry);
    this.localAvatar = new Avatar(me.color, me.name, { showName: false });
    this.scene.add(this.localAvatar.group);
    this.tpc = new ThirdPersonCamera(this.camera, me.ry);
    this.remotes = new Map();
    for (const p of joined.players) if (p.id !== this.myId) this._addRemote(p);
    this.mySus = 0;
    this.myTrapped = false;

    // Loot, traps, cat, vacuum
    this.items = joined.items;
    this.itemViews = new Map(LEVEL.valuables.map((v) => [v.id, new ItemView(v.id, this.scene)]));
    this.trapViews = LEVEL.traps.map((t) => new TrapView(this.scene, t));
    this._applyTraps(joined.traps);
    this.catView = new CatView(this.scene);
    this.catBuf = [];
    this.cat = { x: LEVEL.catBed[0], z: LEVEL.catBed[2], ry: 0, state: 0 };
    this.vacuumView = new VacuumView(this.scene);
    this.prevVac = null;

    this.input = new Input(canvas, (locked) => this._refreshLockHint(locked));
    this.alarmOn = false;
    this.policeUntil = 0;
    this.lastBeep = -1;
    this.completed = null;
    this.failed = false;
    this.sendTimer = 0;
    this.time = 0;
    this.perf = { frames: 0, total: 0, checked: this.lowQuality };

    hud.show();
    hud.setRoom(this.code);
    this._refreshPlayers();
    this._refreshLoot();
    this._refreshLockHint(false);
    if (joined.cameraOff) this.world.setCameraOff(true);
    if (joined.alarm?.on) { this.policeUntil = joined.alarm.until; this._setAlarm(true); }
    if (joined.completed) this._setCompleted(joined.completed);
    if (joined.failed) this._setFailed({ money: this._money() });

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------- Networking ----------

  onMessage(m) {
    switch (m.t) {
      case 'snap':
        for (const [id, x, y, z, ry, g, mv, sus, trapped] of m.pl) {
          if (id === this.myId) { this.mySus = sus; this.myTrapped = !!trapped; continue; }
          const r = this.remotes.get(id);
          if (r) { r.push(m.st, x, y, z, ry, g, mv); r.sus = sus; r.trapped = !!trapped; }
        }
        if (m.cat) this._pushCat(m.st, m.cat);
        break;
      case 'pj':
        if (m.player.id !== this.myId && !this.remotes.has(m.player.id)) {
          this._addRemote(m.player);
          this.hud.toast(`${m.player.name} joined the crew`);
          this._refreshPlayers();
        }
        break;
      case 'pl': {
        const r = this.remotes.get(m.id);
        if (r) {
          this.scene.remove(r.avatar.group);
          this.remotes.delete(m.id);
          this.hud.toast(`${m.name} left`);
          this._refreshPlayers();
        }
        break;
      }
      case 'j': {
        const r = this.remotes.get(m.id);
        if (r) setTimeout(() => r.avatar.jump(), C.INTERP_DELAY_MS); // match the interpolation delay
        break;
      }
      case 'items':
        this.items = m.items;
        if (m.traps) this._applyTraps(m.traps);
        this._refreshLoot();
        break;
      case 'ev': this._onEvent(m); break;
      case 'cam':
        this.world.setCameraOff(m.off);
        this.hud.toast(m.off ? 'Camera switched off!' : 'Camera is back on');
        break;
      case 'alarm':
        if (m.on) this.policeUntil = m.until;
        this._setAlarm(m.on, m.by);
        break;
      case 'done': this._setCompleted(m); break;
      case 'fail': this._setFailed(m); break;
      case 'reset': this._onReset(m); break;
      case 'corr': this.local.teleport(m.p); break;
      default: break;
    }
  }

  _name(id) {
    return id === this.myId ? 'You' : this.remotes.get(id)?.name || 'Someone';
  }

  _onEvent(m) {
    const who = this._name(m.who);
    const item = VALUABLE_BY_ID[m.item]?.name || 'loot';
    switch (m.kind) {
      case 'pickup': this.sfx.pickup(); this.hud.toast(`${who} grabbed the ${item}`); break;
      case 'drop':
        this.sfx.drop();
        this.hud.toast(m.apart ? `Too far apart: the ${item} fell` : `${who} dropped the ${item}`);
        break;
      case 'deliver': this.sfx.deliver(); this.hud.toast(`${who} stashed the ${item} (+${money(VALUABLE_BY_ID[m.item].value)})`); break;
      case 'trap': this.sfx.snap(); this.hud.toast(m.who === this.myId ? 'SNAP! You stepped in a mousetrap' : `${who} is stuck in a mousetrap. Go free them (E)!`); break;
      case 'rescue': this.hud.toast(`${who} freed ${m.other === this.myId ? 'you' : this._name(m.other)}`); break;
      case 'caught':
        this.sfx.swat();
        this.hud.toast(m.who === this.myId ? 'The cat swatted you back to the entrance!' : `The cat swatted ${who}!`);
        break;
      default: break;
    }
  }

  _applyTraps(traps) {
    for (const t of traps || []) this.trapViews[t.id]?.setArmed(t.armed);
  }

  _pushCat(st, [x, z, ry, state]) {
    const last = this.catBuf[this.catBuf.length - 1];
    if (last && st <= last.t) return;
    this.catBuf.push({ t: st, x, z, ry, state });
    if (this.catBuf.length > 40) this.catBuf.shift();
  }

  _sampleCat(rt) {
    const b = this.catBuf;
    while (b.length >= 2 && b[1].t <= rt) b.shift();
    if (!b.length) return;
    const a = b[0], c = b[1];
    const prevState = this.cat.state;
    if (!c || rt <= a.t) Object.assign(this.cat, { x: a.x, z: a.z, ry: a.ry, state: a.state });
    else {
      const k = (rt - a.t) / (c.t - a.t);
      this.cat.x = a.x + (c.x - a.x) * k;
      this.cat.z = a.z + (c.z - a.z) * k;
      this.cat.ry = lerpAngle(a.ry, c.ry, k);
      this.cat.state = k < 0.5 ? a.state : c.state;
    }
    if (this.cat.state === 2 && prevState !== 2) {
      const d = Math.hypot(this.cat.x - this.local.p[0], this.cat.z - this.local.p[2]);
      if (d < 35) this.sfx.meow();
    }
  }

  _setAlarm(on, by) {
    if (on === this.alarmOn) return;
    this.alarmOn = on;
    this.world.setAlarm(on);
    this.hud.setAlarm(on);
    if (on) {
      this.sfx.alarmOn();
      const who = by === this.myId ? 'You were' : `${this.remotes.get(by)?.name || 'Someone'} was`;
      if (by) this.hud.toast(`${who} spotted by the camera! Get out before the police arrive!`);
    } else {
      this.sfx.alarmOff();
      this.hud.setPolice(null);
    }
  }

  _setCompleted(info) {
    this.completed = info;
    this._setAlarm(false);
    this.sfx.complete();
    this.input.releaseLock();
    let record = '';
    try {
      const best = JSON.parse(localStorage.getItem('tinyheist:best') || 'null');
      const better = !best || info.money > best.money || (info.money === best.money && info.time < best.time);
      if (better) { localStorage.setItem('tinyheist:best', JSON.stringify({ money: info.money, time: info.time })); record = 'New personal record!'; }
      else {
        const s = Math.round(best.time / 1000);
        record = `Your best: ${money(best.money)} in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
    } catch { /* storage unavailable */ }
    this.hud.showComplete({ ...info, record });
    this._refreshLockHint(false);
  }

  _setFailed(info) {
    this.failed = true;
    this._setAlarm(false);
    this.input.releaseLock();
    this.hud.showComplete({ failed: true, money: info.money || 0 });
    this._refreshLockHint(false);
  }

  _onReset(m) {
    this.completed = null;
    this.failed = false;
    this.items = m.items;
    this._applyTraps(m.traps);
    this.world.setCameraOff(!!m.cameraOff);
    this.catBuf = [];
    this.hud.showComplete(null);
    this._setAlarm(false);
    for (const [id, p] of Object.entries(m.spawns)) {
      if (id === this.myId) { this.local.teleport(p, LEVEL.spawnYaw); this.tpc.yaw = LEVEL.spawnYaw; }
      else this.remotes.get(id)?.teleport(p);
    }
    this._refreshLoot();
    this._refreshLockHint(this.input.locked);
    this.hud.toast('New heist: the loot has been moved around!');
  }

  requestRestart() { this.net.send({ t: 'restart' }); }

  _addRemote(info) {
    const r = new RemotePlayer(info);
    this.remotes.set(info.id, r);
    this.scene.add(r.avatar.group);
  }

  // ---------- HUD helpers ----------

  _money() {
    return this.items.filter((i) => i.delivered).reduce((s, i) => s + VALUABLE_BY_ID[i.id].value, 0);
  }

  _refreshPlayers() {
    const list = [{ ...this.me, you: true }, ...[...this.remotes.values()].map((r) => ({ name: r.name, color: r.color }))];
    this.hud.setPlayers(list);
  }

  _refreshLoot() {
    const delivered = MAIN_VALUABLES.filter((id) => this.items.find((i) => i.id === id)?.delivered).length;
    this.hud.setLoot(delivered, MAIN_VALUABLES.length, this._money());
  }

  _refreshLockHint(locked) {
    this.hud.setLockHint(!locked && !this.completed && !this.failed);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Where a player is drawn right now (local = predicted, remote = interpolated). */
  _playerPos(id) {
    if (id === this.myId) return { p: this.local.p, ry: this.local.ry };
    const r = this.remotes.get(id);
    return r ? { p: [r.x, r.y, r.z], ry: r.ry } : null;
  }

  // ---------- Frame ----------

  _frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this._autoQuality(dt);
    const serverNow = this.net.clock.now();

    const held = this.items.find((i) => i.holders.includes(this.myId)) || null;
    const heldDef = held ? VALUABLE_BY_ID[held.id] : null;
    const playing = !this.completed && !this.failed;

    // Robot vacuum (same position on every screen: it follows the server clock)
    const vacNow = vacuumAt(serverNow / 1000);
    const vacBox = vacuumCollider(vacNow);
    const prev = this.prevVac || vacNow;
    const vacuum = { box: vacBox, prevBox: vacuumCollider(prev), dx: vacNow.x - prev.x, dz: vacNow.z - prev.z };
    this.prevVac = vacNow;

    // Other thieves are solid, so you can stand on a friend's head for a boost.
    const lp0 = this.local.p;
    const colliders = COLLIDERS.concat([vacBox]);
    for (const r of this.remotes.values()) {
      const box = { min: [r.x - C.PLAYER_RADIUS, r.y, r.z - C.PLAYER_RADIUS], max: [r.x + C.PLAYER_RADIUS, r.y + C.PLAYER_HEIGHT, r.z + C.PLAYER_RADIUS] };
      const touching = Math.abs(lp0[0] - r.x) < C.PLAYER_RADIUS * 2 && Math.abs(lp0[2] - r.z) < C.PLAYER_RADIUS * 2 && lp0[1] < r.y + C.PLAYER_HEIGHT - 0.05 && lp0[1] + C.PLAYER_HEIGHT > r.y;
      if (!touching) colliders.push(box); // never trap someone who is already overlapping
    }

    // Input & local movement
    const [mx, my] = this.input.consumeMouse();
    this.tpc.rotate(mx, my);
    let speedFactor = 1;
    if (held) speedFactor = heldDef.heavy ? (held.holders.length >= 2 ? C.HEAVY_DUO_FACTOR : C.HEAVY_SOLO_FACTOR) : C.CARRY_SPEED_FACTOR;
    const res = this.local.update(dt, this.input, this.tpc.yaw, { speedFactor, frozen: !playing || this.myTrapped, colliders, vacuum });
    if (res.jumped) { this.net.send({ t: 'j' }); this.localAvatar.jump(); this.sfx.jump(); }
    if (res.bounced) { this.net.send({ t: 'j' }); this.localAvatar.jump(); this.sfx.boing(); }
    if (res.shoved) this.sfx.bump();

    // Interaction (the server decides what actually happens)
    const lp = this.local.p;
    let trappedFriend = null;
    if (playing && !this.myTrapped) {
      for (const r of this.remotes.values()) {
        if (r.trapped && Math.hypot(r.x - lp[0], r.z - lp[2]) < C.RESCUE_RANGE) { trappedFriend = r; break; }
      }
    }
    const target = held || trappedFriend || !playing ? null : findPickupTarget(this.items, lp, this.myId);
    if (playing && !this.myTrapped && this.input.wasPressed('KeyE') && (held || target || trappedFriend)) this.net.send({ t: 'e' });

    if (!playing || this.myTrapped) this.hud.setPrompt(null);
    else if (trappedFriend) this.hud.setPrompt('E', `Free ${trappedFriend.name} from the trap`);
    else if (held) this.hud.setPrompt('E', inEscapeZone(lp) ? `Stash the ${heldDef.name}` : `Drop the ${heldDef.name}`);
    else if (target) {
      const def = VALUABLE_BY_ID[target.id];
      this.hud.setPrompt('E', def.heavy ? `Grab the ${def.name} (heavy: carry it together)` : `Pick up the ${def.name}`);
    } else this.hud.setPrompt(null);

    let status = null;
    if (this.myTrapped) status = 'You are stuck in a mousetrap! Wait a few seconds, or a friend can free you.';
    else if (held && heldDef.heavy && held.holders.length < 2) status = 'Too heavy to carry fast alone. A friend can grab the other side (E).';
    else if (held && heldDef.heavy) status = 'Carrying it together. Stay close or you will drop it!';
    else if (this.world.cameraOff) status = 'Camera offline while someone stands on the switch.';
    this.hud.setStatus(playing ? status : null);
    this.hud.setCarry(held ? `Carrying the ${heldDef.name} (${money(heldDef.value)}). Bring it to the yellow zone by the exit.` : null);
    this.hud.setSpotted(this.alarmOn || !playing ? 0 : this.mySus);
    if (this.alarmOn && playing) {
      const left = (this.policeUntil - serverNow) / 1000;
      this.hud.setPolice(left);
      const sec = Math.ceil(left);
      if (sec <= 10 && sec >= 0 && sec !== this.lastBeep) { this.lastBeep = sec; this.sfx.beep(); }
    }

    // Send our state ~20 times per second
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / C.CLIENT_SEND_RATE) {
      this.sendTimer = 0;
      this.net.send({
        t: 's',
        p: [Math.round(lp[0] * 1000) / 1000, Math.round(lp[1] * 1000) / 1000, Math.round(lp[2] * 1000) / 1000],
        r: Math.round(this.local.ry * 1000) / 1000,
        g: this.local.body.grounded ? 1 : 0,
        m: this.local.moving,
      });
    }

    // Avatars
    this.localAvatar.setSpotted(this.alarmOn ? 0 : this.mySus);
    this.localAvatar.pose(lp[0], lp[1], lp[2], this.local.ry, this.local.moving > 0, this.local.moving === 2, this.local.body.grounded, dt);
    const renderTime = serverNow - C.INTERP_DELAY_MS;
    for (const r of this.remotes.values()) r.update(renderTime, dt);

    // Loot: carried pieces follow their carriers (heavy ones sit between two carriers)
    for (const it of this.items) {
      const view = this.itemViews.get(it.id);
      const carriers = it.delivered ? [] : it.holders.map((id) => this._playerPos(id)).filter(Boolean);
      if (carriers.length) {
        const pos = [0, 1, 2].map((k) => carriers.reduce((s, c) => s + c.p[k], 0) / carriers.length);
        pos[1] = Math.min(...carriers.map((c) => c.p[1]));
        let ry = carriers[0].ry;
        if (carriers.length === 2) ry = Math.atan2(carriers[1].p[0] - carriers[0].p[0], carriers[1].p[2] - carriers[0].p[2]) + Math.PI / 2;
        view.update(this.time, pos, ry, { carried: true });
      } else {
        view.update(this.time, it.pos, it.ry, { carried: false, targeted: target && target.id === it.id, delivered: it.delivered });
      }
    }

    // Cat, vacuum, traps
    this._sampleCat(renderTime);
    this.catView.update(this.cat.x, this.cat.z, this.cat.ry, this.cat.state, dt, this.time);
    this.vacuumView.update(vacNow, this.time);
    for (const t of this.trapViews) t.update(dt);

    // World
    this.world.updateSecurityCamera(cameraYawAt(serverNow / 1000), this.mySus > 0.05);
    this.world.update(dt, this.time, !!held);
    this.tpc.update(dt, lp);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  /** If the first few seconds run slowly (older Chromebooks), drop to low quality automatically. */
  _autoQuality(dt) {
    if (this.perf.checked) return;
    this.perf.frames++;
    this.perf.total += dt;
    if (this.perf.total < 4) return;
    this.perf.checked = true;
    const avg = this.perf.total / this.perf.frames;
    if (avg > 1 / 35) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.world.moon.castShadow = false;
      this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      this._resize();
      console.info(`[tiny-heist] ~${Math.round(1 / avg)} fps: switched to low quality (no shadows, 1x resolution)`);
    }
  }
}
