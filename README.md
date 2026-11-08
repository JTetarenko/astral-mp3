# Astral Resonance

A music-driven 3D astral action-RPG for the browser. Drop in your own tracks — the game
streams an **endless** floating-island realm from each track's audio fingerprint, and the
world reacts live: **bass** displaces the islands, **mids** drive the rune glow and bloom,
**highs** spray particle bursts. Resonance Points spawn forever; collecting them charges the
**REALM SHIFT**. Snap the gate it summons to descend one realm deeper — six realms cycle with
escalating intensity (Astral Realm → Tribal Jungle Sanctuary → Void Cathedral → Ancient Ritual
Grounds → Collapsing Realm → Lava Core).

**The deep hunts back.** Each realm breeds its own horror swarm — Husk Pilgrims, Vine
Striders, Rood Shrikes, Effigy Puppets, Carrion Worms, Cinder Wisps — whose pressure follows
the music (CALM realms only lurk; a SHATTER drop launches a coordinated leap wave). Horrors
leap onto you and **latch**: each rider slows you and drags you down, and when the riders
exceed your Latch Ward you are **dragged from the sky** and the run ends. Fight back with the
snap itself (aim a horror and strike THROUGH it — precision and on-beat timing scale the
damage), the **Astral Crystal Bow** — a levitating crystal recurve that materializes when you
draw (RMB): tap for a quick shot, hold for a piercing power draw, keep holding past full for
an **Overdraw Volley** (the arrow splits into a 3-shot fan), and land consecutive on-beat
releases to arm the **Resonance Storm** (the next full draw bursts into five homing shards).
Consecutive arrow hits build the **bow combo** — the weapon visibly ignites, the release
sounds layer up, and tier 3 also banks a storm. Finally the **Banish Nova** (E) spends gate
charge to shed everything latched. Every gate is guarded by a per-realm **Warden** mini-boss:
telegraphed attacks, an EXPOSED relic-heart weak point, and a kill rite that visibly unlocks
the gate.

Between runs, **The Sanctum** hub holds the RPG spine: Elara the Lorekeeper's shop, Korr the
Broken Warden's quest chains and daily bounty, Vess's attunement mirror (XP, levels, four
attributes), and the reliquary (3 relic sockets + 2 consumable rite slots used in-run on
keys 1/2). Kills pay **Resonance Shards**; wardens drop relics and trophies; everything
persists (`astral.rpg.v1`). Best depth still persists per track and overall.

Built per [PRD.md](PRD.md) — frontend MVP scope (Laravel/Docker/Playwright deferred).

## Quickstart

```bash
npm install
npm run dev
```

1. Drop `.mp3` / `.ogg` / `.wav` files into `public/tracks/` (they're gitignored — personal
   files never get committed). Click **RESCAN** in the app if it's already running.
2. Pick a track. It's decoded and pre-analyzed (energy profile, BPM, procedural seed).
3. Click to begin — pointer lock engages, audio starts.

## How to play

| Input | Action |
| --- | --- |
| Mouse | Look / flick — aim at a Resonance Point, a horror, the Warden's open heart, or the Gate |
| LMB | Astral Snap: streak to a point — or strike THROUGH an aimed horror |
| RMB | Crystal Bow — tap: quick shot · hold: power draw (pierces at full) · hold past full: 3-arrow volley · on-beat releases arm the Resonance Storm |
| E | Banish Nova — spends 2 gate charge, sheds every latched horror + AoE damage |
| 1 / 2 | Consume the equipped rite in that loadout slot (set in the Sanctum reliquary) |
| WASD | Drift |
| Space / Shift | Rise / sink |
| W W (hold) | Sprint |
| V | Toggle third-person / first-person camera |
| Esc | Pause (also releases pointer lock) |

Scoring: precision tiers (PERFECT ≤1.5°, GOOD ≤4°), distance bonus, ×1.25 for snapping
within 90 ms of a detected beat. Chained snaps (≤8 s apart) grow the multiplier +0.2 each,
so a 7-chain reads x2.4. Each descent pays a Realm Shift bonus that scales with depth —
half again more if you dive during a PEAK/SHATTER surge.

The default camera is third person, behind your **astral wraith** (procedurally built, tinted
by the current realm). Want a bespoke character? Drop any glTF binary at
`public/assets/player.glb` — it's auto-scaled, its first animation clip plays as the idle,
and the wraith steps aside.

## URL parameters

- `?debug` — tuning overlay: band meters, spectral-flux sparkline vs onset threshold, BPM, seed, FPS.
- `?seed=1234` — override the procedural seed (repro/tuning; same track otherwise always
  generates the same world).
- `?depth=4` — start the run that many realms deep (e.g. straight into the Collapsing Realm).

## Scripts

- `npm run dev` — dev server (tracks manifest served live; rescan picks up new files)
- `npm run build` — typecheck + production build (`dist/`, manifest emitted statically)
- `npm run preview` — serve the production build
- `npm run test` — vitest unit suite (DSP, BPM, seeded layout, scoring, aim assist — all synthetic data)
- `npm run bake` — regenerate the texture assets in `public/assets/` (see below)
- `npm run bake:sfx` — regenerate the tribal sample kit in `public/assets/sfx/`

## Assets

Textures in `public/assets/` are **baked locally** by [scripts/bakeAssets.mjs](scripts/bakeAssets.mjs)
(dependency-free noise generators + a minimal PNG encoder — no downloads, no licensing):

| File | Used for |
| --- | --- |
| `mist.png` / `nebula_b.png` | two structurally distinct equirect nebula shells (rolling banks low, ridged filaments high), counter-rotating, tinted per theme |
| `stars.png` | equirect deep star field — three PSF classes, per-star color temperature, inclined galactic band |
| `rock_normal.png` / `rock_albedo.png` | co-registered tileable relief + cavity-darkened mineral albedo for the islands |
| `runes.png` | 12-glyph atlas — mandala rune circle + resonance-point markers |
| `rune_emissive.png` | island rune-vein emission mask (blooms as sections ignite) |
| `particle_soft.png` | soft glow sprite (halos, wings, corona base) |
| `particle_atlas.png` | 2x2 burst-sprite vocabulary (glow / spark / ember / wisp) for the particle pool |
| `corona_streaks.png` | eclipse corona ray sheet (two counter-rotating shader taps) |
| `ring_soft.png` | ground-ripple impact annulus |

Swap any of them with your own art (same filenames) or tweak the bake parameters and re-run
`npm run bake`.

**Sound design is a tribal/ritual sample kit** synthesized offline at 44.1 kHz by
[scripts/bakeSfx.mjs](scripts/bakeSfx.mjs) (layered frame/log drums, bone clicks, seed rattles,
detuned inharmonic gongs, formant-swept breath whooshes, a didgeridoo drop-stinger, a seamless
throat-chant menu loop, and a generated **stereo** cavern impulse response). Every sample runs a
mastering chain (DC block → glue compression → soft limiter; one-shots staged to −3 dBFS, beds to
a shared RMS), and playback adds a bus compressor for stacked-hit glue. Played through runtime
convolution reverb by
[src/audio/sfx.ts](src/audio/sfx.ts) — routed around the analyser so effects never contaminate
the music-reactivity analysis. Swap any WAV in `public/assets/sfx/` to reskin the kit.

## Intensity tiers & the psychedelic stack

Every track is segmented offline ([src/audio/intensity.ts](src/audio/intensity.ts)) into
CALM / RISING / PEAK / SHATTER sections (percentile-normalized energy, hysteresis, an explicit
two-pattern drop detector). The scene scales its detail with the current tier through one
crossfade helper ([src/scene/visualTuning.ts](src/scene/visualTuning.ts)): fog opens, runes
ignite one by one, crystal shards grow from the islands, dust streams feed the mandala while
the song rises, aurora curtains and godray shafts blaze at PEAK, and during SHATTER the
islands tremble and shed orbiting debris while the trip engages.

Every drop rolls one of four **peak styles** so consecutive climaxes feel different:
KALEIDO (the mandala fold), TUNNEL (heavy radial warp + long echo trails), STROBE
(beat-locked sky pulses — never under reduced motion), and FRACTAL (high-fold slow drift).
All folding is edge-masked: a clear **aim tunnel** at screen center keeps the crosshair,
targets, and flight path readable at full trip.

The DMT layer is two custom `postprocessing` passes: HDR afterimage tracers
([EchoPass](src/scene/EchoPass.ts)) and a warp/kaleidoscope/hue-drift/shimmer shader
([PsychedelicEffect](src/scene/PsychedelicEffect.ts)). The **VISUALS** slider scales the whole
stack — and doubles as the difficulty dial: it is labeled with immersion tiers
(SERENE / IMMERSIVE / INTENSE / **HARD** at 80–90% / **EXTREME** above 90%) and higher
settings also raise horror pressure (swarm budget, attack tokens, speed) via
[src/game/immersion.ts](src/game/immersion.ts). A **REDUCED MOTION** toggle (also on the
pause menu) disables mirroring and caps tracers/flashes for photosensitive players.
Volume is split into **MUSIC** and **SFX** sliders; the SFX default sits low on purpose —
the track leads the mix. An adaptive governor
([perfGovernor](src/scene/perfGovernor.ts)) steps render resolution and effect cost down/up to
hold frame rate.

`?debug` additionally shows the tier timeline, live intensity, SFX kit status and perf level,
plus forcing keys: `Shift+0-3` force a tier, `` ` `` clear, `[`/`]` nudge intensity, `P`
preview the psychedelic stack, `O` preview tracers, `C` fill charge, `B` toggle gate, `M`
force shift, `K` force a leap wave, `L` fell the swarm, `U` spawn/kill the warden, `Y` +1
forced latch (downed testing).

## Architecture notes

- **React Three Fiber** scene; all textures are locally-baked procedural PNGs (no external assets).
- Per-frame audio data flows through a mutable `AudioFrame` singleton
  ([src/audio/reactiveBus.ts](src/audio/reactiveBus.ts)) read directly inside frame loops —
  never through React state. Zustand holds only discrete game state.
- Band split (lows 20–160 Hz / mids 160–2000 / highs 2–12 kHz) derives from the real
  `AudioContext.sampleRate` at runtime; onsets via half-wave-rectified spectral flux with an
  adaptive threshold ([src/audio/analysis.ts](src/audio/analysis.ts)).
- Movement/snap feel lives in [src/scene/snapController.ts](src/scene/snapController.ts)
  (non-React state machine: AIM → FLICK → SNAP → PULL → SHIFT, hover kinematics, third-person
  boom with island occlusion, shockwave).
- The endless world lives in [src/game/worldState.ts](src/game/worldState.ts): deterministic
  chunk streaming ([src/game/chunks.ts](src/game/chunks.ts)) into fixed instanced slot pools
  with serial-guarded recycling, an infinite point spawner, and the Realm Gate.
- Realms: the descent ladder in [src/game/realms.ts](src/game/realms.ts) maps each depth to a
  palette ([src/theme/palettes.ts](src/theme/palettes.ts)) plus numeric mods (fog, densities,
  ember direction, trip bias, horror pressure) applied through the visual-tuning crossfade.
- The horror layer: [src/game/enemyState.ts](src/game/enemyState.ts) is the node-testable
  combat runtime (24-slot swarm SoA pool with serial guards, music-tier spawn director with
  attack tokens, leap ballistics, the 6-anchor latch registry, the warden phase machine, the
  bolt pool). [src/scene/HorrorSwarm.tsx](src/scene/HorrorSwarm.tsx) draws ALL swarm horrors
  as four InstancedMeshes (husk/limb/shred/eye — 4 draw calls) from shared unit parts posed by
  [src/scene/horrorGeom.ts](src/scene/horrorGeom.ts); the warden reuses the same parts at boss
  scale in [src/scene/WardenRig.tsx](src/scene/WardenRig.tsx). Latched horrors compose onto
  the avatar's anchors via the same-frame `avatarFrame` snapshot.
- The RPG spine: [src/game/rpg.ts](src/game/rpg.ts) (xp/levels/attributes/inventory,
  `astral.rpg.v1`, corrupt-safe parse), [src/game/items.ts](src/game/items.ts) (21-item
  catalog + warden loot tables), [src/game/quests.ts](src/game/quests.ts) (chains + daily
  bounty), settled atomically per run by [src/game/rpgRun.ts](src/game/rpgRun.ts) inside
  `endRun`. The Sanctum hub UI lives under [src/ui/hub/](src/ui/hub/). Optional NPC portrait
  art drops in at `public/assets/npc/elara.png` (korr/vess likewise) — the procedural
  composition carries when absent.
- Tracks are decoded fully into memory (~23 MB per stereo minute) for sample-accurate
  timing and offline pre-analysis; the buffer is released when you leave a run.

## Deferred (per PRD, attach points ready)

- Laravel API (profiles/high scores) — `endRun(result)` in `src/game/state.ts` is the seam.
- Playwright E2E — screens carry `data-testid`s; `?seed`/`?depth` make runs deterministic.
- Ethereal Momentum ability (third HUD slot reserved). Realm Shifting shipped as the descent core.
