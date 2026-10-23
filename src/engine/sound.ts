/** 用 Web Audio 实时合成的积木音效（无需音频文件） */
export type SoundName = 'place' | 'remove' | 'select' | 'error' | 'rotate' | 'paint';

class SoundFX {
  enabled = true;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.25);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private burst(t: number, freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.1);
    src.stop(t + dur + 0.02);
  }

  private tone(t: number, f0: number, f1: number, gain: number, dur: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(name: SoundName) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const v = 0.94 + Math.random() * 0.12;
    switch (name) {
      case 'place':
        // 塑料「咔哒」：两次快速的高频敲击 + 低沉的主体共振
        this.burst(t, 3200 * v, 1.4, 0.55, 0.035);
        this.tone(t, 520 * v, 300 * v, 0.28, 0.07, 'triangle');
        this.burst(t + 0.028, 4600 * v, 2, 0.32, 0.025);
        break;
      case 'remove':
        this.burst(t, 1900 * v, 1.2, 0.4, 0.04);
        this.tone(t, 280 * v, 560 * v, 0.18, 0.07, 'triangle');
        break;
      case 'select':
        this.tone(t, 1500 * v, 1300 * v, 0.07, 0.04);
        break;
      case 'rotate':
        this.burst(t, 5200 * v, 3, 0.18, 0.02, 'highpass');
        this.tone(t, 900 * v, 760 * v, 0.06, 0.04);
        break;
      case 'paint':
        this.burst(t, 7000 * v, 0.8, 0.12, 0.08, 'highpass');
        this.tone(t, 880 * v, 1320 * v, 0.07, 0.09);
        break;
      case 'error':
        this.tone(t, 190, 170, 0.08, 0.08, 'square');
        this.tone(t + 0.1, 170, 150, 0.08, 0.09, 'square');
        break;
    }
  }
}

export const sound = new SoundFX();
