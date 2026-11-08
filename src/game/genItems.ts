/**
 * The procedural relic layer. Every generated item is referenced everywhere
 * by a self-describing id — `gen:<version>:<seed8hex>:q<quality>` — and every
 * property re-derives from that id through pure rolls (the "derived, never
 * stored" doctrine: the save stays a tiny Record<id, count> and can never
 * drift from the generator). If affix tables ever change incompatibly, bump
 * GEN_VERSION; old ids re-roll at the same quality (player-favorable heal,
 * the parseRpg precedent).
 *
 * Pure module: imports itemTypes/stats/seededRandom only. Node-tested.
 */
import type { AffixRoll, GenItemMeta, ItemDef, Rarity } from './itemTypes'
import { RARITY_ORDER } from './itemTypes'
import type { CombatStats } from './stats'
import { hashInts, mulberry32, pick } from './seededRandom'

export const GEN_VERSION = 1

export type GenItem = ItemDef & { gen: GenItemMeta }

// ---------------------------------------------------------------------------
// affix table — data rows so new CombatStats keys are one-line additions
// ---------------------------------------------------------------------------

export interface AffixDef {
  id: string
  stat: keyof CombatStats
  /** Magnitude at quality 0 / quality 100 (pre ±15% jitter). */
  lo: number
  hi: number
  weight: number
  /** Minimum rarity tier (0..3) this affix appears at. */
  minTier: number
  round: 'int' | 'pct'
  /** Name-grammar noun pool — the dominant affix names the relic. */
  nouns: readonly string[]
}

export const AFFIXES: readonly AffixDef[] = [
  { id: 'grip', stat: 'maxLatch', lo: 1, hi: 1, weight: 4, minTier: 2, round: 'int', nouns: ['GRIP', 'ANCHOR', 'CHAIN', 'HOLD'] },
  { id: 'marrow', stat: 'maxHp', lo: 10, hi: 60, weight: 10, minTier: 0, round: 'int', nouns: ['MARROW', 'BLOOD', 'PYRE', 'HEART'] },
  { id: 'fang', stat: 'snapDamageMult', lo: 0.08, hi: 0.35, weight: 10, minTier: 0, round: 'pct', nouns: ['HUNT', 'MAW', 'TEETH', 'REND'] },
  { id: 'chorus', stat: 'boltDamageMult', lo: 0.08, hi: 0.35, weight: 10, minTier: 0, round: 'pct', nouns: ['CHORUS', 'VERSE', 'THUNDER', 'TONGUE'] },
  { id: 'bloom', stat: 'novaRadiusMult', lo: 0.06, hi: 0.25, weight: 8, minTier: 0, round: 'pct', nouns: ['BLOOM', 'RING', 'DAWN', 'WAKE'] },
  { id: 'wind', stat: 'moveMult', lo: 0.03, hi: 0.12, weight: 8, minTier: 0, round: 'pct', nouns: ['WIND', 'WING', 'FEATHER', 'CURRENT'] },
  { id: 'gate', stat: 'chargeGainMult', lo: 0.06, hi: 0.3, weight: 8, minTier: 1, round: 'pct', nouns: ['GATE', 'DEEP', 'DESCENT', 'DOOR'] },
  { id: 'haste', stat: 'castSpeedMult', lo: 0.05, hi: 0.2, weight: 8, minTier: 1, round: 'pct', nouns: ['HAND', 'FLICKER', 'QUICKENING', 'SPARK'] },
  { id: 'draw', stat: 'drawSpeedMult', lo: 0.06, hi: 0.25, weight: 8, minTier: 1, round: 'pct', nouns: ['BOW', 'SINEW', 'TENSION', 'PULL'] },
  { id: 'spear', stat: 'pierceBonus', lo: 1, hi: 1, weight: 3, minTier: 3, round: 'int', nouns: ['SPEAR', 'LANCE', 'PIERCING', 'THORN'] },
]

// ---------------------------------------------------------------------------
// name grammar — BASE OF THE ADJ NOUN, in the game's terse mythic voice
// ---------------------------------------------------------------------------

const BASES = [
  'TORC', 'FANG', 'IDOL', 'BELL', 'CROWN', 'LANTERN', 'VERTEBRA', 'SIGIL',
  'WARD', 'TOTEM', 'FETISH', 'KNUCKLEBONE', 'CHARM', 'DRUM',
] as const

const ADJS = [
  'DROWNED', 'HOLLOW', 'EMBER', 'PALE', 'SEVENTH', 'UNCOUNTED', 'SILENT',
  'BROKEN', 'STILL', 'GNAWED', 'SUNKEN', 'FIRST', 'LAST', 'VEILED',
  'THORNED', 'WAITING',
] as const

/** Flavor one-liners keyed by the dominant affix's stat. */
const FLAVOR: Record<keyof CombatStats, readonly string[]> = {
  maxLatch: ['It holds what would hold you.', 'Six anchors. This buys a seventh grip on one.'],
  maxHp: ['It burns slower than you do.', 'Blood remembers the shape it was poured into.'],
  snapDamageMult: ['The hunt sharpened into an object.', 'Teeth, in principle.'],
  boltDamageMult: ['A verse the dark repeats back, louder.', 'Thunder keeps its receipts.'],
  novaRadiusMult: ['The ring widens. The dark makes room.', 'Dawn, portable.'],
  moveMult: ['Weather owes it a favor.', 'The wind read it and agreed.'],
  chargeGainMult: ['The gate leans closer to its carrier.', 'Doors know their own.'],
  castSpeedMult: ['The hand forgets to hesitate.', 'A spark with no patience.'],
  drawSpeedMult: ['Sinew that pulls itself.', 'The bow was already drawn.'],
  pierceBonus: ['It does not stop at the first refusal.', 'A thorn with opinions about crowds.'],
}

// ---------------------------------------------------------------------------
// id codec
// ---------------------------------------------------------------------------

export function makeGenId(seed: number, quality: number): string {
  const s = (seed >>> 0).toString(16).padStart(8, '0')
  const q = Math.max(0, Math.min(100, Math.round(quality)))
  return `gen:${GEN_VERSION}:${s}:q${q}`
}

export function isGenId(id: string): boolean {
  return id.startsWith('gen:')
}

const GEN_RE = /^gen:(\d+):([0-9a-f]{8}):q(\d{1,3})$/

export function parseGenId(id: string): { version: number; seed: number; quality: number } | null {
  const m = GEN_RE.exec(id)
  if (!m) return null
  const version = parseInt(m[1], 10)
  const seed = parseInt(m[2], 16) >>> 0
  const quality = parseInt(m[3], 10)
  if (!Number.isFinite(version) || quality > 100) return null
  return { version, seed, quality }
}

// ---------------------------------------------------------------------------
// tier + magnitude rolls
// ---------------------------------------------------------------------------

/** Rarity-tier weights shift toward the top as drop quality climbs. */
export function tierWeightsFor(quality: number): [number, number, number, number] {
  const q = Math.max(0, Math.min(100, quality))
  return [
    Math.max(8, 70 - 0.6 * q),
    25 + 0.15 * q,
    4 + 0.28 * q,
    q >= 55 ? 0.3 * (q - 55) : 0,
  ]
}

function rollTier(rng: () => number, quality: number): number {
  const w = tierWeightsFor(quality)
  const total = w[0] + w[1] + w[2] + w[3]
  let r = rng() * total
  for (let t = 0; t < 4; t++) {
    r -= w[t]
    if (r <= 0) return t
  }
  return 3
}

/** Dissolve value doubles back into ItemDef.price so the existing
 * duplicateRelicShards (max(40, price/2)) path works untouched. */
export function genPrice(quality: number, tier: number): number {
  return 2 * (30 + Math.round(1.6 * Math.max(0, Math.min(100, quality))) + [0, 30, 80, 150][tier])
}

// ---------------------------------------------------------------------------
// the roll
// ---------------------------------------------------------------------------

const cache = new Map<string, GenItem>()

export function rollItem(seed: number, quality: number): GenItem {
  const id = makeGenId(seed, quality)
  const hit = cache.get(id)
  if (hit) return hit
  const q = Math.max(0, Math.min(100, Math.round(quality)))
  const rng = mulberry32(hashInts(seed >>> 0, q, GEN_VERSION, 0x9e17))
  const tier = rollTier(rng, q)
  const affixCount = tier + 1

  // draw distinct affixes by weight, honoring minTier
  const pool = AFFIXES.filter(a => a.minTier <= tier)
  const chosen: AffixDef[] = []
  for (let n = 0; n < affixCount && pool.length > 0; n++) {
    const avail = pool.filter(a => !chosen.includes(a))
    if (avail.length === 0) break
    const total = avail.reduce((s, a) => s + a.weight, 0)
    let r = rng() * total
    let picked = avail[avail.length - 1]
    for (const a of avail) {
      r -= a.weight
      if (r <= 0) {
        picked = a
        break
      }
    }
    chosen.push(picked)
  }

  const affixes: AffixRoll[] = []
  const mods: Partial<CombatStats> = {}
  let dominant = chosen[0]
  let dominantShare = -1
  for (const a of chosen) {
    const mag = (a.lo + (a.hi - a.lo) * (q / 100)) * (0.85 + 0.3 * rng())
    const value = a.round === 'int' ? Math.max(1, Math.round(mag)) : Math.round(mag * 100) / 100
    if (value === 0) continue
    affixes.push({ id: a.id, stat: a.stat, value })
    mods[a.stat] = (mods[a.stat] ?? 0) + value
    // budget share = magnitude relative to the affix's own full-quality span
    const share = a.hi > 0 ? value / a.hi : 1
    if (share > dominantShare) {
      dominantShare = share
      dominant = a
    }
  }

  const name = `${pick(rng, BASES)} OF THE ${pick(rng, ADJS)} ${pick(rng, dominant.nouns)}`
  const rarity: Rarity = RARITY_ORDER[tier]
  const flavorPool = FLAVOR[dominant.stat]
  const item: GenItem = {
    id,
    name,
    kind: 'relic',
    rarity,
    price: genPrice(q, tier),
    flavor: pick(rng, flavorPool),
    glyph: Math.floor(rng() * 12),
    mods,
    source: 'Taken from the deep',
    gen: { seed: seed >>> 0, quality: q, tier, affixes },
  }
  cache.set(id, item)
  return item
}

/** Resolve any gen:* id to its item; null for malformed ids. Old-version ids
 * re-roll at the same seed/quality under the current generator. */
export function rollFromId(id: string): GenItem | null {
  const parsed = parseGenId(id)
  if (!parsed) return null
  const item = rollItem(parsed.seed, parsed.quality)
  if (parsed.version !== GEN_VERSION) {
    // heal path: alias the old id to the current roll so the save's key keeps
    // resolving (the item's own id stays canonical for future grants)
    const aliased = { ...item, id }
    cache.set(id, aliased)
    return aliased
  }
  return item
}

// ---------------------------------------------------------------------------
// drop offers (choice-of-3 at settlement)
// ---------------------------------------------------------------------------

/** Deterministic run drop quality from the settlement counters. */
export function dropQuality(
  depth: number,
  perfects: number,
  wardenKills: number,
  kills: number,
  downed: boolean,
): number {
  return Math.max(
    5,
    Math.min(
      100,
      Math.round(7 * depth + perfects / 2 + 12 * wardenKills + kills / 4 - (downed ? 10 : 0)),
    ),
  )
}

/** The three offers a settled run puts on the table — same counters, same
 * three ids (the rollDrops discipline). */
export function rollOffers(
  seed: number,
  depth: number,
  kills: number,
  quality: number,
): [string, string, string] {
  const out: string[] = []
  for (let i = 0; i < 3; i++) {
    const rng = mulberry32(hashInts(seed >>> 0, depth, kills * 31 + i, 0xc03))
    const jitter = Math.round((rng() * 2 - 1) * 10)
    const q = Math.max(0, Math.min(100, Math.round(quality) + jitter))
    const offerSeed = hashInts(seed >>> 0, depth * 7 + i, kills, 0xd15c)
    out.push(rollItem(offerSeed, q).id)
  }
  return out as [string, string, string]
}
