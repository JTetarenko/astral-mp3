/**
 * Rolling NPC contracts — the infinite quest loop. Three auto-active slots
 * (two from Korr's hunt board, one from Elara's ledger) generated from seeded
 * templates over the existing ObjectiveKind vocabulary; settlement reuses
 * quests.ts advanceObjective verbatim. Everything about a contract re-derives
 * from (seed, level) — the save carries only progress (the genItems doctrine).
 *
 * Pure module: type-only imports from rpg.ts (no runtime cycle), node-tested.
 */
import { REALMS } from './realms'
import { hashInts, mulberry32, pick } from './seededRandom'
import { rollItem } from './genItems'
import {
  advanceObjective,
  type QuestDef,
  type QuestRunCounters,
} from './quests'
import type { ContractSave, ContractsSave, QuestSave } from './rpg'
import type { QuestTick } from '../types'

/** Slot -> giver: Korr posts two hunts, Elara one ledger errand. */
export const CONTRACT_GIVERS = ['korr', 'korr', 'elara'] as const

interface ContractTemplate {
  key: string
  giver: 'korr' | 'elara'
  title: (realmLabel: string, target: number) => string
  brief: (realmLabel: string, target: number) => string
  /** Objective for a given level (realm chosen by rng where relevant). */
  objective: (level: number, rng: () => number) => QuestDef['objective']
}

const TEMPLATES: readonly ContractTemplate[] = [
  {
    key: 'culling',
    giver: 'korr',
    title: () => 'CONTRACT: THE CULLING',
    brief: (_r, t) => `${t} horrors, any realm. Rates, not mercy.`,
    objective: level => ({ kind: 'killArchetype', target: 15 + 3 * level }),
  },
  {
    key: 'strip',
    giver: 'korr',
    title: r => `CONTRACT: STRIP THE ${r}`,
    brief: (r, t) => `${t} of the ${r.toLowerCase()}'s swarm, unmade.`,
    objective: (level, rng) => ({
      kind: 'killArchetype',
      target: 8 + 2 * level,
      realmId: pick(rng, REALMS).id,
    }),
  },
  {
    key: 'warden',
    giver: 'korr',
    title: () => 'CONTRACT: RETIRE A WARDEN',
    brief: () => 'Any gate-keeper. They all wear my old colors.',
    objective: () => ({ kind: 'killWarden', target: 1 }),
  },
  {
    key: 'untouched',
    giver: 'korr',
    title: () => 'CONTRACT: GIVE THEM NOTHING',
    brief: () => 'Past the second realm without a single latch.',
    objective: () => ({ kind: 'surviveNoLatch', target: 1 }),
  },
  {
    key: 'depth',
    giver: 'korr',
    title: (_r, t) => `CONTRACT: STAND AT DEPTH ${t}`,
    brief: (_r, t) => `The deep measures you at ${t}. Measure back.`,
    objective: level => ({
      kind: 'reachDepth',
      target: Math.min(20, 4 + Math.floor(level / 2)),
    }),
  },
  {
    key: 'tithe',
    giver: 'elara',
    title: () => 'CONTRACT: TITHE OF RESONANCE',
    brief: (_r, t) => `${t} resonances for the ledger's margin.`,
    objective: level => ({ kind: 'collectPoints', target: 40 + 8 * level }),
  },
  {
    key: 'word',
    giver: 'elara',
    title: () => 'CONTRACT: THE EXACT WORD',
    brief: (_r, t) => `${t} perfect snaps. The ink accepts no less.`,
    objective: level => ({ kind: 'perfectSnaps', target: 10 + 2 * level }),
  },
  {
    key: 'cut',
    giver: 'elara',
    title: () => "CONTRACT: THE LEDGER'S CUT",
    brief: (_r, t) => `${t} shards earned below. The house keeps none.`,
    objective: level => ({ kind: 'earnShards', target: 80 + 15 * level }),
  },
]

/** The full QuestDef-shaped derivation for a saved contract. The 'contract:'
 * id prefix guarantees no collision with QUESTS_BY_ID. */
export function contractDef(save: ContractSave, slot: number): QuestDef {
  const giver = CONTRACT_GIVERS[Math.max(0, Math.min(2, slot))]
  const rng = mulberry32(hashInts(save.seed, save.level, slot, 0xc0de))
  const pool = TEMPLATES.filter(t => t.giver === giver)
  const template = pool[Math.floor(rng() * pool.length) % pool.length]
  const objective = template.objective(save.level, rng)
  const realmLabel = objective.realmId
    ? (REALMS.find(r => r.id === objective.realmId)?.label ?? 'DEEP')
    : 'DEEP'
  // every third seed sweetens the pot with a generated relic — the faucet
  const withItem = save.seed % 3 === 0
  const itemId = withItem
    ? rollItem(hashInts(save.seed, save.level, 0x17e2, slot), Math.min(100, 25 + 2 * save.level)).id
    : undefined
  return {
    id: `contract:${(save.seed >>> 0).toString(16).padStart(8, '0')}`,
    giver,
    title: template.title(realmLabel, objective.target),
    brief: template.brief(realmLabel, objective.target),
    objective,
    reward: {
      xp: Math.round(45 + 9 * save.level),
      shards: Math.round(35 + 7 * save.level),
      itemId,
    },
  }
}

export interface ContractGates {
  korr: boolean
  elara: boolean
}

/** Slot unlock gates: contracts open once each giver's first quest settles. */
export function contractGates(saves: Record<string, QuestSave>): ContractGates {
  return {
    korr: saves['k1-first-blood']?.state === 'turnedIn',
    elara: saves['e1-first-offering']?.state === 'turnedIn',
  }
}

function slotUnlocked(slot: number, gates: ContractGates): boolean {
  return CONTRACT_GIVERS[slot] === 'korr' ? gates.korr : gates.elara
}

/** Fill empty unlocked slots (normalizeBounty mold — pure, idempotent for a
 * fixed counter/level). Returns the same object when nothing changed. */
export function normalizeContracts(
  contracts: ContractsSave,
  level: number,
  gates: ContractGates,
): ContractsSave {
  let changed = false
  const slots = [...contracts.slots] as ContractsSave['slots']
  for (let slot = 0; slot < 3; slot++) {
    if (slots[slot] || !slotUnlocked(slot, gates)) continue
    slots[slot] = {
      seed: hashInts(contracts.counter, slot, level, 0xc047),
      level: Math.max(1, Math.floor(level)),
      state: 'active',
      progress: 0,
    }
    changed = true
  }
  return changed ? { counter: contracts.counter, slots } : contracts
}

/** Advance every active contract by one settled run (settlement path). */
export function applyRunToContracts(
  contracts: ContractsSave,
  counters: QuestRunCounters,
): { next: ContractsSave; ticks: QuestTick[] } {
  const ticks: QuestTick[] = []
  let changed = false
  const slots = [...contracts.slots] as ContractsSave['slots']
  for (let slot = 0; slot < 3; slot++) {
    const save = slots[slot]
    if (!save || save.state !== 'active') continue
    const def = contractDef(save, slot)
    const qs: QuestSave = { state: 'active', progress: save.progress }
    const advanced = advanceObjective(def, qs, counters)
    if (!advanced) continue
    slots[slot] = {
      ...save,
      state: advanced.state === 'complete' ? 'complete' : 'active',
      progress: advanced.progress,
    }
    ticks.push({
      questId: def.id,
      title: def.title,
      before: save.progress,
      after: advanced.progress,
      target: def.objective.target,
      completed: advanced.state === 'complete',
    })
    changed = true
  }
  return { next: changed ? { counter: contracts.counter, slots } : contracts, ticks }
}

/** Turn in a completed slot: caller grants contractDef().reward, then this
 * clears the slot and bumps the counter (the refill happens on the next
 * normalizeContracts with a fresh seed). */
export function completeContractSlot(contracts: ContractsSave, slot: number): ContractsSave {
  const slots = [...contracts.slots] as ContractsSave['slots']
  slots[slot] = null
  return { counter: contracts.counter + 1, slots }
}
