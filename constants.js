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
