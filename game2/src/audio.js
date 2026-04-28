/*
 * Adaptive audio engine.
 *
 * Layers (all looping unless noted):
 *   ambience   — base wind + distant birds, always at full
 *   pad        — low drone that fades in with movement
 *   strings    — mid pad that fades in past 33% progress
 *   melody     — emotional motif that fades in past 60% progress
 *   swell      — one-shot at arrival
 *
 * Plus 5 footstep one-shots randomly picked per step.
 *
 * Files are loaded from /assets/sounds/. If a file is missing,
 * we keep going with whatever loaded — placeholder WAVs are shipped.
 */

const SOUND_PATH = "./assets/sounds/";

const FILES = {
  ambience: "ambience_loop.wav",
  pad: "music_pad_loop.wav",
  strings: "music_strings_loop.wav",
  melody: "music_melody_loop.wav",
  swell: "music_swell.wav",
  footsteps: [
    "footstep_01.wav",
    "footstep_02.wav",
    "footstep_03.wav",
    "footstep_04.wav",
    "footstep_05.wav",
  ],
};

export class Audio {
  constructor(camera) {
    this.camera = camera;
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.sources = {}; // currently playing looping sources by name
    this.gains = {};   // per-layer GainNode
    this.ready = false;
    this.progress = 0;
    this.movingTimer = 0; // seconds player has been moving
    this.stillTimer = 0;  // seconds since last movement

    // layer target gains (smoothed every frame)
    this.targets = {
      ambience: 0.65,
      pad: 0.0,
      strings: 0.0,
      melody: 0.0,
    };
  }

  async init() {
    if (this.ready) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // load all buffers in parallel — failures are non-fatal
    const loads = [];
    for (const [name, file] of Object.entries(FILES)) {
      if (Array.isArray(file)) {
        this.buffers[name] = [];
        for (const f of file) {
          loads.push(
            this._loadBuffer(f)
              .then((b) => this.buffers[name].push(b))
              .catch(() => {}),
          );
        }
      } else {
        loads.push(
          this._loadBuffer(file)
            .then((b) => (this.buffers[name] = b))
            .catch(() => (this.buffers[name] = null)),
        );
      }
    }
    await Promise.all(loads);
    this.ready = true;
  }

  async _loadBuffer(file) {
    const res = await fetch(SOUND_PATH + file);
    if (!res.ok) throw new Error("missing: " + file);
    const arr = await res.arrayBuffer();
    return await this.ctx.decodeAudioData(arr);
  }

  startAmbience() {
    if (!this.ready) return;
    this._startLayer("ambience", 0.65);
    this._startLayer("pad", 0.0);
    this._startLayer("strings", 0.0);
    this._startLayer("melody", 0.0);
  }

  _startLayer(name, gainValue) {
    const buf = this.buffers[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gainValue;
    src.connect(g).connect(this.master);
    src.start(0);
    this.sources[name] = src;
    this.gains[name] = g;
  }

  setProgress(p) {
    this.progress = p;
  }

  update(dt, camPos, velocity) {
    if (!this.ready) return;
    const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;

    if (speed > 0.4) {
      this.movingTimer += dt;
      this.stillTimer = 0;
    } else {
      this.stillTimer += dt;
      this.movingTimer = Math.max(0, this.movingTimer - dt * 0.6);
    }

    // adaptive layer targets
    const movingFactor = Math.min(1, this.movingTimer / 1.4);
    const stillFactor = Math.min(1, this.stillTimer / 1.8);

    // pad responds to movement
    this.targets.pad = movingFactor * 0.7 + this.progress * 0.15;
    // strings: enters mid-journey
    this.targets.strings = smoothStep(0.22, 0.7, this.progress) * (0.6 + movingFactor * 0.3);
    // melody: enters late
    this.targets.melody = smoothStep(0.55, 0.95, this.progress) * (0.5 + movingFactor * 0.5);
    // ambience always on but lifts slightly on still moments
    this.targets.ambience = 0.55 + stillFactor * 0.18 + this.progress * 0.1;

    // smooth ramp
    for (const k of Object.keys(this.targets)) {
      const g = this.gains[k];
      if (!g) continue;
      const cur = g.gain.value;
      const target = this.targets[k];
      const next = cur + (target - cur) * Math.min(1, dt * 1.4);
      g.gain.setValueAtTime(next, this.ctx.currentTime);
    }
  }

  footstep(intensity) {
    if (!this.ready) return;
    const arr = this.buffers.footsteps;
    if (!arr || !arr.length) return;
    const buf = arr[Math.floor(Math.random() * arr.length)];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // pitch variation per step
    src.playbackRate.value = 0.92 + Math.random() * 0.18;
    const g = this.ctx.createGain();
    g.gain.value = 0.35 + intensity * 0.25;
    src.connect(g).connect(this.master);
    src.start(0);
  }

  swell() {
    if (!this.ready) return;
    const buf = this.buffers.swell;
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.95, this.ctx.currentTime + 0.4);
      src.connect(g).connect(this.master);
      src.start(0);
    }
    // ramp every layer up briefly
    for (const k of ["pad", "strings", "melody"]) {
      const gNode = this.gains[k];
      if (!gNode) continue;
      const now = this.ctx.currentTime;
      gNode.gain.cancelScheduledValues(now);
      gNode.gain.setValueAtTime(gNode.gain.value, now);
      gNode.gain.linearRampToValueAtTime(0.85, now + 1.5);
    }
  }

  fadeOut(seconds = 4) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.0001, now + seconds);
  }
}

function smoothStep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
