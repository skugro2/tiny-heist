// The shop cat: a server-side guard. It sleeps on its cushion, wakes up to noise (sprinting,
// dropped loot, snapping traps, the alarm), hunts thieves it can see, and swats the ones it reaches.
// It's too big to fit under the display table and can't reach thieves standing up high.

import * as C from './constants.js';
import { LEVEL, BOUNDS } from './level.js';
import { blockedAt, raycast } from './physics.js';

export const CAT_STATE = { SLEEP: 0, WAKE: 1, HUNT: 2, SEARCH: 3, WANDER: 4 };

// ---------- Navigation grid (built once at startup) ----------
const STEP = 2;
const nodes = [];           // { x, z, n: [neighbour indices] }
const index = new Map();    // "ix,iz" -> node index

function catBlocked(x, z) {
  return blockedAt(x, 0.05, z, LEVEL.colliders, C.CAT_RADIUS, C.CAT_HEIGHT - 0.05);
}

export function segmentClear(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    if (catBlocked(ax + (bx - ax) * k, az + (bz - az) * k)) return false;
  }
  return true;
}

for (let x = BOUNDS.minX + 2; x <= BOUNDS.maxX - 2; x += STEP) {
  for (let z = BOUNDS.minZ + 2; z <= BOUNDS.maxZ - 2; z += STEP) {
    if (catBlocked(x, z)) continue;
    index.set(`${x},${z}`, nodes.length);
    nodes.push({ x, z, n: [] });
  }
}
for (const node of nodes) {
  for (const [dx, dz] of [[STEP, 0], [0, STEP], [STEP, STEP], [STEP, -STEP]]) {
    const j = index.get(`${node.x + dx},${node.z + dz}`);
    if (j === undefined) continue;
    const other = nodes[j];
    if (segmentClear(node.x, node.z, other.x, other.z)) {
      const i = index.get(`${node.x},${node.z}`);
      node.n.push(j);
      other.n.push(i);
    }
  }
}

function nearestNode(x, z) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bd && d < 64 && segmentClear(x, z, nodes[i].x, nodes[i].z)) { bd = d; best = i; }
  }
  if (best === -1) { // fall back to plain nearest
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

function findPath(from, to) {
  // A* over the grid
  const start = nearestNode(from[0], from[1]);
  const goal = nearestNode(to[0], to[1]);
  if (start < 0 || goal < 0) return [];
  const g = new Map([[start, 0]]);
  const came = new Map();
  const open = new Set([start]);
  const h = (i) => Math.hypot(nodes[i].x - nodes[goal].x, nodes[i].z - nodes[goal].z);
  let guard = 0;
  while (open.size && guard++ < 4000) {
    let cur = -1, bf = Infinity;
    for (const i of open) { const f = g.get(i) + h(i); if (f < bf) { bf = f; cur = i; } }
    if (cur === goal) break;
    open.delete(cur);
    for (const j of nodes[cur].n) {
      const ng = g.get(cur) + Math.hypot(nodes[j].x - nodes[cur].x, nodes[j].z - nodes[cur].z);
      if (ng < (g.get(j) ?? Infinity)) { g.set(j, ng); came.set(j, cur); open.add(j); }
    }
  }
  if (!came.has(goal) && start !== goal) return [];
  const path = [];
  for (let c = goal; c !== undefined; c = came.get(c)) { path.unshift([nodes[c].x, nodes[c].z]); if (c === start) break; }
  return path;
}

export function randomNode() {
  const n = nodes[Math.floor(Math.random() * nodes.length)];
  return [n.x, n.z];
}

// ---------- The cat ----------
export class Cat {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.reset();
  }

  reset() {
    this.x = LEVEL.catBed[0];
    this.z = LEVEL.catBed[2];
    this.ry = 0;
    this.state = CAT_STATE.SLEEP;
    this.timer = 45 + Math.random() * 30; // naps before wandering on its own
    this.target = null;   // player id being hunted
    this.lastSeen = null; // [x, z]
    this.goal = null;     // [x, z] destination
    this.path = [];
    this.replan = 0;
    this.wanderStops = 0;
    this.cooldown = 0;
    this.bestDist = Infinity;
    this.stuck = 0;
  }

  /** Something made a noise at (x, z) loud enough to hear within `range`. */
  hear(x, z, range) {
    if (!this.enabled) return;
    if (Math.hypot(x - this.x, z - this.z) > range) return;
    if (this.state === CAT_STATE.SLEEP) { this.state = CAT_STATE.WAKE; this.timer = 0.8; this.lastSeen = [x, z]; }
    else if (this.state !== CAT_STATE.HUNT) { this.state = CAT_STATE.SEARCH; this.lastSeen = [x, z]; this.timer = 6; this._goTo(x, z); }
  }

  /** Alarm: the cat is fully awake and goes after the closest thief. */
  alarm(players) {
    if (!this.enabled) return;
    let best = null, bd = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.p[0] - this.x, p.p[2] - this.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { this.state = CAT_STATE.SEARCH; this.lastSeen = [best.p[0], best.p[2]]; this.timer = 8; this._goTo(best.p[0], best.p[2]); }
  }

  canSee(p) {
    const dx = p.p[0] - this.x, dz = p.p[2] - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist > C.CAT_SIGHT_RANGE) return false;
    if (dist > 2.5) {
      let a = Math.atan2(dx, dz) - this.ry;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      if (Math.abs(a) > C.CAT_FOV) return false;
    }
    const eye = [this.x, 3.2, this.z];
    const v = [p.p[0] - eye[0], p.p[1] + 0.5 - eye[1], p.p[2] - eye[2]];
    const len = Math.hypot(v[0], v[1], v[2]);
    const hit = raycast(eye, [v[0] / len, v[1] / len, v[2] / len], len);
    return hit >= len - 0.5;
  }

  _goTo(x, z) {
    this.goal = [x, z];
    this.replan = 0;
    this.goalAge = 0;
  }

  /** Advance the cat. Returns the id of a player it caught this tick, or null. */
  update(dt, players, now) {
    if (!this.enabled) return null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const visible = this.state === CAT_STATE.SLEEP || this.state === CAT_STATE.WAKE
      ? []
      : players.filter((p) => !(p.immuneUntil > now) && this.canSee(p));

    switch (this.state) {
      case CAT_STATE.SLEEP:
        this.timer -= dt;
        if (this.timer <= 0) { this.state = CAT_STATE.WANDER; this.wanderStops = 3; this._goTo(...randomNode()); }
        return null;
      case CAT_STATE.WAKE:
        this.timer -= dt;
        if (this.lastSeen) this._face(this.lastSeen[0], this.lastSeen[1], dt);
        if (this.timer <= 0) { this.state = CAT_STATE.SEARCH; this.timer = 6; if (this.lastSeen) this._goTo(...this.lastSeen); }
        return null;
      default:
        break;
    }

    // Spot someone? Hunt the closest visible thief.
    if (visible.length && this.cooldown <= 0) {
      visible.sort((a, b) => Math.hypot(a.p[0] - this.x, a.p[2] - this.z) - Math.hypot(b.p[0] - this.x, b.p[2] - this.z));
      if (this.state !== CAT_STATE.HUNT || !visible.some((p) => p.id === this.target)) {
        this.target = visible[0].id;
        this.bestDist = Infinity;
        this.stuck = 0;
      }
      this.state = CAT_STATE.HUNT;
    }

    let speed = C.CAT_WALK_SPEED;
    if (this.state === CAT_STATE.HUNT) {
      const prey = players.find((p) => p.id === this.target);
      if (prey && visible.includes(prey)) {
        this.lastSeen = [prey.p[0], prey.p[2]];
        this.timer = 3;
      } else {
        this.timer -= dt;
        if (this.timer <= 0 || !prey) { this.state = CAT_STATE.SEARCH; this.timer = 5; this.target = null; }
      }
      if (this.lastSeen) {
        if (!this.goal || Math.hypot(this.goal[0] - this.lastSeen[0], this.goal[1] - this.lastSeen[1]) > 1.5) this._goTo(...this.lastSeen);
      }
      speed = C.CAT_HUNT_SPEED;
      // Can't get any closer (thief is under the table or up high)? Give up for a while.
      if (prey) {
        const d = Math.hypot(prey.p[0] - this.x, prey.p[2] - this.z);
        if (d < this.bestDist - 0.3) { this.bestDist = d; this.stuck = 0; } else this.stuck += dt;
        if (this.stuck > 4) {
          this.state = CAT_STATE.SEARCH; this.timer = 3; this.cooldown = 6; this.target = null;
          this._goTo(...randomNode());
          this._move(dt, C.CAT_SEARCH_SPEED);
          return null;
        }
      }
      // Swat!
      if (prey && this.cooldown <= 0 && !(prey.immuneUntil > now) && prey.p[1] < C.CAT_REACH_HEIGHT &&
          Math.hypot(prey.p[0] - this.x, prey.p[2] - this.z) < C.CAT_CATCH_RANGE + C.CAT_RADIUS * 0.5) {
        this.cooldown = 3;
        this.state = CAT_STATE.SEARCH;
        this.timer = 4;
        this.target = null;
        this.goal = null;
        return prey.id;
      }
    } else if (this.state === CAT_STATE.SEARCH) {
      speed = C.CAT_SEARCH_SPEED;
      this.timer -= dt;
      if (this.timer <= 0) { this.state = CAT_STATE.WANDER; this.wanderStops = 1; this._goTo(LEVEL.catBed[0], LEVEL.catBed[2]); }
    } else if (this.state === CAT_STATE.WANDER) {
      this.goalAge = (this.goalAge || 0) + dt;
      if (!this.goal || this._reached() || this.goalAge > 20) { // give up on unreachable spots
        if (this.wanderStops > 1) { this.wanderStops--; this._goTo(...randomNode()); }
        else if (this.wanderStops === 1) { this.wanderStops = 0; this._goTo(LEVEL.catBed[0], LEVEL.catBed[2]); }
        else { this.state = CAT_STATE.SLEEP; this.timer = 45 + Math.random() * 30; this.goal = null; }
      }
    }

    this._move(dt, speed);
    return null;
  }

  _reached() {
    return this.goal && Math.hypot(this.goal[0] - this.x, this.goal[1] - this.z) < 1.2;
  }

  _face(x, z, dt) {
    let d = Math.atan2(x - this.x, z - this.z) - this.ry;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.ry += d * Math.min(1, dt * 6);
  }

  _move(dt, speed) {
    if (!this.goal) return;
    this.replan -= dt;
    if (this.replan <= 0) {
      this.replan = 0.4;
      this.path = segmentClear(this.x, this.z, this.goal[0], this.goal[1]) ? [this.goal] : findPath([this.x, this.z], this.goal);
      if (this.path.length > 1 && Math.hypot(this.path[0][0] - this.x, this.path[0][1] - this.z) < 1.5) this.path.shift();
      if (!this.path.length) this.path = [this.goal];
    }
    let next = this.path[0];
    if (Math.hypot(next[0] - this.x, next[1] - this.z) < 0.6 && this.path.length > 1) { this.path.shift(); next = this.path[0]; }
    const dx = next[0] - this.x, dz = next[1] - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return;
    this._face(next[0], next[1], dt);
    const step = Math.min(dist, speed * dt);
    const nx = this.x + (dx / dist) * step;
    const nz = this.z + (dz / dist) * step;
    if (!catBlocked(nx, nz)) { this.x = nx; this.z = nz; }
    else if (!catBlocked(nx, this.z)) this.x = nx;
    else if (!catBlocked(this.x, nz)) this.z = nz;
    else this.replan = 0;
  }
}
