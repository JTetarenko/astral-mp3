/**
 * Shared item type vocabulary — hoisted below items.ts (stats.ts mold) so the
 * procedural generator (genItems.ts) and the static catalog (items.ts) can
 * both speak it without a cycle:
 *
 *   stats.ts <- itemTypes.ts <- genItems.ts <- items.ts <- rpg.ts <- rpgRun.ts
 *
 * Pure types + tiny constants only. items.ts re-exports everything here, so
 * existing consumers keep their imports.
 */
import type { CombatStats } from './stats'

export type Rarity = 'common' | 'rare' | 'mythic' | 'primal'
export type ItemKind = 'relic' | 'consumable' | 'trophy'

/** Effects the combat layer executes when a loadout slot fires. */
export type ConsumableEffect =
  | 'purgeLatches' // shed every latched horror instantly
  | 'stasisAura' // ~4s slow bubble around the player
  | 'autoRevive' // consumed automatically on what would be DOWNED
  | 'overcharge' // +50% of the current shiftCost as instant charge
  | 'veil' // ~6s untargetable by horrors
  | 'frenzy' // ~8s +50% snap/bolt damage

export interface ItemDef {
  id: string
  name: string
  kind: ItemKind
  rarity: Rarity
  /** Shard price in Elara's shop; 0 = not sold (drop/quest only). */
  price: number
  flavor: string
  /** Rune-atlas glyph index 0..11. */
  glyph: number
  /** Relics only — additive CombatStats deltas. */
  mods?: Partial<CombatStats>
  /** Consumables only. */
  effect?: ConsumableEffect
  /** Tooltip provenance line. */
  source: string
}

/** One rolled affix on a generated relic. */
export interface AffixRoll {
  id: string
  stat: keyof CombatStats
  value: number
}

/** The derivation record a generated relic carries beside its ItemDef face. */
export interface GenItemMeta {
  seed: number
  /** 0..100 drop quality the roll was made at. */
  quality: number
  /** Rarity tier index 0..3 (common..primal). */
  tier: number
  affixes: AffixRoll[]
}

export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'mythic', 'primal']
