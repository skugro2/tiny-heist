// Keyboard + mouse input. Uses e.code, so WASD works on any keyboard layout.
// Mouse look uses pointer lock; if that's unavailable, dragging with the mouse also turns the camera.

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas, onLockChange) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.dragging = false;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target instanceof HTMLInputElement) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => this.requestLock());
    canvas.addEventListener('mousedown', () => { if (!this.locked) this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (onLockChange) onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !(this.locked || this.dragging)) return;
      // Chrome occasionally reports huge spikes right after locking; ignore them.
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
  }

  requestLock() {
    if (this.locked || !this.enabled || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* browser refused; drag-to-look still works */ }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  consumeMouse() {
    const d = [this.dx, this.dy];
    this.dx = 0; this.dy = 0;
    return d;
  }

  endFrame() { this.pressed.clear(); }
}
