// A small, dependency-free WebSocket server (RFC 6455) — enough for JSON game messages.
// Handles the HTTP upgrade handshake, masked client frames, fragmentation, ping/pong and close.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 16 * 1024;

export class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentBytes = 0;
    this.closed = false;
    this.isAlive = true;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  send(text) {
    if (this.closed) return;
    this._writeFrame(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    if (!this.closed) this._writeFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this._writeFrame(0x8, payload);
    this.socket.end();
    this._finish();
  }

  terminate() {
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _writeFrame(opcode, data) {
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, data])); } catch { this.terminate(); }
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed) {
      const frame = this._parseFrame();
      if (!frame) break;
      this._handleFrame(frame);
    }
  }

  _parseFrame() {
    const b = this.buffer;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_MESSAGE_BYTES)) { this.close(1009); return null; }
      len = Number(big); off = 10;
    }
    if (len > MAX_MESSAGE_BYTES) { this.close(1009); return null; }
    if (!masked) { this.close(1002); return null; } // browsers always mask client frames
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4);
    off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    this.buffer = b.subarray(off + len);
    return { fin, opcode, payload };
  }

  _handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case 0x0: // continuation
        if (!this.fragments.length) return this.close(1002);
        this._pushFragment(payload);
        if (fin) this._emitFragments();
        break;
      case 0x1: // text
      case 0x2: // binary (treated as text)
        if (this.fragments.length) return this.close(1002);
        if (fin) this.emit('message', payload.toString('utf8'));
        else this._pushFragment(payload);
        break;
      case 0x8: // close
        this.close(1000);
        break;
      case 0x9: // ping
        this._writeFrame(0xa, payload);
        break;
      case 0xa: // pong
        this.isAlive = true;
        break;
      default:
        this.close(1002);
    }
  }

  _pushFragment(payload) {
    this.fragmentBytes += payload.length;
    if (this.fragmentBytes > MAX_MESSAGE_BYTES) return this.close(1009);
    this.fragments.push(payload);
  }

  _emitFragments() {
    const text = Buffer.concat(this.fragments).toString('utf8');
    this.fragments = [];
    this.fragmentBytes = 0;
    this.emit('message', text);
  }
}

/** Accept WebSocket upgrades on `path` and hand each connection to onConnection(ws, req). */
export function attachWebSocketServer(httpServer, path, onConnection) {
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    const upgrade = (req.headers.upgrade || '').toLowerCase();
    if (url.pathname !== path || upgrade !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    const ws = new WSConnection(socket);
    if (head && head.length) ws._onData(head);
    onConnection(ws, req);
  });
}
