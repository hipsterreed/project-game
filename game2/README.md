# Echoes

A short, atmospheric first-person walk at golden hour. The music builds in
layers as you move toward a single distant lantern. When you arrive, it
swells.

The aim is feeling, not features.

## Run

It's a static site — no build, no install. Three.js is pulled from a CDN via
an import map. You just need to serve the folder over HTTP (browsers won't
run ES modules from `file://`).

From this folder, any of these works:

```
npx serve .
# or
python -m http.server 8000
# or
npx http-server -p 8000 .
```

Then open the printed URL and click **Begin**. (Pointer lock + audio both
require a click, so the title screen exists for a reason.)

## Controls

- `W A S D` — walk
- `Mouse` — look
- `Shift` — slow walk

## Replacing the placeholder sounds

The placeholder WAVs are procedurally generated and intentionally minimal.
Drop higher-quality files into `assets/sounds/` using the **same filenames**
and the game picks them up automatically — no code changes.

Expected files (replace any or all):

| File | What it is | Notes |
|---|---|---|
| `ambience_loop.wav` | Wind + birds bed | Loops continuously. Aim for ~10–20s seamless loop. |
| `music_pad_loop.wav` | Low drone | Fades in when the player is moving. Loops. Key of A minor recommended. |
| `music_strings_loop.wav` | Mid sustained pad | Fades in past ~25% of the journey. Loops. Should sit harmonically over the pad. |
| `music_melody_loop.wav` | Emotional motif | Fades in past ~55%. Loops. Sparse plucked / piano works well. |
| `music_swell.wav` | One-shot swell | Plays on arrival at the lantern. ~6–10s. Builds and resolves. |
| `footstep_01.wav` … `footstep_05.wav` | Footsteps on grass | Picked at random per step with a small pitch variation. Keep them ≤0.5s each. |

If you want to regenerate the placeholders after editing the synthesis
script, run:

```
node scripts/generate-sounds.js
```

## Structure

```
game2/
├── index.html              entry, import map, overlays
├── src/
│   ├── main.js             game loop + post-processing + state
│   ├── scene.js            world (sky, ground, lights, lantern, path stones, birds, god rays)
│   ├── grass.js            instanced grass blades with shader wind
│   ├── trees.js            low-poly trees with foliage sway shader
│   ├── particles.js        fireflies + dust motes
│   ├── player.js           first-person controller + cinematic ending lock-on
│   ├── audio.js            adaptive layered audio engine
│   └── shaders.js          shared GLSL (wind, sky tint, post)
├── assets/sounds/          placeholder WAVs (replace freely)
└── scripts/
    └── generate-sounds.js  regenerates placeholder WAVs
```

## What's hooked up to feeling

- **Music reacts to movement.** The `pad` layer fades in when you've been
  moving for ~1.4s and fades back out when you stop. Standing still feels
  quieter on purpose.
- **Music reacts to progress.** Strings layer in around the middle of the
  walk. The melody layer doesn't appear until the final stretch.
- **Footsteps** are sample-randomised with pitch variation — never identical
  twice in a row.
- **Grass parts at your feet** (the shader pushes blades away from the
  player position).
- **Wind, sun rim light, fireflies, dust motes catching the light, distant
  birds** — all running on the menu too, so the world feels alive before
  you press a key.
- **Arrival is cinematic.** Player control is taken away, the camera glides
  to the lantern, the music swells, the screen fades.
