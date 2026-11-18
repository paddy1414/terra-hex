// Terra Hex — synthesized sound effects (Web Audio; no sound files).
export class Sound {
  constructor() {
    this.ctx = null;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('terrahex.sound') || '{}'); } catch { /* storage blocked */ }
    this.muted = !!saved.muted;
    this.volume = typeof saved.volume === 'number' ? saved.volume : 0.7;
  }
  save() { try { localStorage.setItem('terrahex.sound', JSON.stringify({ muted: this.muted, volume: this.volume })); } catch { /* ignore */ } }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this.volume; this.save(); }
  setMuted(m) { this.muted = m; this.save(); }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }
  _ok() { return this.ctx && !this.muted && this.volume > 0; }
  _tone(freq, dur, { type = 'sine', gain = 0.25, at = 0, slide = 0, attack = 0.005 } = {}) {
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(dur, { gain = 0.2, at = 0, freq = 1200, q = 1 } = {}) {
    const t = this.ctx.currentTime + at;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  dice() {
    if (!this._ok()) return;
    for (let i = 0; i < 7; i++) this._noise(0.05, { at: i * 0.07 + Math.random() * 0.03, gain: 0.35, freq: 2500 + Math.random() * 1500, q: 3 });
    this._noise(0.08, { at: 0.55, gain: 0.4, freq: 1800, q: 2 });
  }
  build(kind = 'road') {
    if (!this._ok()) return;
    if (kind === 'road') { this._noise(0.12, { gain: 0.35, freq: 500, q: 1 }); this._tone(140, 0.15, { type: 'triangle', gain: 0.2, slide: 0.6 }); }
    else {
      this._tone(kind === 'city' ? 196 : 262, 0.18, { type: 'triangle', gain: 0.22 });
      this._tone(kind === 'city' ? 294 : 392, 0.25, { type: 'triangle', gain: 0.2, at: 0.1 });
      if (kind === 'city') this._tone(392, 0.4, { type: 'triangle', gain: 0.18, at: 0.22 });
      this._noise(0.1, { gain: 0.25, freq: 700 });
    }
  }
  collect(n = 1) {
    if (!this._ok()) return;
    for (let i = 0; i < Math.min(n, 5); i++) this._tone(660 + i * 110, 0.12, { type: 'sine', gain: 0.14, at: i * 0.07 });
  }
  trade() { if (!this._ok()) return; this._tone(523, 0.12, { gain: 0.16 }); this._tone(784, 0.18, { gain: 0.16, at: 0.1 }); }
  robber() { if (!this._ok()) return; this._tone(110, 0.5, { type: 'sawtooth', gain: 0.12, slide: 0.7 }); this._noise(0.3, { gain: 0.15, freq: 300 }); }
  /** A sly "heh-heh-heh" when the robber's tile is rolled. */
  robberLaugh() {
    if (!this._ok()) return;
    [[330, 0], [294, 0.17], [262, 0.34], [220, 0.52]].forEach(([f, at], i) => {
      this._tone(f, 0.13, { type: 'sawtooth', gain: 0.07, at, slide: 0.82 });
      this._tone(f * 2.01, 0.1, { type: 'square', gain: 0.025, at });
      this._noise(0.09, { gain: 0.12, at: at + 0.01, freq: 1400 - i * 150, q: 4 });
    });
    this._tone(110, 0.6, { type: 'triangle', gain: 0.1, at: 0.05, slide: 0.7 });
  }
  card() { if (!this._ok()) return; this._noise(0.08, { gain: 0.2, freq: 3000, q: 0.7 }); this._tone(880, 0.08, { gain: 0.08, at: 0.04 }); }
  turn() { if (!this._ok()) return; this._tone(587, 0.18, { gain: 0.15 }); this._tone(880, 0.3, { gain: 0.14, at: 0.12 }); }
  tick(urgent) { if (!this._ok()) return; this._tone(urgent ? 1100 : 880, 0.06, { type: 'square', gain: 0.05 }); }
  /** A clear, rising call: it is your turn. */
  yourTurn() {
    if (!this._ok()) return;
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.38]].forEach(([f, at]) => this._tone(f, 0.32, { type: 'triangle', gain: 0.22, at }));
    this._tone(1568, 0.5, { type: 'sine', gain: 0.08, at: 0.38 });
  }
  error() { if (!this._ok()) return; this._tone(180, 0.18, { type: 'square', gain: 0.07 }); }
  award() { if (!this._ok()) return; [523, 659, 784].forEach((f, i) => this._tone(f, 0.25, { type: 'triangle', gain: 0.16, at: i * 0.09 })); }
  victory() {
    if (!this._ok()) return;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this._tone(f, 0.35, { type: 'triangle', gain: 0.18, at: i * 0.13 }));
  }
}
