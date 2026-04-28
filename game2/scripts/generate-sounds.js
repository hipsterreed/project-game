/*
 * Generates placeholder WAV files into ../assets/sounds/.
 * Run once with: node scripts/generate-sounds.js
 *
 * Replace any of the produced WAVs with high-quality versions of the same
 * filename and the game will pick them up automatically — no code changes.
 */

const fs = require("fs");
const path = require("path");

const SR = 44100;
const OUT_DIR = path.join(__dirname, "..", "assets", "sounds");
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- WAV writer (16-bit mono PCM) ----
function writeWav(samples, filename) {
  const numSamples = samples.length;
  const byteRate = SR * 2;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  const out = path.join(OUT_DIR, filename);
  fs.writeFileSync(out, buf);
  console.log("wrote", filename, `(${(dataSize / 1024).toFixed(0)} KB)`);
}

// ---- helpers ----
function rand(a, b) { return a + Math.random() * (b - a); }

function lowpass(x, cutoff) {
  const out = new Float32Array(x.length);
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < x.length; i++) {
    prev = prev + a * (x[i] - prev);
    out[i] = prev;
  }
  return out;
}

function highpass(x, cutoff) {
  const out = new Float32Array(x.length);
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = rc / (rc + dt);
  let prevX = 0, prevY = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (prevY + x[i] - prevX);
    out[i] = y;
    prevX = x[i];
    prevY = y;
  }
  return out;
}

function fadeEnds(samples, fadeIn, fadeOut) {
  const fi = Math.floor(fadeIn * SR);
  const fo = Math.floor(fadeOut * SR);
  for (let i = 0; i < fi; i++) samples[i] *= i / fi;
  for (let i = 0; i < fo; i++) {
    const idx = samples.length - 1 - i;
    samples[idx] *= i / fo;
  }
  return samples;
}

// crossfade a one-shot tail back into its head so a loop is seamless
function loopify(samples, xfade) {
  const n = Math.floor(xfade * SR);
  const len = samples.length;
  const out = new Float32Array(len);
  out.set(samples);
  for (let i = 0; i < n; i++) {
    const a = i / n; // 0..1 ramp at start
    out[i] = samples[i] * a + samples[len - n + i] * (1 - a);
  }
  // truncate the tail we just folded in
  return out.subarray(0, len - n);
}

function noise(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
  return out;
}

// ---- ambience: wind + birds ----
function makeAmbience() {
  const sec = 12;
  const N = sec * SR;
  // base wind = lowpass noise modulated by slow LFO
  const wind1 = lowpass(noise(N), 600);
  const wind2 = lowpass(noise(N), 200);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const lfo = 0.7 + Math.sin(t * 0.18) * 0.25 + Math.sin(t * 0.07) * 0.2;
    out[i] = wind1[i] * 0.55 * lfo + wind2[i] * 0.35 * lfo;
  }

  // sprinkle bird chirps
  const numBirds = 18;
  for (let b = 0; b < numBirds; b++) {
    const start = Math.floor(rand(0.5, sec - 1.0) * SR);
    const dur = Math.floor(rand(0.06, 0.18) * SR);
    const baseFreq = rand(1800, 3400);
    const sweep = rand(-400, 600);
    const amp = rand(0.05, 0.13);
    for (let i = 0; i < dur; i++) {
      const env = Math.sin((i / dur) * Math.PI);
      const f = baseFreq + sweep * (i / dur);
      const s = Math.sin((2 * Math.PI * f * i) / SR) * env * amp;
      const idx = start + i;
      if (idx < N) out[idx] += s;
    }
  }

  // distant bird call cluster
  for (let b = 0; b < 4; b++) {
    const start = Math.floor(rand(1, sec - 2) * SR);
    const dur = Math.floor(rand(0.18, 0.32) * SR);
    const freq = rand(700, 1100);
    for (let i = 0; i < dur; i++) {
      const env = Math.sin((i / dur) * Math.PI);
      const wob = 1 + Math.sin((i / SR) * 18) * 0.04;
      const s = Math.sin((2 * Math.PI * freq * wob * i) / SR) * env * 0.06;
      const idx = start + i;
      if (idx < N) out[idx] += s;
    }
  }

  const looped = loopify(out, 1.0);
  return looped;
}

// ---- pad: low drone in A minor ----
function makePad() {
  const sec = 16;
  const N = sec * SR;
  const out = new Float32Array(N);

  // root (A1=55), fifth (E2=82.4), octave (A2=110)
  const freqs = [55, 82.41, 110, 164.81];
  const amps = [0.32, 0.18, 0.13, 0.07];

  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      // detuned dual oscillators per partial for thickness
      const det = 1.005;
      s += Math.sin(2 * Math.PI * freqs[k] * t) * amps[k] * 0.6;
      s += Math.sin(2 * Math.PI * freqs[k] * det * t) * amps[k] * 0.4;
    }
    // slow LFO swell
    const swell = 0.65 + Math.sin(t * 0.39) * 0.18 + Math.sin(t * 0.11) * 0.18;
    out[i] = s * swell * 0.6;
  }

  // gentle highpass to keep it from rumbling too low
  const hp = highpass(out, 35);
  return loopify(hp, 1.5);
}

// ---- strings: sustained mid pad ----
function makeStrings() {
  const sec = 16;
  const N = sec * SR;
  const out = new Float32Array(N);

  // chord: A3, C4, E4, G4 (Am7) — bittersweet
  const freqs = [220, 261.63, 329.63, 392.0];

  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      // gentle saw via summed sines (3 partials)
      const f = freqs[k];
      s +=
        Math.sin(2 * Math.PI * f * t) * 0.18 +
        Math.sin(2 * Math.PI * f * 1.0036 * t) * 0.12 +
        Math.sin(2 * Math.PI * f * 2 * t) * 0.05 +
        Math.sin(2 * Math.PI * f * 3 * t) * 0.025;
    }
    // breathing
    const breath = 0.55 + Math.sin(t * 0.27) * 0.22 + Math.sin(t * 0.09) * 0.18;
    // slight tremolo
    const trem = 1 + Math.sin(t * 4.6) * 0.04;
    out[i] = s * breath * trem * 0.18;
  }

  // soft lowpass — strings shouldn't be harsh
  const lp = lowpass(out, 2200);
  return loopify(lp, 1.5);
}

// ---- melody: bell pluck motif ----
function makeMelody() {
  const sec = 16;
  const N = sec * SR;
  const out = new Float32Array(N);

  // motif notes (Hz) and start times (sec)
  // A minor pentatonic: A4, C5, E5, D5, A4, G4
  const notes = [
    { f: 440.0, t: 0.0,  v: 0.55 },
    { f: 523.25, t: 1.6, v: 0.5  },
    { f: 659.25, t: 3.2, v: 0.55 },
    { f: 587.33, t: 5.0, v: 0.45 },
    { f: 440.0, t: 6.6,  v: 0.5  },
    { f: 392.0, t: 8.4,  v: 0.4  },
    { f: 523.25, t: 10.0, v: 0.45 },
    { f: 659.25, t: 11.8, v: 0.5  },
    { f: 587.33, t: 13.4, v: 0.4  },
    { f: 440.0, t: 14.8, v: 0.35 },
  ];

  function pluck(freq, startSec, vel) {
    const start = Math.floor(startSec * SR);
    const dur = Math.floor(2.4 * SR);
    for (let i = 0; i < dur; i++) {
      const t = i / SR;
      // exp decay envelope, longer for low notes
      const env = Math.exp(-t * 1.6) * vel;
      // bell-like: fundamental + slightly inharmonic 2nd + 3rd
      const s =
        Math.sin(2 * Math.PI * freq * t) * 1.0 +
        Math.sin(2 * Math.PI * freq * 2.01 * t) * 0.45 * Math.exp(-t * 3.0) +
        Math.sin(2 * Math.PI * freq * 3.02 * t) * 0.15 * Math.exp(-t * 4.5);
      const idx = start + i;
      if (idx < N) out[idx] += s * env * 0.18;
    }
  }

  for (const n of notes) pluck(n.f, n.t, n.v);

  return loopify(out, 1.0);
}

// ---- swell: builds + resolves (one-shot, no loop) ----
function makeSwell() {
  const sec = 8;
  const N = sec * SR;
  const out = new Float32Array(N);

  // Open chord: A2, E3, A3, C#4 (A major-ish — resolves bittersweet)
  const freqs = [110, 164.81, 220, 277.18, 329.63];

  for (let i = 0; i < N; i++) {
    const t = i / SR;
    // attack 3.5s, sustain to 6s, release to end
    let env;
    if (t < 3.5) env = Math.pow(t / 3.5, 1.4);
    else if (t < 6) env = 1;
    else env = Math.max(0, 1 - (t - 6) / 2);

    let s = 0;
    for (const f of freqs) {
      s +=
        Math.sin(2 * Math.PI * f * t) * 0.15 +
        Math.sin(2 * Math.PI * f * 1.005 * t) * 0.1 +
        Math.sin(2 * Math.PI * f * 2 * t) * 0.04;
    }
    // shimmer high partial that arrives near peak
    const shim = Math.sin(2 * Math.PI * 880 * t) * 0.05 * Math.max(0, t - 2) / 4;
    out[i] = (s + shim) * env * 0.45;
  }

  return fadeEnds(out, 0.05, 1.5);
}

// ---- footsteps: short noise burst + thump ----
function makeFootstep(seed) {
  const dur = 0.42;
  const N = Math.floor(dur * SR);
  const out = new Float32Array(N);

  // low thump: short sine burst around 80-110Hz
  const thumpFreq = 80 + (seed * 9) % 35;
  const thumpDur = 0.08;
  for (let i = 0; i < thumpDur * SR; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 28);
    out[i] += Math.sin(2 * Math.PI * thumpFreq * t) * env * 0.6;
  }

  // crispy grass/leaf top: filtered noise burst
  const crispyN = Math.floor(0.22 * SR);
  const n = noise(crispyN);
  const filtered = highpass(lowpass(n, 4500 + (seed * 320) % 1500), 1200);
  for (let i = 0; i < crispyN; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 14) * (1 - Math.exp(-t * 200));
    out[i] += filtered[i] * env * 0.35;
  }

  return out;
}

// ---- main ----
console.log("generating placeholder sounds into", OUT_DIR);

writeWav(makeAmbience(), "ambience_loop.wav");
writeWav(makePad(), "music_pad_loop.wav");
writeWav(makeStrings(), "music_strings_loop.wav");
writeWav(makeMelody(), "music_melody_loop.wav");
writeWav(makeSwell(), "music_swell.wav");

for (let i = 1; i <= 5; i++) {
  writeWav(makeFootstep(i * 17), `footstep_0${i}.wav`);
}

console.log("done.");
