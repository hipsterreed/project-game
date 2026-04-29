/* -----------------------------------------------------------
 * Audio
 *   Procedural soundscape using the Web Audio API.
 *   No external audio assets, everything synthesized so the
 *   demo is self-contained.
 *
 *   Layers:
 *     - wind base: filtered pink/brown noise, slow LFO on cutoff
 *     - wind gust: bandpassed noise with periodic swells
 *     - footstep: short noise burst, lowpass, fast decay
 *     - slide hiss: continuous gain on filtered noise
 *     - chime: detuned sine pad fading in near the arch
 *     - drone: distant low pad, rises near the destination
 *
 *   Master is gated through a low-pass that opens when the
 *   player begins (intent: a soft "world wakes up" sweep).
 * --------------------------------------------------------- */

export class Audio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.master = null;

    // dynamic state
    this.windBase = null;
    this.windGust = null;
    this.slideGain = null;
    this.chimeGain = null;
    this.droneGain = null;

    // music: a regular HTMLAudioElement so it plays alongside the
    // procedural Web Audio layers without going through the master.
    // Try to play it immediately on page load — most browsers block
    // unmuted autoplay without a gesture, so we start it muted (which
    // IS allowed) and unmute on first gesture / on start(). That way
    // playback is *running* the moment the page opens, and the audio
    // becomes audible the instant the user touches anything.
    this.music = new window.Audio("assets/sounds/main_track.mp3");
    this.music.loop = true;
    this.music.preload = "auto";
    this.music.muted = true;
    this.music.volume = 0;
    this.music.load();
    this.musicStarted = false;
    this._tryAutoplay();

    // params we react to externally
    this.windStrength = 0.0;
    this.slideStrength = 0.0;
    this.archProximity = 0.0; // 0..1
  }

  _tryAutoplay() {
    if (!this.music || this.musicStarted) return;
    const p = this.music.play();
    if (p && p.then) {
      p.then(() => { this.musicStarted = true; })
       .catch(() => { /* gesture-gated browser; first gesture will retry */ });
    } else {
      this.musicStarted = true;
    }
  }

  /* Unmute and ramp the music in. Safe to call repeatedly — every
   * call re-attempts play() in case an earlier attempt was blocked by
   * the browser's autoplay policy (e.g. pointermove isn't always a
   * valid activation; a real click/keydown is). */
  _unmuteMusic() {
    if (!this.music) return;
    this.music.muted = false;

    // Always retry play(). If it's already playing this is a no-op;
    // if it was paused/blocked, this kicks it off now that we (likely)
    // have a real gesture.
    const p = this.music.play();
    if (p && p.then) {
      p.then(() => { this.musicStarted = true; })
       .catch(() => { /* still blocked — next gesture will retry */ });
    } else {
      this.musicStarted = true;
    }

    if (this._musicFading) return;
    this._musicFading = true;
    const fadeMs = 700;
    const targetVol = 0.55;
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / fadeMs);
      if (this.music) this.music.volume = targetVol * k;
      if (k < 1 && this.music) requestAnimationFrame(tick);
      else this._musicFading = false;
    };
    requestAnimationFrame(tick);
  }

  start() {
    if (this.started) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.started = true;

    // master with low-pass open sweep
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    this.master = master;

    const masterFilter = ctx.createBiquadFilter();
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = 800;
    masterFilter.Q.value = 0.5;
    masterFilter.connect(master);
    this.masterFilter = masterFilter;

    // ----- wind base -----
    {
      const noise = this._brownNoise(8);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 380;
      lp.Q.value = 0.7;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 80;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      noise.connect(hp).connect(lp).connect(g).connect(masterFilter);

      // cutoff LFO
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 90;
      lfo.connect(lfoGain).connect(lp.frequency);
      lfo.start();

      this.windBase = { src: noise, gain: g };
    }

    // ----- wind gust (bandpass swell) -----
    {
      const noise = this._whiteNoise(8);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 600;
      bp.Q.value = 1.6;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      noise.connect(bp).connect(g).connect(masterFilter);

      // slow swell LFO
      const swell = ctx.createOscillator();
      const swellGain = ctx.createGain();
      swell.frequency.value = 0.08;
      swellGain.gain.value = 0.03;
      const swellOffset = ctx.createConstantSource();
      swellOffset.offset.value = 0.03;
      swell.connect(swellGain);
      swellOffset.connect(g.gain);
      swellGain.connect(g.gain);
      swell.start();
      swellOffset.start();

      // bp freq drift
      const fLfo = ctx.createOscillator();
      const fLfoGain = ctx.createGain();
      fLfo.frequency.value = 0.13;
      fLfoGain.gain.value = 220;
      fLfo.connect(fLfoGain).connect(bp.frequency);
      fLfo.start();

      this.windGust = { src: noise, gain: g };
    }

    // ----- slide hiss (manually driven gain) -----
    {
      const noise = this._whiteNoise(8);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 1.0;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      noise.connect(bp).connect(g).connect(masterFilter);
      this.slideGain = g;
    }

    // ----- chime pad (detuned sines, slow) -----
    {
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.connect(masterFilter);

      const freqs = [220, 277.18, 329.63, 440, 554.37];
      for (const f of freqs) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = 0.08;
        // very slow detune wobble
        const det = ctx.createOscillator();
        const detG = ctx.createGain();
        det.frequency.value = 0.07 + Math.random() * 0.05;
        detG.gain.value = 4;
        det.connect(detG).connect(o.detune);
        det.start();
        o.connect(og).connect(g);
        o.start();
      }
      this.chimeGain = g;
    }

    // ----- distant drone (low warm pad) -----
    {
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.connect(masterFilter);

      const freqs = [55, 82.41, 110];
      for (const f of freqs) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = 0.16;
        o.connect(og).connect(g);
        o.start();
      }
      this.droneGain = g;
    }

    // open up master & filter — fast: we want the soundscape audible
    // immediately, not 6 seconds later.
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.85, now + 0.8);
    masterFilter.frequency.setValueAtTime(2400, now);
    masterFilter.frequency.exponentialRampToValueAtTime(8000, now + 1.2);

    // wind base swell up — quieter overall ambient bed
    this.windBase.gain.gain.setValueAtTime(0, now);
    this.windBase.gain.gain.linearRampToValueAtTime(0.07, now + 1.2);

    // ----- music: started muted at page load; unmute + fade in now -----
    this._unmuteMusic();
  }

  /* short, single-trigger sounds */
  playFootstep(intensity = 0.5, sprintBlend = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const noise = this._burst(0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400 + sprintBlend * 1200;
    lp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 250;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.gain.setValueAtTime(0.0, now);
    g.gain.linearRampToValueAtTime(0.10 * intensity * (0.6 + sprintBlend * 0.6), now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.connect(hp).connect(lp).connect(g).connect(this.masterFilter);
  }

  playLanding(impactSpeed) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const v = Math.min(1, impactSpeed / 12);
    // a low thump
    {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 110;
      o.frequency.exponentialRampToValueAtTime(50, now + 0.3);
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.18 * v, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      o.connect(g).connect(this.masterFilter);
      o.start(now);
      o.stop(now + 0.45);
    }
    // a sand puff (noise burst)
    {
      const n = this._burst(0.35);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.16 * v, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      n.connect(lp).connect(g).connect(this.masterFilter);
    }
  }

  /* -----------------------------------------------------------
   * Ruin chime: a short, bell-like tone played when a ruin's
   * resonance crosses the awakening threshold. The seed picks a
   * note from a pentatonic-ish scale so the chord built up by
   * many ruins waking sounds intentional rather than random.
   * --------------------------------------------------------- */
  playRuinChime(seed = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // A minor pentatonic, two octaves
    const scale = [
      220.00, 261.63, 293.66, 329.63, 392.00,
      440.00, 523.25, 587.33, 659.25, 783.99,
    ];
    const f = scale[Math.abs(seed) % scale.length];

    // fundamental
    {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.22, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 3.4);
      o.connect(g).connect(this.masterFilter);
      o.start(now);
      o.stop(now + 3.6);
    }
    // octave overtone
    {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * 2;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.10, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 2.6);
      o.connect(g).connect(this.masterFilter);
      o.start(now);
      o.stop(now + 2.8);
    }
    // perfect fifth shimmer
    {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * 1.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.06, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, now + 2.0);
      o.connect(g).connect(this.masterFilter);
      o.start(now);
      o.stop(now + 2.2);
    }
  }

  /* per-frame parameter updates from main */
  update(dt, t, opts) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // wind responds to player speed (opts.speed) and time-of-day LFO.
    // Quieter overall — was a fairly loud bed; now a soft background.
    const speed = opts.speed || 0;
    const targetWind = 0.05 + Math.min(1, speed / 9) * 0.07 + (opts.gustExtra || 0);
    if (this.windBase?.gain) {
      this.windBase.gain.gain.setTargetAtTime(targetWind, now, 0.4);
    }
    if (this.windGust?.gain) {
      // gust LFO is already handled inside; keep base near 0.07.
    }

    // slide hiss
    const slideAmt = opts.sliding ? Math.min(1, speed / 9) * 0.5 : 0;
    if (this.slideGain) {
      this.slideGain.gain.setTargetAtTime(slideAmt, now, 0.05);
    }

    // chime + drone proximity
    const prox = opts.archProximity || 0;
    if (this.chimeGain) {
      this.chimeGain.gain.setTargetAtTime(prox * 0.18, now, 1.5);
    }
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0.05 + prox * 0.18, now, 1.5);
    }
  }

  /* call at the ending fade to dim the world */
  fadeOut(seconds = 4) {
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(0.0, now, seconds * 0.5);
    }
    if (this.music) {
      const startVol = this.music.volume;
      const t0 = performance.now();
      const ms = seconds * 1000;
      const tick = () => {
        if (!this.music) return;
        const k = Math.min(1, (performance.now() - t0) / ms);
        this.music.volume = startVol * (1 - k);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  /* swell back up after a fadeOut (used for restoration / finale) */
  fadeIn(seconds = 3, target = 0.85, musicTarget = 0.55) {
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(target, now, seconds * 0.5);
    }
    if (this.music) {
      const startVol = this.music.volume;
      const t0 = performance.now();
      const ms = seconds * 1000;
      const tick = () => {
        if (!this.music) return;
        const k = Math.min(1, (performance.now() - t0) / ms);
        this.music.volume = startVol + (musicTarget - startVol) * k;
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  /* ----- helpers ----- */

  _whiteNoise(seconds = 4) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  _brownNoise(seconds = 4) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  _burst(seconds = 0.2) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = false;
    src.start();
    return src;
  }
}
