'use strict';
// Synthesized sound effects (Web Audio). The context is created lazily on the first sound, which is
// always triggered by user input, so browsers allow it.

class AudioSystem {
    constructor() {
        this.enabled = true;
        this.stepVolume = 0.7;
        this.ctx = null;
        this.noiseBuffer = null;
    }

    context() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.3, this.ctx.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        return this.ctx;
    }

    tone(freq, dur, type = 'square', vol = 0.04, slideTo = null) {
        if (!this.enabled || vol <= 0) return;
        const ctx = this.context();
        const t0 = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur);
    }

    // Filtered white-noise burst
    noise({ filter = 'bandpass', freq = 1000, q = 1, vol = 0.1, dur = 0.1, delay = 0, offset = 0 }) {
        if (!this.enabled || vol <= 0) return;
        const ctx = this.context();
        const t0 = ctx.currentTime + delay;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = ctx.createBiquadFilter();
        f.type = filter;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
        src.connect(f).connect(g).connect(ctx.destination);
        src.start(t0, offset);
        src.stop(t0 + dur + 0.02);
    }

    later(ms, fn) {
        setTimeout(fn, ms);
    }

    // ---- presets ----
    door() {
        this.tone(80, 1.4, 'sawtooth', 0.05, 45);
        this.tone(160, 0.25, 'square', 0.03, 90);
    }

    // Boot on metal grating: filtered noise scuff + low thump + faint ring
    step(run) {
        if (this.stepVolume <= 0) return;
        const vol = this.stepVolume * (run ? 0.3 : 0.18);
        this.noise({ freq: 700 + Math.random() * 900, q: 1.1, vol, dur: 0.11, offset: Math.random() * 0.15 });
        this.tone(65 + Math.random() * 20, 0.1, 'sine', vol * 0.9, 38);
        this.tone(2300 + Math.random() * 500, 0.06, 'triangle', vol * 0.07);
    }

    shutter() {
        this.noise({ filter: 'highpass', freq: 4000, vol: 0.12, dur: 0.05 });
        this.noise({ filter: 'highpass', freq: 2500, vol: 0.12, dur: 0.05, delay: 0.07 });
    }

    chime(up) {
        const [a, b] = up ? [880, 1320] : [1320, 880];
        this.tone(a, 0.08, 'sine', 0.04);
        this.later(90, () => this.tone(b, 0.1, 'sine', 0.04));
    }
}
