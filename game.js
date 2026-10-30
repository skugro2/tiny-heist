// The in-game session: owns the Three.js renderer, the local player, remote players and the valuables.
// Everything authoritative (items, alarm, completion) comes from server messages.

import * as THREE from 'three';
import * as C from './constants.js';
import { LEVEL, VALUABLE_BY_ID } from './level.js';
import { cameraYawAt, findPickupTarget, inEscapeZone } from './physics.js';
import { World } from './world.js';
import { Avatar, RemotePlayer } from './avatar.js';
import { ItemView } from './items.js';
import { LocalPlayer, ThirdPersonCamera } from './player.js';
import { Input } from './input.js';

const params = new URLSearchParams(location.search);

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

    // Valuables
    this.items = joined.items;
    this.itemViews = new Map(LEVEL.valuables.map((v) => [v.id, new ItemView(v.id, this.scene)]));

    this.input = new Input(canvas, (locked) => this._refreshLockHint(locked));
    this.alarmOn = false;
    this.completed = null;
    this.sendTimer = 0;
    this.time = 0;
    this.perf = { frames: 0, total: 0, checked: this.lowQuality };

    hud.show();
    hud.setRoom(this.code);
    this._refreshPlayers();
    this._refreshLoot();
    this._refreshLockHint(false);
    if (joined.alarm?.on) this._setAlarm(true);
    if (joined.completed) this._setCompleted(joined.completed);

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------- Networking ----------

  onMessage(m) {
    switch (m.t) {
      case 'snap':
        for (const [id, x, y, z, ry, g, mv, sus] of m.pl) {
          if (id === this.myId) { this.mySus = sus; continue; }
          const r = this.remotes.get(id);
          if (r) { r.push(m.st, x, y, z, ry, g, mv); r.sus = sus; }
        }
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
        this._refreshLoot();
        break;
      case 'ev': this._onEvent(m); break;
      case 'alarm': this._setAlarm(m.on, m.by); break;
      case 'done': this._setCompleted(m); break;
      case 'reset': this._onReset(m); break;
      case 'corr': this.local.teleport(m.p); break;
      default: break;
    }
  }

  _onEvent(m) {
    const who = m.who === this.myId ? 'You' : this.remotes.get(m.who)?.name || 'Someone';
    const item = VALUABLE_BY_ID[m.item]?.name || 'valuable';
    if (m.kind === 'pickup') { this.sfx.pickup(); this.hud.toast(`${who} grabbed the ${item}`); }
    if (m.kind === 'drop') { this.sfx.drop(); this.hud.toast(`${who} dropped the ${item}`); }
    if (m.kind === 'deliver') { this.sfx.deliver(); this.hud.toast(`${who} stashed the ${item}`); }
  }

  _setAlarm(on, by) {
    if (on === this.alarmOn) return;
    this.alarmOn = on;
    this.world.setAlarm(on);
    this.hud.setAlarm(on);
    if (on) {
      this.sfx.alarmOn();
      const who = by === this.myId ? 'You were' : `${this.remotes.get(by)?.name || 'Someone'} was`;
      this.hud.toast(`${who} spotted by the camera!`);
    } else {
      this.sfx.alarmOff();
    }
  }

  _setCompleted(info) {
    this.completed = info;
    this._setAlarm(false);
    this.sfx.complete();
    this.input.releaseLock();
    this.hud.showComplete(info);
  }

  _onReset(m) {
    this.completed = null;
    this.items = m.items;
    this.hud.showComplete(null);
    this._setAlarm(false);
    for (const [id, p] of Object.entries(m.spawns)) {
      if (id === this.myId) { this.local.teleport(p, LEVEL.spawnYaw); this.tpc.yaw = LEVEL.spawnYaw; }
      else this.remotes.get(id)?.teleport(p);
    }
    this._refreshLoot();
    this._refreshLockHint(this.input.locked);
    this.hud.toast('New heist: the store is locked up again');
  }

  requestRestart() { this.net.send({ t: 'restart' }); }

  _addRemote(info) {
    const r = new RemotePlayer(info);
    this.remotes.set(info.id, r);
    this.scene.add(r.avatar.group);
  }

  // ---------- HUD helpers ----------

  _refreshPlayers() {
    const list = [{ ...this.me, you: true }, ...[...this.remotes.values()].map((r) => ({ name: r.name, color: r.color }))];
    this.hud.setPlayers(list);
  }

  _refreshLoot() {
    this.hud.setLoot(this.items.filter((i) => i.delivered).length, this.items.length);
  }

  _refreshLockHint(locked) {
    this.hud.setLockHint(!locked && !this.completed);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- Frame ----------

  _frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this._autoQuality(dt);

    const held = this.items.find((i) => i.holder === this.myId) || null;
    const canPlay = !this.completed;

    // Input & local movement
    const [mx, my] = this.input.consumeMouse();
    this.tpc.rotate(mx, my);
    if (canPlay) {
      const jumped = this.local.update(dt, this.input, this.tpc.yaw, !!held);
      if (jumped) { this.net.send({ t: 'j' }); this.localAvatar.jump(); this.sfx.jump(); }
    }

    // Interaction (the server decides what actually happens)
    const target = held ? null : findPickupTarget(this.items, this.local.p);
    if (canPlay && this.input.wasPressed('KeyE') && (held || target)) this.net.send({ t: 'e' });
    if (!canPlay) this.hud.setPrompt(null);
    else if (held) this.hud.setPrompt('E', inEscapeZone(this.local.p) ? `Stash the ${VALUABLE_BY_ID[held.id].name}` : `Drop the ${VALUABLE_BY_ID[held.id].name}`);
    else if (target) this.hud.setPrompt('E', `Pick up the ${VALUABLE_BY_ID[target.id].name}`);
    else this.hud.setPrompt(null);
    this.hud.setCarry(held ? `Carrying the ${VALUABLE_BY_ID[held.id].name}. Bring it to the yellow zone by the exit.` : null);
    this.hud.setSpotted(this.alarmOn || this.completed ? 0 : this.mySus);

    // Send our state ~20 times per second
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / C.CLIENT_SEND_RATE) {
      this.sendTimer = 0;
      const p = this.local.p;
      this.net.send({
        t: 's',
        p: [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000, Math.round(p[2] * 1000) / 1000],
        r: Math.round(this.local.ry * 1000) / 1000,
        g: this.local.body.grounded ? 1 : 0,
        m: this.local.moving,
      });
    }

    // Avatars
    const lp = this.local.p;
    this.localAvatar.setSpotted(this.alarmOn ? 0 : this.mySus);
    this.localAvatar.pose(lp[0], lp[1], lp[2], this.local.ry, this.local.moving > 0, this.local.moving === 2, this.local.body.grounded, dt);
    const renderTime = this.net.clock.now() - C.INTERP_DELAY_MS;
    for (const r of this.remotes.values()) r.update(renderTime, dt);

    // Valuables: carried ones follow their carrier, the rest sit where the server put them
    for (const it of this.items) {
      const view = this.itemViews.get(it.id);
      if (it.holder) {
        let pos = null, ry = 0;
        if (it.holder === this.myId) { pos = lp; ry = this.local.ry; }
        else { const r = this.remotes.get(it.holder); if (r) { pos = [r.x, r.y, r.z]; ry = r.ry; } }
        if (pos) view.update(this.time, pos, ry, { carried: true });
        else view.update(this.time, it.pos, it.ry, { carried: false, delivered: it.delivered });
      } else {
        view.update(this.time, it.pos, it.ry, { carried: false, targeted: target && target.id === it.id, delivered: it.delivered });
      }
    }

    // World
    this.world.updateSecurityCamera(cameraYawAt(this.net.clock.now() / 1000), this.mySus > 0.05);
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
