/**
 * Horror parameter tables: the six per-realm swarm archetypes, the six gate
 * wardens, latch anchor slots, and the director's pressure constants. Pure
 * data — enemyState.ts is the mechanism that reads it. Archetype index ==
 * realm index (depth % 6) everywhere.
 */

export const ENEMY = {
  SWARM_CAP: 24,
  /** Physical latch anchor slots on the player body (stats.maxLatch <= this). */
  LATCH_CAP: 6,
  /** Player-sphere radius a landing leap latches within. */
  LATCH_R: 2.4,
  /** Spawn ring relative to the player (world units). */
  SPAWN_NEAR: 34,
  SPAWN_FAR: 72,
  DESPAWN_R: 120,
  RETREAT_DESPAWN_R: 80,
  /** Seconds a dying enemy holds its slot for the dissolve to play. */
  DEATH_HOLD: 0.7,
  /** Run-start / post-swap seconds before the first spawn. */
  GRACE_SEC: 8,
  SWAP_GRACE_SEC: 4,
  /** Per-tier live-swarm budget (CALM/RISING/PEAK/SHATTER), pre realm/loop scale. */
  BUDGET: [2, 5, 10, 16] as const,
  /** Per-tier simultaneous attacker tokens (windup+leap+latched). CALM never leaps. */
  TOKENS: [0, 1, 2, 4] as const,
  /** Per-tier seconds between spawn attempts. */
  SPAWN_TICK: [2.2, 1.4, 0.8, 0.45] as const,
  /** Player-bolt pool. Sized for a storm fan (5) + a volley (3) + in-flight quicks. */
  BOLT_CAP: 16,
  /** Warden kill-sequence length (DYING -> DEAD). */
  WARDEN_DEATH_DUR: 2.6,
  WARDEN_EMERGE_DUR: 2,
  WARDEN_STAGGER_DUR: 2,
} as const

/** Motion styles the pose/steering code switches on. */
export const STYLE = {
  STUTTER: 0, // astral: drift + blink-teleport
  SKITTER: 1, // jungle: island-hugging darts
  SWOOP: 2, // cathedral: high sine arcs
  PUPPET: 3, // ritual: pulse-gated yanks
  BURROW: 4, // collapse: submerge/emerge cycle
  DASH: 5, // lavacore: ember dashes
} as const

export interface SwarmArchetype {
  id: string
  label: string
  hp: number
  speed: number
  accel: number
  /** STALK -> CIRCLE hand-off distance. */
  engageR: number
  /** Orbit radius while circling. */
  standoffR: number
  /** Preferred height offset vs the player while circling. */
  orbitY: number
  /** May request WINDUP when player distance is inside this band. */
  leapRange: readonly [number, number]
  /** Telegraph seconds before the leap launches. */
  windupDur: number
  leapSpeed: number
  /** Bezier apex lift: ~0.5 flat pounce .. ~6 diving strike. */
  arcLift: number
  /** Seconds a latch holds before auto-detaching to STAGGER. */
  latchDur: number
  style: number
  /** Style knobs (blink dist / swoop amp / dash mult / submerge duty ...). */
  styleA: number
  /** Style period seconds (blink cadence / swoop rate / dash cadence ...). */
  styleB: number
}

export const SWARM_ARCHETYPES: readonly SwarmArchetype[] = [
  {
    id: 'astral',
    label: 'HUSK PILGRIM',
    hp: 24,
    speed: 7,
    accel: 14,
    engageR: 44,
    standoffR: 13,
    orbitY: 1,
    leapRange: [8, 20],
    windupDur: 0.7,
    leapSpeed: 30,
    arcLift: 1.2,
    latchDur: 9,
    style: STYLE.STUTTER,
    styleA: 5.5,
    styleB: 1.6,
  },
  {
    id: 'jungle',
    label: 'VINE STRIDER',
    hp: 30,
    speed: 9,
    accel: 22,
    engageR: 40,
    standoffR: 11,
    orbitY: -0.5,
    leapRange: [7, 16],
    windupDur: 0.55,
    leapSpeed: 34,
    arcLift: 0.6,
    latchDur: 8,
    style: STYLE.SKITTER,
    styleA: 2.2,
    styleB: 2.4,
  },
  {
    id: 'cathedral',
    label: 'ROOD SHRIKE',
    hp: 28,
    speed: 8,
    accel: 12,
    engageR: 50,
    standoffR: 15,
    orbitY: 6,
    leapRange: [10, 26],
    windupDur: 0.8,
    leapSpeed: 30,
    arcLift: 5,
    latchDur: 8,
    style: STYLE.SWOOP,
    styleA: 7,
    styleB: 0.5,
  },
  {
    id: 'ritual',
    label: 'EFFIGY PUPPET',
    hp: 34,
    speed: 8.5,
    accel: 26,
    engageR: 42,
    standoffR: 10,
    orbitY: 0.5,
    leapRange: [7, 15],
    windupDur: 0.75,
    leapSpeed: 32,
    arcLift: 1,
    latchDur: 10,
    style: STYLE.PUPPET,
    styleA: 0.3,
    styleB: 0.35,
  },
  {
    id: 'collapse',
    label: 'CARRION WORM',
    hp: 40,
    speed: 7.5,
    accel: 16,
    engageR: 38,
    standoffR: 9,
    orbitY: -1,
    leapRange: [6, 13],
    windupDur: 0.7,
    leapSpeed: 28,
    arcLift: 0.8,
    latchDur: 11,
    style: STYLE.BURROW,
    styleA: 0.45,
    styleB: 5,
  },
  {
    id: 'lavacore',
    label: 'CINDER WISP',
    hp: 22,
    speed: 10,
    accel: 20,
    engageR: 46,
    standoffR: 12,
    orbitY: 0.8,
    leapRange: [8, 18],
    windupDur: 0.35,
    leapSpeed: 40,
    arcLift: 1.5,
    latchDur: 8,
    style: STYLE.DASH,
    styleA: 2.5,
    styleB: 1.9,
  },
]

/** Warden attack kinds. */
export const WK = { SUMMON: 0, LASH: 1, SLAM: 2 } as const

export interface WardenAttack {
  kind: number
  /** Telegraph seconds (telegraphT ramps 0..1 for renderer/sfx). */
  windup: number
  /** Execution seconds. */
  active: number
  recover: number
  /** SUMMON: count | LASH: sweep arc radians | SLAM: radius. */
  param: number
  /** shiftCharge stolen when the attack connects. */
  chargeDrain: number
  /** Player HP torn away on connect (0 for SUMMON — no contact test). */
  damage: number
}

export interface WardenArchetype {
  id: string
  label: string
  hp: number
  /** Body radius (bolt hits, knockback origin, weak-point orbit). */
  bodyR: number
  /** Preferred hover height above the gate. */
  hover: number
  /** Guard drift speed. */
  speed: number
  /** GUARD seconds between attacks. */
  attackPeriod: number
  /** Attacks per EXPOSED weak-point window. */
  exposeEvery: number
  /** Weak-point window seconds. */
  weakDur: number
  attacks: readonly WardenAttack[]
}

const A = (
  kind: number,
  windup: number,
  active: number,
  recover: number,
  param: number,
): WardenAttack => ({
  kind,
  windup,
  active,
  recover,
  param,
  chargeDrain: 1,
  // the slow slam earns the bigger punch; summons never touch you directly
  damage: kind === WK.SLAM ? 18 : kind === WK.LASH ? 12 : 0,
})

export const WARDEN_ARCHETYPES: readonly WardenArchetype[] = [
  {
    id: 'astral',
    label: 'VOIDMAW MATRIARCH',
    hp: 220,
    bodyR: 5,
    hover: 6,
    speed: 3,
    attackPeriod: 5.5,
    exposeEvery: 2,
    weakDur: 3.5,
    attacks: [A(WK.SUMMON, 1.2, 0.6, 1.2, 3), A(WK.LASH, 1.1, 0.8, 1.0, 1.0), A(WK.SLAM, 1.4, 0.4, 1.2, 10)],
  },
  {
    id: 'jungle',
    label: 'THORN TYRANT',
    hp: 240,
    bodyR: 5.5,
    hover: 5,
    speed: 3.5,
    attackPeriod: 5,
    exposeEvery: 2,
    weakDur: 3.5,
    attacks: [A(WK.SLAM, 1.2, 0.4, 1.1, 9), A(WK.LASH, 0.9, 0.7, 0.9, 1.2), A(WK.SUMMON, 1.1, 0.6, 1.1, 2)],
  },
  {
    id: 'cathedral',
    label: 'CANTOR OF THE HOLLOW',
    hp: 260,
    bodyR: 6,
    hover: 8,
    speed: 3,
    attackPeriod: 5.2,
    exposeEvery: 3,
    weakDur: 3.5,
    attacks: [A(WK.LASH, 1.0, 1.0, 1.0, 1.4), A(WK.SUMMON, 1.2, 0.6, 1.1, 3), A(WK.SLAM, 1.3, 0.5, 1.2, 12)],
  },
  {
    id: 'ritual',
    label: 'MARIONETTE IDOL',
    hp: 260,
    bodyR: 5,
    hover: 6,
    speed: 4,
    attackPeriod: 4.5,
    exposeEvery: 2,
    weakDur: 3.2,
    attacks: [A(WK.LASH, 0.7, 0.6, 0.8, 1.1), A(WK.SUMMON, 1.0, 0.5, 1.0, 3), A(WK.SLAM, 1.2, 0.4, 1.0, 9)],
  },
  {
    id: 'collapse',
    label: 'RIFT MAW',
    hp: 280,
    bodyR: 6,
    hover: 4,
    speed: 3.2,
    attackPeriod: 4.2,
    exposeEvery: 3,
    weakDur: 3.2,
    attacks: [A(WK.SLAM, 1.3, 0.5, 1.0, 10), A(WK.SUMMON, 1.1, 0.5, 1.0, 4), A(WK.LASH, 0.9, 0.8, 0.9, 1.3)],
  },
  {
    id: 'lavacore',
    label: 'CINDER SOVEREIGN',
    hp: 300,
    bodyR: 5.5,
    hover: 7,
    speed: 4.5,
    attackPeriod: 3.8,
    exposeEvery: 3,
    weakDur: 3,
    attacks: [A(WK.LASH, 0.8, 0.6, 0.8, 1.5), A(WK.SUMMON, 1.0, 0.5, 0.9, 3), A(WK.SLAM, 1.1, 0.4, 1.0, 11)],
  },
]

/** Body-local latch anchors [x, y, z, yawFacing] — shoulders, hips, spine,
 * hood. The renderer composes latched horrors onto these via avatarFrame. */
export const LATCH_ANCHORS: readonly (readonly [number, number, number, number])[] = [
  [0.55, 0.45, -0.1, Math.PI * 0.5],
  [-0.55, 0.45, -0.1, -Math.PI * 0.5],
  [0.4, -0.35, -0.15, Math.PI * 0.6],
  [-0.4, -0.35, -0.15, -Math.PI * 0.6],
  [0, 0.15, -0.5, Math.PI],
  [0, 0.62, 0.3, 0],
]
