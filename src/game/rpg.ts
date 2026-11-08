/**
 * Persistent RPG progression: xp, attributes, shards, inventory, equipped
 * relics/rites, quest saves, lifetime tallies. Pure parse/merge logic in the
 * progress.ts mold — localStorage touched only in the load/save wrappers.
 * Level and unspent attribute points are ALWAYS derived from xp (never
 * stored), so the save cannot drift.
 */
import { BASE_STATS, type CombatStats } from './stats'
import { duplicateRelicShards, getItem } from './items'
import type { RunLoadout } from './runState'

export type AttributeId = 'vigor' | 'force' | 'grace' | 'attunement'
export const ATTRIBUTE_IDS: readonly AttributeId[] = ['vigor', 'force', 'grace', 'attunement']

/** Save-side quest states; 'locked'/'offered' are derived, never stored. */
export type QuestSaveState = 'active' | 'complete' | 'turnedIn'

export interface QuestSave {
  state: QuestSaveState
  /** Additive count, or high-water mark for reachDepth objectives. */
  progress: number
}

export interface BountySave {
  /** Local date the bounty belongs to, 'YYYY-MM-DD'. Mismatch => reset. */
  day: string
  progress: number
  claimed: boolean
}

/** A rolling NPC contract: everything re-derives from (seed, level) via
 * contracts.ts contractDef, so the save carries only progress. */
export interface ContractSave {
  seed: number
  /** Player level frozen at generation — target/reward never drift mid-run. */
  level: number
  state: 'active' | 'complete'
  progress: number
}

export interface ContractsSave {
  /** Total contracts turned in — reseeds the slots so they never repeat. */
  counter: number
  slots: [ContractSave | null, ContractSave | null, ContractSave | null]
}

/** The choice-of-3 a settled run leaves on the table until claimed. */
export interface PendingDrops {
  quality: number
  offers: [string, string, string]
}

export interface RpgData {
  /** Lifetime XP. Level is ALWAYS derived via levelForXp. */
  xp: number
  /** Spent points per attribute (0..ATTR_CAP each). */
  attributes: Record<AttributeId, number>
  /** Resonance Shards. Never negative. */
  shards: number
  /** Owned item id -> count (relics/trophies cap at 1, consumables stack). */
  items: Record<string, number>
  /** 3 relic sockets. */
  relics: [string | null, string | null, string | null]
  /** 2 consumable rite slots (keys 1/2 in-run). */
  loadout: [string | null, string | null]
  quests: Record<string, QuestSave>
  bounty: BountySave | null
  /** Rolling NPC contracts (the infinite quest loop). */
  contracts: ContractsSave
  /** Unclaimed choice-of-3 from the last settled run (refresh-proof). */
  pendingDrops: PendingDrops | null
  /** Lifetime kill tallies: realmId and 'warden:<realmId>' keys. */
  kills: Record<string, number>
  /** First-meeting dialog gating per NPC id. */
  npcMet: Record<string, boolean>
}

const KEY = 'astral.rpg.v1'

export const LEVEL_CAP = 30
export const ATTR_CAP = 12

export function defaultRpg(): RpgData {
  return {
    xp: 0,
    attributes: { vigor: 0, force: 0, grace: 0, attunement: 0 },
    shards: 0,
    items: {},
    relics: [null, null, null],
    loadout: [null, null],
    quests: {},
    bounty: null,
    contracts: { counter: 0, slots: [null, null, null] },
    pendingDrops: null,
    kills: {},
    npcMet: {},
  }
}

// ---------------------------------------------------------------------------
// progression math
// ---------------------------------------------------------------------------

/** XP required to go from `level` to `level + 1`. L1->2: 60, L2->3: 93, ... */
export function xpToNext(level: number): number {
  const k = Math.max(0, Math.floor(level) - 1)
  return 60 + 30 * k + 3 * k * k
}

export function levelForXp(xp: number): number {
  let level = 1
  let need = 0
  while (level < LEVEL_CAP) {
    need += xpToNext(level)
    if (xp < need) break
    level++
  }
  return level
}

/** Progress inside the current level, for XP bars: {into, span}. At the cap
 * span reports the last step and into saturates. */
export function xpIntoLevel(xp: number): { into: number; span: number } {
  const x = Math.max(0, xp)
  let level = 1
  let base = 0
  while (level < LEVEL_CAP && x >= base + xpToNext(level)) {
    base += xpToNext(level)
    level++
  }
  const span = xpToNext(level)
  return { into: Math.min(span, x - base), span }
}

/** Attribute points granted by a level (1 per level past the first). */
export function pointsForLevel(level: number): number {
  return Math.max(0, Math.min(LEVEL_CAP, Math.floor(level)) - 1)
}

export function spentPoints(rpg: RpgData): number {
  return ATTRIBUTE_IDS.reduce((s, a) => s + rpg.attributes[a], 0)
}

export function unspentPoints(rpg: RpgData): number {
  return Math.max(0, pointsForLevel(levelForXp(rpg.xp)) - spentPoints(rpg))
}

// ---------------------------------------------------------------------------
// derived combat stats
// ---------------------------------------------------------------------------

const clampMult = (v: number) => Math.max(0.5, Math.min(2.5, v))

/** Attributes + equipped relics -> the frozen per-run CombatStats snapshot.
 * A fresh save returns exactly BASE_STATS (level 1 == the pre-RPG game). */
export function computeStats(rpg: RpgData): CombatStats {
  const a = rpg.attributes
  const s: CombatStats = {
    maxLatch: BASE_STATS.maxLatch + Math.floor(a.vigor / 3),
    // vigor pays continuously between its every-3rd-point latch breaks
    maxHp: BASE_STATS.maxHp + 8 * a.vigor,
    snapDamageMult: BASE_STATS.snapDamageMult + 0.05 * a.force,
    boltDamageMult: BASE_STATS.boltDamageMult + 0.04 * a.force,
    novaRadiusMult: BASE_STATS.novaRadiusMult + 0.03 * a.grace,
    moveMult: BASE_STATS.moveMult + 0.015 * a.grace,
    chargeGainMult: BASE_STATS.chargeGainMult + 0.04 * a.attunement,
    castSpeedMult: BASE_STATS.castSpeedMult,
    drawSpeedMult: BASE_STATS.drawSpeedMult,
    pierceBonus: BASE_STATS.pierceBonus,
  }
  for (const id of rpg.relics) {
    if (!id) continue
    const mods = getItem(id)?.mods
    if (!mods) continue
    if (mods.maxLatch) s.maxLatch += mods.maxLatch
    if (mods.maxHp) s.maxHp += mods.maxHp
    if (mods.snapDamageMult) s.snapDamageMult += mods.snapDamageMult
    if (mods.boltDamageMult) s.boltDamageMult += mods.boltDamageMult
    if (mods.novaRadiusMult) s.novaRadiusMult += mods.novaRadiusMult
    if (mods.moveMult) s.moveMult += mods.moveMult
    if (mods.chargeGainMult) s.chargeGainMult += mods.chargeGainMult
    if (mods.castSpeedMult) s.castSpeedMult += mods.castSpeedMult
    if (mods.drawSpeedMult) s.drawSpeedMult += mods.drawSpeedMult
    if (mods.pierceBonus) s.pierceBonus += mods.pierceBonus
  }
  // maxLatch is bounded by the 6 physical latch anchors on the avatar
  s.maxLatch = Math.max(1, Math.min(6, Math.round(s.maxLatch)))
  s.maxHp = Math.max(40, Math.min(400, Math.round(s.maxHp)))
  s.snapDamageMult = clampMult(s.snapDamageMult)
  s.boltDamageMult = clampMult(s.boltDamageMult)
  s.novaRadiusMult = clampMult(s.novaRadiusMult)
  s.moveMult = clampMult(s.moveMult)
  s.chargeGainMult = clampMult(s.chargeGainMult)
  s.castSpeedMult = clampMult(s.castSpeedMult)
  s.drawSpeedMult = clampMult(s.drawSpeedMult)
  s.pierceBonus = Math.max(0, Math.min(2, Math.round(s.pierceBonus)))
  return s
}

/** The frozen snapshot resetRun() takes when a run starts. */
export function buildRunLoadout(rpg: RpgData): RunLoadout {
  return {
    stats: computeStats(rpg),
    loadout: [rpg.loadout[0], rpg.loadout[1]],
    charges: [
      rpg.loadout[0] ? (rpg.items[rpg.loadout[0]] ?? 0) : 0,
      rpg.loadout[1] ? (rpg.items[rpg.loadout[1]] ?? 0) : 0,
    ],
  }
}

// ---------------------------------------------------------------------------
// pure appliers (fresh objects, never mutate input)
// ---------------------------------------------------------------------------

function cloneRpg(rpg: RpgData): RpgData {
  return {
    xp: rpg.xp,
    attributes: { ...rpg.attributes },
    shards: rpg.shards,
    items: { ...rpg.items },
    relics: [...rpg.relics],
    loadout: [...rpg.loadout],
    quests: Object.fromEntries(Object.entries(rpg.quests).map(([k, v]) => [k, { ...v }])),
    bounty: rpg.bounty ? { ...rpg.bounty } : null,
    contracts: {
      counter: rpg.contracts.counter,
      slots: [
        rpg.contracts.slots[0] ? { ...rpg.contracts.slots[0] } : null,
        rpg.contracts.slots[1] ? { ...rpg.contracts.slots[1] } : null,
        rpg.contracts.slots[2] ? { ...rpg.contracts.slots[2] } : null,
      ],
    },
    pendingDrops: rpg.pendingDrops
      ? {
          quality: rpg.pendingDrops.quality,
          offers: [...rpg.pendingDrops.offers] as [string, string, string],
        }
      : null,
    kills: { ...rpg.kills },
    npcMet: { ...rpg.npcMet },
  }
}

export type BuyFailReason = 'poor' | 'owned' | 'unknown'

export function tryBuy(
  rpg: RpgData,
  itemId: string,
): { next: RpgData; ok: boolean; reason?: BuyFailReason } {
  const item = getItem(itemId)
  if (!item || item.price <= 0) return { next: rpg, ok: false, reason: 'unknown' }
  if (item.kind !== 'consumable' && (rpg.items[itemId] ?? 0) > 0) {
    return { next: rpg, ok: false, reason: 'owned' }
  }
  if (rpg.shards < item.price) return { next: rpg, ok: false, reason: 'poor' }
  const next = cloneRpg(rpg)
  next.shards -= item.price
  next.items[itemId] = (next.items[itemId] ?? 0) + 1
  return { next, ok: true }
}

export function equipRelic(
  rpg: RpgData,
  itemId: string,
  slot: number,
): { next: RpgData; ok: boolean } {
  const item = getItem(itemId)
  if (
    !item ||
    item.kind !== 'relic' ||
    (rpg.items[itemId] ?? 0) < 1 ||
    slot < 0 ||
    slot > 2 ||
    !Number.isInteger(slot)
  ) {
    return { next: rpg, ok: false }
  }
  const next = cloneRpg(rpg)
  // auto-move instead of duplicating across sockets
  for (let i = 0; i < 3; i++) {
    if (next.relics[i] === itemId) next.relics[i] = null
  }
  next.relics[slot] = itemId
  return { next, ok: true }
}

export function unequipRelic(rpg: RpgData, slot: number): { next: RpgData; ok: boolean } {
  if (slot < 0 || slot > 2 || !Number.isInteger(slot) || rpg.relics[slot] === null) {
    return { next: rpg, ok: false }
  }
  const next = cloneRpg(rpg)
  next.relics[slot] = null
  return { next, ok: true }
}

export function setLoadoutSlot(
  rpg: RpgData,
  slot: number,
  itemId: string | null,
): { next: RpgData; ok: boolean } {
  if (slot < 0 || slot > 1 || !Number.isInteger(slot)) return { next: rpg, ok: false }
  if (itemId !== null) {
    const item = getItem(itemId)
    if (!item || item.kind !== 'consumable' || (rpg.items[itemId] ?? 0) < 1) {
      return { next: rpg, ok: false }
    }
  }
  const next = cloneRpg(rpg)
  // the same rite cannot occupy both slots
  for (let i = 0; i < 2; i++) {
    if (itemId !== null && next.loadout[i] === itemId) next.loadout[i] = null
  }
  next.loadout[slot] = itemId
  return { next, ok: true }
}

export function spendPoint(rpg: RpgData, attr: AttributeId): { next: RpgData; ok: boolean } {
  if (unspentPoints(rpg) < 1 || rpg.attributes[attr] >= ATTR_CAP) {
    return { next: rpg, ok: false }
  }
  const next = cloneRpg(rpg)
  next.attributes[attr] += 1
  return { next, ok: true }
}

export interface RewardGrant {
  xp?: number
  shards?: number
  items?: Record<string, number>
}

/** Shared by quest turn-in and run settlement. Duplicate relics/trophies
 * convert to shards instead of stacking. */
export function grantRewards(rpg: RpgData, grant: RewardGrant): RpgData {
  const next = cloneRpg(rpg)
  if (grant.xp && grant.xp > 0) next.xp += Math.floor(grant.xp)
  if (grant.shards && grant.shards > 0) next.shards += Math.floor(grant.shards)
  if (grant.items) {
    for (const [id, count] of Object.entries(grant.items)) {
      const item = getItem(id)
      if (!item || count < 1) continue
      if (item.kind === 'consumable') {
        next.items[id] = (next.items[id] ?? 0) + Math.floor(count)
      } else if ((next.items[id] ?? 0) > 0) {
        next.shards += duplicateRelicShards(item) * Math.floor(count)
      } else {
        next.items[id] = 1
        const extra = Math.floor(count) - 1
        if (extra > 0) next.shards += duplicateRelicShards(item) * extra
      }
    }
  }
  return next
}

/** Claim one of the three pending drop offers; the others dissolve with the
 * pendingDrops record. Duplicate conversion rides grantRewards for free. */
export function claimPendingDrop(rpg: RpgData, index: 0 | 1 | 2): { next: RpgData; ok: boolean } {
  const pending = rpg.pendingDrops
  if (!pending) return { next: rpg, ok: false }
  const id = pending.offers[index]
  if (typeof id !== 'string' || !getItem(id)) return { next: rpg, ok: false }
  const next = grantRewards(rpg, { items: { [id]: 1 } })
  next.pendingDrops = null
  return { next, ok: true }
}

// ---------------------------------------------------------------------------
// corrupt-safe parse (heals player-favorably) + storage wrappers
// ---------------------------------------------------------------------------

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

export function parseRpg(raw: string | null): RpgData {
  const out = defaultRpg()
  if (!raw) return out
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    if (typeof p.xp === 'number' && Number.isFinite(p.xp)) out.xp = Math.max(0, Math.floor(p.xp))
    if (typeof p.shards === 'number' && Number.isFinite(p.shards)) {
      out.shards = Math.max(0, Math.floor(p.shards))
    }
    if (p.attributes && typeof p.attributes === 'object') {
      const attrs = p.attributes as Record<string, unknown>
      for (const a of ATTRIBUTE_IDS) {
        const v = attrs[a]
        if (typeof v === 'number' && Number.isFinite(v)) {
          out.attributes[a] = Math.max(0, Math.min(ATTR_CAP, Math.floor(v)))
        }
      }
    }
    // over-spent attributes (tampered/corrupt) heal to zero — points refund
    if (spentPoints(out) > pointsForLevel(levelForXp(out.xp))) {
      out.attributes = { vigor: 0, force: 0, grace: 0, attunement: 0 }
    }
    if (p.items && typeof p.items === 'object') {
      for (const [id, v] of Object.entries(p.items as Record<string, unknown>)) {
        // getItem resolves both the static catalog and gen:* ids — malformed
        // gen ids come back null and drop silently (the existing heal)
        const item = getItem(id)
        const n = asCount(v)
        if (!item || n < 1) continue // unknown/removed items drop silently
        out.items[id] = item.kind === 'consumable' ? n : 1
      }
    }
    const readSocket = (v: unknown, kind: 'relic' | 'consumable'): string | null => {
      if (typeof v !== 'string') return null
      const item = getItem(v)
      if (!item || item.kind !== kind || (out.items[v] ?? 0) < 1) return null
      return v
    }
    if (Array.isArray(p.relics)) {
      for (let i = 0; i < 3; i++) {
        const id = readSocket(p.relics[i], 'relic')
        // a relic may occupy only one socket
        out.relics[i] = id !== null && out.relics.includes(id) ? null : id
      }
    }
    if (Array.isArray(p.loadout)) {
      for (let i = 0; i < 2; i++) {
        const id = readSocket(p.loadout[i], 'consumable')
        out.loadout[i] = id !== null && out.loadout.includes(id) ? null : id
      }
    }
    if (p.quests && typeof p.quests === 'object') {
      for (const [id, v] of Object.entries(p.quests as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue
        const q = v as Record<string, unknown>
        if (q.state !== 'active' && q.state !== 'complete' && q.state !== 'turnedIn') continue
        const progress =
          typeof q.progress === 'number' && Number.isFinite(q.progress)
            ? Math.max(0, Math.floor(q.progress))
            : 0
        out.quests[id] = { state: q.state, progress }
      }
    }
    if (p.bounty && typeof p.bounty === 'object') {
      const b = p.bounty as Record<string, unknown>
      if (typeof b.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.day)) {
        out.bounty = {
          day: b.day,
          progress: asCount(b.progress),
          claimed: b.claimed === true,
        }
      }
    }
    if (p.contracts && typeof p.contracts === 'object') {
      const c = p.contracts as Record<string, unknown>
      if (typeof c.counter === 'number' && Number.isFinite(c.counter)) {
        out.contracts.counter = Math.max(0, Math.floor(c.counter))
      }
      if (Array.isArray(c.slots)) {
        for (let i = 0; i < 3; i++) {
          const v = c.slots[i]
          if (!v || typeof v !== 'object') continue
          const s = v as Record<string, unknown>
          if (typeof s.seed !== 'number' || !Number.isFinite(s.seed)) continue
          if (s.state !== 'active' && s.state !== 'complete') continue
          out.contracts.slots[i] = {
            seed: s.seed >>> 0,
            level:
              typeof s.level === 'number' && Number.isFinite(s.level)
                ? Math.max(1, Math.min(LEVEL_CAP, Math.floor(s.level)))
                : 1,
            state: s.state,
            progress: asCount(s.progress),
          }
        }
      }
    }
    if (p.pendingDrops && typeof p.pendingDrops === 'object') {
      const d = p.pendingDrops as Record<string, unknown>
      if (
        Array.isArray(d.offers) &&
        d.offers.length === 3 &&
        d.offers.every(o => typeof o === 'string' && getItem(o) !== null)
      ) {
        out.pendingDrops = {
          quality:
            typeof d.quality === 'number' && Number.isFinite(d.quality)
              ? Math.max(0, Math.min(100, Math.round(d.quality)))
              : 0,
          offers: [d.offers[0], d.offers[1], d.offers[2]] as [string, string, string],
        }
      }
    }
    if (p.kills && typeof p.kills === 'object') {
      for (const [k, v] of Object.entries(p.kills as Record<string, unknown>)) {
        const n = asCount(v)
        if (n > 0) out.kills[k] = n
      }
    }
    if (p.npcMet && typeof p.npcMet === 'object') {
      for (const [k, v] of Object.entries(p.npcMet as Record<string, unknown>)) {
        if (v === true) out.npcMet[k] = true
      }
    }
  } catch {
    // corrupt JSON -> fresh save
  }
  return out
}

export function loadRpg(): RpgData {
  try {
    return parseRpg(localStorage.getItem(KEY))
  } catch {
    return defaultRpg()
  }
}

export function saveRpg(rpg: RpgData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rpg))
  } catch {
    // storage unavailable (private mode) — progression just doesn't persist
  }
}
