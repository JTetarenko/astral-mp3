/**
 * Quest system: fixed chains from the Sanctum NPCs plus a rotating daily
 * bounty. Progress is evaluated ONCE per run at settlement from the run's
 * counters — no per-frame hooks anywhere. Pure module, node-testable.
 */
import { hashInts } from './seededRandom'
import type { BountySave, QuestSave, QuestSaveState } from './rpg'
import type { QuestTick } from '../types'

export type ObjectiveKind =
  | 'killArchetype' // realmId set => that realm's swarm; omitted => all swarm kills
  | 'killWarden' // realmId set => that warden; omitted => any warden
  | 'reachDepth' // high-water mark of human depth
  | 'collectPoints'
  | 'perfectSnaps'
  | 'earnShards'
  | 'surviveNoLatch' // binary per run: needs zero latches AND depth >= 2

export interface QuestObjective {
  kind: ObjectiveKind
  target: number
  /** Realm id filter for killArchetype / killWarden. */
  realmId?: string
}

export interface QuestReward {
  xp: number
  shards: number
  itemId?: string
  itemCount?: number
}

export interface QuestDef {
  id: string
  /** NPC id offering it. */
  giver: string
  title: string
  brief: string
  objective: QuestObjective
  reward: QuestReward
  /** Prerequisite quest id (must be turnedIn before this one is offered). */
  requires?: string
}

export const QUESTS: QuestDef[] = [
  // ---- Elara the Lorekeeper: ledger & lore ----
  {
    id: 'e1-first-offering',
    giver: 'elara',
    title: 'FIRST OFFERING',
    brief: 'The ledger opens with small change. Bring resonance.',
    objective: { kind: 'collectPoints', target: 30 },
    reward: { xp: 50, shards: 30 },
  },
  {
    id: 'e2-perfect-word',
    giver: 'elara',
    title: 'THE PERFECT WORD',
    brief: 'Precision is a kind of prayer. Snap without error.',
    objective: { kind: 'perfectSnaps', target: 20 },
    reward: { xp: 90, shards: 0, itemId: 'loop-eater-sigil' },
    requires: 'e1-first-offering',
  },
  {
    id: 'e3-six-below',
    giver: 'elara',
    title: 'SIX BELOW',
    brief: 'The sixth realm has a margin I cannot read from here.',
    objective: { kind: 'reachDepth', target: 6 },
    reward: { xp: 120, shards: 80 },
    requires: 'e1-first-offering',
  },
  {
    id: 'e4-deep-ink',
    giver: 'elara',
    title: 'DEEP INK',
    brief: 'Twelve realms down, the ink writes itself. Witness it.',
    objective: { kind: 'reachDepth', target: 12 },
    reward: { xp: 250, shards: 0, itemId: 'stillwater-torc' },
    requires: 'e3-six-below',
  },
  {
    id: 'e5-tithe-of-sparks',
    giver: 'elara',
    title: 'TITHE OF SPARKS',
    brief: 'Shards are the deep paying attention. Collect its regard.',
    objective: { kind: 'earnShards', target: 300 },
    reward: { xp: 100, shards: 0, itemId: 'vial-of-stillness', itemCount: 2 },
    requires: 'e1-first-offering',
  },
  {
    id: 'e6-ink-and-ash',
    giver: 'elara',
    title: 'INK AND ASH',
    brief: 'Two hundred resonances. The chapter needs a spine.',
    objective: { kind: 'collectPoints', target: 200 },
    reward: { xp: 200, shards: 150 },
    requires: 'e2-perfect-word',
  },
  // ---- Korr, the Broken Warden: the hunt ----
  {
    id: 'k1-first-blood',
    giver: 'korr',
    title: 'FIRST BLOOD',
    brief: 'The swarms below wear my old colors. Strip ten of them.',
    objective: { kind: 'killArchetype', target: 10 },
    reward: { xp: 60, shards: 40 },
  },
  {
    id: 'k2-cull-the-chorus',
    giver: 'korr',
    title: 'CULL THE CHORUS',
    brief: 'The Cathedral sings with stolen throats. Silence twenty-five.',
    objective: { kind: 'killArchetype', target: 25, realmId: 'cathedral' },
    reward: { xp: 110, shards: 60 },
    requires: 'k1-first-blood',
  },
  {
    id: 'k3-the-green-warden',
    giver: 'korr',
    title: 'THE GREEN WARDEN',
    brief: 'The Thorn Tyrant took my post at the jungle gate. Retire it.',
    objective: { kind: 'killWarden', target: 1, realmId: 'jungle' },
    reward: { xp: 150, shards: 0, itemId: 'gravemoss-crown' },
    requires: 'k1-first-blood',
  },
  {
    id: 'k4-broken-mirror',
    giver: 'korr',
    title: 'BROKEN MIRROR',
    brief: 'The Rift Maw has my face. Correct that.',
    objective: { kind: 'killWarden', target: 1, realmId: 'collapse' },
    reward: { xp: 200, shards: 0, itemId: 'chorus-of-teeth' },
    requires: 'k3-the-green-warden',
  },
  {
    id: 'k5-no-purchase',
    giver: 'korr',
    title: 'NO PURCHASE',
    brief: 'Descend past the second realm untouched. Give them nothing.',
    objective: { kind: 'surviveNoLatch', target: 1 },
    reward: { xp: 150, shards: 0, itemId: 'phoenix-ash' },
    requires: 'k2-cull-the-chorus',
  },
  {
    id: 'k6-ember-heart',
    giver: 'korr',
    title: 'EMBER HEART',
    brief: 'The Core keeps a sovereign. Bring me its cold.',
    objective: { kind: 'killWarden', target: 1, realmId: 'lavacore' },
    reward: { xp: 300, shards: 0, itemId: 'ember-vertebra' },
    requires: 'k4-broken-mirror',
  },
]

export const QUESTS_BY_ID: Record<string, QuestDef> = Object.fromEntries(
  QUESTS.map(q => [q.id, q]),
)

/** Rotating daily bounties (giver korr). Chosen by local date, offline-pure. */
export const BOUNTY_POOL: QuestDef[] = [
  {
    id: 'bounty-cull',
    giver: 'korr',
    title: 'BOUNTY: THE CULL',
    brief: 'Twenty horrors, any realm. The deep is lighter by that much.',
    objective: { kind: 'killArchetype', target: 20 },
    reward: { xp: 80, shards: 60 },
  },
  {
    id: 'bounty-harvest',
    giver: 'korr',
    title: 'BOUNTY: THE HARVEST',
    brief: 'Sixty resonances before the song forgets you.',
    objective: { kind: 'collectPoints', target: 60 },
    reward: { xp: 80, shards: 60 },
  },
  {
    id: 'bounty-precision',
    giver: 'korr',
    title: 'BOUNTY: THE FLICK',
    brief: 'Fifteen perfect snaps. Show the swarm what aim is.',
    objective: { kind: 'perfectSnaps', target: 15 },
    reward: { xp: 80, shards: 60 },
  },
  {
    id: 'bounty-tithe',
    giver: 'korr',
    title: 'BOUNTY: THE TITHE',
    brief: 'A hundred and twenty shards, torn from the dark.',
    objective: { kind: 'earnShards', target: 120 },
    reward: { xp: 80, shards: 60 },
  },
]

/** Deterministic bounty for a 'YYYY-MM-DD' local date string. */
export function bountyForDay(dateStr: string): QuestDef {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  const y = m ? Number(m[1]) : 0
  const mo = m ? Number(m[2]) : 0
  const d = m ? Number(m[3]) : 0
  return BOUNTY_POOL[hashInts(y, mo, d, 0xb0) % BOUNTY_POOL.length]
}

/** Day-roll handling: a stale bounty save resets for the new day. Pure. */
export function normalizeBounty(bounty: BountySave | null, todayStr: string): BountySave {
  if (bounty && bounty.day === todayStr) return bounty
  return { day: todayStr, progress: 0, claimed: false }
}

export type QuestAvailability = 'locked' | 'offered' | QuestSaveState

export function questAvailability(
  def: QuestDef,
  saves: Record<string, QuestSave>,
): QuestAvailability {
  const save = saves[def.id]
  if (save) return save.state
  if (def.requires && saves[def.requires]?.state !== 'turnedIn') return 'locked'
  return 'offered'
}

/** The per-run counter snapshot quests consume (built by settleRun from
 * runState.combat + RunResult fields; realm-id keyed). */
export interface QuestRunCounters {
  /** 1-based human depth reached. */
  depth: number
  collected: number
  perfects: number
  latchesSuffered: number
  shardsEarned: number
  killsByRealm: Record<string, number>
  wardenKillsByRealm: Record<string, number>
}

export function objectiveDelta(obj: QuestObjective, c: QuestRunCounters): number {
  switch (obj.kind) {
    case 'killArchetype': {
      if (obj.realmId) return c.killsByRealm[obj.realmId] ?? 0
      let sum = 0
      for (const v of Object.values(c.killsByRealm)) sum += v
      return sum
    }
    case 'killWarden': {
      if (obj.realmId) return c.wardenKillsByRealm[obj.realmId] ?? 0
      let sum = 0
      for (const v of Object.values(c.wardenKillsByRealm)) sum += v
      return sum
    }
    case 'reachDepth':
      return c.depth // high-water handled by the caller
    case 'collectPoints':
      return c.collected
    case 'perfectSnaps':
      return c.perfects
    case 'earnShards':
      return c.shardsEarned
    case 'surviveNoLatch':
      return c.latchesSuffered === 0 && c.depth >= 2 ? 1 : 0
  }
}

/** Exported for contracts.ts — rolling contracts reuse the exact same
 * settlement math as the fixed chains. */
export function advanceObjective(
  def: QuestDef,
  save: QuestSave,
  c: QuestRunCounters,
): QuestSave | null {
  return advance(def, save, c)
}

function advance(def: QuestDef, save: QuestSave, c: QuestRunCounters): QuestSave | null {
  const delta = objectiveDelta(def.objective, c)
  const after =
    def.objective.kind === 'reachDepth'
      ? Math.max(save.progress, delta)
      : save.progress + delta
  if (after === save.progress) return null
  const capped = Math.min(def.objective.target, after)
  return {
    state: capped >= def.objective.target ? 'complete' : 'active',
    progress: capped,
  }
}

/**
 * Advance every ACTIVE quest by one settled run. Returns fresh saves plus
 * the ticks the end screen shows. Never mutates input.
 */
export function applyRunToQuests(
  saves: Record<string, QuestSave>,
  counters: QuestRunCounters,
): { next: Record<string, QuestSave>; ticks: QuestTick[] } {
  const next: Record<string, QuestSave> = Object.fromEntries(
    Object.entries(saves).map(([k, v]) => [k, { ...v }]),
  )
  const ticks: QuestTick[] = []
  for (const def of QUESTS) {
    const save = next[def.id]
    if (!save || save.state !== 'active') continue
    const advanced = advance(def, save, counters)
    if (!advanced) continue
    ticks.push({
      questId: def.id,
      title: def.title,
      before: save.progress,
      after: advanced.progress,
      target: def.objective.target,
      completed: advanced.state === 'complete',
    })
    next[def.id] = advanced
  }
  return { next, ticks }
}

/** Advance the daily bounty (auto-active, no accept step). Pure. */
export function applyRunToBounty(
  bounty: BountySave | null,
  todayStr: string,
  counters: QuestRunCounters,
): { next: BountySave; tick: QuestTick | null } {
  const normalized = normalizeBounty(bounty, todayStr)
  if (normalized.claimed) return { next: normalized, tick: null }
  const def = bountyForDay(normalized.day)
  const save: QuestSave = { state: 'active', progress: normalized.progress }
  const advanced = advance(def, save, counters)
  if (!advanced) return { next: normalized, tick: null }
  return {
    next: { ...normalized, progress: advanced.progress },
    tick: {
      questId: def.id,
      title: def.title,
      before: normalized.progress,
      after: advanced.progress,
      target: def.objective.target,
      completed: advanced.progress >= def.objective.target,
    },
  }
}

/** Bounty completion check for the hub CLAIM button. */
export function bountyComplete(bounty: BountySave | null, todayStr: string): boolean {
  const b = normalizeBounty(bounty, todayStr)
  return !b.claimed && b.progress >= bountyForDay(b.day).objective.target
}
