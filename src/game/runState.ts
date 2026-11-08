import { initialScoreState, type ScoreState } from './scoring'
import { shiftCostForDepth } from './realms'
import { BASE_STATS, cloneStats, type CombatStats } from './stats'

export type FeedbackKind =
  | 'perfect'
  | 'good'
  | 'ok'
  | 'beat'
  | 'complete'
  | 'descent'
  | 'realm'
  | 'kill'
  | 'latch'
  | 'nova'
  | 'warden'
  | 'downed'
  | 'warn'

export interface FeedbackMsg {
  id: number
  title: string
  sub: string
  kind: FeedbackKind
  /** Wall-clock seconds at push (performance.now()/1000) — the toast
   * renderer's expiry base. Wall time on purpose: toasts keep aging through
   * a sim hit-stop. */
  at: number
}

export interface LastActivation {
  x: number
  y: number
  z: number
  at: number
}

/**
 * Combat event surface: monotonic counters + timestamps mutated by enemyState
 * and diffed by consumers (renderer flashes, RPG settlement) — never callbacks.
 * Archetype arrays are indexed by realm index (depth % 6).
 */
export interface CombatCounters {
  kills: number
  killsByArchetype: number[]
  wardenKills: number
  wardenKillsByArchetype: number[]
  /** Post-multiplier damage, all sources, plus per-source splits. */
  damageDealt: number
  strikeDamage: number
  boltDamage: number
  novaDamage: number
  boltsFired: number
  novasFired: number
  latchesSuffered: number
  /** Tear-offs + expiries + nova releases. */
  shakeoffs: number
  /** Warden charge-theft events. */
  chargeDrained: number
  /** Loot currency earned this run (swarm 1, warden 10). */
  shardsEarned: number
  lastKillAt: number
  lastLatchAt: number
  /** Player HP lost this run, all sources + per-source splits. */
  damageTaken: number
  wardenDamageTaken: number
  gnawDamageTaken: number
  /** Sim clock of the last player-damage event (regen delay base). -1 = never. */
  lastDamageTakenAt: number
  /** Sim clock of the last WARDEN hit on the player (mercy window base). */
  lastWardenDamageAt: number
}

export function freshCombatCounters(): CombatCounters {
  return {
    kills: 0,
    killsByArchetype: [0, 0, 0, 0, 0, 0],
    wardenKills: 0,
    wardenKillsByArchetype: [0, 0, 0, 0, 0, 0],
    damageDealt: 0,
    strikeDamage: 0,
    boltDamage: 0,
    novaDamage: 0,
    boltsFired: 0,
    novasFired: 0,
    latchesSuffered: 0,
    shakeoffs: 0,
    chargeDrained: 0,
    shardsEarned: 0,
    lastKillAt: -1,
    lastLatchAt: -1,
    damageTaken: 0,
    wardenDamageTaken: 0,
    gnawDamageTaken: 0,
    lastDamageTakenAt: -1,
    lastWardenDamageAt: -1,
  }
}

/** Timed consumable auras, seconds remaining (ticked by EnemyDirector). */
export interface ActiveEffects {
  stasisT: number
  veilT: number
  frenzyT: number
}

/** Per-run RPG loadout snapshot passed into resetRun by the store. */
export interface RunLoadout {
  stats: CombatStats
  loadout: [string | null, string | null]
  charges: [number, number]
}

/**
 * Mutable per-run state. Read directly from frame loops (scene + HUD rAF);
 * never mirrored into React state. Reset via resetRun() when a run starts.
 * Depth/shift fields mirror worldState so the HUD reads one place.
 */
export interface RunStateData {
  scoreState: ScoreState
  /** Player blood pool, 0..stats.maxHp. Mutated ONLY via playerHealth.ts. */
  hp: number
  /** 0-based realm depth (mirrors worldState.depth). HUD shows depth + 1. */
  depth: number
  /** Resonance points collected this run, across all realms. */
  collected: number
  shiftCharge: number
  shiftCost: number
  shiftsDone: number
  /** Best human depth from previous runs — HUD flags NEW DEEPEST past this. */
  bestDepthPrev: number
  snaps: number
  perfects: number
  goods: number
  onBeats: number
  lastActivation: LastActivation | null
  feedback: FeedbackMsg[]
  combat: CombatCounters
  /** Frozen CombatStats snapshot for this run — the combat sim reads ONLY this. */
  stats: CombatStats
  /** Consumable rite slots (item ids) + charges remaining in-run. */
  loadout: [string | null, string | null]
  loadoutCharges: [number, number]
  /** Charges burned this run — persisted to RpgData only at settlement. */
  consumablesUsed: [number, number]
  activeEffects: ActiveEffects
}

/** Timed-rite durations in seconds — the sim (EnemyDirector), the HUD drain
 * bars, and the aura visuals all read this one table. Keys = ItemEffect ids. */
export const RITE_DURATION = { stasisAura: 4, veil: 6, frenzy: 8 } as const

export const runState: RunStateData = {
  scoreState: initialScoreState(),
  hp: BASE_STATS.maxHp,
  depth: 0,
  collected: 0,
  shiftCharge: 0,
  shiftCost: shiftCostForDepth(0),
  shiftsDone: 0,
  bestDepthPrev: 0,
  snaps: 0,
  perfects: 0,
  goods: 0,
  onBeats: 0,
  lastActivation: null,
  feedback: [],
  combat: freshCombatCounters(),
  stats: cloneStats(BASE_STATS),
  loadout: [null, null],
  loadoutCharges: [0, 0],
  consumablesUsed: [0, 0],
  activeEffects: { stasisT: 0, veilT: 0, frenzyT: 0 },
}

let feedbackId = 0

export function resetRun(startDepth = 0, bestDepthPrev = 0, rpgRun?: RunLoadout): void {
  runState.scoreState = initialScoreState()
  runState.depth = startDepth
  runState.collected = 0
  runState.shiftCharge = 0
  runState.shiftCost = shiftCostForDepth(startDepth)
  runState.shiftsDone = 0
  runState.bestDepthPrev = bestDepthPrev
  runState.snaps = 0
  runState.perfects = 0
  runState.goods = 0
  runState.onBeats = 0
  runState.lastActivation = null
  runState.feedback.length = 0
  runState.combat = freshCombatCounters()
  runState.stats = cloneStats(rpgRun?.stats ?? BASE_STATS)
  runState.hp = runState.stats.maxHp
  runState.loadout = rpgRun ? [...rpgRun.loadout] : [null, null]
  runState.loadoutCharges = rpgRun ? [...rpgRun.charges] : [0, 0]
  runState.consumablesUsed = [0, 0]
  runState.activeEffects.stasisT = 0
  runState.activeEffects.veilT = 0
  runState.activeEffects.frenzyT = 0
}

/** Wall-clock seconds (toast expiry base; monotonic, hit-stop-immune). */
function nowSec(): number {
  return typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000
}

/**
 * The combat-readability pass gave this queue its renderer at last: the HUD
 * toast layer drains it (kind-filtered — snap grades ride the reticle and
 * damage bubbles instead). The 8-item cap keeps it leak-free either way.
 */
export function pushFeedback(title: string, sub: string, kind: FeedbackKind): void {
  runState.feedback.push({ id: feedbackId++, title, sub, kind, at: nowSec() })
  if (runState.feedback.length > 8) runState.feedback.shift()
}
