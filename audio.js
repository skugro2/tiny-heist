// Tiny synthesised sound effects with the Web Audio API, so the game ships with no audio files.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.siren = null;
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, { type = 'square', vol = 0.12, to = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  jump() { this.tone(260, 0.12, { type: 'sine', vol: 0.08, to: 420 }); }
  pickup() { this.tone(520, 0.09, { vol: 0.08 }); this.tone(880, 0.12, { vol: 0.08, delay: 0.07 }); }
  drop() { this.tone(300, 0.15, { type: 'triangle', vol: 0.14, to: 140 }); }
  deliver() { [660, 830, 990].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.12, delay: i * 0.08 })); }
  complete() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.14, delay: i * 0.12 })); }

  boing() { this.tone(180, 0.35, { type: 'sine', vol: 0.16, to: 720 }); }
  snap() { this.tone(1800, 0.05, { type: 'square', vol: 0.2, to: 300 }); this.tone(120, 0.12, { type: 'triangle', vol: 0.2, delay: 0.03 }); }
  meow() {
    this.tone(520, 0.18, { type: 'sawtooth', vol: 0.07, to: 820 });
    this.tone(820, 0.4, { type: 'sawtooth', vol: 0.07, to: 380, delay: 0.17 });
  }
  swat() { this.tone(900, 0.08, { type: 'square', vol: 0.15, to: 200 }); this.tone(90, 0.3, { type: 'triangle', vol: 0.22, delay: 0.05, to: 50 }); }
  beep() { this.tone(1000, 0.08, { type: 'square', vol: 0.08 }); }
  bump() { this.tone(140, 0.15, { type: 'triangle', vol: 0.16, to: 90 }); }

  alarmOn() {
    if (!this.ctx || this.siren) return;
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 760;
    lfo.frequency.value = 1.6;
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(osc.frequency);
    g.gain.value = 0.05;
    osc.connect(g).connect(this.master);
    osc.start(); lfo.start();
    this.siren = { osc, lfo, g };
  }

  alarmOff() {
    if (!this.siren) return;
    const { osc, lfo, g } = this.siren;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t, 0.08);
    osc.stop(t + 0.4); lfo.stop(t + 0.4);
    this.siren = null;
  }
}
