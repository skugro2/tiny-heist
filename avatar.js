// The temporary thief character: a bean with a beanie and a burglar mask, plus remote-player smoothing.

import * as THREE from 'three';

const SHARED = {
  body: new THREE.CapsuleGeometry(0.3, 0.4, 4, 10),
  beanie: new THREE.SphereGeometry(0.315, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  pom: new THREE.SphereGeometry(0.09, 8, 6),
  band: new THREE.CylinderGeometry(0.308, 0.308, 0.13, 16, 1, true),
  eye: new THREE.SphereGeometry(0.065, 8, 6),
  pupil: new THREE.SphereGeometry(0.035, 6, 4),
  sack: new THREE.SphereGeometry(0.2, 10, 8),
  foot: new THREE.BoxGeometry(0.15, 0.1, 0.22),
};
const DARK = new THREE.MeshLambertMaterial({ color: '#1c1830' });
const WHITE = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const BLACK = new THREE.MeshBasicMaterial({ color: '#000000' });
const SACK = new THREE.MeshLambertMaterial({ color: '#b98c5a' });

function nameSprite(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = '700 30px "Atkinson Hyperlegible", "Segoe UI", sans-serif';
  const w = Math.min(248, ctx.measureText(name).width + 34);
  ctx.fillStyle = 'rgba(20,26,51,0.8)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc((256 - w) / 2 + 20, 32, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f6f3ff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, (256 - w) / 2 + 32, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 1.55;
  return sprite;
}

function alertSprite() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ff4d5e';
  ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '44px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!', 32, 35);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(0.45, 0.45, 1);
  s.position.y = 1.95;
  s.visible = false;
  return s;
}

export class Avatar {
  constructor(color, name, { showName = true } = {}) {
    this.group = new THREE.Group();
    this.rig = new THREE.Group();
    this.group.add(this.rig);

    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(SHARED.body, bodyMat);
    body.position.y = 0.5;
    body.castShadow = true;
    const beanie = new THREE.Mesh(SHARED.beanie, DARK);
    beanie.position.y = 0.7;
    const pom = new THREE.Mesh(SHARED.pom, bodyMat);
    pom.position.y = 1.06;
    const band = new THREE.Mesh(SHARED.band, DARK);
    band.position.y = 0.66;
    const sack = new THREE.Mesh(SHARED.sack, SACK);
    sack.position.set(0, 0.48, -0.32);
    sack.scale.set(1, 1.1, 0.8);
    this.rig.add(body, beanie, pom, band, sack);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(SHARED.eye, WHITE);
      eye.position.set(side * 0.11, 0.66, 0.27);
      const pupil = new THREE.Mesh(SHARED.pupil, BLACK);
      pupil.position.set(side * 0.11, 0.66, 0.325);
      const foot = new THREE.Mesh(SHARED.foot, DARK);
      foot.position.set(side * 0.13, 0.05, 0.06);
      this.rig.add(eye, pupil, foot);
    }
    if (showName) this.group.add(nameSprite(name, color));
    this.alert = alertSprite();
    this.group.add(this.alert);

    this.phase = 0;
    this.squash = 0;     // >0 stretched (jump), <0 squashed (landing)
    this.wasGrounded = true;
  }

  jump() { this.squash = 0.25; }

  setSpotted(level) { this.alert.visible = level > 0.3; }

  /** Pose + procedural animation: bob while running, stretch on jump, squash on landing. */
  pose(x, y, z, ry, moving, sprint, grounded, dt) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = ry;
    if (grounded && !this.wasGrounded) this.squash = -0.22;
    this.wasGrounded = grounded;
    this.squash += (0 - this.squash) * Math.min(1, dt * 10);

    if (moving && grounded) this.phase += dt * (sprint ? 16 : 11);
    const bob = moving && grounded ? Math.abs(Math.sin(this.phase)) * 0.08 : 0;
    this.rig.position.y = bob;
    this.rig.rotation.x = moving ? (sprint ? 0.18 : 0.1) : 0;
    this.rig.rotation.z = moving && grounded ? Math.sin(this.phase) * 0.06 : 0;
    const s = 1 + this.squash;
    this.rig.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Another player: keeps a short buffer of server snapshots and renders between them. */
export class RemotePlayer {
  constructor(info) {
    this.id = info.id;
    this.name = info.name;
    this.color = info.color;
    this.avatar = new Avatar(info.color, info.name);
    this.buf = [];
    this.x = info.p[0]; this.y = info.p[1]; this.z = info.p[2];
    this.ry = info.ry; this.g = !!info.g; this.m = info.m || 0;
    this.sus = 0;
  }

  push(t, x, y, z, ry, g, m) {
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) return;
    this.buf.push({ t, x, y, z, ry, g, m });
    if (this.buf.length > 40) this.buf.shift();
  }

  teleport(p) {
    this.buf = [];
    this.x = p[0]; this.y = p[1]; this.z = p[2];
  }

  update(renderTime, dt) {
    const b = this.buf;
    while (b.length >= 2 && b[1].t <= renderTime) b.shift();
    if (b.length) {
      const a = b[0];
      const c = b[1];
      if (!c || renderTime <= a.t) {
        this.x = a.x; this.y = a.y; this.z = a.z; this.ry = a.ry; this.g = !!a.g; this.m = a.m;
      } else {
        const k = (renderTime - a.t) / (c.t - a.t);
        this.x = a.x + (c.x - a.x) * k;
        this.y = a.y + (c.y - a.y) * k;
        this.z = a.z + (c.z - a.z) * k;
        this.ry = lerpAngle(a.ry, c.ry, k);
        this.g = !!(k < 0.5 ? a.g : c.g);
        this.m = k < 0.5 ? a.m : c.m;
      }
    }
    this.avatar.setSpotted(this.sus);
    this.avatar.pose(this.x, this.y, this.z, this.ry, this.m > 0, this.m === 2, this.g, dt);
  }
}
