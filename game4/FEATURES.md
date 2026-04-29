# Game4 — Features & Tasks

## Sand & Environment

- [ ] **Fine sand particles**
  - Sand should feel like very fine particles, not coarse grains.
  - As the player walks, leave a visible footprint trail in the sand.
  - Particles should dust up / kick up around the feet on each step.

- [ ] **High-quality desert look**
  - Use a more solid base color for the sand.
  - Add only small color variation/noise on top — subtle, not splotchy.
  - Goal: looks like a polished, high-end desert rather than a noisy texture.

## Tower & Pillars

- [ ] **Mysterious tower (at the arch)**
  - Replace the existing arch location with a tall, higher-detail tower — the tower IS the arch landmark.
  - Make it noticeably taller than anything else in the scene so it reads as the destination from far away.
  - Add accent color(s) that make it feel mysterious / otherworldly.
  - Stairs wrap around the outside of the tower going up.
  - Stairs are arranged so the player has to parkour (gaps, jumps) to reach the top.

- [ ] **Restyled ancient pillars**
  - Keep the smaller pillars but restyle them — currently too plain.
  - Add geometric, ancient-style carvings/engravings on the surfaces (runes, glyphs, banded patterns).
  - As the player walks near a pillar, its engravings light up (glow on).
  - On activation, light particles drift off the pillar and stream toward the tower in the distance, visually linking pillar → tower.
  - Light should fade back down once the player moves away.

- [ ] **Blooming flowers near the tower**
  - As the player gets close to the tower, flowers bloom where the player walks.
  - Flowers use vibrant, saturated colors.
  - Bloom should be animated (pop in / scale up), not instant.

- [ ] **Cinematic moment at the tower**
  - When the player gets close to the tower, trigger a cinematic mode.
  - Camera takes over: pans/tilts up the tower toward the top (slow, dramatic).
  - Player input is locked during the cinematic; smooth ease-in / ease-out back to gameplay.
  - Display a mysterious on-screen message during/after the pan, e.g. "The top speaks to you..." (typewriter or fade-in).
  - Should only fire once per approach (don't re-trigger every frame the player is in range).

## Player Animation

- [ ] **Walk cycle**
  - Legs animate with a clear, readable walk cycle while moving.

- [ ] **Jump animation**
  - On jump: legs tuck upward.
  - Upper torso + head do a small jump-y motion (compress/lift).
  - On descent: legs extend back out for landing.

- [ ] **Double jump (bonus)**
  - Second jump tucks legs and performs a front flip.
  - Double jump goes ~1.5× higher than the base jump.

## Lamp & Lore

- [ ] **Spawn lamp** (similar to the lamp in `game2`)
  - Place a lamp near the player spawn point.
  - When the player approaches it, surface some lore text.
  - The lore should mysteriously hint at / point the player toward the tower.

## Performance

- [ ] **Optimization pass**
  - After features are in, do a full pass over the code to optimize performance.
  - Keep visual quality very high — no obvious downgrades to materials, lighting, or particle density.
  - Look for: unnecessary per-frame allocations, redundant draw calls, geometry/texture reuse, instancing for repeated meshes (pillars, flowers, sand particles), LOD or distance culling for the tower/stairs, throttling effects when off-screen.
  - Profile before and after to confirm real gains.
