/**
 * The item catalog: relics (equippable passive CombatStats deltas),
 * consumable rites (in-run one-shots on keys 1/2), and warden trophies
 * (quest proof + collection shelf). Pure data — no three.js, node-testable.
 * Icons are rune-atlas glyph indices (0..11) rendered via CSS masks.
 */
import { rollFromId } from './genItems'
import type { ItemDef } from './itemTypes'

export type { ConsumableEffect, ItemDef, ItemKind, Rarity } from './itemTypes'

export const ITEMS: ItemDef[] = [
  // ---- relics ----
  {
    id: 'feathered-ward',
    name: 'FEATHERED WARD',
    kind: 'relic',
    rarity: 'common',
    price: 60,
    flavor: 'A single feather from your own wing, folded against the dark.',
    glyph: 0,
    mods: { maxLatch: 1 },
    source: "Elara's ledger",
  },
  {
    id: 'hollow-bell',
    name: 'HOLLOW BELL',
    kind: 'relic',
    rarity: 'common',
    price: 70,
    flavor: 'Rung once at the bottom of the Cathedral. It never finished.',
    glyph: 1,
    mods: { boltDamageMult: 0.15 },
    source: "Elara's ledger · Cantor of the Hollow",
  },
  {
    id: 'third-lung',
    name: 'THE THIRD LUNG',
    kind: 'relic',
    rarity: 'common',
    price: 80,
    flavor: 'Breathes for you when the deep forgets to let you.',
    glyph: 2,
    mods: { moveMult: 0.06 },
    source: "Elara's ledger",
  },
  {
    id: 'wardens-fang',
    name: "WARDEN'S FANG",
    kind: 'relic',
    rarity: 'rare',
    price: 180,
    flavor: "Snapped from a gate warden's jaw. It still bites in your grip.",
    glyph: 3,
    mods: { snapDamageMult: 0.25 },
    source: "Elara's ledger · Marionette Idol",
  },
  {
    id: 'loop-eater-sigil',
    name: 'LOOP-EATER SIGIL',
    kind: 'relic',
    rarity: 'rare',
    price: 200,
    flavor: 'It swallows the song and spits back the descent.',
    glyph: 4,
    mods: { chargeGainMult: 0.2 },
    source: "Elara's ledger · her second quest",
  },
  {
    id: 'stillwater-torc',
    name: 'STILLWATER TORC',
    kind: 'relic',
    rarity: 'rare',
    price: 220,
    flavor: 'Heavy as a held breath. Steady as one, too.',
    glyph: 5,
    mods: { maxLatch: 1, moveMult: -0.03 },
    source: "Elara's ledger · Voidmaw Matriarch",
  },
  {
    id: 'marrow-lantern',
    name: 'MARROW LANTERN',
    kind: 'relic',
    rarity: 'common',
    price: 90,
    flavor: 'It burns what you are. There is more of you than you feared.',
    glyph: 9,
    mods: { maxHp: 20 },
    source: "Vess's stall · always stocked",
  },
  {
    id: 'gravemoss-crown',
    name: 'GRAVEMOSS CROWN',
    kind: 'relic',
    rarity: 'rare',
    price: 0,
    flavor: 'The jungle buries its kings standing up.',
    glyph: 6,
    mods: { novaRadiusMult: 0.15 },
    source: "Thorn Tyrant · Korr's hunt",
  },
  {
    id: 'chorus-of-teeth',
    name: 'CHORUS OF TEETH',
    kind: 'relic',
    rarity: 'mythic',
    price: 0,
    flavor: 'Every mouth the Collapse ever closed, singing.',
    glyph: 7,
    mods: { boltDamageMult: 0.3 },
    source: "Rift Maw · Korr's hunt",
  },
  {
    id: 'ember-vertebra',
    name: 'EMBER VERTEBRA',
    kind: 'relic',
    rarity: 'mythic',
    price: 0,
    flavor: 'A spine-bone of the Core. It remembers standing.',
    glyph: 8,
    mods: { snapDamageMult: 0.2, boltDamageMult: 0.1 },
    source: "Cinder Sovereign · Korr's hunt",
  },
  // ---- consumable rites (keys 1/2 in-run) ----
  {
    id: 'cleansing-ember',
    name: 'CLEANSING EMBER',
    kind: 'consumable',
    rarity: 'common',
    price: 35,
    flavor: 'Old fire remembers what clean means.',
    glyph: 9,
    effect: 'purgeLatches',
    source: "Elara's satchel · any warden",
  },
  {
    id: 'vial-of-stillness',
    name: 'VIAL OF STILLNESS',
    kind: 'consumable',
    rarity: 'common',
    price: 45,
    flavor: 'Drawn from the Lorekeeper’s satchel. The deep slows to read it.',
    glyph: 10,
    effect: 'stasisAura',
    source: "Elara's satchel",
  },
  {
    id: 'drum-of-the-deep',
    name: 'DRUM OF THE DEEP',
    kind: 'consumable',
    rarity: 'common',
    price: 50,
    flavor: 'One strike, and the gate leans closer.',
    glyph: 11,
    effect: 'overcharge',
    source: "Elara's satchel",
  },
  {
    id: 'veil-of-motes',
    name: 'VEIL OF MOTES',
    kind: 'consumable',
    rarity: 'rare',
    price: 55,
    flavor: 'The swarm hunts signals. Become weather instead.',
    glyph: 0,
    effect: 'veil',
    source: "Elara's satchel",
  },
  {
    id: 'tincture-of-teeth',
    name: 'TINCTURE OF TEETH',
    kind: 'consumable',
    rarity: 'rare',
    price: 60,
    flavor: 'Bottled hunger. Point it away from yourself.',
    glyph: 3,
    effect: 'frenzy',
    source: "Elara's satchel",
  },
  {
    id: 'phoenix-ash',
    name: 'PHOENIX ASH',
    kind: 'consumable',
    rarity: 'mythic',
    price: 120,
    flavor: 'One more verse. Just one.',
    glyph: 8,
    effect: 'autoRevive',
    source: "Elara's satchel · Korr's fifth hunt",
  },
  // ---- warden trophies (100% drops, quest proof) ----
  {
    id: 'sigil-first-warden',
    name: 'HOOD-SIGIL OF THE MATRIARCH',
    kind: 'trophy',
    rarity: 'rare',
    price: 0,
    flavor: 'Cut from a cowl that was never cloth.',
    glyph: 4,
    source: 'Voidmaw Matriarch',
  },
  {
    id: 'idol-green-warden',
    name: 'IDOL OF THE THORN TYRANT',
    kind: 'trophy',
    rarity: 'rare',
    price: 0,
    flavor: 'Still growing. Keep it away from the soil.',
    glyph: 6,
    source: 'Thorn Tyrant',
  },
  {
    id: 'shard-choir-warden',
    name: 'SHARD OF THE SILENT CHOIR',
    kind: 'trophy',
    rarity: 'rare',
    price: 0,
    flavor: 'Press it to your ear and hear nothing, beautifully.',
    glyph: 1,
    source: 'Cantor of the Hollow',
  },
  {
    id: 'ash-rite-warden',
    name: 'ASH OF THE BROKEN RITE',
    kind: 'trophy',
    rarity: 'rare',
    price: 0,
    flavor: 'The strings burned last. They always do.',
    glyph: 9,
    source: 'Marionette Idol',
  },
  {
    id: 'splinter-broken-warden',
    name: 'SPLINTER OF THE RIFT MAW',
    kind: 'trophy',
    rarity: 'rare',
    price: 0,
    flavor: 'It twitches toward whatever you love most.',
    glyph: 7,
    source: 'Rift Maw',
  },
  {
    id: 'heart-core-warden',
    name: 'COLD HEART OF THE CORE',
    kind: 'trophy',
    rarity: 'mythic',
    price: 0,
    flavor: 'The only cold thing down there. It chose to be.',
    glyph: 8,
    source: 'Cinder Sovereign',
  },
]

export const ITEMS_BY_ID: Record<string, ItemDef> = Object.fromEntries(
  ITEMS.map(i => [i.id, i]),
)

/** Instance-aware lookup: static catalog first, then the procedural layer
 * (gen:* ids re-derive their whole roll from the id — see genItems.ts). */
export function getItem(id: string): ItemDef | null {
  return ITEMS_BY_ID[id] ?? rollFromId(id)
}

export interface DropRoll {
  itemId: string
  /** 0..1 roll-under chance. */
  chance: number
}

/** Loot tables keyed 'warden:<realmId>' — trophy always, relic sometimes,
 * plus the shared ember mercy roll. */
export const WARDEN_DROPS: Record<string, DropRoll[]> = {
  'warden:astral': [
    { itemId: 'sigil-first-warden', chance: 1 },
    { itemId: 'stillwater-torc', chance: 0.2 },
    { itemId: 'cleansing-ember', chance: 0.5 },
  ],
  'warden:jungle': [
    { itemId: 'idol-green-warden', chance: 1 },
    { itemId: 'gravemoss-crown', chance: 0.25 },
    { itemId: 'cleansing-ember', chance: 0.5 },
  ],
  'warden:cathedral': [
    { itemId: 'shard-choir-warden', chance: 1 },
    { itemId: 'hollow-bell', chance: 0.3 },
    { itemId: 'cleansing-ember', chance: 0.5 },
  ],
  'warden:ritual': [
    { itemId: 'ash-rite-warden', chance: 1 },
    { itemId: 'wardens-fang', chance: 0.3 },
    { itemId: 'cleansing-ember', chance: 0.5 },
  ],
  'warden:collapse': [
    { itemId: 'splinter-broken-warden', chance: 1 },
    { itemId: 'chorus-of-teeth', chance: 0.2 },
    { itemId: 'cleansing-ember', chance: 0.5 },
  ],
  'warden:lavacore': [
    { itemId: 'heart-core-warden', chance: 1 },
    { itemId: 'ember-vertebra', chance: 0.2 },
    { itemId: 'cleansing-ember', chance: 0.5 },
  ],
}

/** Shards paid out when a duplicate relic/trophy would drop or be granted. */
export function duplicateRelicShards(item: ItemDef): number {
  return Math.max(40, Math.floor(item.price / 2))
}
