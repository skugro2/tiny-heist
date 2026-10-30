// Local player movement (client-side, using the shared physics) and the third-person camera.

import * as C from './constants.js';
import { moveAndCollide, overlapsBox, blockedAt, raycast } from './physics.js';
import { COLLIDERS } from './level.js';

const JUMP_BUFFER = 0.12;   // seconds a jump press is remembered before landing
const COYOTE_TIME = 0.1;    // seconds you can still jump after running off a ledge

export class LocalPlayer {
  constructor(spawn, yaw) {
    this.body = { p: [...spawn], v: [0, 0, 0], grounded: true };
    this.ry = yaw;
    this.spawn = [...spawn];
    this.jumpBuffer = 0;
    this.airTime = 0;
    this.moving = 0; // 0 idle, 1 walk, 2 sprint
  }

  get p() { return this.body.p; }

  teleport(p, yaw = this.ry) {
    this.body.p = [...p];
    this.body.v = [0, 0, 0];
    this.body.grounded = true;
    this.ry = yaw;
  }

  /**
   * opts: { speedFactor, frozen, colliders, vacuum: { box, dx, dz } }
   * Returns { jumped, bounced, shoved } for sounds/animation.
   */
  update(dt, input, camYaw, opts = {}) {
    const b = this.body;
    const colliders = opts.colliders || COLLIDERS;
    const out = { jumped: false, bounced: false, shoved: false };

    // Riding the robot vacuum: move along with it.
    const vac = opts.vacuum;
    if (vac && b.grounded && Math.abs(b.p[1] - vac.box.max[1]) < 0.05 &&
        b.p[0] > vac.prevBox.min[0] - C.PLAYER_RADIUS && b.p[0] < vac.prevBox.max[0] + C.PLAYER_RADIUS &&
        b.p[2] > vac.prevBox.min[2] - C.PLAYER_RADIUS && b.p[2] < vac.prevBox.max[2] + C.PLAYER_RADIUS) {
      if (!blockedAt(b.p[0] + vac.dx, b.p[1], b.p[2] + vac.dz, COLLIDERS)) { b.p[0] += vac.dx; b.p[2] += vac.dz; }
    }
    // The vacuum drove into us: shove the thief out of the way.
    if (vac && overlapsBox(b.p[0], b.p[1], b.p[2], vac.box)) {
      const cx = (vac.box.min[0] + vac.box.max[0]) / 2, cz = (vac.box.min[2] + vac.box.max[2]) / 2;
      let ax = b.p[0] - cx, az = b.p[2] - cz;
      const len = Math.hypot(ax, az) || 1;
      ax /= len; az /= len;
      for (let i = 0; i < 30 && overlapsBox(b.p[0], b.p[1], b.p[2], vac.box); i++) { b.p[0] += ax * 0.1; b.p[2] += az * 0.1; }
      b.v[0] = ax * 8; b.v[2] = az * 8; b.v[1] = Math.max(b.v[1], 4);
      out.shoved = true;
    }
    if (opts.frozen) {
      b.v[0] = 0; b.v[2] = 0;
      b.v[1] -= C.GRAVITY * dt;
      moveAndCollide(b, dt, colliders);
      this.moving = 0;
      return out;
    }
    const fwd = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const side = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');

    // Camera-relative direction: forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw).
    let mx = Math.sin(camYaw) * fwd - Math.cos(camYaw) * side;
    let mz = Math.cos(camYaw) * fwd + Math.sin(camYaw) * side;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    let speed = sprint ? C.SPRINT_SPEED : C.WALK_SPEED;
    speed *= opts.speedFactor ?? 1;
    const accel = b.grounded ? 60 : 22;
    const tx = mx * speed, tz = mz * speed;
    const k = Math.min(1, accel * dt / Math.max(speed, 1));
    b.v[0] += (tx - b.v[0]) * k;
    b.v[2] += (tz - b.v[2]) * k;

    if (input.wasPressed('Space')) this.jumpBuffer = JUMP_BUFFER;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.airTime = b.grounded ? 0 : this.airTime + dt;

    if (this.jumpBuffer > 0 && this.airTime <= COYOTE_TIME && b.v[1] <= 0.01) {
      b.v[1] = C.JUMP_VELOCITY;
      this.jumpBuffer = 0;
      this.airTime = COYOTE_TIME + 1;
      out.jumped = true;
    }

    b.v[1] -= C.GRAVITY * dt;
    if (b.v[1] < -40) b.v[1] = -40;
    moveAndCollide(b, dt, colliders);
    if (b.landedOn && b.landedOn.bounce) { // rubber-band trampoline
      b.v[1] = b.landedOn.bounce;
      b.grounded = false;
      this.airTime = COYOTE_TIME + 1;
      out.bounced = true;
    }

    if (b.p[1] < -5) this.teleport(this.spawn); // safety net, should never happen

    const hs = Math.hypot(b.v[0], b.v[2]);
    if (len > 0 && hs > 0.3) {
      const target = Math.atan2(b.v[0], b.v[2]);
      let d = target - this.ry;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.ry += d * Math.min(1, dt * 14);
    }
    this.moving = len > 0 && hs > 0.5 ? (sprint ? 2 : 1) : 0;
    return out;
  }
}

export class ThirdPersonCamera {
  constructor(camera, yaw) {
    this.camera = camera;
    this.yaw = yaw;
    this.pitch = 0.32;
    this.distance = 4.6;
    this.current = 4.6;
    this.sensitivity = 0.0025;
  }

  rotate(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + dy * this.sensitivity));
  }

  update(dt, target) {
    const t = [target[0], target[1] + 1.05, target[2]];
    const cp = Math.cos(this.pitch);
    const dir = [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
    // Pull the camera in front of walls and shelves so they never block the view.
    const hit = raycast(t, dir, this.distance);
    const want = Math.max(0.7, Math.min(this.distance, hit - 0.3));
    this.current = want < this.current ? want : this.current + (want - this.current) * Math.min(1, dt * 4);
    let cy = t[1] + dir[1] * this.current;
    if (cy < 0.25) cy = 0.25;
    this.camera.position.set(t[0] + dir[0] * this.current, cy, t[2] + dir[2] * this.current);
    this.camera.lookAt(t[0], t[1], t[2]);
  }
}
