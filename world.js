// Builds the convenience store from level.js.
// Performance: all static level geometry is merged into a few meshes that use vertex colours,
// so the whole store costs a handful of draw calls (important on Chromebooks).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LEVEL } from './level.js';
import { cameraDir, cameraConeLength } from './physics.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12).toNonIndexed();
const UNIT_CONE = new THREE.CylinderGeometry(0.18, 0.5, 1, 12).toNonIndexed();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

class Bucket {
  constructor() { this.parts = []; }
  add(unit, color, cx, cy, cz, sx, sy, sz, ry = 0, rx = 0) {
    const g = unit.clone();
    tmpE.set(rx, ry, 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(cx, cy, cz), tmpQ, tmpS.set(sx, sy, sz));
    g.applyMatrix4(tmpM);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
  }
  build(material) {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    merged.computeBoundingSphere();
    return new THREE.Mesh(merged, material);
  }
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c;
}

function textTexture(text, { w = 512, h = 128, bg = '#1a2045', fg = '#ffd23f', font = 'Bungee', size = 72 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `${size}px ${font}, 'Arial Black', sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function floorTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d');
  const colors = ['#3e4677', '#363e6c'];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    ctx.fillStyle = colors[(x + y) % 2];
    ctx.fillRect(x * 128, y * 128, 128, 128);
  }
  ctx.strokeStyle = 'rgba(15,18,40,0.55)';
  ctx.lineWidth = 4;
  for (let i = 0; i <= 256; i += 128) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function zoneTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 280;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 512, 280);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, 512, 280); ctx.rect(26, 26, 460, 228); ctx.clip('evenodd');
  for (let i = -300; i < 800; i += 44) {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 22, 0); ctx.lineTo(i + 22 - 280, 280); ctx.lineTo(i - 280, 280); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,210,63,0.85)';
  ctx.font = '64px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('LOOT HERE', 256, 148);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Per-shape geometry ----------

function buildObject(o, solid, decor, glow) {
  const { x, y, z, w, h, d, color } = o;
  const cy = y + h / 2;
  const main = o.shadow ? solid : decor;
  switch (o.shape) {
    case 'wall':
      decor.add(UNIT_BOX, color, x, cy, z, w, h, d);
      break;
    case 'plank':
      solid.add(UNIT_BOX, color, x, cy, z, w, h, d);
      decor.add(UNIT_BOX, '#ffd23f', x - w / 2 - 0.02, cy, z, 0.06, h * 0.9, d * 0.995); // price strips
      decor.add(UNIT_BOX, '#ffd23f', x + w / 2 + 0.02, cy, z, 0.06, h * 0.9, d * 0.995);
      break;
    case 'cardboard':
      main.add(UNIT_BOX, color, x, cy, z, w, h, d);
      decor.add(UNIT_BOX, '#ead2a1', x, y + h + 0.01, z, w * 1.004, 0.03, Math.min(0.6, d * 0.28));
      decor.add(UNIT_BOX, shade(color, 0.7), x, y + h * 0.62, z, w * 1.01, Math.min(0.35, h * 0.12), d * 0.3);
      break;
    case 'cereal':
      main.add(UNIT_BOX, color, x, cy, z, w, h, d);
      decor.add(UNIT_BOX, '#fff4d6', x, y + h * 0.62, z, w * 1.02, h * 0.28, d * 0.8);
      decor.add(UNIT_BOX, shade(color, 0.6), x, y + h * 0.25, z, w * 1.02, h * 0.12, d * 0.6);
      break;
    case 'books': {
      const n = 4, bh = h / n;
      const cols = ['#5b8def', '#e94f64', '#4fc3a1', '#b06ee8'];
      for (let i = 0; i < n; i++) main.add(UNIT_BOX, cols[i % 4], x + (i % 2 ? 0.05 : -0.05), y + bh * (i + 0.5), z, w * 0.98, bh * 0.97, d * (0.92 + (i % 3) * 0.03));
      break;
    }
    case 'can': {
      const r = Math.min(w, d);
      main.add(UNIT_CYL, color, x, cy, z, r, h, r);
      decor.add(UNIT_CYL, '#d9dceb', x, y + h + 0.03, z, r * 0.92, 0.06, r * 0.92);
      decor.add(UNIT_CYL, '#fff4d6', x, y + h * 0.5, z, r * 1.02, h * 0.3, r * 1.02);
      break;
    }
    case 'bottle': {
      const r = Math.min(w, d) * 0.92;
      main.add(UNIT_CYL, color, x, y + h * 0.3, z, r, h * 0.6, r);
      main.add(UNIT_CONE, color, x, y + h * 0.7, z, r, h * 0.2, r);
      main.add(UNIT_CYL, color, x, y + h * 0.86, z, r * 0.34, h * 0.12, r * 0.34);
      decor.add(UNIT_CYL, '#f6f3ff', x, y + h * 0.95, z, r * 0.4, h * 0.06, r * 0.4);
      decor.add(UNIT_CYL, '#fff4d6', x, y + h * 0.32, z, r * 1.02, h * 0.22, r * 1.02);
      break;
    }
    case 'cooler': {
      solid.add(UNIT_BOX, color, x, cy, z, w, h, d);
      const doors = 4, dw = (w - 1) / doors, fz = z + d / 2;
      for (let i = 0; i < doors; i++) {
        const dx = x - w / 2 + 0.5 + dw * (i + 0.5);
        glow.add(UNIT_BOX, '#1d6b7a', dx, y + h / 2, fz + 0.02, dw - 0.7, h - 4, 0.05);
        decor.add(UNIT_BOX, '#c9cde6', dx + dw / 2 - 0.65, y + h / 2, fz + 0.1, 0.25, h * 0.35, 0.15); // handle
        const bottleCols = ['#3fd0c9', '#ff6b8b', '#ffd23f', '#7ee081', '#9fb4ff'];
        for (let row = 0; row < 4; row++) {
          const by = y + 3.2 + row * 5;
          for (let k = 0; k < 4; k++) {
            glow.add(UNIT_BOX, bottleCols[(i * 3 + row * 2 + k) % 5], dx - dw / 2 + 1.1 + k * (dw - 2.2) / 3, by + 1.3, fz + 0.06, 0.9, 2.6, 0.02);
          }
          decor.add(UNIT_BOX, '#151a33', dx, by - 0.1, fz + 0.07, dw - 0.7, 0.18, 0.02);
        }
      }
      decor.add(UNIT_BOX, '#63e6e2', x, y + h - 1, fz + 0.06, w - 1, 0.6, 0.05);
      break;
    }
    case 'counter':
      solid.add(UNIT_BOX, color, x, y + (h - 0.6) / 2, z, w, h - 0.6, d);
      solid.add(UNIT_BOX, '#cfc8ef', x, y + h - 0.3, z, w + 0.8, 0.6, d + 0.8);
      decor.add(UNIT_BOX, '#2a2140', x, y + 0.4, z + d / 2 + 0.02, w, 0.8, 0.05);
      decor.add(UNIT_BOX, '#ffd23f', x, y + h * 0.55, z + d / 2 + 0.03, w * 0.96, 0.5, 0.05);
      decor.add(UNIT_BOX, '#ffd23f', x - w / 2 - 0.03, y + h * 0.55, z, 0.05, 0.5, d * 0.96);
      break;
    case 'register':
      solid.add(UNIT_BOX, color, x, y + h * 0.3, z, w, h * 0.6, d);
      solid.add(UNIT_BOX, '#3d4470', x - 0.5, y + h * 0.75, z, w * 0.5, h * 0.4, d * 0.7, 0, 0);
      glow.add(UNIT_BOX, '#7ee081', x - 0.5 - w * 0.25 - 0.02, y + h * 0.78, z, 0.05, h * 0.28, d * 0.55);
      decor.add(UNIT_BOX, '#c9cde6', x + w * 0.2, y + h * 0.62, z, w * 0.35, 0.1, d * 0.6);
      break;
    case 'pallet':
      for (let i = 0; i < 5; i++) main.add(UNIT_BOX, color, x, y + h - 0.12, z - d / 2 + d * (i + 0.5) / 5, w, 0.24, d / 5 - 0.25);
      for (const k of [-1, 0, 1]) main.add(UNIT_BOX, shade(color, 0.75), x + k * (w / 2 - 0.4), y + (h - 0.24) / 2, z, 0.8, h - 0.24, d);
      break;
    case 'pack':
      main.add(UNIT_BOX, color, x, cy, z, w, h, d);
      for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
        decor.add(UNIT_CYL, '#2f6fc7', x - w / 3 + i * (w / 3), y + h + 0.08, z - d / 4 + k * (d / 2), 0.5, 0.16, 0.5);
      }
      decor.add(UNIT_BOX, '#f6f3ff', x, y + h * 0.5, z, w * 1.01, h * 0.25, d * 1.01);
      break;
    case 'gift':
      main.add(UNIT_BOX, color, x, cy, z, w, h, d);
      decor.add(UNIT_BOX, '#ffd23f', x, cy, z, w * 1.02, h * 1.01, 0.22);
      decor.add(UNIT_BOX, '#ffd23f', x, cy, z, 0.22, h * 1.01, d * 1.02);
      break;
    case 'bucket':
      main.add(UNIT_CONE, color, x, cy, z, w, h, d, 0, Math.PI); // flipped: wide at the top
      decor.add(UNIT_CYL, '#2a2140', x, y + h - 0.02, z, w * 0.82, 0.05, d * 0.82);
      break;
    default:
      main.add(UNIT_BOX, color, x, cy, z, w, h, d);
  }
}

// ---------- The world ----------

export class World {
  constructor(scene, { shadows }) {
    this.scene = scene;
    this.alarm = false;
    this.alarmT = 0;

    scene.background = new THREE.Color('#0f1430');
    scene.fog = new THREE.Fog('#0f1430', 45, 120);

    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

    const solid = new Bucket(), decor = new Bucket(), glow = new Bucket();
    for (const o of LEVEL.objects) buildObject(o, solid, decor, glow);
    this._buildShell(decor, glow);

    const solidMesh = solid.build(this.solidMat);
    solidMesh.castShadow = true; solidMesh.receiveShadow = true;
    const decorMesh = decor.build(this.solidMat);
    decorMesh.receiveShadow = true;
    const glowMesh = glow.build(this.glowMat);
    scene.add(solidMesh, decorMesh, glowMesh);

    this._buildFloor();
    this._buildSigns();
    this._buildEscapeZone();
    this._buildLights(shadows);
    this._buildSecurityCamera();
  }

  _buildShell(decor, glow) {
    const B = LEVEL.bounds;
    // Ceiling with switched-off fluorescent panels
    decor.add(UNIT_BOX, '#1a2045', 0, B.height + 0.5, 0, 82, 1, 58);
    for (let x = -30; x <= 30; x += 20) for (let z = -18; z <= 18; z += 18) glow.add(UNIT_BOX, '#3a4270', x, B.height - 0.05, z, 10, 0.1, 2.4);
    // Baseboards
    decor.add(UNIT_BOX, '#1b2142', 0, 0.6, -27.95, 80, 1.2, 0.1);
    decor.add(UNIT_BOX, '#1b2142', -39.95, 0.6, 0, 0.1, 1.2, 56);
    decor.add(UNIT_BOX, '#1b2142', 39.95, 0.6, 0, 0.1, 1.2, 56);
    // Front windows with moonlit street outside
    for (let i = 0; i < 3; i++) {
      const wx = -34 + i * 11;
      glow.add(UNIT_BOX, '#22346a', wx, 16, 27.95, 9.4, 18, 0.05);
      decor.add(UNIT_BOX, '#1b2142', wx, 16, 27.9, 0.4, 18, 0.12);
      decor.add(UNIT_BOX, '#1b2142', wx, 16, 27.9, 9.4, 0.4, 0.12);
    }
    // The big exit door (front wall, behind the escape zone)
    decor.add(UNIT_BOX, '#1b2142', 6, 14.5, 27.85, 13, 29, 0.3);
    glow.add(UNIT_BOX, '#25396e', 2.9, 14, 27.68, 5.2, 25, 0.05);
    glow.add(UNIT_BOX, '#25396e', 9.1, 14, 27.68, 5.2, 25, 0.05);
    decor.add(UNIT_BOX, '#c9cde6', 2.9, 12, 27.55, 4.6, 0.5, 0.3);
    decor.add(UNIT_BOX, '#c9cde6', 9.1, 12, 27.55, 4.6, 0.5, 0.3);
    decor.add(UNIT_BOX, '#1b2142', 6, 14.5, 27.6, 0.5, 29, 0.2);
  }

  _buildFloor() {
    const B = LEVEL.bounds;
    const tex = floorTexture();
    tex.repeat.set((B.maxX - B.minX) / 8, (B.maxZ - B.minZ) / 8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  _buildSigns() {
    const exit = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 1.9),
      new THREE.MeshBasicMaterial({ map: textTexture('EXIT', { bg: '#0d3b24', fg: '#6dff9e', size: 88 }) })
    );
    exit.position.set(6, 30.6, 27.9);
    exit.rotation.y = Math.PI;
    this.scene.add(exit);

    const signs = [
      { text: 'SNACKS', x: -24, z: -5 },
      { text: 'DRINKS', x: -10, z: -5 },
    ];
    for (const s of signs) {
      const mat = new THREE.MeshBasicMaterial({ map: textTexture(s.text, { bg: '#ffd23f', fg: '#2a2140', size: 76 }) });
      for (const side of [1, -1]) { // two faces so the text reads correctly from both aisles
        const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), mat);
        m.position.set(s.x + side * 0.03, 27, s.z);
        m.rotation.y = side * Math.PI / 2;
        this.scene.add(m);
      }
    }
    const closed = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.6),
      new THREE.MeshBasicMaterial({ map: textTexture('CLOSED', { bg: '#3a0d1a', fg: '#ff4d5e', size: 80 }) })
    );
    closed.position.set(-23, 21, 27.85);
    closed.rotation.y = Math.PI;
    this.scene.add(closed);
  }

  _buildEscapeZone() {
    const Z = LEVEL.escapeZone;
    const w = Z.maxX - Z.minX, d = Z.maxZ - Z.minZ;
    const cx = (Z.minX + Z.maxX) / 2, cz = (Z.minZ + Z.maxZ) / 2;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: zoneTexture(), transparent: true, depthWrite: false })
    );
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = Math.PI;
    decal.position.set(cx, 0.03, cz);
    this.scene.add(decal);
    this.zoneGlow = new THREE.Mesh(
      new THREE.BoxGeometry(w, 5, d),
      new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })
    );
    this.zoneGlow.position.set(cx, 2.5, cz);
    this.scene.add(this.zoneGlow);
  }

  _buildLights(shadows) {
    this.hemi = new THREE.HemisphereLight('#8a9be0', '#2a2140', 1.35);
    this.scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight('#a9bcff', 1.5);
    this.moon.position.set(-30, 60, 45);
    this.moon.target.position.set(0, 0, 0);
    this.moon.castShadow = shadows;
    this.moon.shadow.mapSize.set(1024, 1024);
    const sc = this.moon.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 160;
    sc.updateProjectionMatrix();
    this.moon.shadow.bias = -0.0015;
    this.scene.add(this.moon, this.moon.target);

    // A few cheap point lights for mood (no shadows).
    this.lamps = [
      { light: new THREE.PointLight('#5fe0e0', 16, 36, 1), pos: [-22, 12, -19], base: '#5fe0e0', i: 16 },
      { light: new THREE.PointLight('#ffc27a', 12, 28, 1), pos: [26, 18, 9], base: '#ffc27a', i: 12 },
      { light: new THREE.PointLight('#6dff9e', 7, 22, 1), pos: [6, 26, 24], base: '#6dff9e', i: 7 },
    ];
    for (const l of this.lamps) { l.light.position.set(...l.pos); this.scene.add(l.light); }
  }

  _buildSecurityCamera() {
    const cam = LEVEL.securityCamera;
    this.secCam = new THREE.Group();
    this.secCam.position.set(...cam.pos);
    this.scene.add(this.secCam);

    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 2.4), new THREE.MeshLambertMaterial({ color: '#c9cde6' }));
    mount.position.set(0.6, 0.8, 0);
    mount.rotation.y = Math.PI / 2;
    this.secCam.add(mount);

    this.camHead = new THREE.Group();
    this.secCam.add(this.camHead);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 3), new THREE.MeshLambertMaterial({ color: '#e8eaf6' }));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14), new THREE.MeshBasicMaterial({ color: '#10142a' }));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 1.55;
    this.camLed = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
    this.camLed.position.set(0.4, 0.5, 1.4);
    this.camHead.add(body, lens, this.camLed);

    // View cone, apex at the lens, reaching the floor.
    const L = cameraConeLength(cam);
    const radius = L * Math.tan(cam.halfAngle);
    const coneGeo = new THREE.ConeGeometry(radius, L, 28, 1, true);
    coneGeo.translate(0, -L / 2, 0);  // apex at origin, opening towards -Y
    this.coneMat = new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
    this.cone = new THREE.Mesh(coneGeo, this.coneMat);
    this.secCam.add(this.cone);
    this._down = new THREE.Vector3(0, -1, 0);
    this._dir = new THREE.Vector3();
  }

  updateSecurityCamera(yaw, spottingMe) {
    const d = cameraDir(yaw);
    this._dir.set(d[0], d[1], d[2]);
    this.cone.quaternion.setFromUnitVectors(this._down, this._dir);
    this.camHead.lookAt(this.secCam.position.x + d[0], this.secCam.position.y + d[1], this.secCam.position.z + d[2]);
    const hot = this.alarm || spottingMe;
    this.coneMat.color.set(hot ? '#ff4d5e' : '#ffe27a');
    this.coneMat.opacity = hot ? 0.2 : 0.13;
  }

  setAlarm(on) {
    this.alarm = on;
    if (!on) {
      for (const l of this.lamps) { l.light.color.set(l.base); l.light.intensity = l.i; }
      this.hemi.color.set('#8a9be0');
      this.moon.intensity = 1.5;
    }
  }

  update(dt, time, carrying) {
    this.zoneGlow.material.opacity = carrying ? 0.12 + 0.08 * Math.sin(time * 6) : 0.07;
    this.camLed.visible = this.alarm ? Math.sin(time * 18) > 0 : Math.sin(time * 3) > -0.3;
    if (this.alarm) {
      this.alarmT += dt;
      const pulse = 0.5 + 0.5 * Math.sin(this.alarmT * 9);
      for (const l of this.lamps) { l.light.color.set('#ff2b3d'); l.light.intensity = l.i * (0.8 + 1.6 * pulse); }
      this.hemi.color.setRGB(0.55 + 0.4 * pulse, 0.12, 0.16);
      this.moon.intensity = 0.7;
    }
  }
}
