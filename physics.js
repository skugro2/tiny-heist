// Collision and gameplay queries shared by client (movement, camera) and server (validation).
// The world is a list of axis-aligned boxes; the player is a box of PLAYER_RADIUS x PLAYER_HEIGHT.

import { PLAYER_RADIUS as R, PLAYER_HEIGHT as H, STEP_HEIGHT, INTERACT_RANGE } from './constants.js';
import { COLLIDERS, ESCAPE_ZONE, SECURITY_CAMERA, VALUABLE_BY_ID } from './level.js';

const EPS = 1e-4;
const SKIN = 1e-3;

export function overlapsBox(x, y, z, c) {
  return (
    x + R > c.min[0] + EPS && x - R < c.max[0] - EPS &&
    z + R > c.min[2] + EPS && z - R < c.max[2] - EPS &&
    y + H > c.min[1] + EPS && y < c.max[1] - EPS
  );
}

export function blockedAt(x, y, z, colliders = COLLIDERS) {
  for (const c of colliders) if (overlapsBox(x, y, z, c)) return true;
  return false;
}

function supported(p, colliders) {
  if (p[1] <= 0.001) return true;
  for (const c of colliders) {
    if (Math.abs(c.max[1] - p[1]) > 0.02) continue;
    if (p[0] + R > c.min[0] && p[0] - R < c.max[0] && p[2] + R > c.min[2] && p[2] - R < c.max[2]) return true;
  }
  return false;
}

/**
 * Moves a body { p:[x,y,z], v:[vx,vy,vz], grounded } through the level for dt seconds.
 * Horizontal axes are resolved separately (so you slide along walls), low ledges are stepped onto,
 * then vertical movement lands on tops or bumps heads on undersides.
 */
export function moveAndCollide(s, dt, colliders = COLLIDERS) {
  const p = s.p, v = s.v;
  const maxMove = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) * dt;
  const steps = Math.max(1, Math.ceil(maxMove / 0.2));
  const h = dt / steps;
  let grounded = false;

  for (let i = 0; i < steps; i++) {
    for (const axis of [0, 2]) {
      const dv = v[axis] * h;
      if (dv === 0) continue;
      p[axis] += dv;
      for (const c of colliders) {
        if (!overlapsBox(p[0], p[1], p[2], c)) continue;
        const up = c.max[1] - p[1];
        if (up > 0 && up <= STEP_HEIGHT && !blockedAt(p[0], c.max[1], p[2], colliders)) {
          p[1] = c.max[1];          // ledge assist: hop onto low edges
          if (v[1] < 0) v[1] = 0;
        } else {
          p[axis] = dv > 0 ? c.min[axis] - R - SKIN : c.max[axis] + R + SKIN;
          v[axis] = 0;
        }
      }
    }

    const dy = v[1] * h;
    p[1] += dy;
    for (const c of colliders) {
      if (!overlapsBox(p[0], p[1], p[2], c)) continue;
      if (dy <= 0) {
        if (c.max[1] - p[1] <= -dy + 0.05) { p[1] = c.max[1]; v[1] = 0; grounded = true; }
      } else if (p[1] + H - c.min[1] <= dy + 0.05) {
        p[1] = c.min[1] - H - SKIN; v[1] = 0;
      }
    }
    if (p[1] < 0) { p[1] = 0; if (v[1] < 0) v[1] = 0; grounded = true; }
  }
  if (!grounded && v[1] <= 0) grounded = supported(p, colliders);
  s.grounded = grounded;
  return s;
}

/** Height of the highest surface under (x, z) that is not above maxY. */
export function groundHeightAt(x, z, maxY, colliders = COLLIDERS) {
  let best = 0;
  for (const c of colliders) {
    if (x < c.min[0] || x > c.max[0] || z < c.min[2] || z > c.max[2]) continue;
    if (c.max[1] <= maxY + 0.05 && c.max[1] > best) best = c.max[1];
  }
  return best;
}

/** True if the point is inside a solid box (used to stop items being dropped into walls). */
export function pointInSolid(x, y, z, colliders = COLLIDERS) {
  for (const c of colliders) {
    if (x > c.min[0] && x < c.max[0] && y > c.min[1] && y < c.max[1] && z > c.min[2] && z < c.max[2]) return true;
  }
  return false;
}

/** Ray vs box (slab method). Returns distance along the normalised direction, or Infinity. */
export function rayBox(o, d, c) {
  let tmin = 0, tmax = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < c.min[a] || o[a] > c.max[a]) return Infinity;
    } else {
      let t1 = (c.min[a] - o[a]) / d[a];
      let t2 = (c.max[a] - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function raycast(o, d, maxDist, colliders = COLLIDERS) {
  let best = maxDist;
  for (const c of colliders) {
    const t = rayBox(o, d, c);
    if (t < best) best = t;
  }
  return best;
}

// ---------- Security camera ----------

export function cameraYawAt(seconds, cam = SECURITY_CAMERA) {
  return cam.baseYaw + cam.sweep * Math.sin((2 * Math.PI * seconds) / cam.period);
}

export function cameraDir(yaw, cam = SECURITY_CAMERA) {
  const cp = Math.cos(cam.pitch);
  return [cp * Math.sin(yaw), -Math.sin(cam.pitch), cp * Math.cos(yaw)];
}

/** Length of the camera's view cone from the lens down to the floor. */
export function cameraConeLength(cam = SECURITY_CAMERA) {
  return cam.pos[1] / Math.sin(cam.pitch);
}

/** Can the camera see this point (inside the cone, in range, and not behind a solid box)? */
export function cameraSees(yaw, point, colliders = COLLIDERS, cam = SECURITY_CAMERA) {
  const v = [point[0] - cam.pos[0], point[1] - cam.pos[1], point[2] - cam.pos[2]];
  const dist = Math.hypot(v[0], v[1], v[2]);
  if (dist > cam.range || dist < 0.01) return false;
  const n = [v[0] / dist, v[1] / dist, v[2] / dist];
  const dir = cameraDir(yaw, cam);
  const cos = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
  if (cos < Math.cos(cam.halfAngle)) return false;
  const hit = raycast(cam.pos, n, dist, colliders);
  return hit >= dist - 0.6; // nothing solid between the lens and the thief
}

// ---------- Heist helpers ----------

export function inEscapeZone(p, zone = ESCAPE_ZONE) {
  return p[0] >= zone.minX && p[0] <= zone.maxX && p[2] >= zone.minZ && p[2] <= zone.maxZ && p[1] < 2.5;
}

/** Nearest valuable the player at p can pick up, or null. Same rule on client (prompt) and server (truth). */
export function findPickupTarget(items, p) {
  let best = null;
  let bestDist = Infinity;
  for (const it of items) {
    if (it.holder || it.delivered) continue;
    const def = VALUABLE_BY_ID[it.id];
    const dy = it.pos[1] - p[1];
    if (dy < -1.2 || dy > 1.5) continue;
    const d = Math.hypot(it.pos[0] - p[0], it.pos[2] - p[2]);
    const reach = INTERACT_RANGE + Math.max(def.size[0], def.size[2]) * 0.35;
    if (d < reach && d < bestDist) { best = it; bestDist = d; }
  }
  return best;
}

/** Where a dropped valuable lands: just in front of the player, resting on whatever is below. */
export function dropPosition(p, ry, colliders = COLLIDERS) {
  let x = p[0] + Math.sin(ry) * 0.9;
  let z = p[2] + Math.cos(ry) * 0.9;
  if (pointInSolid(x, p[1] + 0.3, z, colliders)) { x = p[0]; z = p[2]; }
  const y = groundHeightAt(x, z, p[1] + 0.3, colliders);
  return [x, y, z];
}
