import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  PointsMaterial,
  TextureLoader,
  type BufferAttribute,
  type Points,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { gameTime } from '../game/gameTime'
import { WORLD, worldState, type IslandSlot } from '../game/worldState'
import { ambientRecipeForDepth, ambientStyleForSlot, type AmbientRecipe } from './ambientVocab'
import { BURST, BURST_STYLES, hexToRgb, PK, ROLE_COUNT, styleTint } from './burstVocab'
import { snapController } from './snapController'
import { smoothstep, streamLife, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const COUNT = 3400
const AMBIENT = 400
const KIND_BURST = 0
const KIND_STREAM = 1
const KIND_FALL = 2
/** Ambient drifters wrap in a torus of this XZ span around the player. */
const AMBIENT_WRAP = 130
const AMBIENT_WRAP_Y = 45
/** Bass-onset ember flare ring (indices into the ambient range). */
const FLARES = 8

interface ParticlePool {
  positions: Float32Array
  colors: Float32Array
  velocities: Float32Array
  life: Float32Array
  maxLife: Float32Array
  kind: Uint8Array
  /** Per-particle sprite size multiplier (aSize vertex attribute). */
  sizes: Float32Array
  /** Per-particle atlas cell (aCell vertex attribute, PK.* value). */
  cells: Float32Array
  /** Per-particle burst tint (style role color x bright, written at spawn). */
  tints: Float32Array
  /** Per-particle vertical bias u/s^2 (+sinks, -rises; burst styles only). */
  grav: Float32Array
  ambientBase: Float32Array
  ambientPhase: Float32Array
  /** Per-drifter 0..1 hash: settle rate + ember/ash color mix. */
  ambientHash: Float32Array
  /** Per-drifter realm ambient-style index (re-dealt on epoch). */
  ambientStyle: Uint8Array
  cursor: number
}

function buildPool(): ParticlePool {
  const pool: ParticlePool = {
    positions: new Float32Array(COUNT * 3),
    colors: new Float32Array(COUNT * 3),
    velocities: new Float32Array(COUNT * 3),
    life: new Float32Array(COUNT),
    maxLife: new Float32Array(COUNT),
    kind: new Uint8Array(COUNT),
    sizes: new Float32Array(COUNT).fill(1),
    cells: new Float32Array(COUNT).fill(PK.GLOW),
    tints: new Float32Array(COUNT * 3),
    grav: new Float32Array(COUNT),
    ambientBase: new Float32Array(AMBIENT * 3),
    ambientPhase: new Float32Array(AMBIENT),
    ambientHash: new Float32Array(AMBIENT),
    ambientStyle: new Uint8Array(AMBIENT),
    cursor: AMBIENT,
  }
  for (let i = 0; i < AMBIENT; i++) {
    // Uniform in the wrap volume; per-frame wrapping recenters on the player.
    pool.ambientBase[i * 3] = (Math.random() - 0.5) * AMBIENT_WRAP
    pool.ambientBase[i * 3 + 1] = (Math.random() - 0.5) * AMBIENT_WRAP_Y
    pool.ambientBase[i * 3 + 2] = (Math.random() - 0.5) * AMBIENT_WRAP
    pool.ambientPhase[i] = Math.random() * Math.PI * 2
    pool.ambientHash[i] = Math.random()
    const r = Math.random()
    pool.sizes[i] = 0.55 + 1.0 * r * r // varied ash flakes, mostly small
    // drifters read as irregular ember flakes, not soft glows
    pool.cells[i] = PK.EMBER
  }
  return pool
}

/** Wrap offset v into [-r/2, r/2) — the infinite-starfield torus trick. */
function wrapSpan(v: number, r: number): number {
  return v - Math.floor(v / r + 0.5) * r
}

/** Probe for a random live island slot (a few tries, null when the world is bare). */
function randomLiveIsland(): IslandSlot | null {
  const slots = worldState.slots
  for (let tries = 0; tries < 12; tries++) {
    const s = slots[Math.floor(Math.random() * WORLD.TOTAL_SLOTS)]
    if (s.used) return s
  }
  return null
}

/** 3400-slot pool: player-following ambient drifters, onset/cymbal bursts,
 * snap bursts, gate-bound dust streams, and stardust falls that RISE as
 * embers in Lava Core (visuals.fallDir). */
export function Particles({ palette }: { palette: Palette }) {
  const points = useRef<Points>(null)
  const pool = useMemo(buildPool, [])
  const burstColor = useMemo(() => new Color(palette.particle), [palette])
  const streamColor = useMemo(() => new Color(palette.rune), [palette])
  const prevHighs = useRef(0)
  const streamAcc = useRef(0)
  const fallAcc = useRef(0)
  const lastNova = useRef(visuals.novaCount)
  const lastEpoch = useRef(-1)
  const spawnDirty = useRef(false)
  const recipeRef = useRef<AmbientRecipe>(ambientRecipeForDepth(0))
  // roleA/roleB rgb pairs per ambient style — rebuilt on palette AND epoch
  // (the recipe can change without a React commit and vice versa)
  const ambientTints = useMemo(
    () => ({ a: new Float32Array(4 * 3), b: new Float32Array(4 * 3), dirty: true }),
    [],
  )
  useEffect(() => {
    ambientTints.dirty = true
  }, [palette, ambientTints])
  const flares = useRef({
    idx: new Int16Array(FLARES).fill(-1),
    age: new Float32Array(FLARES),
    bright: new Float32Array(FLARES),
    cursor: 0,
  })
  const atlasTex = useLoader(TextureLoader, '/assets/particle_atlas.png')

  // Per-palette spawn tints, one rgb per BURST style (role color x whiteMix x
  // bright, resolved once per realm — color-writes-only swap law).
  const styleTints = useMemo(() => {
    const roles = new Float32Array(ROLE_COUNT * 3)
    hexToRgb(palette.particle, roles, 0)
    hexToRgb(palette.rune, roles, 3)
    hexToRgb(palette.horrorEye, roles, 6)
    hexToRgb(palette.wardenAccent, roles, 9)
    hexToRgb(palette.primary, roles, 12)
    roles.set([1, 1, 1], 15)
    const arr = new Float32Array(BURST_STYLES.length * 3)
    for (let k = 0; k < BURST_STYLES.length; k++) styleTint(BURST_STYLES[k], roles, arr, k * 3)
    return arr
  }, [palette])

  // Per-particle size via a tiny injector on the stock PointsMaterial (the
  // full plumbing — map/sizeAttenuation/vertexColors — stays three's).
  // fog:false — the additive+linear-fog combo ADDS fog color instead of
  // occluding; the CPU distance fade below does the occlusion correctly.
  const material = useMemo(() => {
    const m = new PointsMaterial({
      map: atlasTex,
      size: 0.32,
      sizeAttenuation: true,
      vertexColors: true,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      fog: false,
    })
    m.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace(
          'uniform float size;',
          'uniform float size;\nattribute float aSize;\nattribute float aCell;\nvarying vec2 vCellOff;',
        )
        .replace(
          'gl_PointSize = size;',
          'gl_PointSize = size * aSize;\n\tvCellOff = vec2(mod(aCell, 2.0), floor(aCell * 0.5 + 0.01)) * 0.5;',
        )
      // Atlas cell select: replace the stock sprite sample with a quarter-UV
      // tap offset by the per-particle cell (uvTransform unused on this map).
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying vec2 vCellOff;\nvoid main() {')
        .replace(
          '#include <map_particle_fragment>',
          'vec2 pUv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * 0.5 + vCellOff;\n\tdiffuseColor *= texture2D(map, pUv);',
        )
    }
    m.customProgramCacheKey = () => 'ashSize2atlas1'
    return m
  }, [atlasTex])
  useEffect(() => {
    return () => material.dispose()
  }, [material])

  const spawnBurst = (x: number, y: number, z: number, count: number, style = BURST.GENERIC as number) => {
    const p = pool
    const s = BURST_STYLES[style] ?? BURST_STYLES[BURST.GENERIC]
    const tr = styleTints[style * 3]
    const tg = styleTints[style * 3 + 1]
    const tb = styleTints[style * 3 + 2]
    let spawned = 0
    let scanned = 0
    const poolSize = COUNT - AMBIENT
    while (spawned < count && scanned < poolSize) {
      const i = p.cursor
      p.cursor = p.cursor + 1 >= COUNT ? AMBIENT : p.cursor + 1
      scanned++
      if (p.life[i] > 0) continue
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speed = s.speedMin + Math.random() * s.speedVar
      p.positions[i * 3] = x + (Math.random() - 0.5) * 2
      p.positions[i * 3 + 1] = y + (Math.random() - 0.5) * 2
      p.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 2
      p.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed
      p.velocities[i * 3 + 1] = Math.cos(phi) * speed
      p.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed
      p.maxLife[i] = s.lifeMin + Math.random() * s.lifeVar
      p.life[i] = p.maxLife[i]
      p.kind[i] = KIND_BURST
      p.sizes[i] = s.sizeMin + Math.random() * s.sizeVar
      p.cells[i] = s.cell
      p.grav[i] = s.grav
      p.tints[i * 3] = tr
      p.tints[i * 3 + 1] = tg
      p.tints[i * 3 + 2] = tb
      spawned++
    }
    if (spawned > 0) spawnDirty.current = true
  }

  /** Stardust pouring off a live island rim — or rising off it in Lava Core. */
  const spawnFalls = (count: number) => {
    const p = pool
    const dir = visuals.fallDir
    let spawned = 0
    let scanned = 0
    const poolSize = COUNT - AMBIENT
    while (spawned < count && scanned < poolSize) {
      const i = p.cursor
      p.cursor = p.cursor + 1 >= COUNT ? AMBIENT : p.cursor + 1
      scanned++
      if (p.life[i] > 0) continue
      const isl = randomLiveIsland()
      if (!isl) return
      const a = Math.random() * Math.PI * 2
      const out = 0.4 + Math.random() * 0.8
      p.positions[i * 3] = isl.x + Math.cos(a) * isl.scale * 0.95
      p.positions[i * 3 + 1] = isl.y - isl.scale * 0.2 * dir
      p.positions[i * 3 + 2] = isl.z + Math.sin(a) * isl.scale * 0.95
      p.velocities[i * 3] = Math.cos(a) * out
      p.velocities[i * 3 + 1] = dir * (-1.5 - Math.random() * 1.5)
      p.velocities[i * 3 + 2] = Math.sin(a) * out
      p.maxLife[i] = 2.5 + Math.random() * 1.5
      p.life[i] = p.maxLife[i]
      p.kind[i] = KIND_FALL
      p.sizes[i] = 0.6 + Math.random() * 0.7
      p.cells[i] = recipeRef.current.fallCell
      p.grav[i] = 0
      spawned++
    }
    if (spawned > 0) spawnDirty.current = true
  }

  /** Dust streams converging on a target (the gate, or the pre-drop focus). */
  const spawnStream = (count: number, tx0: number, ty0: number, tz0: number, speedMult = 1) => {
    const p = pool
    let spawned = 0
    let scanned = 0
    const poolSize = COUNT - AMBIENT
    while (spawned < count && scanned < poolSize) {
      const i = p.cursor
      p.cursor = p.cursor + 1 >= COUNT ? AMBIENT : p.cursor + 1
      scanned++
      if (p.life[i] > 0) continue
      const isl = randomLiveIsland()
      if (!isl) return
      const ox = isl.x + (Math.random() - 0.5) * isl.scale
      const oy = isl.y + isl.scale * 0.9
      const oz = isl.z + (Math.random() - 0.5) * isl.scale
      let dx = tx0 - ox
      let dy = ty0 - oy
      let dz = tz0 - oz
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4
      dx /= dist
      dy /= dist
      dz /= dist
      // tangential swirl (cross with up) + slight lift
      const tl = Math.hypot(dz, dx) + 1e-4
      const tx = dz / tl
      const tz = -dx / tl
      const speed = (5 + Math.random() * 4) * speedMult
      p.positions[i * 3] = ox
      p.positions[i * 3 + 1] = oy
      p.positions[i * 3 + 2] = oz
      p.velocities[i * 3] = (dx + tx * 0.2) * speed
      p.velocities[i * 3 + 1] = (dy + 0.1) * speed
      p.velocities[i * 3 + 2] = (dz + tz * 0.2) * speed
      p.maxLife[i] = streamLife(dist, speed)
      p.life[i] = p.maxLife[i]
      p.kind[i] = KIND_STREAM
      p.sizes[i] = 0.85
      p.cells[i] = PK.GLOW
      p.grav[i] = 0
      spawned++
    }
    if (spawned > 0) spawnDirty.current = true
  }

  useFrame(({ clock }, rawDt) => {
    // world-scaled: a kill-stop freezes the strike burst as a hanging
    // starburst that explodes on release (spawning stays unconditional)
    const dt = Math.min(rawDt, 0.05) * gameTime.worldScale
    const t = clock.elapsedTime
    const p = pool
    const highs = audioFrame.highs
    const player = snapController.pos
    const gate = worldState.gate

    // Realm swap: the old realm's motes die under the whiteout, and the
    // ambient population re-deals to the incoming realm's recipe (index
    // partition — deterministic per depth).
    if (lastEpoch.current !== worldState.epoch) {
      lastEpoch.current = worldState.epoch
      for (let i = AMBIENT; i < COUNT; i++) {
        p.life[i] = 0
        p.colors[i * 3] = p.colors[i * 3 + 1] = p.colors[i * 3 + 2] = 0
      }
      const recipe = ambientRecipeForDepth(worldState.depth)
      recipeRef.current = recipe
      for (let i = 0; i < AMBIENT; i++) {
        const s = ambientStyleForSlot(recipe, i, AMBIENT)
        p.ambientStyle[i] = recipe.styles.indexOf(s)
        p.cells[i] = s.cell
        const r = p.ambientHash[i]
        p.sizes[i] = s.sizeMin + s.sizeVar * r * r
      }
      spawnDirty.current = true
      ambientTints.dirty = true
    }
    if (ambientTints.dirty) {
      ambientTints.dirty = false
      const roleRgb = (role: string, out: Float32Array, o: number) => {
        const hex =
          role === 'rune'
            ? palette.rune
            : role === 'primary'
              ? palette.primary
              : role === 'secondary'
                ? palette.secondary
                : role === 'white'
                  ? '#ffffff'
                  : palette.particle
        hexToRgb(hex, out, o)
      }
      const styles = recipeRef.current.styles
      for (let si = 0; si < styles.length && si < 4; si++) {
        roleRgb(styles[si].roleA, ambientTints.a, si * 3)
        roleRgb(styles[si].roleB, ambientTints.b, si * 3)
      }
    }

    // Snap impact bursts queued by the controller
    const bursts = snapController.pendingBursts
    while (bursts.length > 0) {
      const b = bursts.pop()!
      spawnBurst(b.x, b.y, b.z, b.count, b.style ?? BURST.GENERIC)
    }

    // Impact nova (drops + realm shifts): one huge burst centered on the player
    if (visuals.novaCount !== lastNova.current) {
      lastNova.current = visuals.novaCount
      const n = Math.round(350 * (0.6 + 0.4 * visuals.vi))
      spawnBurst(player.x, player.y, player.z, n, BURST.NOVA)
    }

    // Spontaneous emission, tier-scaled
    const burstMult = T(0.5, 1.0, 1.5, 2.0) * (0.6 + 0.4 * visuals.vi)
    if (audioFrame.onset || highs - prevHighs.current > 0.08) {
      const base = audioFrame.onset
        ? 50 + audioFrame.onsetStrength * 60
        : (highs - prevHighs.current) * 300
      const count = Math.floor(base * burstMult)
      if (gate.active && Math.random() < 0.35) {
        spawnBurst(gate.x, gate.y, gate.z, count)
      } else {
        const isl = randomLiveIsland()
        if (isl) spawnBurst(isl.x, isl.y + isl.scale, isl.z, count)
      }
    }
    prevHighs.current = highs

    // high-band streaks: hi-hats/cymbals spray fast sparks off island crowns
    if (audioFrame.highOnset && visuals.highSparkle > 0.04) {
      const n = Math.floor(
        (8 + 26 * visuals.highSparkle) * T(0.6, 0.9, 1.2, 1.5) * (0.5 + 0.5 * visuals.vi),
      )
      const isl = randomLiveIsland()
      if (isl && n > 0) spawnBurst(isl.x, isl.y + isl.scale * 1.1, isl.z, n, BURST.SHIMMER)
    }

    // Dust streams: the gate drinks the realm while open; with no gate the
    // pre-drop charge pulls dust toward the space ahead of the player.
    const streamRate = gate.active
      ? 110 * visuals.w1 + 260 * visuals.dropCharge
      : 260 * visuals.dropCharge
    streamAcc.current += streamRate * dt
    if (streamAcc.current >= 1) {
      const n = Math.floor(streamAcc.current)
      streamAcc.current -= n
      if (gate.active) {
        spawnStream(n, gate.x, gate.y, gate.z, 1 + 0.8 * visuals.dropCharge)
      } else {
        const f = snapController.forward
        spawnStream(
          n,
          player.x + f.x * 40,
          player.y + f.y * 40,
          player.z + f.z * 40,
          1 + 0.8 * visuals.dropCharge,
        )
      }
    }

    // Stardust falls pouring off island rims (rate pre-scaled by governor/vi)
    fallAcc.current += visuals.fallRate * dt
    if (fallAcc.current >= 1) {
      const n = Math.floor(fallAcc.current)
      fallAcc.current -= n
      spawnFalls(n)
    }

    // fog occlusion, done on CPU where colors are written anyway (the
    // material is fog:false — see the material comment)
    const fadeNear = 0.55 * visuals.fogFar
    const fadeFar = 0.95 * visuals.fogFar

    // Ambient drifters -> settling ash: fixed offsets torus-wrapped around
    // the player, with a persistent gravity-biased settle (rising embers in
    // Lava Core via fallDir) and a decorrelated sway instead of orbit drift.
    const activeAmbient = Math.min(AMBIENT, visuals.ambientCount)
    const ambientGlow =
      (0.12 +
        highs * 0.3 * visuals.highsReact +
        0.15 * audioFrame.highOnsetStrength * visuals.highsReact) *
      T(0.8, 1.0, 1.2, 1.3)
    const rm = visuals.rm
    const styles = recipeRef.current.styles
    const tintsA = ambientTints.a
    const tintsB = ambientTints.b
    for (let i = 0; i < AMBIENT; i++) {
      if (i >= activeAmbient) {
        p.colors[i * 3] = p.colors[i * 3 + 1] = p.colors[i * 3 + 2] = 0
        continue
      }
      const ph = p.ambientPhase[i]
      const hash = p.ambientHash[i]
      const si = Math.min(p.ambientStyle[i], styles.length - 1)
      const sty = styles[si]
      // persistent settle — wrapSpan recenters, so drift runs forever; the
      // style's settleMult can RISE against the realm fall (incense)
      p.ambientBase[i * 3 + 1] -= (0.35 + 0.3 * hash) * sty.settleMult * visuals.fallDir * dt
      const bx = p.ambientBase[i * 3]
      const by = p.ambientBase[i * 3 + 1]
      const bz = p.ambientBase[i * 3 + 2]
      const fq = sty.swayFreq * (rm ? 0.6 : 1)
      const am = sty.swayAmp
      const dx = bx + am * (1.3 * Math.sin(0.13 * by + t * 0.21 * fq + ph) + 0.5 * Math.sin(0.07 * bz + t * 0.17 * fq + ph * 2))
      const dy = by + am * 0.8 * Math.sin(0.11 * bx + t * 0.13 * fq + ph)
      const dz = bz + am * (1.3 * Math.cos(0.12 * bx + t * 0.19 * fq + ph) + 0.5 * Math.sin(0.09 * by + t * 0.23 * fq + ph * 3))
      const wx = wrapSpan(dx - player.x, AMBIENT_WRAP)
      const wy = wrapSpan(dy - player.y, AMBIENT_WRAP_Y)
      const wz = wrapSpan(dz - player.z, AMBIENT_WRAP)
      p.positions[i * 3] = player.x + wx
      p.positions[i * 3 + 1] = player.y + wy
      p.positions[i * 3 + 2] = player.z + wz
      const fade = 1 - smoothstep(fadeNear, fadeFar, Math.sqrt(wx * wx + wy * wy + wz * wz))
      // blink (fireflies / votives): sharpened pulse train, dead under rm
      let blink = 1
      if (sty.blinkRate > 0 && !rm) {
        const osc = 0.5 + 0.5 * Math.sin(sty.blinkRate * 6.2832 * t + ph * 3)
        const o2 = osc * osc
        blink = 1 - sty.blinkDepth + sty.blinkDepth * o2 * o2
      }
      const tw =
        ambientGlow * (0.6 + 0.4 * Math.sin(t * 2 + ph * 3)) * fade * blink * sty.bright * 0.55
      // roleA -> roleB per-flake mix (hash² keeps most flakes on the base)
      const mix = hash * hash
      const o = si * 3
      p.colors[i * 3] = (tintsA[o] + (tintsB[o] - tintsA[o]) * mix) * tw
      p.colors[i * 3 + 1] = (tintsA[o + 1] + (tintsB[o + 1] - tintsA[o + 1]) * mix) * tw
      p.colors[i * 3 + 2] = (tintsA[o + 2] + (tintsB[o + 2] - tintsA[o + 2]) * mix) * tw
    }

    // Bass-onset ember flares: a few ash flakes catch and blaze HDR
    const fl = flares.current
    if (audioFrame.onset && audioFrame.onsetStrength >= 1.1 && visuals.emberFlareGain > 0 && activeAmbient > 0) {
      const slot = fl.cursor
      fl.cursor = (fl.cursor + 1) % FLARES
      fl.idx[slot] = Math.floor(Math.random() * activeAmbient)
      fl.age[slot] = 0
      fl.bright[slot] = (2.5 + 1.5 * Math.random()) * visuals.emberFlareGain
    }
    for (let f = 0; f < FLARES; f++) {
      if (fl.idx[f] < 0) continue
      fl.age[f] += dt
      if (fl.age[f] > 1.5 || fl.idx[f] >= activeAmbient) {
        fl.idx[f] = -1
        continue
      }
      // multiplies the already-faded base color up past the bloom threshold
      const boost = 1 + fl.bright[f] * Math.exp(-4 * fl.age[f])
      const i = fl.idx[f]
      p.colors[i * 3] *= boost
      p.colors[i * 3 + 1] *= boost
      p.colors[i * 3 + 2] *= boost
    }

    // Live burst/stream/fall particles
    const damp = Math.exp(-0.5 * dt)
    const streamGlow = 1.2 * (1 + 0.6 * visuals.dropCharge)
    const fallGravity = visuals.fallDir * -5
    for (let i = AMBIENT; i < COUNT; i++) {
      if (p.life[i] <= 0) continue
      p.life[i] -= dt
      if (p.life[i] <= 0) {
        p.colors[i * 3] = p.colors[i * 3 + 1] = p.colors[i * 3 + 2] = 0
        continue
      }
      if (p.kind[i] === KIND_FALL) p.velocities[i * 3 + 1] += fallGravity * dt
      // burst-style vertical bias: dying embers sink, freed soul-motes rise
      if (p.grav[i] !== 0) p.velocities[i * 3 + 1] -= p.grav[i] * dt
      p.positions[i * 3] += p.velocities[i * 3] * dt
      p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * dt
      p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * dt
      p.velocities[i * 3] *= damp
      p.velocities[i * 3 + 1] *= damp
      p.velocities[i * 3 + 2] *= damp
      const frac = p.life[i] / p.maxLife[i]
      const px = p.positions[i * 3] - player.x
      const py = p.positions[i * 3 + 1] - player.y
      const pz = p.positions[i * 3 + 2] - player.z
      const fade = 1 - smoothstep(fadeNear, fadeFar, Math.sqrt(px * px + py * py + pz * pz))
      if (p.kind[i] === KIND_STREAM) {
        // streams hold steady glow, then are absorbed near arrival
        const b = Math.min(1, frac / 0.35) * streamGlow * fade
        p.colors[i * 3] = streamColor.r * b
        p.colors[i * 3 + 1] = streamColor.g * b
        p.colors[i * 3 + 2] = streamColor.b * b
      } else if (p.kind[i] === KIND_FALL) {
        const b = frac * frac * 0.9 * fade
        p.colors[i * 3] = burstColor.r * b
        p.colors[i * 3 + 1] = burstColor.g * b
        p.colors[i * 3 + 2] = burstColor.b * b
      } else {
        // burst: per-particle style tint (bright pre-folded at spawn)
        const b = frac * fade
        p.colors[i * 3] = p.tints[i * 3] * b
        p.colors[i * 3 + 1] = p.tints[i * 3 + 1] * b
        p.colors[i * 3 + 2] = p.tints[i * 3 + 2] * b
      }
    }

    const mesh = points.current
    if (mesh) {
      ;(mesh.geometry.attributes.position as BufferAttribute).needsUpdate = true
      ;(mesh.geometry.attributes.color as BufferAttribute).needsUpdate = true
      if (spawnDirty.current) {
        spawnDirty.current = false
        const aSize = mesh.geometry.attributes.aSize as BufferAttribute | undefined
        if (aSize) aSize.needsUpdate = true
        const aCell = mesh.geometry.attributes.aCell as BufferAttribute | undefined
        if (aCell) aCell.needsUpdate = true
      }
    }
  })

  return (
    <points ref={points} frustumCulled={false} material={material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pool.positions, 3]} usage={DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" args={[pool.colors, 3]} usage={DynamicDrawUsage} />
        <bufferAttribute attach="attributes-aSize" args={[pool.sizes, 1]} usage={DynamicDrawUsage} />
        <bufferAttribute attach="attributes-aCell" args={[pool.cells, 1]} usage={DynamicDrawUsage} />
      </bufferGeometry>
    </points>
  )
}
