/**
 * The horror-combat runtime singleton: swarm SoA pool, spawn/pressure
 * director, steering + leap/latch machine, the gate warden, and the player's
 * bolt projectiles. Pure of three.js (scalar math only) so the whole sim is
 * node-testable, in the exact mold of worldState.ts.
 *
 * Layering: mutates runState.combat counters directly (counter-diffing, no
 * callbacks) and reads worldState (slots for spawn perches, gate, depth,
 * epoch, modsGen for pressure). It NEVER imports scene/ modules — renderers
 * and snapController read this state and fire their own FX from diffs.
 */
import { hashInts, mulberry32 } from './seededRandom'
import { variantTop } from './islandVariants'
import { worldState } from './worldState'
import { pushFeedback, runState } from './runState'
import { feel, HK, pushHit } from './feelSignals'
import { damagePlayer, PLAYER_HP } from './playerHealth'
import type { CombatStats } from './stats'
import {
  ENEMY,
  LATCH_ANCHORS,
  STYLE,
  SWARM_ARCHETYPES,
  WARDEN_ARCHETYPES,
  WK,
} from './enemyArchetypes'
import { COMBAT, killScore, novaHitDamage, wardenScore } from './combat'

// ---------------------------------------------------------------------------
// state enums (Uint8-friendly consts, not TS enums)
// ---------------------------------------------------------------------------

export const ES = {
  DORMANT: 0,
  STALK: 1,
  CIRCLE: 2,
  WINDUP: 3,
  LEAP: 4,
  LATCHED: 5,
  STAGGER: 6,
  DYING: 7,
  RETREAT: 8,
} as const
export type EnemyStateId = (typeof ES)[keyof typeof ES]

export const WP = {
  DORMANT: 0,
  EMERGE: 1,
  GUARD: 2,
  WINDUP: 3,
  ATTACK: 4,
  EXPOSED: 5,
  STAGGER: 6,
  DYING: 7,
  DEAD: 8,
} as const
export type WardenPhaseId = (typeof WP)[keyof typeof WP]

/** Targetable by aim/bolts (not empty, not attached, not already dying). */
export function isTargetable(state: number): boolean {
  return state >= ES.STALK && state !== ES.LATCHED && state !== ES.DYING
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

const CAP = ENEMY.SWARM_CAP

export interface EnemyPool {
  state: Uint8Array
  archetype: Uint8Array
  x: Float32Array
  y: Float32Array
  z: Float32Array
  vx: Float32Array
  vy: Float32Array
  vz: Float32Array
  hp: Float32Array
  maxHp: Float32Array
  /** Bumped on every spawn AND free — consumers store (idx, serial). */
  serial: Uint32Array
  /** Seconds in the current state. */
  stateT: Float32Array
  /** Deterministic per-spawn hash: style phases, glyphs, release angles. */
  seed: Uint32Array
  /** Latch anchor 0..LATCH_CAP-1 while LATCHED, else -1. */
  latchSlot: Int8Array
  /** Orbit direction ±1. */
  dir: Int8Array
  /** Committed leap target / launch origin (timed bezier, not physics). */
  tx: Float32Array
  ty: Float32Array
  tz: Float32Array
  lx: Float32Array
  ly: Float32Array
  lz: Float32Array
  leapDur: Float32Array
  /** Accumulated knockback impulse, applied then zeroed each tick. */
  ix: Float32Array
  iy: Float32Array
  iz: Float32Array
  /** Nearest-island cache (skitter/burrow perches), serial-guarded. */
  homeSlot: Int16Array
  homeSerial: Int32Array
  /** 0..1 hit flash the renderer reads; decays exp(-8t). */
  hitFlash: Float32Array
}

export interface WardenState {
  active: boolean
  archetype: number
  phase: WardenPhaseId
  phaseT: number
  attackIdx: number
  attacksSinceExpose: number
  hp: number
  maxHp: number
  x: number
  y: number
  z: number
  homeX: number
  homeY: number
  homeZ: number
  orbitA: number
  /** 0..1 windup telegraph (renderer + combatSignals). */
  telegraphT: number
  weakOpen: boolean
  weakX: number
  weakY: number
  weakZ: number
  hitFlash: number
  /** ++ per spawn; renderers reset transient FX on diff. */
  serial: number
  /** Live LASH segment (player dodge test) / SLAM center. */
  lashAx: number
  lashAy: number
  lashAz: number
  lashBx: number
  lashBy: number
  lashBz: number
  slamX: number
  slamY: number
  slamZ: number
  /** Attack-connected latch (one hit per attack execution). */
  attackHitDone: boolean
}

export interface BoltPool {
  active: Uint8Array
  x: Float32Array
  y: Float32Array
  z: Float32Array
  vx: Float32Array
  vy: Float32Array
  vz: Float32Array
  bornAt: Float32Array
  dmg: Float32Array
  serial: Uint32Array
  homeIdx: Int16Array
  homeSerial: Uint32Array
  // ---- per-bolt cast identity (charged shots differ from quick bolts) ----
  /** Lifetime seconds for THIS bolt. */
  life: Float32Array
  /** Hit radius for THIS bolt. */
  radius: Float32Array
  /** Downward gravity, u/s². */
  grav: Float32Array
  /** Homing strength (rad/s-ish lerp gain). */
  homeTurn: Float32Array
  /** Draw power 0..1 at loose — renderers read for scale/trail/light. */
  power: Float32Array
  /** On-beat release: every hit this bolt lands styles as crit. */
  crit: Uint8Array
  /** Enemies this bolt may still pass through. */
  pierceLeft: Uint8Array
  /** Victims already struck (idx+serial pairs, BOLT_HIT_TRACK per bolt) so an
   * overlapped enemy is never hit twice by one bolt. */
  hitCount: Uint8Array
  hitIdx: Int16Array
  hitSerial: Uint32Array
}

/** Max victims recorded per bolt: maxPierce (3) + pierceBonus clamp (2) + 1. */
export const BOLT_HIT_TRACK = 6

/** Everything about one loosed cast that varies with draw power. */
export interface BoltSpec {
  power: number
  speed: number
  radius: number
  pierce: number
  grav: number
  homeTurn: number
  lobUp: number
  life: number
  crit: boolean
}

export interface EnemyDirectorInput {
  px: number
  py: number
  pz: number
  pvx: number
  pvy: number
  pvz: number
  /** Travel forward, XZ-normalized (spawn ahead bias). */
  fx: number
  fz: number
  tier: number
  tierFrom: number
  tierBlend: number
  /** visuals.beatPulse — confidence-gated, rm-capped upstream. */
  beatPulse: number
  /** audioFrame.dropCommitCount — diffed for coordinated leap waves. */
  dropCount: number
  /** True during streak/pull/shift/downed or a veil rite: leaps whiff. */
  playerUntargetable: boolean
  /** Stasis rite: scales enemy speed/accel (1 = normal). */
  enemySpeedMult: number
  /** VISUALS-as-difficulty dial (difficultyFromVisuals). Scales swarm budget,
   * attack tokens and speed. Optional — defaults to 1 (neutral). */
  difficultyMult?: number
  stats: CombatStats
}

export interface EnemyStateData {
  trackSeed: number
  epoch: number
  pool: EnemyPool
  /** latchSlots[k] = enemy idx occupying player anchor k, or -1. */
  latchSlots: Int16Array
  latchSerial: Uint32Array
  latchedCount: number
  warden: WardenState
  bolts: BoltPool
  rng: () => number
  /** Seconds until spawning may begin (run start / realm swap grace). */
  graceLeft: number
  nextSpawnIn: number
  retreatCheckIn: number
  lastDropCount: number
  lastGateOpenedAt: number
  lastGateX: number
  lastGateZ: number
  /** Pending knockback on the player (consumed + zeroed by snapController). */
  playerKnockX: number
  playerKnockY: number
  playerKnockZ: number
  /** Monotonic count of warden hits on the player (shake diffs). */
  playerHitCount: number
}

function freshPool(): EnemyPool {
  return {
    state: new Uint8Array(CAP),
    archetype: new Uint8Array(CAP),
    x: new Float32Array(CAP),
    y: new Float32Array(CAP),
    z: new Float32Array(CAP),
    vx: new Float32Array(CAP),
    vy: new Float32Array(CAP),
    vz: new Float32Array(CAP),
    hp: new Float32Array(CAP),
    maxHp: new Float32Array(CAP),
    serial: new Uint32Array(CAP),
    stateT: new Float32Array(CAP),
    seed: new Uint32Array(CAP),
    latchSlot: new Int8Array(CAP).fill(-1),
    dir: new Int8Array(CAP),
    tx: new Float32Array(CAP),
    ty: new Float32Array(CAP),
    tz: new Float32Array(CAP),
    lx: new Float32Array(CAP),
    ly: new Float32Array(CAP),
    lz: new Float32Array(CAP),
    leapDur: new Float32Array(CAP),
    ix: new Float32Array(CAP),
    iy: new Float32Array(CAP),
    iz: new Float32Array(CAP),
    homeSlot: new Int16Array(CAP).fill(-1),
    homeSerial: new Int32Array(CAP),
    hitFlash: new Float32Array(CAP),
  }
}

function freshWarden(): WardenState {
  return {
    active: false,
    archetype: 0,
    phase: WP.DORMANT,
    phaseT: 0,
    attackIdx: 0,
    attacksSinceExpose: 0,
    hp: 0,
    maxHp: 0,
    x: 0,
    y: 0,
    z: 0,
    homeX: 0,
    homeY: 0,
    homeZ: 0,
    orbitA: 0,
    telegraphT: 0,
    weakOpen: false,
    weakX: 0,
    weakY: 0,
    weakZ: 0,
    hitFlash: 0,
    serial: 0,
    lashAx: 0,
    lashAy: 0,
    lashAz: 0,
    lashBx: 0,
    lashBy: 0,
    lashBz: 0,
    slamX: 0,
    slamY: 0,
    slamZ: 0,
    attackHitDone: false,
  }
}

function freshBolts(): BoltPool {
  return {
    active: new Uint8Array(ENEMY.BOLT_CAP),
    x: new Float32Array(ENEMY.BOLT_CAP),
    y: new Float32Array(ENEMY.BOLT_CAP),
    z: new Float32Array(ENEMY.BOLT_CAP),
    vx: new Float32Array(ENEMY.BOLT_CAP),
    vy: new Float32Array(ENEMY.BOLT_CAP),
    vz: new Float32Array(ENEMY.BOLT_CAP),
    bornAt: new Float32Array(ENEMY.BOLT_CAP),
    dmg: new Float32Array(ENEMY.BOLT_CAP),
    serial: new Uint32Array(ENEMY.BOLT_CAP),
    homeIdx: new Int16Array(ENEMY.BOLT_CAP).fill(-1),
    homeSerial: new Uint32Array(ENEMY.BOLT_CAP),
    life: new Float32Array(ENEMY.BOLT_CAP),
    radius: new Float32Array(ENEMY.BOLT_CAP),
    grav: new Float32Array(ENEMY.BOLT_CAP),
    homeTurn: new Float32Array(ENEMY.BOLT_CAP),
    power: new Float32Array(ENEMY.BOLT_CAP),
    crit: new Uint8Array(ENEMY.BOLT_CAP),
    pierceLeft: new Uint8Array(ENEMY.BOLT_CAP),
    hitCount: new Uint8Array(ENEMY.BOLT_CAP),
    hitIdx: new Int16Array(ENEMY.BOLT_CAP * BOLT_HIT_TRACK).fill(-1),
    hitSerial: new Uint32Array(ENEMY.BOLT_CAP * BOLT_HIT_TRACK),
  }
}

function freshState(): EnemyStateData {
  return {
    trackSeed: 0,
    epoch: -1,
    pool: freshPool(),
    latchSlots: new Int16Array(ENEMY.LATCH_CAP).fill(-1),
    latchSerial: new Uint32Array(ENEMY.LATCH_CAP),
    latchedCount: 0,
    warden: freshWarden(),
    bolts: freshBolts(),
    rng: mulberry32(1),
    graceLeft: ENEMY.GRACE_SEC,
    nextSpawnIn: 0,
    retreatCheckIn: 1,
    lastDropCount: 0,
    lastGateOpenedAt: 0,
    lastGateX: 0,
    lastGateZ: 0,
    playerKnockX: 0,
    playerKnockY: 0,
    playerKnockZ: 0,
    playerHitCount: 0,
  }
}

/** DEV HMR guard (worldState pattern): hot updates must not orphan the pool. */
export const enemyState: EnemyStateData = import.meta.env.DEV
  ? (((globalThis as Record<string, unknown>).__astralEnemies ??= freshState()) as EnemyStateData)
  : freshState()

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

function clearSwarm(): void {
  const p = enemyState.pool
  for (let i = 0; i < CAP; i++) {
    if (p.state[i] !== ES.DORMANT) p.serial[i]++
    p.state[i] = ES.DORMANT
    p.latchSlot[i] = -1
    p.hitFlash[i] = 0
    p.ix[i] = p.iy[i] = p.iz[i] = 0
    p.homeSlot[i] = -1
  }
  enemyState.latchSlots.fill(-1)
  enemyState.latchedCount = 0
}

function clearWarden(): void {
  const w = enemyState.warden
  w.active = false
  w.phase = WP.DORMANT
  w.phaseT = 0
  w.telegraphT = 0
  w.weakOpen = false
  w.hitFlash = 0
  w.attackHitDone = false
}

function reseed(depth: number): void {
  enemyState.rng = mulberry32(hashInts(enemyState.trackSeed, depth, 0xee11, 0))
}

/** Full reset for a new run / replay / back-to-select. */
export function resetEnemies(trackSeed: number, depth: number): void {
  const es = enemyState
  es.trackSeed = trackSeed >>> 0
  es.epoch = worldState.epoch
  clearSwarm()
  clearWarden()
  const b = es.bolts
  for (let i = 0; i < ENEMY.BOLT_CAP; i++) {
    if (b.active[i]) b.serial[i]++
    b.active[i] = 0
    b.homeIdx[i] = -1
  }
  reseed(depth)
  spawnCounter = 0
  es.graceLeft = ENEMY.GRACE_SEC
  es.nextSpawnIn = 0
  es.retreatCheckIn = 1
  es.lastDropCount = -1
  es.lastGateOpenedAt = worldState.gate.openedAt
  es.lastGateX = worldState.gate.x
  es.lastGateZ = worldState.gate.z
  es.playerKnockX = es.playerKnockY = es.playerKnockZ = 0
  es.playerHitCount = 0
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

export function liveSwarmCount(): number {
  const p = enemyState.pool
  let n = 0
  for (let i = 0; i < CAP; i++) {
    const s = p.state[i]
    if (s !== ES.DORMANT && s !== ES.DYING) n++
  }
  return n
}

export function latchLoad(maxLatch: number): number {
  return enemyState.latchedCount / Math.max(1, maxLatch)
}

export function isDownedTriggered(maxLatch: number): boolean {
  return enemyState.latchedCount >= Math.max(1, maxLatch)
}

export function wardenBlocksGate(): boolean {
  const w = enemyState.warden
  return w.active && w.phase !== WP.DEAD && w.phase !== WP.DORMANT
}

export function weakPointTarget(out: { x: number; y: number; z: number; open: boolean }): void {
  const w = enemyState.warden
  out.x = w.weakX
  out.y = w.weakY
  out.z = w.weakZ
  out.open = w.active && w.weakOpen
}

/** Anchor slot k in body-local space (renderer transforms via avatarFrame). */
export function latchAnchor(k: number): readonly [number, number, number, number] {
  return LATCH_ANCHORS[Math.max(0, Math.min(ENEMY.LATCH_CAP - 1, k))]
}

// ---------------------------------------------------------------------------
// latch registry
// ---------------------------------------------------------------------------

function recountLatched(): void {
  let n = 0
  for (let k = 0; k < ENEMY.LATCH_CAP; k++) if (enemyState.latchSlots[k] >= 0) n++
  enemyState.latchedCount = n
}

function tryLatch(i: number, t: number): boolean {
  const es = enemyState
  const p = es.pool
  for (let k = 0; k < ENEMY.LATCH_CAP; k++) {
    if (es.latchSlots[k] !== -1) continue
    es.latchSlots[k] = i
    es.latchSerial[k] = p.serial[i]
    p.latchSlot[i] = k
    p.state[i] = ES.LATCHED
    p.stateT[i] = 0
    p.vx[i] = p.vy[i] = p.vz[i] = 0
    recountLatched()
    runState.combat.latchesSuffered++
    runState.combat.lastLatchAt = t
    pushFeedback('LATCHED', SWARM_ARCHETYPES[p.archetype[i]].label, 'latch')
    return true
  }
  return false
}

/** Detach enemy i; stagger=true leaves it vulnerable, else it re-circles. */
export function releaseLatch(i: number, t: number, stagger: boolean): void {
  const es = enemyState
  const p = es.pool
  const k = p.latchSlot[i]
  if (k >= 0) {
    es.latchSlots[k] = -1
    p.latchSlot[i] = -1
  }
  if (p.state[i] === ES.LATCHED) {
    p.state[i] = stagger ? ES.STAGGER : ES.CIRCLE
    p.stateT[i] = 0
    // fling off the body along a seeded angle so releases read physically
    const a = ((p.seed[i] % 1024) / 1024) * Math.PI * 2 + t * 0.37
    const sp = stagger ? 12 : 6
    p.vx[i] = Math.cos(a) * sp
    p.vy[i] = 3
    p.vz[i] = Math.sin(a) * sp
    p.x[i] += Math.cos(a) * 1.5
    p.z[i] += Math.sin(a) * 1.5
    runState.combat.shakeoffs++
  }
  recountLatched()
}

export function releaseAllLatched(t: number, stagger: boolean): number {
  const es = enemyState
  let released = 0
  for (let k = 0; k < ENEMY.LATCH_CAP; k++) {
    const i = es.latchSlots[k]
    if (i < 0) continue
    releaseLatch(i, t, stagger)
    released++
  }
  return released
}

/** Snap arrival g-force rips the OLDEST latched horror off. */
export function tearOffOneLatch(t: number): boolean {
  const es = enemyState
  const p = es.pool
  let best = -1
  let bestT = -1
  for (let k = 0; k < ENEMY.LATCH_CAP; k++) {
    const i = es.latchSlots[k]
    if (i < 0) continue
    if (p.stateT[i] > bestT) {
      bestT = p.stateT[i]
      best = i
    }
  }
  if (best < 0) return false
  releaseLatch(best, t, true)
  return true
}

// ---------------------------------------------------------------------------
// damage / death
// ---------------------------------------------------------------------------

export type DamageSource = 0 | 1 | 2 | 3 // strike, bolt, nova, warden-death-blast

function creditDamage(amount: number, src: DamageSource): void {
  const c = runState.combat
  c.damageDealt += amount
  if (src === 0) c.strikeDamage += amount
  else if (src === 1) c.boltDamage += amount
  else if (src === 2) c.novaDamage += amount
}

/** DamageSource -> feel HitEvent kind (strike/bolt/nova; the warden death
 * blast reads as nova). */
function srcKind(src: DamageSource): number {
  return src === 0 ? HK.STRIKE : src === 1 ? HK.BOLT : HK.NOVA
}

/** src is part of the stable call contract (damageEnemy forwards it) even
 * though the kill toast it once fed was removed as toast-rule dead code. */
export function killEnemy(i: number, t: number, _src: DamageSource): void {
  const p = enemyState.pool
  if (p.state[i] === ES.DORMANT || p.state[i] === ES.DYING) return
  if (p.latchSlot[i] >= 0) releaseLatch(i, t, true)
  p.state[i] = ES.DYING
  p.stateT[i] = 0
  p.hp[i] = 0
  p.hitFlash[i] = 1
  const c = runState.combat
  c.kills++
  c.killsByArchetype[p.archetype[i]]++
  c.shardsEarned += 1
  c.lastKillAt = t
  // kills honor the chain: a hot multiplier makes combat pay
  runState.scoreState.score += Math.round(
    killScore(p.maxHp[i], worldState.depth) * runState.scoreState.multiplier,
  )
  feel.killConfirmCount++
  // no toast here: 'kill' is excluded from the toast allowlist by design — the
  // kill is carried by the hitmark, the KILL ember burst, hit-stop and SFX
}

/** Returns true when this call killed it. Pushes the per-hit feel event
 * (damage bubbles / hitmarkers) — the ONE write site for swarm damage. */
export function damageEnemy(
  i: number,
  amount: number,
  t: number,
  src: DamageSource,
  crit = false,
): boolean {
  const p = enemyState.pool
  if (i < 0 || i >= CAP) return false
  const s = p.state[i]
  if (s === ES.DORMANT || s === ES.DYING) return false
  const dmg = Math.max(0, amount)
  if (dmg <= 0) return false
  creditDamage(dmg, src)
  p.hp[i] -= dmg
  p.hitFlash[i] = 1
  const killed = p.hp[i] <= 0
  pushHit(t, p.x[i], p.y[i], p.z[i], dmg, srcKind(src), crit, killed, i)
  if (killed) {
    killEnemy(i, t, src)
    return true
  }
  return false
}

/** Gameplay knockback (twin of the cosmetic shockwave): impulse + stagger. */
export function applyRadialImpulse(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  strength: number,
): void {
  const p = enemyState.pool
  for (let i = 0; i < CAP; i++) {
    const s = p.state[i]
    if (s === ES.DORMANT || s === ES.DYING || s === ES.LATCHED) continue
    const dx = p.x[i] - cx
    const dy = p.y[i] - cy
    const dz = p.z[i] - cz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > radius) continue
    const k = (1 - dist / radius) * strength
    const inv = dist > 1e-4 ? 1 / dist : 0
    p.ix[i] += dx * inv * k
    p.iy[i] += dy * inv * k + k * 0.25
    p.iz[i] += dz * inv * k
    if (s === ES.WINDUP || s === ES.LEAP) {
      p.state[i] = ES.STAGGER
      p.stateT[i] = 0
    }
  }
}

// ---------------------------------------------------------------------------
// player combat entry points
// ---------------------------------------------------------------------------

/** Strike-arrival outcomes. */
export const STRIKE_MISS = 0
export const STRIKE_HIT = 1
export const STRIKE_KILL = 2

/** Strike arrival at a committed (idx, serial). 0 = whiff (the victim
 * slipped the blow), 1 = connected, 2 = the killing blow — the caller
 * differentiates the crunch. */
export function applySnapStrike(
  idx: number,
  serial: number,
  hitX: number,
  hitY: number,
  hitZ: number,
  dmg: number,
  t: number,
  crit = false,
): 0 | 1 | 2 {
  const p = enemyState.pool
  if (idx < 0 || idx >= CAP) return STRIKE_MISS
  if (p.serial[idx] !== serial) return STRIKE_MISS
  const s = p.state[idx]
  if (s === ES.DORMANT || s === ES.DYING) return STRIKE_MISS
  const dx = p.x[idx] - hitX
  const dy = p.y[idx] - hitY
  const dz = p.z[idx] - hitZ
  if (dx * dx + dy * dy + dz * dz > COMBAT.strike.hitR * COMBAT.strike.hitR) return STRIKE_MISS
  const killed = damageEnemy(idx, dmg, t, 0, crit)
  applyRadialImpulse(hitX, hitY, hitZ, COMBAT.strike.knockR, COMBAT.strike.knock)
  return killed ? STRIKE_KILL : STRIKE_HIT
}

/** Player cast (quick bolt or charged shot — the spec carries the identity).
 * Returns false when the pool is exhausted. */
export function fireBolt(
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  dmg: number,
  homeIdx: number,
  homeSerial: number,
  t: number,
  spec: BoltSpec,
): boolean {
  const b = enemyState.bolts
  for (let i = 0; i < ENEMY.BOLT_CAP; i++) {
    if (b.active[i]) continue
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
    b.active[i] = 1
    b.serial[i]++
    b.x[i] = px
    b.y[i] = py
    b.z[i] = pz
    b.vx[i] = (dx / len) * spec.speed
    b.vy[i] = (dy / len) * spec.speed + spec.lobUp
    b.vz[i] = (dz / len) * spec.speed
    b.bornAt[i] = t
    b.dmg[i] = dmg
    b.homeIdx[i] = homeIdx >= 0 && homeIdx < CAP ? homeIdx : -1
    b.homeSerial[i] = homeSerial >>> 0
    b.life[i] = spec.life
    b.radius[i] = spec.radius
    b.grav[i] = spec.grav
    b.homeTurn[i] = spec.homeTurn
    b.power[i] = Math.min(1, Math.max(0, spec.power))
    b.crit[i] = spec.crit ? 1 : 0
    b.pierceLeft[i] = Math.max(0, Math.min(BOLT_HIT_TRACK - 1, Math.round(spec.pierce)))
    b.hitCount[i] = 0
    runState.combat.boltsFired++
    return true
  }
  return false
}

/** Distance² scratch for collectStormTargets — insertion-sorted beside `out`. */
const stormDist = new Float32Array(8)

/**
 * Nearest targetable horrors to (px,py,pz), nearest first, up to `max`.
 * Returns the count written into `out`. Zero-alloc — feeds storm-shard
 * homing assignment at the loose site.
 */
export function collectStormTargets(
  out: Int16Array,
  px: number,
  py: number,
  pz: number,
  max: number,
): number {
  const p = enemyState.pool
  const cap = Math.min(max, out.length, stormDist.length)
  let n = 0
  for (let i = 0; i < CAP; i++) {
    if (!isTargetable(p.state[i])) continue
    const dx = p.x[i] - px
    const dy = p.y[i] - py
    const dz = p.z[i] - pz
    const d2 = dx * dx + dy * dy + dz * dz
    let at = n
    while (at > 0 && stormDist[at - 1] > d2) at--
    if (at >= cap) continue
    for (let j = Math.min(n, cap - 1); j > at; j--) {
      stormDist[j] = stormDist[j - 1]
      out[j] = out[j - 1]
    }
    stormDist[at] = d2
    out[at] = i
    if (n < cap) n++
  }
  return n
}

/** Banish Nova: release everything latched + AoE damage + knockback.
 * Charge spending stays with the caller (snapController). */
export function banishNova(px: number, py: number, pz: number, t: number, stats: CombatStats): void {
  const radius = COMBAT.nova.radius * stats.novaRadiusMult
  const released = releaseAllLatched(t, true)
  const p = enemyState.pool
  for (let i = 0; i < CAP; i++) {
    const s = p.state[i]
    if (s === ES.DORMANT || s === ES.DYING) continue
    const dx = p.x[i] - px
    const dy = p.y[i] - py
    const dz = p.z[i] - pz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > radius) continue
    damageEnemy(i, novaHitDamage(dist, radius, 1), t, 2)
  }
  applyRadialImpulse(px, py, pz, radius * 1.2, COMBAT.nova.knock)
  const w = enemyState.warden
  if (w.active && w.phase >= WP.GUARD && w.phase < WP.DYING) {
    const dw = Math.sqrt((w.x - px) ** 2 + (w.y - py) ** 2 + (w.z - pz) ** 2)
    if (dw < radius + WARDEN_ARCHETYPES[w.archetype].bodyR) {
      damageWarden(novaHitDamage(Math.max(0, dw - WARDEN_ARCHETYPES[w.archetype].bodyR), radius, 1), t, 2)
    }
  }
  runState.combat.novasFired++
  pushFeedback('BANISH NOVA', released > 0 ? 'THE GRIP BREAKS' : '', 'nova')
}

// ---------------------------------------------------------------------------
// warden
// ---------------------------------------------------------------------------

export function spawnWarden(
  gx: number,
  gy: number,
  gz: number,
  realmIdx: number,
  hpMult: number,
  t: number,
): void {
  const w = enemyState.warden
  const table = WARDEN_ARCHETYPES[realmIdx % WARDEN_ARCHETYPES.length]
  const keepHp = w.active && w.phase !== WP.DEAD && w.archetype === realmIdx % 6 ? w.hp : -1
  w.active = true
  w.archetype = realmIdx % WARDEN_ARCHETYPES.length
  w.maxHp = Math.round(table.hp * Math.max(0.1, hpMult))
  w.hp = keepHp > 0 ? keepHp : w.maxHp
  w.phase = WP.EMERGE
  w.phaseT = 0
  w.attackIdx = 0
  w.attacksSinceExpose = 0
  w.homeX = gx
  w.homeY = gy + table.hover
  w.homeZ = gz
  w.x = gx
  w.y = gy - 6
  w.z = gz
  w.orbitA = ((t * 997) % 6.28318) as number
  w.telegraphT = 0
  w.weakOpen = false
  w.hitFlash = 0
  w.serial++
  w.attackHitDone = false
  pushFeedback('THE GATE IS WARDED', table.label, 'warden')
}

function beginWardenDeath(t: number): void {
  const w = enemyState.warden
  const stats = runState.stats
  w.phase = WP.DYING
  w.phaseT = 0
  w.weakOpen = false
  w.telegraphT = 0
  const c = runState.combat
  c.wardenKills++
  c.wardenKillsByArchetype[w.archetype]++
  c.shardsEarned += 10
  c.lastKillAt = t
  runState.scoreState.score += wardenScore(worldState.depth)
  runState.shiftCharge += 3 * stats.chargeGainMult
  releaseAllLatched(t, true)
  applyRadialImpulse(w.x, w.y, w.z, 20, 26)
  feel.wardenKillConfirmCount++
  feel.gateUnsealedCount++ // the seal breaks with its jailer
  pushFeedback('WARDEN BANISHED', '+3 CHARGE', 'warden')
}

/** Body damage (armored outside EXPOSED/STAGGER). Returns true on the kill.
 * The pushed feel event carries the POST-armor number — the small bubbles on
 * an armored warden teach the 0.25x armor honestly. */
export function damageWarden(amount: number, t: number, src: DamageSource, crit = false): boolean {
  const w = enemyState.warden
  if (!w.active || w.phase < WP.GUARD || w.phase >= WP.DYING) return false
  const exposed = w.phase === WP.EXPOSED || w.phase === WP.STAGGER
  const dmg = Math.max(0, amount) * (exposed ? 1 : COMBAT.wardenArmor)
  if (dmg <= 0) return false
  creditDamage(dmg, src)
  w.hp -= dmg
  w.hitFlash = 1
  const killed = w.hp <= 0
  pushHit(t, w.x, w.y, w.z, dmg, srcKind(src), crit, killed, 300)
  if (killed) {
    beginWardenDeath(t)
    return true
  }
  return false
}

/** Snap-strike on the OPEN weak point: full damage + stagger + cycle reset.
 * Returns true when it was the kill. */
export function applyWardenWeakHit(dmg: number, t: number, crit = false): boolean {
  const w = enemyState.warden
  if (!w.active || !w.weakOpen || w.phase >= WP.DYING) return false
  const amount = Math.max(0, dmg)
  creditDamage(amount, 0)
  w.hp -= amount
  w.hitFlash = 1
  w.weakOpen = false
  w.attacksSinceExpose = 0
  const killed = w.hp <= 0
  pushHit(t, w.weakX, w.weakY, w.weakZ, amount, HK.WARDEN_WEAK, crit, killed, 300)
  if (killed) {
    beginWardenDeath(t)
    return true
  }
  w.phase = WP.STAGGER
  w.phaseT = 0
  pushFeedback('WEAK POINT SHATTERED', '', 'warden')
  return false
}

function updateWarden(dt: number, t: number, inp: EnemyDirectorInput): void {
  const w = enemyState.warden
  if (!w.active || w.phase === WP.DEAD) return
  const table = WARDEN_ARCHETYPES[w.archetype]
  w.phaseT += dt
  w.hitFlash *= Math.exp(-8 * dt)
  const pdx = inp.px - w.x
  const pdy = inp.py - w.y
  const pdz = inp.pz - w.z
  const pdist = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz)

  // weak point orbits the body while open
  if (w.weakOpen) {
    const a = t * 0.7 + w.serial
    w.weakX = w.x + Math.cos(a) * table.bodyR * 0.9
    w.weakY = w.y + 0.5
    w.weakZ = w.z + Math.sin(a) * table.bodyR * 0.9
  }

  switch (w.phase) {
    case WP.EMERGE: {
      const k = Math.min(1, w.phaseT / ENEMY.WARDEN_EMERGE_DUR)
      w.y = w.homeY - 6 * (1 - k) * (1 - k)
      w.x = w.homeX
      w.z = w.homeZ
      if (w.phaseT >= ENEMY.WARDEN_EMERGE_DUR) {
        w.phase = WP.GUARD
        w.phaseT = 0
      }
      break
    }
    case WP.GUARD: {
      // hover-orbit the gate
      w.orbitA += dt * (table.speed / 8)
      const gx = w.homeX + Math.cos(w.orbitA) * 4
      const gz = w.homeZ + Math.sin(w.orbitA) * 4
      const k = 1 - Math.exp(-dt / 0.6)
      w.x += (gx - w.x) * k
      w.y += (w.homeY - w.y) * k
      w.z += (gz - w.z) * k
      if (pdist < 45 && w.phaseT >= table.attackPeriod) {
        w.phase = WP.WINDUP
        w.phaseT = 0
        w.attackHitDone = false
      }
      break
    }
    case WP.WINDUP: {
      const atk = table.attacks[w.attackIdx % table.attacks.length]
      w.telegraphT = Math.min(1, w.phaseT / atk.windup)
      if (w.phaseT >= atk.windup) {
        w.phase = WP.ATTACK
        w.phaseT = 0
        w.telegraphT = 0
        // freeze targeting at commit
        if (atk.kind === WK.SLAM) {
          w.slamX = inp.px
          w.slamY = inp.py
          w.slamZ = inp.pz
        } else if (atk.kind === WK.LASH) {
          const inv = pdist > 1e-4 ? 1 / pdist : 0
          w.lashAx = w.x
          w.lashAy = w.y
          w.lashAz = w.z
          w.lashBx = w.x + pdx * inv * 30
          w.lashBy = w.y + pdy * inv * 30
          w.lashBz = w.z + pdz * inv * 30
        } else if (atk.kind === WK.SUMMON) {
          for (let n = 0; n < atk.param; n++) summonAt(w.x, w.y, w.z)
        }
      }
      break
    }
    case WP.ATTACK: {
      const atk = table.attacks[w.attackIdx % table.attacks.length]
      const k = Math.min(1, w.phaseT / Math.max(0.05, atk.active))
      if (atk.kind === WK.LASH && !w.attackHitDone) {
        // sweep the segment endpoint around the body by param radians
        const swing = (k - 0.5) * atk.param
        const bx = w.lashBx - w.lashAx
        const bz = w.lashBz - w.lashAz
        const cs = Math.cos(swing)
        const sn = Math.sin(swing)
        const ex = w.lashAx + bx * cs - bz * sn
        const ez = w.lashAz + bx * sn + bz * cs
        w.lashBx = w.lashAx + (ex - w.lashAx)
        w.lashBz = w.lashAz + (ez - w.lashAz)
        if (segPointDist(w.lashAx, w.lashAy, w.lashAz, w.lashBx, w.lashBy, w.lashBz, inp.px, inp.py, inp.pz) < 2.2) {
          wardenHitPlayer(atk, pdx, pdy, pdz, pdist, t)
        }
      } else if (atk.kind === WK.SLAM && !w.attackHitDone && k >= 1) {
        const dx = inp.px - w.slamX
        const dy = inp.py - w.slamY
        const dz = inp.pz - w.slamZ
        if (dx * dx + dy * dy + dz * dz < atk.param * atk.param) {
          wardenHitPlayer(atk, pdx, pdy, pdz, pdist, t)
        }
      }
      if (w.phaseT >= atk.active + atk.recover) {
        w.attackIdx++
        w.attacksSinceExpose++
        if (w.attacksSinceExpose >= table.exposeEvery) {
          w.phase = WP.EXPOSED
          w.phaseT = 0
          w.weakOpen = true
          pushFeedback('THE RELIC HEART OPENS', 'STRIKE IT', 'warden')
        } else {
          w.phase = WP.GUARD
          w.phaseT = 0
        }
      }
      break
    }
    case WP.EXPOSED: {
      if (w.phaseT >= table.weakDur) {
        w.weakOpen = false
        w.attacksSinceExpose = 0
        w.phase = WP.GUARD
        w.phaseT = 0
      }
      break
    }
    case WP.STAGGER: {
      if (w.phaseT >= ENEMY.WARDEN_STAGGER_DUR) {
        w.phase = WP.GUARD
        w.phaseT = 0
      }
      break
    }
    case WP.DYING: {
      if (w.phaseT >= ENEMY.WARDEN_DEATH_DUR) {
        w.phase = WP.DEAD
        w.phaseT = 0
      }
      break
    }
  }
}

function wardenHitPlayer(
  atk: { chargeDrain: number; damage: number },
  pdx: number,
  _pdy: number,
  pdz: number,
  pdist: number,
  t: number,
): void {
  const w = enemyState.warden
  w.attackHitDone = true
  const inv = pdist > 1e-4 ? 1 / pdist : 0
  enemyState.playerKnockX += pdx * inv * 16
  enemyState.playerKnockY += 5
  enemyState.playerKnockZ += pdz * inv * 16
  enemyState.playerHitCount++
  // blood price (mercy window handled inside; SLAM+LASH overlap can't double-dip).
  // Event position = the WARDEN (damage source) — the HUD rotates its
  // directional damage arc from it. Gnaw events stay player-positioned.
  if (atk.damage > 0) {
    damagePlayer(atk.damage, t, HK.PLAYER_TAKEN, w.x, w.y, w.z)
  }
  if (atk.chargeDrain > 0 && runState.shiftCharge > 0) {
    runState.shiftCharge = Math.max(0, runState.shiftCharge - atk.chargeDrain)
    runState.combat.chargeDrained++
    pushFeedback('CHARGE TORN AWAY', '', 'warn')
  }
}

function segPointDist(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  px: number,
  py: number,
  pz: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const apx = px - ax
  const apy = py - ay
  const apz = pz - az
  const len2 = abx * abx + aby * aby + abz * abz
  const t = len2 > 1e-8 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2)) : 0
  const dx = apx - abx * t
  const dy = apy - aby * t
  const dz = apz - abz * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ---------------------------------------------------------------------------
// spawning
// ---------------------------------------------------------------------------

function freeEnemy(i: number): void {
  const p = enemyState.pool
  if (p.latchSlot[i] >= 0) {
    const k = p.latchSlot[i]
    enemyState.latchSlots[k] = -1
    p.latchSlot[i] = -1
    recountLatched()
  }
  p.state[i] = ES.DORMANT
  p.serial[i]++
  p.hitFlash[i] = 0
  p.homeSlot[i] = -1
}

function findFreeSlot(): number {
  const p = enemyState.pool
  for (let i = 0; i < CAP; i++) if (p.state[i] === ES.DORMANT) return i
  return -1
}

let spawnCounter = 0

function initEnemy(i: number, x: number, y: number, z: number): void {
  const es = enemyState
  const p = es.pool
  const arch = worldState.depth % SWARM_ARCHETYPES.length
  const table = SWARM_ARCHETYPES[arch]
  const loop = Math.floor(worldState.depth / 6)
  spawnCounter++
  p.state[i] = ES.STALK
  p.archetype[i] = arch
  p.x[i] = x
  p.y[i] = y
  p.z[i] = z
  p.vx[i] = p.vy[i] = p.vz[i] = 0
  p.maxHp[i] = Math.round(table.hp * (1 + 0.1 * Math.min(3, loop)))
  p.hp[i] = p.maxHp[i]
  p.serial[i]++
  p.stateT[i] = 0
  p.seed[i] = hashInts(es.trackSeed, worldState.depth, spawnCounter, 0x408b) >>> 0
  p.latchSlot[i] = -1
  p.dir[i] = p.seed[i] & 1 ? 1 : -1
  p.ix[i] = p.iy[i] = p.iz[i] = 0
  p.homeSlot[i] = -1
  p.hitFlash[i] = 0
  p.tx[i] = p.ty[i] = p.tz[i] = 0
  p.lx[i] = x
  p.ly[i] = y
  p.lz[i] = z
  p.leapDur[i] = 1
}

/** One spawn attempt on an island perch inside the ring (director cadence). */
function trySpawnOne(inp: EnemyDirectorInput): boolean {
  const es = enemyState
  const slots = worldState.slots
  const gate = worldState.gate
  const slot = findFreeSlot()
  if (slot < 0) return false
  for (let attempt = 0; attempt < 10; attempt++) {
    const idx = Math.floor(es.rng() * slots.length)
    const isl = slots[idx]
    if (!isl || !isl.used) continue
    const cy = isl.y + isl.scale * variantTop(isl.variant) + 1.5 + es.rng() * 2.5
    const dx = isl.x - inp.px
    const dy = cy - inp.py
    const dz = isl.z - inp.pz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist < ENEMY.SPAWN_NEAR || dist > ENEMY.SPAWN_FAR) continue
    const horiz = Math.sqrt(dx * dx + dz * dz) || 1
    const dot = (dx / horiz) * inp.fx + (dz / horiz) * inp.fz
    if (dot < -0.6) continue
    if (gate.active) {
      const gdx = isl.x - gate.x
      const gdz = isl.z - gate.z
      if (gdx * gdx + gdz * gdz < 14 * 14) continue
    }
    let crowded = false
    const p = es.pool
    for (let j = 0; j < CAP; j++) {
      if (p.state[j] === ES.DORMANT || p.state[j] === ES.DYING) continue
      const ex = p.x[j] - isl.x
      const ez = p.z[j] - isl.z
      if (ex * ex + ez * ez < 10 * 10) {
        crowded = true
        break
      }
    }
    if (crowded) continue
    initEnemy(slot, isl.x, cy, isl.z)
    return true
  }
  return false
}

/** Warden summon: ring around the body, cap-respecting, no placement rules. */
function summonAt(cx: number, cy: number, cz: number): void {
  const es = enemyState
  const slot = findFreeSlot()
  if (slot < 0) return
  const a = es.rng() * Math.PI * 2
  const r = 6 + es.rng() * 4
  initEnemy(slot, cx + Math.cos(a) * r, cy + 1 + es.rng() * 2, cz + Math.sin(a) * r)
}

// ---------------------------------------------------------------------------
// the director + per-frame simulation
// ---------------------------------------------------------------------------

function tierWeights(tier: number, tierFrom: number, blend: number): [number, number, number, number] {
  const w: [number, number, number, number] = [0, 0, 0, 0]
  const e = blend * blend * (3 - 2 * blend)
  const add = (ti: number, wt: number) => {
    const c = Math.max(0, Math.min(3, Math.floor(ti)))
    w[c] += wt
  }
  add(tier, e)
  add(blend < 1 ? tierFrom : tier, 1 - e)
  return w
}

function tw(w: [number, number, number, number], vals: readonly number[]): number {
  return w[0] * vals[0] + w[1] * vals[1] + w[2] * vals[2] + w[3] * vals[3]
}

const frac = (v: number) => v - Math.floor(v)

export function updateEnemies(dt: number, t: number, inp: EnemyDirectorInput): void {
  const es = enemyState
  const p = es.pool
  const mods = worldState.modsGen

  // ---- realm swap: epoch diff clears the field, grace re-arms ----
  if (worldState.epoch !== es.epoch) {
    es.epoch = worldState.epoch
    clearSwarm()
    clearWarden()
    reseed(worldState.depth)
    es.graceLeft = ENEMY.SWAP_GRACE_SEC
    es.nextSpawnIn = 0
    es.lastGateOpenedAt = worldState.gate.openedAt
    es.lastGateX = worldState.gate.x
    es.lastGateZ = worldState.gate.z
  }

  // ---- warden lifecycle from the gate ----
  const gate = worldState.gate
  if (gate.active && gate.openedAt !== es.lastGateOpenedAt) {
    es.lastGateOpenedAt = gate.openedAt
    const moved =
      Math.abs(gate.x - es.lastGateX) > 40 || Math.abs(gate.z - es.lastGateZ) > 40
    if (!es.warden.active || es.warden.phase === WP.DEAD || !moved) {
      spawnWarden(gate.x, gate.y, gate.z, worldState.depth % 6, mods.wardenHpMult, t)
    } else {
      // the gate teleported ahead of a fleeing player — its jailer follows
      spawnWarden(gate.x, gate.y, gate.z, worldState.depth % 6, mods.wardenHpMult, t)
    }
    es.lastGateX = gate.x
    es.lastGateZ = gate.z
  }
  updateWarden(dt, t, inp)

  // ---- pressure director ----
  const w = tierWeights(inp.tier, inp.tierFrom, inp.tierBlend)
  const diff = inp.difficultyMult ?? 1
  const budget =
    es.graceLeft > 0
      ? 0
      : Math.min(CAP, Math.round(tw(w, ENEMY.BUDGET) * mods.enemyDensity * diff))
  const tokens = Math.round(tw(w, ENEMY.TOKENS) * mods.enemyAggroMult * diff)
  if (es.graceLeft > 0) es.graceLeft -= dt
  const alive = liveSwarmCount()

  es.nextSpawnIn -= dt
  if (alive < budget && es.nextSpawnIn <= 0) {
    trySpawnOne(inp)
    es.nextSpawnIn = tw(w, ENEMY.SPAWN_TICK) / Math.max(0.25, mods.enemyAggroMult * diff)
  }

  es.retreatCheckIn -= dt
  if (es.retreatCheckIn <= 0) {
    es.retreatCheckIn = 1
    const excess = alive - budget - 2
    if (excess > 0) {
      // mark the farthest hunters for retreat
      for (let n = 0; n < excess; n++) {
        let far = -1
        let farD = -1
        for (let i = 0; i < CAP; i++) {
          const s = p.state[i]
          if (s !== ES.STALK && s !== ES.CIRCLE) continue
          const dx = p.x[i] - inp.px
          const dy = p.y[i] - inp.py
          const dz = p.z[i] - inp.pz
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 > farD) {
            farD = d2
            far = i
          }
        }
        if (far < 0) break
        p.state[far] = ES.RETREAT
        p.stateT[far] = 0
      }
    }
  }

  // ---- coordinated leap wave on a musical drop ----
  if (inp.dropCount !== es.lastDropCount) {
    const firstFrame = es.lastDropCount === -1
    es.lastDropCount = inp.dropCount
    if (!firstFrame) {
      let surged = false
      for (let i = 0; i < CAP; i++) {
        if (p.state[i] !== ES.CIRCLE) continue
        const table = SWARM_ARCHETYPES[p.archetype[i]]
        const dx = p.x[i] - inp.px
        const dy = p.y[i] - inp.py
        const dz = p.z[i] - inp.pz
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist > table.leapRange[1] * 1.4) continue
        p.state[i] = ES.WINDUP
        // pre-advanced windup: the drop wave strikes at 0.45x telegraph
        p.stateT[i] = table.windupDur * 0.55
        surged = true
      }
      if (surged) pushFeedback('THE SWARM SURGES', '', 'warn')
    }
  }

  // ---- per-enemy state machine + steering ----
  const speedScale = Math.max(0.1, inp.enemySpeedMult) * mods.enemySpeedMult * (inp.difficultyMult ?? 1)
  let attackers = 0
  for (let i = 0; i < CAP; i++) {
    const s = p.state[i]
    if (s === ES.WINDUP || s === ES.LEAP || s === ES.LATCHED) attackers++
  }

  for (let i = 0; i < CAP; i++) {
    const s = p.state[i]
    if (s === ES.DORMANT) continue
    const table = SWARM_ARCHETYPES[p.archetype[i]]
    p.stateT[i] += dt
    p.hitFlash[i] *= Math.exp(-8 * dt)

    if (s === ES.DYING) {
      if (p.stateT[i] >= ENEMY.DEATH_HOLD) freeEnemy(i)
      continue
    }

    const dxp = inp.px - p.x[i]
    const dyp = inp.py - p.y[i]
    const dzp = inp.pz - p.z[i]
    const pdist = Math.sqrt(dxp * dxp + dyp * dyp + dzp * dzp)

    if (s === ES.LATCHED) {
      // coarse sim position rides the player; the renderer owns exact attach
      p.x[i] = inp.px
      p.y[i] = inp.py
      p.z[i] = inp.pz
      // gnaw ticks: stateless floor-crossing derivation, deterministic under
      // any dt slicing — the un-dodgeable pressure clock behind the hp pool
      const g0 = Math.floor((p.stateT[i] - dt - PLAYER_HP.gnawFirstAt) / PLAYER_HP.gnawPeriod)
      const g1 = Math.floor((p.stateT[i] - PLAYER_HP.gnawFirstAt) / PLAYER_HP.gnawPeriod)
      if (g1 > g0 && g1 >= 0) {
        damagePlayer(PLAYER_HP.gnawDamage, t, HK.LATCH_GNAW, inp.px, inp.py, inp.pz)
      }
      if (p.stateT[i] >= table.latchDur) releaseLatch(i, t, true)
      continue
    }

    if (s === ES.LEAP) {
      const k = Math.min(1, p.stateT[i] / p.leapDur[i])
      const nx = p.lx[i] + (p.tx[i] - p.lx[i]) * k
      const ny =
        p.ly[i] + (p.ty[i] - p.ly[i]) * k + table.arcLift * 4 * k * (1 - k)
      const nz = p.lz[i] + (p.tz[i] - p.lz[i]) * k
      p.vx[i] = (nx - p.x[i]) / Math.max(1e-4, dt)
      p.vy[i] = (ny - p.y[i]) / Math.max(1e-4, dt)
      p.vz[i] = (nz - p.z[i]) / Math.max(1e-4, dt)
      p.x[i] = nx
      p.y[i] = ny
      p.z[i] = nz
      // contact test on the POST-move position, and before the overshoot
      // check — a fast leap must never tunnel through the player in one frame
      const cdx = inp.px - nx
      const cdy = inp.py - ny
      const cdz = inp.pz - nz
      const contact = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz)
      if (contact < ENEMY.LATCH_R && !inp.playerUntargetable) {
        if (!tryLatch(i, t)) {
          p.state[i] = ES.STAGGER
          p.stateT[i] = 0
        }
        continue
      }
      if (k >= 1) {
        // overshoot — the dodge is rewarded with a vulnerability window
        p.state[i] = ES.STAGGER
        p.stateT[i] = 0
      }
      continue
    }

    if (s === ES.WINDUP) {
      // hold, quiver (renderer), launch on the beat when one is near
      p.vx[i] *= Math.exp(-8 * dt)
      p.vy[i] *= Math.exp(-8 * dt)
      p.vz[i] *= Math.exp(-8 * dt)
      const due = p.stateT[i] >= table.windupDur
      const overdue = p.stateT[i] >= table.windupDur + 0.4
      if ((due && inp.beatPulse > 0.55) || overdue) {
        const leapDist = Math.max(1, pdist)
        const dur = Math.max(0.22, leapDist / (table.leapSpeed * speedScale))
        p.lx[i] = p.x[i]
        p.ly[i] = p.y[i]
        p.lz[i] = p.z[i]
        p.tx[i] = inp.px + inp.pvx * dur
        p.ty[i] = Math.max(-30, Math.min(52, inp.py + inp.pvy * dur))
        p.tz[i] = inp.pz + inp.pvz * dur
        p.leapDur[i] = dur
        p.state[i] = ES.LEAP
        p.stateT[i] = 0
      }
      continue
    }

    // ---- STALK / CIRCLE / STAGGER / RETREAT steering ----
    const seedFrac = (p.seed[i] % 1024) / 1024
    let goalX = inp.px
    let goalY = inp.py + table.orbitY
    let goalZ = inp.pz
    let accel = table.accel * speedScale
    let speed = table.speed * speedScale
    let drag = 1.2

    if (s === ES.STAGGER) {
      if (p.stateT[i] >= 0.8) {
        p.state[i] = ES.CIRCLE
        p.stateT[i] = 0
      }
      drag = 2.5
      accel = 0
    } else if (s === ES.RETREAT) {
      const inv = pdist > 1e-4 ? 1 / pdist : 0
      goalX = p.x[i] - dxp * inv * 30
      goalY = p.y[i] - dyp * inv * 10
      goalZ = p.z[i] - dzp * inv * 30
      if (pdist > ENEMY.RETREAT_DESPAWN_R) {
        freeEnemy(i)
        continue
      }
    } else if (s === ES.STALK) {
      if (pdist < table.engageR) {
        p.state[i] = ES.CIRCLE
        p.stateT[i] = 0
      }
    } else if (s === ES.CIRCLE) {
      // orbit goal: current angle advanced by a lead arc
      const ang = Math.atan2(p.z[i] - inp.pz, p.x[i] - inp.px)
      const lead = ang + p.dir[i] * 0.55
      goalX = inp.px + Math.cos(lead) * table.standoffR
      goalZ = inp.pz + Math.sin(lead) * table.standoffR
      goalY = inp.py + table.orbitY

      // attack-token request (seeded cadence so grants desynchronize)
      if (
        tokens > attackers &&
        pdist >= table.leapRange[0] &&
        pdist <= table.leapRange[1] &&
        p.stateT[i] > 1.4 + seedFrac &&
        !inp.playerUntargetable
      ) {
        p.state[i] = ES.WINDUP
        p.stateT[i] = 0
        attackers++
        continue
      }
    }

    // ---- style modulation ----
    const style = table.style
    if (s === ES.STALK || s === ES.CIRCLE) {
      if (style === STYLE.STUTTER) {
        const phase = (t + seedFrac * table.styleB * 7) / table.styleB
        if (Math.floor(phase) !== Math.floor(phase - dt / table.styleB)) {
          // blink along the orbit tangent
          const ang = Math.atan2(p.z[i] - inp.pz, p.x[i] - inp.px)
          const jump = table.styleA * (0.7 + 0.5 * frac(seedFrac * 13 + phase))
          p.x[i] += -Math.sin(ang) * p.dir[i] * jump
          p.z[i] += Math.cos(ang) * p.dir[i] * jump
          p.hitFlash[i] = Math.max(p.hitFlash[i], 0.7)
        }
      } else if (style === STYLE.SKITTER) {
        refreshHome(i)
        const hs = p.homeSlot[i]
        if (hs >= 0) {
          const isl = worldState.slots[hs]
          goalY = isl.y + isl.scale * variantTop(isl.variant) + 0.6
        }
        if (frac((t + seedFrac * table.styleB) / table.styleB) < 0.25) accel *= table.styleA
      } else if (style === STYLE.SWOOP) {
        goalY += Math.sin(t * table.styleB * Math.PI * 2 + seedFrac * 6.283) * table.styleA
      } else if (style === STYLE.PUPPET) {
        const pulsing = frac((t + seedFrac) / table.styleB) < table.styleA
        if (pulsing) accel *= 3
        else {
          accel = 0
          drag = 6
        }
      } else if (style === STYLE.BURROW) {
        refreshHome(i)
        const cyc = frac((t + seedFrac * table.styleB) / table.styleB)
        const submerged = cyc < table.styleA
        const hs = p.homeSlot[i]
        if (submerged && hs >= 0) {
          const isl = worldState.slots[hs]
          goalX = isl.x
          goalZ = isl.z
          goalY = isl.y - isl.scale * 0.3
          accel *= 1.4
        }
      } else if (style === STYLE.DASH) {
        if (frac((t + seedFrac * table.styleB) / table.styleB) < 0.21) {
          accel *= table.styleA
          speed *= 1.6
          drag = 0.3
        }
      }
    }

    // seek + integrate
    if (accel > 0) {
      const gx = goalX - p.x[i]
      const gy = goalY - p.y[i]
      const gz = goalZ - p.z[i]
      const glen = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1
      const k = 1 - Math.exp((-dt * accel) / Math.max(1, speed))
      p.vx[i] += ((gx / glen) * speed - p.vx[i]) * k
      p.vy[i] += ((gy / glen) * speed - p.vy[i]) * k
      p.vz[i] += ((gz / glen) * speed - p.vz[i]) * k
    }

    // separation (skip attached/dying — cheap O(n^2) scalar pass)
    for (let j = i + 1; j < CAP; j++) {
      const sj = p.state[j]
      if (sj === ES.DORMANT || sj === ES.DYING || sj === ES.LATCHED || sj === ES.LEAP) continue
      const sx = p.x[i] - p.x[j]
      const sy = p.y[i] - p.y[j]
      const sz = p.z[i] - p.z[j]
      const d2 = sx * sx + sy * sy + sz * sz
      if (d2 > 16 || d2 < 1e-6) continue
      const d = Math.sqrt(d2)
      const push = ((4 - d) / 4) * 6 * dt
      const inv = 1 / d
      p.vx[i] += sx * inv * push
      p.vy[i] += sy * inv * push
      p.vz[i] += sz * inv * push
      p.vx[j] -= sx * inv * push
      p.vy[j] -= sy * inv * push
      p.vz[j] -= sz * inv * push
    }

    // vertical band springs (horrors can never bait the player out of it)
    if (p.y[i] < -30) p.vy[i] += (-30 - p.y[i]) * 2 * dt
    else if (p.y[i] > 52) p.vy[i] += (52 - p.y[i]) * 2 * dt

    // knockback impulses accumulated since last tick
    p.vx[i] += p.ix[i]
    p.vy[i] += p.iy[i]
    p.vz[i] += p.iz[i]
    p.ix[i] = p.iy[i] = p.iz[i] = 0

    const dragK = Math.exp(-drag * dt)
    p.vx[i] *= dragK
    p.vy[i] *= dragK
    p.vz[i] *= dragK
    p.x[i] += p.vx[i] * dt
    p.y[i] += p.vy[i] * dt
    p.z[i] += p.vz[i] * dt

    // despawn far strays
    if (pdist > ENEMY.DESPAWN_R && s !== ES.LEAP) freeEnemy(i)
  }

  // ---- bolts ----
  const b = es.bolts
  for (let i = 0; i < ENEMY.BOLT_CAP; i++) {
    if (!b.active[i]) continue
    if (t - b.bornAt[i] > b.life[i]) {
      b.active[i] = 0
      b.serial[i]++
      continue
    }
    // mild homing toward a validated target (per-bolt strength: a full draw
    // is an AIMED shot and barely corrects)
    const hi = b.homeIdx[i]
    if (hi >= 0 && p.serial[hi] === b.homeSerial[i] && isTargetable(p.state[hi])) {
      const dx = p.x[hi] - b.x[i]
      const dy = p.y[hi] - b.y[i]
      const dz = p.z[hi] - b.z[i]
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const sp = Math.sqrt(b.vx[i] ** 2 + b.vy[i] ** 2 + b.vz[i] ** 2) || 1
      const maxTurn = b.homeTurn[i] * dt
      b.vx[i] += ((dx / dl) * sp - b.vx[i]) * maxTurn
      b.vy[i] += ((dy / dl) * sp - b.vy[i]) * maxTurn
      b.vz[i] += ((dz / dl) * sp - b.vz[i]) * maxTurn
    } else {
      b.homeIdx[i] = -1
    }
    // ballistic arc — after homing so a locked bolt still lands
    b.vy[i] -= b.grav[i] * dt
    b.x[i] += b.vx[i] * dt
    b.y[i] += b.vy[i] * dt
    b.z[i] += b.vz[i] * dt
    // swarm hit (skip victims this bolt already struck — pierce guard)
    let hit = false
    const heavy = b.power[i] >= 0.5
    const rr = b.radius[i] * b.radius[i]
    for (let e = 0; e < CAP; e++) {
      if (!isTargetable(p.state[e])) continue
      let already = false
      for (let k = 0; k < b.hitCount[i]; k++) {
        const j = i * BOLT_HIT_TRACK + k
        if (b.hitIdx[j] === e && b.hitSerial[j] === p.serial[e]) {
          already = true
          break
        }
      }
      if (already) continue
      const dx = p.x[e] - b.x[i]
      const dy = p.y[e] - b.y[i]
      const dz = p.z[e] - b.z[i]
      if (dx * dx + dy * dy + dz * dz < rr) {
        damageEnemy(e, b.dmg[i], t, 1, b.crit[i] === 1 || heavy)
        if (heavy) {
          // the meaty shove — also staggers WINDUP/LEAP enemies for free
          applyRadialImpulse(b.x[i], b.y[i], b.z[i], COMBAT.cast.knockR, COMBAT.cast.knock * b.power[i])
        }
        if (b.pierceLeft[i] > 0) {
          b.pierceLeft[i]--
          const j = i * BOLT_HIT_TRACK + Math.min(b.hitCount[i], BOLT_HIT_TRACK - 1)
          b.hitIdx[j] = e
          b.hitSerial[j] = p.serial[e]
          if (b.hitCount[i] < BOLT_HIT_TRACK) b.hitCount[i]++
        } else {
          hit = true
        }
        break // one victim per bolt per frame
      }
    }
    // warden body hit — a boss always consumes the bolt (no pierce through)
    const wd = es.warden
    if (!hit && wd.active && wd.phase >= WP.GUARD && wd.phase < WP.DYING) {
      const dx = wd.x - b.x[i]
      const dy = wd.y - b.y[i]
      const dz = wd.z - b.z[i]
      const r = WARDEN_ARCHETYPES[wd.archetype].bodyR
      if (dx * dx + dy * dy + dz * dz < r * r) {
        damageWarden(b.dmg[i], t, 1)
        hit = true
      }
    }
    if (hit) {
      b.active[i] = 0
      b.serial[i]++
    }
  }
}

/** Debug (Y key): conjure a horror already latched onto the player. */
export function debugForceLatch(px: number, py: number, pz: number, t: number): boolean {
  const slot = findFreeSlot()
  if (slot < 0) return false
  initEnemy(slot, px, py, pz)
  return tryLatch(slot, t)
}

/** Debug (L key): fell the whole live swarm at once. */
export function debugKillSwarm(t: number): void {
  const p = enemyState.pool
  for (let i = 0; i < CAP; i++) {
    const s = p.state[i]
    if (s !== ES.DORMANT && s !== ES.DYING) killEnemy(i, t, 1)
  }
}

/** Amortized nearest-island cache refresh (serial-guarded, cheap scan). */
function refreshHome(i: number): void {
  const p = enemyState.pool
  const hs = p.homeSlot[i]
  if (hs >= 0) {
    const isl = worldState.slots[hs]
    if (isl && isl.used && isl.serial === p.homeSerial[i]) {
      const dx = isl.x - p.x[i]
      const dz = isl.z - p.z[i]
      if (dx * dx + dz * dz < 40 * 40) return // still a good perch
    }
    p.homeSlot[i] = -1
  }
  // full rescan for THIS enemy only (amortized by the early-out above)
  let best = -1
  let bestD = 34 * 34
  const slots = worldState.slots
  for (let j = 0; j < slots.length; j++) {
    const isl = slots[j]
    if (!isl.used) continue
    const dx = isl.x - p.x[i]
    const dz = isl.z - p.z[i]
    const d2 = dx * dx + dz * dz
    if (d2 < bestD) {
      bestD = d2
      best = j
    }
  }
  if (best >= 0) {
    p.homeSlot[i] = best
    p.homeSerial[i] = slots[best].serial
  }
}
