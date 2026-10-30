// WebSocket connection to the game server plus a clock estimate of server time
// (used to draw remote players slightly in the past for smooth interpolation).

export class ServerClock {
  constructor() { this.offset = null; }
  sample(serverMs) {
    const s = serverMs - performance.now();
    if (this.offset === null) this.offset = s;
    else if (s > this.offset) this.offset += (s - this.offset) * 0.5; // a faster packet: trust it more
    else this.offset += (s - this.offset) * 0.02;                     // slowly follow drift
  }
  now() { return performance.now() + (this.offset ?? 0); }
}

export class Net {
  constructor() {
    this.ws = null;
    this.onMessage = null;
    this.onClose = null;
    this.clock = new ServerClock();
  }

  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  connect() {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      let opened = false;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error('Could not connect')); };
      ws.onclose = (e) => {
        if (this.ws === ws) this.ws = null;
        if (opened && this.onClose) this.onClose(e);
        if (!opened) reject(new Error('Could not connect'));
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (typeof msg.st === 'number') this.clock.sample(msg.st);
        if (this.onMessage) this.onMessage(msg);
      };
      this.ws = ws;
    });
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }
}
