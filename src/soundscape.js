class Soundscape {
  constructor() {
    this.ctx = null;
    this.ambientNodes = null;
    this.ambientEnabled = false;
    this.unlocked = false;
    this._ambientTimer = null;
  }

  _ensureContext() {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    this.unlocked = true;
    return this.ctx;
  }

  init() {
    return this._ensureContext();
  }

  dispose() {
    this.stopAmbient(true);
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
  }

  playToken(type = "neutral") {
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = 0.32;

    const palette = {
      success: [523.25, 659.25, 783.99],
      warning: [392.0, 523.25],
      alert: [349.23, 466.16],
      neutral: [440.0],
    };

    const freqs = palette[type] || palette.neutral;

    freqs.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type === "warning" ? "triangle" : "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0;

      const startAt = now + index * 0.05;
      osc.connect(gain).connect(ctx.destination);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.08, startAt + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      osc.start(startAt);
      osc.stop(startAt + duration + 0.1);
    });
  }

  startAmbient() {
    if (this.ambientEnabled) return;
    const ctx = this._ensureContext();
    if (!ctx) return;

    const notes = [196.0, 261.63, 329.63];
    const nodes = notes.map((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.04 / (idx + 1), now + 3);
      osc.start(now + idx * 0.15);
      return { osc, gain };
    });

    this.ambientNodes = nodes;
    this.ambientEnabled = true;

    this._scheduleAmbientPulse();
  }

  _scheduleAmbientPulse() {
    if (!this.ambientEnabled || !this.ctx || !this.ambientNodes) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const cycle = 12;
    this.ambientNodes.forEach((node, idx) => {
      const delay = idx * 0.6;
      node.gain.gain.cancelScheduledValues(now + delay);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now + delay);
      node.gain.gain.linearRampToValueAtTime(0.06 / (idx + 1), now + delay + cycle / 2);
      node.gain.gain.linearRampToValueAtTime(0.02 / (idx + 1), now + delay + cycle);
    });

    this._ambientTimer = setTimeout(() => this._scheduleAmbientPulse(), cycle * 500);
  }

  stopAmbient(immediate = false) {
    if (!this.ambientEnabled) return;
    if (this._ambientTimer) {
      clearTimeout(this._ambientTimer);
      this._ambientTimer = null;
    }
    if (!this.ambientNodes || !this.ctx) {
      this.ambientEnabled = false;
      this.ambientNodes = null;
      return;
    }
    const now = this.ctx.currentTime;
    this.ambientNodes.forEach(({ osc, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, immediate ? now + 0.2 : now + 2);
      osc.stop(now + (immediate ? 0.4 : 2.5));
    });
    this.ambientNodes = null;
    this.ambientEnabled = false;
  }

  toggleAmbient(enable) {
    if (enable) {
      this.startAmbient();
    } else {
      this.stopAmbient();
    }
  }
}

export function createSoundscape() {
  return new Soundscape();
}
