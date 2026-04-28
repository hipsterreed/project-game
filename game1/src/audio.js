/*
 * AdaptiveAudio
 *
 * A fully procedural audio engine. Every sound is synthesized with the
 * Web Audio API so the demo runs with zero asset dependencies. To use real
 * recorded audio later, drop files into ./assets/sounds/ matching the
 * `samples` map below — anything found will replace the procedural source
 * for that channel. See SOUNDS.txt for the manifest.
 *
 * Channels and how they react:
 *   - drone      : always on once started (foundation pad, A2)
 *   - bedLow     : low-mid pad, fades in with player progress
 *   - bedMid     : mid pad with movement; pulses with speed
 *   - bedHigh    : shimmering top layer; fades in only when both moving and far in
 *   - melody     : occasional bell-like notes triggered while moving
 *   - wind       : filtered noise; volume tied to player speed
 *   - leaves     : higher-frequency rustle, follows wind
 *   - footsteps  : triggered by Player.onStep
 *   - birds      : occasional procedural chirps
 *   - swell      : one-shot lifted chord at arrival
 */

const SOUND_FILES = {
  ambient_wind:    'assets/sounds/ambient_wind.ogg',
  ambient_leaves:  'assets/sounds/ambient_leaves.ogg',
  music_drone:     'assets/sounds/music_drone.ogg',
  music_bed_low:   'assets/sounds/music_bed_low.ogg',
  music_bed_mid:   'assets/sounds/music_bed_mid.ogg',
  music_bed_high:  'assets/sounds/music_bed_high.ogg',
  music_swell:     'assets/sounds/music_swell.ogg',
  footstep_grass:  'assets/sounds/footstep_grass.ogg',
  bird_chirp:      'assets/sounds/bird_chirp.ogg',
};

export class AdaptiveAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.paused = false;

    this.intensity = 0;     // 0..1 from player speed
    this.progress = 0;      // 0..1 from progress to goal

    // Loaded buffers (overrides for procedural)
    this.buffers = {};

    // Per-channel gains (so we can control them externally)
    this.g = {};
    this.windFilter = null;
    this.windLfo = null;
    this.melodyTimer = 0;
    this.birdTimer = 0;

    this.lastStepTime = 0;
  }

  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Browsers create AudioContext suspended — must resume within the user gesture
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch {}
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);

    // Try to load any sound files the user has dropped in. Missing files just fall back.
    await this._loadSamples();

    // Reverb send for ambience
    this.reverb = this._makeReverb(3.4, 2.4);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.45;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    // Build all sound generators
    this._buildDrone();
    this._buildPad('bedLow',  ['A2', 'E3'],          { detune: 6, lp: 800,  baseGain: 0.0 });
    this._buildPad('bedMid',  ['A3', 'C#4', 'E4'],   { detune: 8, lp: 1500, baseGain: 0.0 });
    this._buildPad('bedHigh', ['A4', 'C#5', 'E5'],   { detune: 10, lp: 3200, baseGain: 0.0, type: 'triangle' });
    this._buildWind();
    this._buildLeaves();

    // Sample-based slots (created on demand if buffer present)
    this.g.swell = this.ctx.createGain();
    this.g.swell.gain.value = 0;
    this.g.swell.connect(this.master);

    // Master fade-in
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(0, this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.85, this.ctx.currentTime + 3.0);

    // Hook footstep firing into a shared callback
    this._setupFootsteps();

    // Auto-resume on visibility return
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.ctx.suspend();
      } else if (!this.paused) {
        this.ctx.resume();
      }
    });

    this.ready = true;
  }

  async _loadSamples() {
    const entries = Object.entries(SOUND_FILES);
    await Promise.all(entries.map(async ([key, url]) => {
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this.buffers[key] = buf;
      } catch (e) {
        // Silently fall back to procedural
      }
    }));
  }

  setPaused(p) {
    if (!this.ctx) return;
    this.paused = p;
    if (p) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.4);
    } else {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0.85, this.ctx.currentTime + 0.5);
    }
  }

  update(dt, speed, progress) {
    // Bail until init() has fully built channel graph
    if (!this.ctx || !this.ready) return;
    // Smooth incoming values
    this.intensity += (speed - this.intensity) * Math.min(1, dt * 1.5);
    this.progress  += (progress - this.progress) * Math.min(1, dt * 0.6);

    const now = this.ctx.currentTime;
    const lerpTo = (param, val, time = 0.4) => {
      if (!param) return;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(val, now + time);
    };
    const ch = (name) => this.g[name] && this.g[name].gain;

    // Wind: louder with movement, plus a base ambient level
    const windLevel = 0.18 + this.intensity * 0.32;
    lerpTo(ch('wind'),    windLevel, 0.2);
    lerpTo(ch('leaves'),  0.05 + this.intensity * 0.12, 0.2);

    // Music layers respond to progress + intensity
    lerpTo(ch('bedLow'),  0.10 + this.progress * 0.30, 1.2);

    const moveBlend = this.intensity;
    lerpTo(ch('bedMid'),  moveBlend * (0.18 + this.progress * 0.25), 1.0);
    lerpTo(ch('bedHigh'), moveBlend * Math.max(0, this.progress - 0.3) * 0.4, 1.5);

    // Wind LFO speed scales with intensity for energy
    if (this.windLfo) {
      this.windLfo.frequency.setValueAtTime(0.18 + this.intensity * 0.5, now);
    }

    // Melody bells (triggered occasionally when moving)
    this.melodyTimer -= dt;
    if (this.melodyTimer <= 0 && this.intensity > 0.25) {
      this.melodyTimer = 4 + Math.random() * 6 - this.progress * 2;
      this._playMelodyNote();
    }

    // Bird chirps - rare and atmospheric
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 5 + Math.random() * 9;
      if (Math.random() > 0.25) this._playBird();
    }
  }

  triggerSwell() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Use sample if loaded, else synthesize
    if (this.buffers.music_swell) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers.music_swell;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.master);
      g.gain.linearRampToValueAtTime(0.9, now + 1.5);
      g.gain.linearRampToValueAtTime(0.0, now + 10);
      src.start();
      return;
    }

    // Synthesize a rich resolved chord (A major add9) with bell on top
    const chord = ['A2', 'E3', 'A3', 'C#4', 'E4', 'B4', 'C#5'];
    chord.forEach((note, i) => {
      const f = noteToFreq(note);
      this._sustainTone(f, 0.18, 8.5, 0.6 + Math.random() * 0.6, i % 2 ? 'sine' : 'triangle');
      this._sustainTone(f * 1.005, 0.08, 8.5, 0.6 + Math.random() * 0.6, 'sine');
    });

    // High bell glitter
    setTimeout(() => this._playMelodyNote(true), 1400);
    setTimeout(() => this._playMelodyNote(true), 2800);
    setTimeout(() => this._playMelodyNote(true), 4600);
  }

  _setupFootsteps() {
    // Player calls window.dispatchEvent('footstep') via callback we set up in main
    // Simpler: expose a method players can call
  }

  triggerFootstep(intensity = 1) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStepTime < 0.18) return;
    this.lastStepTime = now;

    if (this.buffers.footstep_grass) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers.footstep_grass;
      const g = this.ctx.createGain();
      g.gain.value = 0.4 * intensity;
      src.connect(g).connect(this.master);
      src.playbackRate.value = 0.9 + Math.random() * 0.25;
      src.start();
      return;
    }

    // Procedural footstep: short noise burst with low-pass + brief envelope
    const buf = this._noiseBuffer(0.18);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220 + Math.random() * 120;
    lp.Q.value = 1.5;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;

    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.32 * intensity, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    src.connect(hp).connect(lp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + 0.2);
  }

  _playBird() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.buffers.bird_chirp) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers.bird_chirp;
      const g = this.ctx.createGain();
      g.gain.value = 0.12 + Math.random() * 0.1;
      src.connect(g).connect(this.reverb);
      src.connect(g).connect(this.master);
      src.playbackRate.value = 0.85 + Math.random() * 0.4;
      src.start();
      return;
    }

    // Procedural chirp: FM with rapid pitch sweep
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const env = this.ctx.createGain();

    const baseFreq = 1800 + Math.random() * 1600;
    carrier.type = 'sine';
    carrier.frequency.value = baseFreq;
    mod.type = 'sine';
    mod.frequency.value = 8 + Math.random() * 18;
    modGain.gain.value = 200 + Math.random() * 400;

    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    env.gain.value = 0;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.05, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.18 + Math.random() * 0.3);

    carrier.connect(env).connect(this.reverb);
    env.connect(this.master);

    mod.start(now);
    carrier.start(now);
    const dur = 0.3 + Math.random() * 0.5;
    mod.stop(now + dur);
    carrier.stop(now + dur);

    // Sometimes a quick double-chirp
    if (Math.random() < 0.4) {
      setTimeout(() => this._playBird(), 200 + Math.random() * 250);
    }
  }

  _playMelodyNote(bright = false) {
    if (!this.ctx) return;
    // A pentatonic: A C# E F# B (we'll favor higher, twinkly)
    const notes = bright
      ? ['A5', 'C#6', 'E6', 'B5', 'F#5']
      : ['A4', 'C#5', 'E5', 'F#5', 'B4'];
    const note = notes[Math.floor(Math.random() * notes.length)];
    const f = noteToFreq(note);
    this._sustainTone(f, 0.12, 4.0, 0.6, 'sine', true);
    // Octave shimmer
    this._sustainTone(f * 2, 0.04, 3.5, 0.6, 'sine', true);
  }

  _sustainTone(freq, peak, duration, attack = 0.4, type = 'sine', sendReverb = false) {
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;

    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.linearRampToValueAtTime(0.0001, now + duration);

    o.connect(g).connect(this.master);
    if (sendReverb) g.connect(this.reverb);

    o.start(now);
    o.stop(now + duration + 0.1);
  }

  _buildDrone() {
    const g = this.ctx.createGain();
    g.gain.value = 0.12;
    g.connect(this.master);
    g.connect(this.reverb);
    this.g.drone = g;

    // Two detuned sines on A2 (110Hz) for a slow beating drone
    [110, 110.4, 220].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const og = this.ctx.createGain();
      og.gain.value = i === 2 ? 0.08 : 0.5;
      o.connect(og).connect(g);
      o.start();
    });

    // Slow filter modulation for organic motion
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 0.5;
    g.disconnect();
    g.connect(lp);
    lp.connect(this.master);
    lp.connect(this.reverb);
  }

  _buildPad(name, notes, opts = {}) {
    const { detune = 6, lp = 1200, baseGain = 0.1, type = 'sine' } = opts;
    const g = this.ctx.createGain();
    g.gain.value = baseGain;
    g.connect(this.master);
    g.connect(this.reverb);
    this.g[name] = g;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lp;
    filter.Q.value = 0.7;

    g.disconnect();
    g.connect(filter);
    filter.connect(this.master);
    filter.connect(this.reverb);

    notes.forEach((note, i) => {
      const f = noteToFreq(note);
      // Two voices per note, slightly detuned for chorus
      [-detune, detune].forEach((d) => {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = d;
        const og = this.ctx.createGain();
        og.gain.value = 0.18 / notes.length;
        // LFO for slow amplitude movement
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 0.07 + Math.random() * 0.12;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.04;
        lfo.connect(lfoGain).connect(og.gain);
        o.connect(og).connect(g);
        o.start();
        lfo.start();
      });
    });
  }

  _buildWind() {
    const g = this.ctx.createGain();
    g.gain.value = 0.18;
    g.connect(this.master);
    this.g.wind = g;

    // White noise -> bandpass for "wind" tone
    const buf = this._noiseBuffer(6, true);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.4;
    this.windFilter = bp;

    // Slow gain LFO for gusts
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.18;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(g.gain);
    this.windLfo = lfo;

    src.connect(bp).connect(g);
    src.start();
    lfo.start();
  }

  _buildLeaves() {
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);
    this.g.leaves = g;

    const buf = this._noiseBuffer(5, true);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    // Higher band for "leaves rustling"
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4500;
    bp.Q.value = 0.5;

    src.connect(hp).connect(bp).connect(g);
    src.start();

    // Modulate amplitude
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.4;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
  }

  _noiseBuffer(durationSec, pink = false) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    if (!pink) {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } else {
      // Simple pinking via running average
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.15;
      }
    }
    return buf;
  }

  _makeReverb(durationSec, decay) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }
}

function noteToFreq(noteName) {
  // e.g. "A4" -> 440, "C#5" -> ...
  const m = noteName.match(/^([A-G])(#|b)?(-?\d+)$/);
  if (!m) return 440;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semi = semitones[m[1]];
  if (m[2] === '#') semi += 1;
  if (m[2] === 'b') semi -= 1;
  const octave = parseInt(m[3], 10);
  const midi = (octave + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
