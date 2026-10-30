// Values shared by the client and the server. Units: 1 unit = one tiny thief's height.

export const SERVER_TICK_RATE = 20;   // snapshots per second sent by the server
export const CLIENT_SEND_RATE = 20;   // player state updates per second sent by each client
export const INTERP_DELAY_MS = 110;   // remote players are drawn this far in the past for smoothness

export const MAX_PLAYERS = 4;
export const ROOM_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read aloud
export const ROOM_CODE_LENGTH = 4;
export const NAME_MAX_LENGTH = 14;

export const PLAYER_RADIUS = 0.3;     // half-width of the player's collision box
export const PLAYER_HEIGHT = 1.0;
export const WALK_SPEED = 5.5;
export const SPRINT_SPEED = 9.0;
export const CARRY_SPEED_FACTOR = 0.72;
export const JUMP_VELOCITY = 8.2;     // jump height = v^2 / 2g = ~1.6 units
export const GRAVITY = 21;
export const STEP_HEIGHT = 0.4;       // ledges this low are climbed automatically

export const INTERACT_RANGE = 1.7;

export const DETECT_SECONDS = 1.3;    // continuous time in the camera cone before the alarm
export const DETECT_DECAY = 0.6;      // how fast suspicion drains (per second) when hidden
export const ALARM_SECONDS = 10;

// Anti-teleport: a client can only move as far as a fast sprinter could.
export const MOVE_ALLOWANCE_SPEED = SPRINT_SPEED * 1.35;
export const MOVE_BUDGET_MAX = 6;

// ---------- Update 2: cat, police, traps, heavy loot ----------
export const POLICE_SECONDS = 60;     // after the alarm, police arrive this many seconds later

export const CAT_RADIUS = 1.6;        // half-width of the cat's collision box
export const CAT_HEIGHT = 4.0;        // too tall to fit under the display table
export const CAT_HUNT_SPEED = 7.2;    // faster than walking (5.5), slower than sprinting (9)
export const CAT_SEARCH_SPEED = 4.2;
export const CAT_WALK_SPEED = 3.2;
export const CAT_SIGHT_RANGE = 17;
export const CAT_FOV = (70 * Math.PI) / 180; // half-angle of the cat's vision
export const CAT_CATCH_RANGE = 1.9;
export const CAT_REACH_HEIGHT = 2.2;  // thieves standing higher than this are out of paw reach
export const CAT_HEAR_SPRINT = 11;    // sprinting this close wakes the cat
export const CAT_HEAR_NOISE = 16;     // drops and snapping traps this close wake the cat
export const CAUGHT_IMMUNITY = 3;     // seconds of safety after being caught

export const TRAP_STUCK_SECONDS = 4;  // stuck this long unless a friend frees you
export const TRAP_REARM_SECONDS = 8;
export const RESCUE_RANGE = 2.2;

export const HEAVY_SOLO_FACTOR = 0.3; // dragging a heavy item alone
export const HEAVY_DUO_FACTOR = 0.7;  // carrying it together
export const HEAVY_MAX_APART = 4.5;   // carriers further apart than this drop it
