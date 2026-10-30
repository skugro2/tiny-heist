// The one demo level: a corner convenience store at night, seen from a toy's height.
// Both the client (to build meshes) and the server (to validate gameplay) import this file,
// so everything here must be deterministic and free of browser/Node specifics.
//
// Coordinates: x = left/right, y = up, z = back wall (-28) to front wall with the door (+28).
// Every object is described by its BASE centre (x, y, z) and its size (w along x, h, d along z).

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261026);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

export const BOUNDS = { minX: -40, maxX: 40, minZ: -28, maxZ: 28, height: 34 };

const objects = [];
function add(o) {
  const obj = { collide: true, shadow: true, ry: 0, ...o };
  objects.push(obj);
  return obj;
}

const PRODUCT_COLORS = ['#e94f64', '#f6b93b', '#4fc3a1', '#5b8def', '#b06ee8', '#f78fb3', '#7bd389', '#ff8c42'];

// ---------- Walls ----------
const WALL = '#2d3560';
add({ shape: 'wall', x: 0, y: 0, z: -28.5, w: 82, h: 34, d: 1, color: WALL, shadow: false });
add({ shape: 'wall', x: 0, y: 0, z: 28.5, w: 82, h: 34, d: 1, color: WALL, shadow: false });
add({ shape: 'wall', x: -40.5, y: 0, z: 0, w: 1, h: 34, d: 58, color: WALL, shadow: false });
add({ shape: 'wall', x: 40.5, y: 0, z: 0, w: 1, h: 34, d: 58, color: WALL, shadow: false });

// ---------- Drinks cooler along the back wall ----------
add({ shape: 'cooler', x: -22, y: 0, z: -25.5, w: 32, h: 26, d: 5, color: '#3a4170' });

// ---------- Two tall shelving units (aisle between them) ----------
function fillShelfRow({ x, y, z0, z1, depth, maxH, collide, skip }) {
  let z = z0 + 0.45;
  while (z < z1 - 0.45) {
    const roll = rand();
    let shape, w, h, d;
    if (roll < 0.45) { shape = 'cereal'; d = 1.2 + rand() * 0.6; w = depth * 0.8; h = Math.min(maxH, 2.8 + rand() * 1.0); }
    else if (roll < 0.8) { shape = 'can'; d = 1.0; w = 1.0; h = 1.5; }
    else { shape = 'bottle'; d = 1.0; w = 1.0; h = Math.min(maxH, 3.1 + rand() * 0.7); }
    const color = pick(PRODUCT_COLORS);
    const gap = 0.25 + rand() * 0.35;
    if (z + d > z1 - 0.45) break;
    const cz = z + d / 2;
    const skipped = skip && cz + d / 2 > skip[0] && cz - d / 2 < skip[1];
    if (!skipped) add({ shape, x, y, z: cz, w, h, d, color, collide, shadow: false });
    z += d + gap;
  }
}

function shelfUnit(cx, z0, z1, watchGapSide) {
  const W = 6, H = 22, len = z1 - z0, cz = (z0 + z1) / 2;
  const FRAME = '#59608f', PLANK = '#8a90c0';
  add({ shape: 'box', x: cx, y: 0, z: cz, w: W, h: 0.6, d: len, color: FRAME });             // base
  for (const py of [6, 11.5, 17]) add({ shape: 'plank', x: cx, y: py, z: cz, w: W, h: 0.35, d: len, color: PLANK });
  add({ shape: 'box', x: cx, y: 21.4, z: cz, w: W, h: 0.6, d: len, color: FRAME });           // top cap
  add({ shape: 'box', x: cx, y: 0.6, z: cz, w: 0.4, h: 20.8, d: len, color: '#464d7d' });     // back panel
  add({ shape: 'box', x: cx, y: 0, z: z0 + 0.2, w: W + 0.2, h: 22.2, d: 0.4, color: FRAME }); // end panels
  add({ shape: 'box', x: cx, y: 0, z: z1 - 0.2, w: W + 0.2, h: 22.2, d: 0.4, color: FRAME });

  const levels = [
    { y: 0.6, maxH: 4.0, collide: true },     // the floor-level shelf is walkable, so its products block you
    { y: 6.35, maxH: 4.4, collide: false },
    { y: 11.85, maxH: 4.4, collide: false },
    { y: 17.35, maxH: 3.8, collide: false },
  ];
  for (const lv of levels) {
    for (const side of [-1, 1]) {
      const skip = lv.y < 1 && side === watchGapSide ? [-8, -2] : null; // clear a nook for the watch
      fillShelfRow({ x: cx + side * 1.6, y: lv.y, z0: z0 + 0.4, z1: z1 - 0.4, depth: 2.6, maxH: lv.maxH, collide: lv.collide, skip });
    }
  }
}
shelfUnit(-24, -16, 6, +1);   // shelf A: the golden watch hides on its bottom shelf, aisle side
shelfUnit(-10, -16, 6, 0);    // shelf B

// ---------- Checkout counter + climbable staircase of stuff ----------
add({ shape: 'counter', x: 25, y: 0, z: 9.5, w: 14, h: 10, d: 7, color: '#4f4386' });
add({ shape: 'register', x: 28.8, y: 10, z: 9.2, w: 4, h: 3, d: 3.2, color: '#2f3557' });
add({ shape: 'can', x: 31.2, y: 10, z: 12, w: 1.8, h: 1.9, d: 1.8, color: '#9fd8e8' });     // tip jar
add({ shape: 'cardboard', x: 19.6, y: 10, z: 7.2, w: 2.2, h: 1.0, d: 1.6, color: '#d39a5c' }); // gum box

const STEP_KINDS = [
  { shape: 'cardboard', color: '#c68b52' },
  { shape: 'cardboard', color: '#b97f48' },
  { shape: 'can', color: '#e94f64' },
  { shape: 'books', color: '#5b8def' },
  { shape: 'cereal', color: '#f6b93b' },
  { shape: 'cardboard', color: '#c68b52' },
  { shape: 'cereal', color: '#4fc3a1' },
];
STEP_KINDS.forEach((k, i) => {
  const n = i + 1;
  const xmax = 18 - (7 - n) * 1.5;
  add({ shape: k.shape, x: xmax - 0.75, y: 0, z: 9.5, w: 1.5, h: 1.25 * n, d: 3, color: k.color, climb: true });
});

// ---------- Display table by the window (luxury phone on top) ----------
const TABLE = { x: -29, z: 16, w: 10, d: 8, top: 4.0 };
add({ shape: 'box', x: TABLE.x, y: 3.6, z: TABLE.z, w: TABLE.w, h: 0.4, d: TABLE.d, color: '#b59bd9' });
for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
  add({ shape: 'box', x: TABLE.x + lx * (TABLE.w / 2 - 0.5), y: 0, z: TABLE.z + lz * (TABLE.d / 2 - 0.5), w: 0.6, h: 3.6, d: 0.6, color: '#6c5a99' });
}
add({ shape: 'gift', x: -32, y: 4, z: 14, w: 1.8, h: 1.5, d: 1.8, color: '#e94f64' });
add({ shape: 'gift', x: -26.6, y: 4, z: 18.6, w: 1.5, h: 2.2, d: 1.5, color: '#4fc3a1' });
add({ shape: 'cardboard', x: -23.2, y: 0, z: 16, w: 1.4, h: 2.7, d: 2.2, color: '#c68b52', climb: true }); // six-pack box
add({ shape: 'can', x: -21.6, y: 0, z: 16, w: 1.2, h: 1.4, d: 1.2, color: '#ff8c42', climb: true });       // soda can

// ---------- Cover and clutter on the shop floor ----------
add({ shape: 'cardboard', x: -2, y: 0, z: 2, w: 4, h: 4, d: 4, color: '#c68b52' });
add({ shape: 'cardboard', x: 1.5, y: 0, z: -6, w: 3.5, h: 2.4, d: 3, color: '#b97f48' });
add({ shape: 'cardboard', x: 3.9, y: 0, z: -6, w: 1.4, h: 1.2, d: 1.4, color: '#d39a5c', climb: true });
add({ shape: 'cardboard', x: 10, y: 0, z: 0, w: 5, h: 2.9, d: 4.5, color: '#c68b52' }); // reachable from a friend's head
add({ shape: 'cardboard', x: -4.5, y: 0, z: 14, w: 3, h: 2.4, d: 3, color: '#b97f48' });
add({ shape: 'cardboard', x: 16, y: 0, z: 17, w: 2.6, h: 1.4, d: 2.6, color: '#d39a5c' });

// Pallet of water packs
add({ shape: 'pallet', x: 6, y: 0, z: -19, w: 8, h: 0.9, d: 6, color: '#a77b4f' });
for (const px of [-1, 1]) for (const pz of [-1, 1]) {
  add({ shape: 'pack', x: 6 + px * 1.9, y: 0.9, z: -19 + pz * 1.4, w: 3.6, h: 3.2, d: 2.6, color: '#8fc7ef' });
}
// Giant soda bottles next to the cooler
add({ shape: 'bottle', x: 13, y: 0, z: -24.5, w: 2.6, h: 10.5, d: 2.6, color: '#3fa36b' });
add({ shape: 'bottle', x: 16.2, y: 0, z: -24.5, w: 2.6, h: 10.5, d: 2.6, color: '#ff8c42' });
add({ shape: 'bottle', x: 19.4, y: 0, z: -24.5, w: 2.6, h: 9.0, d: 2.6, color: '#7fc8ff' });
// Back-room crates and a mop bucket
add({ shape: 'cardboard', x: 31, y: 0, z: -21, w: 6, h: 5, d: 6, color: '#b97f48' });
add({ shape: 'cardboard', x: 32.3, y: 5, z: -22.3, w: 3, h: 3, d: 3, color: '#c68b52' });
add({ shape: 'cardboard', x: 35, y: 0, z: -13, w: 4, h: 3, d: 4, color: '#d39a5c' });
add({ shape: 'bucket', x: 24, y: 0, z: -9, w: 3.2, h: 3, d: 3.2, color: '#ffd23f' });

// Rubber-band trampolines: landing on one launches you upward.
add({ shape: 'pad', x: 26.4, y: 0, z: -21, w: 2.4, h: 0.35, d: 2.4, color: '#ff5fa2', bounce: 15 }); // onto the crates
add({ shape: 'pad', x: 25, y: 0, z: 15.6, w: 2.4, h: 0.35, d: 2.4, color: '#ff5fa2', bounce: 21 });  // up to the counter
// Cat bed (cushion, low enough to walk over)
add({ shape: 'cushion', x: -3, y: 0, z: -21, w: 5, h: 0.5, d: 4, color: '#7b5ea7', collide: false });

export const OBJECTS = objects;

export const COLLIDERS = objects
  .filter((o) => o.collide)
  .map((o) => ({
    min: [o.x - o.w / 2, o.y, o.z - o.d / 2],
    max: [o.x + o.w / 2, o.y + o.h, o.z + o.d / 2],
    bounce: o.bounce || 0,
  }));

// ---------- Gameplay ----------
export const SPAWNS = [
  [4, 0, 18.5],
  [7, 0, 18.5],
  [10, 0, 18.5],
  [13, 0, 18.5],
];
export const SPAWN_YAW = Math.PI; // facing into the store (-z)

// Valuables. size = [w, h, d]; value in dollars. Positions are picked from SPOTS each heist.
export const VALUABLES = [
  { id: 'watch', name: 'golden watch', value: 1200, size: [0.5, 1.7, 1.5] },
  { id: 'phone', name: 'luxury phone', value: 900, size: [1.3, 0.2, 2.4] },
  { id: 'jewels', name: 'jewelry box', value: 2500, size: [1.7, 1.3, 1.3] },
  { id: 'gold', name: 'gold bar', value: 5000, size: [2.4, 0.9, 1.3], heavy: true },
  { id: 'ring', name: 'diamond ring', value: 8000, size: [0.9, 0.9, 0.9], rare: true },
];
export const VALUABLE_BY_ID = Object.fromEntries(VALUABLES.map((v) => [v.id, v]));
export const MAIN_VALUABLES = VALUABLES.filter((v) => !v.rare).map((v) => v.id);

// Where valuables can appear. [x, y, z, ry]. Every spot is reachable (see test.mjs).
export const SPOTS = {
  normal: [
    [-22.4, 0.6, -5, Math.PI / 2],   // bottom shelf nook, left aisle
    [-29.5, 4.0, 16, 0.4],           // display table by the window
    [22.4, 10, 9.6, -0.3],           // checkout counter
    [16, 1.4, 17, 0.8],              // small box near the entrance
    [3.9, 1.2, -6, 0.2],             // little box in the middle of the shop
    [16.2, 0, -21.4, -0.5],          // behind the giant soda bottles
  ],
  floor: [
    [-29, 0, 16, 0.1],               // under the display table
    [37, 0, -22, 1.5],               // back-right corner, past the crates
    [-17, 0, -20.5, 0],              // corridor in front of the cooler
    [-36, 0, -8, 1.2],               // along the left wall
  ],
  secret: [
    [29.2, 5, -19.8, 0.3],           // on the crates (use the trampoline)
    [10, 2.9, 0, 0.6],               // on the big box (jump off a friend's head)
    [31.2, 11.9, 12, 0],             // on top of the tip jar on the counter
  ],
};

export const ESCAPE_ZONE = { minX: 0.5, maxX: 11.5, minZ: 21.5, maxZ: 27.6 };
export const DELIVERY_SLOTS = [
  [3, 0, 25.2, 0.2],
  [6, 0, 25.6, -0.1],
  [9, 0, 25.2, 0.3],
];

// Security camera: mounted high on the right wall, sweeping across the route to the exit.
const camPos = [39.2, 23, -8];
const camTarget = [6, 0, 8];
const cdx = camTarget[0] - camPos[0];
const cdz = camTarget[2] - camPos[2];
const horiz = Math.hypot(cdx, cdz);
export const SECURITY_CAMERA = {
  pos: camPos,
  baseYaw: Math.atan2(cdx, cdz),
  pitch: Math.atan2(camPos[1] - camTarget[1], horiz),
  sweep: (35 * Math.PI) / 180,
  period: 10,               // seconds for a full left-right-left sweep
  halfAngle: (13 * Math.PI) / 180,
  range: 70,
};

// Mousetraps on the floor in darker spots.
export const TRAPS = [
  [-17, 0, -18.6], [-17, 0, 10], [20, 0, -12], [-34, 0, 6], [0, 0, -14.5],
];

// Standing on this switch turns the security camera off.
export const CAMERA_SWITCH = { x: 36.5, z: -4, w: 2.6, d: 2.6 };

export const CAT_BED = [-3, 0, -21];

// Robot vacuum: drives this loop forever. Players can ride on it; it shoves thieves it bumps.
export const VACUUM = {
  path: [[-3, -11], [15, -11], [15, 5.5], [2, 5.5], [2, -2], [-3, -2]],
  speed: 3,
  half: 1.7,   // half-width of its square collision box
  height: 0.9,
};

export const LEVEL = {
  bounds: BOUNDS,
  objects: OBJECTS,
  colliders: COLLIDERS,
  spawns: SPAWNS,
  spawnYaw: SPAWN_YAW,
  valuables: VALUABLES,
  spots: SPOTS,
  traps: TRAPS,
  cameraSwitch: CAMERA_SWITCH,
  catBed: CAT_BED,
  vacuum: VACUUM,
  escapeZone: ESCAPE_ZONE,
  deliverySlots: DELIVERY_SLOTS,
  securityCamera: SECURITY_CAMERA,
};
