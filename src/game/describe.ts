/**
 * The single item/rite stat formatter — every surface that shows gear
 * (tooltips, shop rows, drop cards, quest rewards, rite sockets) speaks
 * through these so numbers can never drift from the sim. Durations come from
 * RITE_DURATION; stat labels reuse the CharacterPanel vocabulary.
 * Pure, node-tested.
 */
import type { ConsumableEffect, ItemDef, Rarity } from './itemTypes'
import type { CombatStats } from './stats'
import { RITE_DURATION } from './runState'

/** CharacterPanel's stat vocabulary, extended with the cast-layer keys. */
const STAT_LABEL: Record<keyof CombatStats, string> = {
  maxLatch: 'LATCH WARD',
  maxHp: 'BLOOD',
  snapDamageMult: 'SNAP FORCE',
  boltDamageMult: 'BOLT FORCE',
  novaRadiusMult: 'NOVA REACH',
  moveMult: 'FLIGHT',
  chargeGainMult: 'GATE CHARGE',
  castSpeedMult: 'CAST SPEED',
  drawSpeedMult: 'DRAW SPEED',
  pierceBonus: 'PIERCE',
}

/** Integer-styled stats; everything else formats as a percentage delta. */
const INT_STATS = new Set<keyof CombatStats>(['maxLatch', 'maxHp', 'pierceBonus'])

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'COMMON',
  rare: 'RARE',
  mythic: 'MYTHIC',
  primal: 'PRIMAL',
}

function fmtValue(stat: keyof CombatStats, v: number): string {
  if (INT_STATS.has(stat)) return `${v >= 0 ? '+' : ''}${Math.round(v)}`
  const pct = Math.round(v * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

/** '+25% SNAP FORCE' · '+1 LATCH WARD' · '+20 BLOOD' — one line per stat. */
export function describeMods(mods: Partial<CombatStats>): string[] {
  const out: string[] = []
  for (const key of Object.keys(STAT_LABEL) as (keyof CombatStats)[]) {
    const v = mods[key]
    if (v === undefined || v === 0) continue
    out.push(`${fmtValue(key, v)} ${STAT_LABEL[key]}`)
  }
  return out
}

/** One plain sentence per rite — what it does, before you burn it. */
export function describeEffect(effect: ConsumableEffect): string {
  switch (effect) {
    case 'purgeLatches':
      return 'SHEDS EVERY LATCHED HORROR'
    case 'stasisAura':
      return `SLOWS NEARBY HORRORS — ${RITE_DURATION.stasisAura}s`
    case 'veil':
      return `UNSEEN BY THE SWARM — ${RITE_DURATION.veil}s`
    case 'frenzy':
      return `+50% SNAP & BOLT DAMAGE — ${RITE_DURATION.frenzy}s`
    case 'overcharge':
      return 'INSTANT GATE CHARGE — HALF THE SHIFT COST'
    case 'autoRevive':
      return 'CONSUMED ON THE KILLING BLOW — RISE AGAIN'
  }
}

export function rarityLabel(r: Rarity): string {
  return RARITY_LABEL[r]
}

export interface ItemDescription {
  rarityLabel: string
  /** Mechanical truth: stat lines for relics, the effect line for rites,
   * a proof line for trophies. Never empty. */
  lines: string[]
  flavor: string
  source: string
}

/** The one description every UI surface renders from. */
export function describeItem(item: ItemDef): ItemDescription {
  let lines: string[] = []
  if (item.kind === 'relic' && item.mods) lines = describeMods(item.mods)
  else if (item.kind === 'consumable' && item.effect) lines = [describeEffect(item.effect)]
  else if (item.kind === 'trophy') lines = ['PROOF OF A FALLEN WARDEN']
  if (lines.length === 0) lines = ['—']
  return {
    rarityLabel: RARITY_LABEL[item.rarity],
    lines,
    flavor: item.flavor,
    source: item.source,
  }
}
