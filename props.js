// Moving props: the shop cat, the robot vacuum and the mousetraps.

import * as THREE from 'three';
import { LEVEL } from './level.js';

const lam = (color) => new THREE.MeshLambertMaterial({ color });
const basic = (color) => new THREE.MeshBasicMaterial({ color });

function iconSprite(text, bg, fg = '#ffffff', size = 1.2) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = fg;
  ctx.font = `${bg ? 84 : 60}px Bungee, "Arial Black", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
}

// ---------- Cat ----------
export class CatView {
  constructor(scene) {
    this.group = new THREE.Group();
    const fur = lam('#f2a03d');
    const stripe = lam('#c46f1c');
    const white = lam('#fff4e0');
    const pink = lam('#ff9fb2');

    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), fur);
    body.scale.set(1.35, 1.15, 2.4);
    body.position.set(0, 2.4, -0.3);
    body.castShadow = true;
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 6, 16, Math.PI), stripe);
      s.rotation.y = Math.PI / 2;
      s.scale.set(1.0, 1.05, 1);
      s.position.set(0, 2.45, -1.4 + i * 1.0);
      this.group.add(s);
    }
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), white);
    belly.scale.set(1.1, 0.8, 1.9);
    belly.position.set(0, 1.85, -0.2);

    this.head = new THREE.Group();
    this.head.position.set(0, 3.5, 2.2);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), fur);
    skull.scale.set(1.1, 0.95, 1);
    skull.castShadow = true;
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), white);
    muzzle.scale.set(1.2, 0.8, 0.8);
    muzzle.position.set(0, -0.35, 0.9);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), pink);
    nose.position.set(0, -0.15, 1.3);
    this.head.add(skull, muzzle, nose);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 4), fur);
      ear.position.set(side * 0.62, 0.95, 0.1);
      ear.rotation.z = -side * 0.3;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 4), pink);
      inner.position.set(side * 0.6, 0.85, 0.28);
      inner.rotation.z = -side * 0.3;
      this.head.add(ear, inner);
    }
    this.eyesOpen = new THREE.Group();
    this.eyesClosed = new THREE.Group();
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), basic('#d8ff5a'));
      eye.scale.set(1, 1.2, 0.6);
      eye.position.set(side * 0.45, 0.15, 0.98);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.05), basic('#111111'));
      slit.position.set(side * 0.45, 0.15, 1.12);
      this.eyesOpen.add(eye, slit);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.05), basic('#3b2210'));
      lid.position.set(side * 0.45, 0.1, 1.08);
      this.eyesClosed.add(lid);
    }
    this.head.add(this.eyesOpen, this.eyesClosed);

    this.legs = [];
    for (const [lx, lz] of [[-0.75, 1.3], [0.75, 1.3], [-0.75, -1.8], [0.75, -1.8]]) {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 1.6, lz);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 1.6, 8), fur);
      leg.position.y = -0.8;
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), white);
      paw.scale.set(1, 0.6, 1.2);
      paw.position.set(0, -1.55, 0.1);
      pivot.add(leg, paw);
      this.legs.push(pivot);
      this.group.add(pivot);
    }
    this.tail = new THREE.Group();
    this.tail.position.set(0, 2.8, -2.8);
    const tailMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 3, 8), fur);
    tailMesh.position.y = 1.4;
    this.tail.add(tailMesh);
    this.tail.rotation.x = -0.6;

    this.body = new THREE.Group();
    this.body.add(body, belly, this.head, this.tail);
    this.group.add(this.body);

    this.zzz = iconSprite('z z z', null, '#c9cde6', 2.2);
    this.zzz.position.set(0, 5.6, 1.5);
    this.alert = iconSprite('!', '#ff4d5e');
    this.alert.position.set(0, 6, 2);
    this.question = iconSprite('?', '#ffd23f', '#2a2140');
    this.question.position.set(0, 6, 2);
    this.group.add(this.zzz, this.alert, this.question);
    scene.add(this.group);

    this.phase = 0;
    this.lastX = null;
  }

  /** state: 0 sleep, 1 waking, 2 hunting, 3 searching, 4 wandering */
  update(x, z, ry, state, dt, time) {
    const moved = this.lastX === null ? 0 : Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x; this.lastZ = z;
    const speed = dt > 0 ? moved / dt : 0;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = ry;
    const asleep = state === 0;
    this.eyesOpen.visible = !asleep;
    this.eyesClosed.visible = asleep;
    this.zzz.visible = asleep;
    this.zzz.position.y = 5.4 + Math.sin(time * 1.5) * 0.25;
    this.alert.visible = state === 2;
    this.question.visible = state === 1 || state === 3;

    if (asleep) {
      // Curled up and breathing
      this.body.position.y = -1.1;
      this.body.scale.set(1, 0.92 + Math.sin(time * 1.6) * 0.04, 1);
      this.head.rotation.x = 0.35;
      for (const l of this.legs) { l.visible = false; }
      this.tail.rotation.x = -1.4;
    } else {
      this.body.position.y = 0;
      this.body.scale.set(1, 1, 1);
      this.head.rotation.x = state === 2 ? -0.15 : 0;
      for (const l of this.legs) l.visible = true;
      this.phase += dt * Math.min(14, speed * 1.6);
      this.legs.forEach((l, i) => { // diagonal pairs move together
        const offset = i === 0 || i === 3 ? 0 : Math.PI;
        l.rotation.x = speed > 0.3 ? Math.sin(this.phase + offset) * 0.55 : 0;
      });
      this.tail.rotation.x = -0.6 + Math.sin(time * (state === 2 ? 9 : 3)) * 0.25;
      this.tail.rotation.z = Math.sin(time * 2) * 0.3;
    }
  }
}

// ---------- Robot vacuum ----------
export class VacuumView {
  constructor(scene) {
    const v = LEVEL.vacuum;
    this.group = new THREE.Group();
    const r = v.half + 0.1;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, v.height * 0.85, 28), lam('#30364f'));
    shell.position.y = v.height * 0.45;
    shell.castShadow = true;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.06, 28), lam('#4c5478'));
    top.position.y = v.height - 0.02;
    const bumper = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.35, 28, 1, true, -Math.PI / 2, Math.PI), lam('#151a33'));
    bumper.position.y = 0.35;
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), basic('#63e6e2'));
    this.led.position.set(0, v.height + 0.02, r * 0.55);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 16), lam('#c9cde6'));
    button.position.set(0, v.height + 0.02, 0);
    this.group.add(shell, top, bumper, this.led, button);
    scene.add(this.group);
  }
  update(state, time) {
    this.group.position.set(state.x, 0, state.z);
    this.group.rotation.y = state.ry;
    this.led.visible = Math.sin(time * 4) > -0.5;
  }
}

// ---------- Mousetraps ----------
export class TrapView {
  constructor(scene, pos) {
    this.group = new THREE.Group();
    this.group.position.set(pos[0], 0, pos[2]);
    this.group.rotation.y = (pos[0] * 13) % Math.PI;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.95), lam('#c9965b'));
    base.position.y = 0.08;
    base.receiveShadow = true;
    const cheese = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 3), lam('#ffd23f'));
    cheese.position.set(0.25, 0.26, 0);
    this.bar = new THREE.Group();
    this.bar.position.set(-0.05, 0.18, 0);
    const metal = lam('#d9dceb');
    const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.05), metal);
    side1.position.set(-0.375, 0, 0.42);
    const side2 = side1.clone(); side2.position.z = -0.42;
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), metal);
    cross.position.x = -0.75;
    this.bar.add(side1, side2, cross);
    this.group.add(base, cheese, this.bar);
    scene.add(this.group);
    this.armed = true;
    this.angle = 0;
  }
  setArmed(armed) { this.armed = armed; }
  update(dt) {
    const target = this.armed ? 0 : Math.PI * 0.97; // snapped bar swings over to the other side
    this.angle += (target - this.angle) * Math.min(1, dt * (this.armed ? 3 : 30));
    this.bar.rotation.z = -this.angle;
  }
}
