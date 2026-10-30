// Visuals for the three valuables. Each model's origin is the bottom-centre of the object,
// matching how the server stores item positions (resting on a surface).

import * as THREE from 'three';
import { VALUABLE_BY_ID } from './level.js';

const lam = (color, emissive = '#000000', ei = 0) => new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: ei });
const basic = (color) => new THREE.MeshBasicMaterial({ color });

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function watchModel() {
  const g = new THREE.Group();
  const gold = lam('#ffcf4d', '#5a3d00', 0.6);
  const strap = lam('#8a5a2b');
  g.add(mesh(new THREE.BoxGeometry(0.5, 1.7, 0.16), strap, 0, 0.85, -0.12));
  const face = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 24), gold, 0, 0.85, 0);
  face.rotation.x = Math.PI / 2;
  const dial = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 24), basic('#fff8e6'), 0, 0.85, 0.16);
  dial.rotation.x = Math.PI / 2;
  const hand1 = mesh(new THREE.BoxGeometry(0.05, 0.36, 0.02), basic('#2a2140'), 0, 0.98, 0.19);
  const hand2 = mesh(new THREE.BoxGeometry(0.26, 0.05, 0.02), basic('#2a2140'), 0.11, 0.85, 0.19);
  const crown = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 10), gold, 0.68, 0.85, 0);
  crown.rotation.z = Math.PI / 2;
  g.add(face, dial, hand1, hand2, crown);
  return g;
}

function phoneModel() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.3, 0.18, 2.4), lam('#1c1f33'), 0, 0.09, 0));
  const screen = mesh(new THREE.BoxGeometry(1.14, 0.02, 2.16), basic('#6aa8ff'), 0, 0.19, 0);
  screen.castShadow = false;
  g.add(screen);
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.04, 0.05), basic('#f6f3ff'), 0, 0.21, -0.6));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12), lam('#c9cde6'), 0.35, 0.21, 0.85));
  return g;
}

function jewelsModel() {
  const g = new THREE.Group();
  const velvet = lam('#a3173f', '#3a0010', 0.4);
  const gold = lam('#ffcf4d', '#5a3d00', 0.6);
  g.add(mesh(new THREE.BoxGeometry(1.7, 0.8, 1.3), velvet, 0, 0.4, 0));
  g.add(mesh(new THREE.BoxGeometry(1.76, 0.12, 1.36), gold, 0, 0.82, 0));
  g.add(mesh(new THREE.BoxGeometry(1.72, 0.3, 1.32), velvet, 0, 1.0, 0));
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.2, 0.06), gold, 0, 0.75, 0.68));
  const gem = mesh(new THREE.OctahedronGeometry(0.22), lam('#7ff3ff', '#2aa9c9', 0.9), 0, 1.33, 0);
  g.add(gem);
  return g;
}

function goldModel() {
  const g = new THREE.Group();
  const gold = lam('#ffcf4d', '#6a4a00', 0.7);
  const bar = mesh(new THREE.BoxGeometry(2.4, 0.9, 1.3), gold, 0, 0.45, 0);
  const top = mesh(new THREE.BoxGeometry(2.0, 0.12, 0.95), lam('#ffe58a', '#6a4a00', 0.7), 0, 0.95, 0);
  const stamp = mesh(new THREE.BoxGeometry(0.9, 0.03, 0.45), lam('#d9a520'), 0, 1.02, 0);
  g.add(bar, top, stamp);
  return g;
}

function ringModel() {
  const g = new THREE.Group();
  const band = mesh(new THREE.TorusGeometry(0.32, 0.08, 8, 20), lam('#e8eaf6', '#555a70', 0.6), 0, 0.4, 0);
  const setting = mesh(new THREE.ConeGeometry(0.14, 0.18, 6), lam('#e8eaf6'), 0, 0.78, 0);
  const gem = mesh(new THREE.OctahedronGeometry(0.24), new THREE.MeshBasicMaterial({ color: '#bff6ff' }), 0, 0.98, 0);
  gem.scale.y = 0.8;
  g.add(band, setting, gem);
  g.userData.spin = gem;
  return g;
}

const BUILDERS = { watch: watchModel, phone: phoneModel, jewels: jewelsModel, gold: goldModel, ring: ringModel };
const MARKER_GEO = new THREE.OctahedronGeometry(0.22);

export class ItemView {
  constructor(id, scene) {
    this.id = id;
    this.def = VALUABLE_BY_ID[id];
    this.group = BUILDERS[id]();
    this.markerColor = this.def.rare ? '#bff6ff' : this.def.heavy ? '#ff8c42' : '#ffd23f';
    this.marker = new THREE.Mesh(MARKER_GEO, new THREE.MeshBasicMaterial({ color: this.markerColor }));
    this.marker.scale.y = 1.5;
    scene.add(this.group, this.marker);
    this.state = null;
  }

  /** pos/ry = where to draw it; carried = held above someone's head; targeted = the local player can grab it. */
  update(time, pos, ry, { carried, targeted, delivered }) {
    const lift = carried ? (this.def.heavy ? 1.0 : 1.08) + Math.sin(time * 5) * 0.03 : 0;
    if (this.group.userData.spin) this.group.userData.spin.rotation.y = time * 2;
    this.group.position.set(pos[0], pos[1] + lift, pos[2]);
    this.group.rotation.y = ry;
    const s = carried ? 0.85 : 1;
    this.group.scale.set(s, s, s);

    this.marker.visible = !carried && !delivered;
    if (this.marker.visible) {
      const h = this.def.size[1];
      this.marker.position.set(pos[0], pos[1] + h + 0.7 + Math.sin(time * 3 + pos[0]) * 0.12, pos[2]);
      this.marker.rotation.y = time * 2;
      this.marker.material.color.set(targeted ? '#ffffff' : this.markerColor);
      const ms = targeted ? 1.4 : 1;
      this.marker.scale.set(ms, ms * 1.5, ms);
    }
  }
}
