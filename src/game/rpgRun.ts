/**
 * Run settlement: fold one finished run's counters into the persistent
 * RpgData — xp, shards, consumable charges, deterministic warden drops,
 * quest/bounty progress, lifetime tallies. One pure entry point called from
 * endRun(); kept separate so rpg/items/quests stay acyclic.
 */
import { REALMS } from './realms'
import { hashInts, mulberry32 } from './seededRandom'
import { duplicateRelicShards, getItem, WARDEN_DROPS } from './items'
import { dropQuality, rollOffers } from './genItems'
import { grantRewards, levelForXp, type RpgData } from './rpg'
import {
  applyRunToBounty,
  applyRunToQuests,
  type QuestRunCounters,
} from './quests'
import { applyRunToContracts, contractGates, normalizeContracts } from './contracts'
import type { QuestTick, RunOutcome } from '../types'

/** Snapshot lifted off runState + the result inside endRun(). */
export interface RunCounters {
  outcome: RunOutcome
  /** 1-based human depth reached. */
  depth: number
  collected: number
  perfects: number
  durationPlayed: number
  /** Indexed by realm archetype (depth % 6). */
  killsByArchetype: number[]
  wardenKillsByArchetype: number[]
  shardsEarned: number
  latchesSuffered: number
  consumablesUsed: [number, number]
  loadout: [string | null, string | null]
  /** Track analysis seed — drop-roll determinism. */
  seed: number
}

export interface RunSettlement {
  next: RpgData
  xpGained: number
  levelBefore: number
  levelAfter: number
  shardsGained: number
  /** Item ids granted this run (duplicates already converted to shards). */
  drops: string[]
  /** Shards paid out for a previous run's unclaimed choice-of-3 offers. */
  stalePendingShards: number
  questTicks: QuestTick[]
}

function sum(arr: number[]): number {
  let s = 0
  for (const v of arr) s += v
  return s
}

/** XP for a settled run. Downed runs pay half — the deep keeps its cut. */
export function xpForRun(c: RunCounters): number {
  const kills = sum(c.killsByArchetype)
  const wardens = sum(c.wardenKillsByArchetype)
  const base = 10 * Math.max(0, c.depth) + c.collected + 2 * kills + 30 * wardens
  return Math.round(base * (c.outcome === 'downed' ? 0.5 : 1))
}

function byRealmId(arr: number[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < REALMS.length; i++) {
    if (arr[i] > 0) out[REALMS[i].id] = arr[i]
  }
  return out
}

/** Deterministic warden loot for this run (duplicate conversion happens in
 * grantRewards at settlement). */
export function rollDrops(c: RunCounters): string[] {
  const kills = sum(c.killsByArchetype)
  const rng = mulberry32(hashInts(c.seed, c.depth, kills, 0xd06))
  const rolled: string[] = []
  for (let i = 0; i < REALMS.length; i++) {
    const count = c.wardenKillsByArchetype[i] ?? 0
    const table = WARDEN_DROPS[`warden:${REALMS[i].id}`]
    if (!table) continue
    for (let k = 0; k < count; k++) {
      for (const roll of table) {
        if (rng() < roll.chance) rolled.push(roll.itemId)
      }
    }
  }
  return rolled
}

export function settleRun(rpg: RpgData, c: RunCounters, todayStr: string): RunSettlement {
  const levelBefore = levelForXp(rpg.xp)
  const xpGained = xpForRun(c)
  // attunement pays a settlement bonus on shards earned in the field
  const shardsGained = Math.round(c.shardsEarned * (1 + 0.03 * rpg.attributes.attunement))

  // ---- consumable charges: burned in-run, persisted only now (atomic) ----
  let next: RpgData = {
    ...rpg,
    items: { ...rpg.items },
    quests: rpg.quests,
    kills: { ...rpg.kills },
  }
  for (let slot = 0; slot < 2; slot++) {
    const id = c.loadout[slot]
    const used = c.consumablesUsed[slot]
    if (!id || used < 1) continue
    const left = Math.max(0, (next.items[id] ?? 0) - used)
    if (left > 0) next.items[id] = left
    else delete next.items[id]
  }

  // ---- deterministic warden drops (duplicates convert inside grantRewards) ----
  const drops = rollDrops(c)
  const dropGrant: Record<string, number> = {}
  const dropIds: string[] = []
  for (const id of drops) {
    if (!getItem(id)) continue
    dropGrant[id] = (dropGrant[id] ?? 0) + 1
    dropIds.push(id)
  }

  // ---- a previous run's unclaimed offers dissolve into shards (deterministic,
  //      player-favorable: a third of each offer's dupe value) ----
  let stalePendingShards = 0
  if (next.pendingDrops) {
    for (const id of next.pendingDrops.offers) {
      const item = getItem(id)
      if (item) stalePendingShards += Math.floor(duplicateRelicShards(item) / 3)
    }
  }

  next = grantRewards(next, {
    xp: xpGained,
    shards: shardsGained + stalePendingShards,
    items: dropGrant,
  })

  // ---- the new choice-of-3 this run puts on the table ----
  const kills = sum(c.killsByArchetype)
  const wardenKills = sum(c.wardenKillsByArchetype)
  const quality = dropQuality(c.depth, c.perfects, wardenKills, kills, c.outcome === 'downed')
  next.pendingDrops = { quality, offers: rollOffers(c.seed, c.depth, kills, quality) }

  // ---- quests + bounty ----
  const questCounters: QuestRunCounters = {
    depth: c.depth,
    collected: c.collected,
    perfects: c.perfects,
    latchesSuffered: c.latchesSuffered,
    shardsEarned: c.shardsEarned,
    killsByRealm: byRealmId(c.killsByArchetype),
    wardenKillsByRealm: byRealmId(c.wardenKillsByArchetype),
  }
  const questResult = applyRunToQuests(next.quests, questCounters)
  const bountyResult = applyRunToBounty(next.bounty, todayStr, questCounters)
  // contracts: fill any empty unlocked slots first (deterministic for a fixed
  // counter/level), then advance them with the same counters
  const filled = normalizeContracts(
    next.contracts,
    levelForXp(next.xp),
    contractGates(questResult.next),
  )
  const contractResult = applyRunToContracts(filled, questCounters)
  next = {
    ...next,
    quests: questResult.next,
    bounty: bountyResult.next,
    contracts: contractResult.next,
  }
  const questTicks = [
    ...questResult.ticks,
    ...(bountyResult.tick ? [bountyResult.tick] : []),
    ...contractResult.ticks,
  ]

  // ---- lifetime tallies ----
  for (let i = 0; i < REALMS.length; i++) {
    const id = REALMS[i].id
    const k = c.killsByArchetype[i] ?? 0
    if (k > 0) next.kills[id] = (next.kills[id] ?? 0) + k
    const w = c.wardenKillsByArchetype[i] ?? 0
    if (w > 0) next.kills[`warden:${id}`] = (next.kills[`warden:${id}`] ?? 0) + w
  }

  return {
    next,
    xpGained,
    levelBefore,
    levelAfter: levelForXp(next.xp),
    shardsGained,
    drops: dropIds,
    stalePendingShards,
    questTicks,
  }
}

/** Local 'YYYY-MM-DD' for bounty day-keying. */
export function localDayString(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
