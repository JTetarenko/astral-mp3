/**
 * Realm registry: the descent ladder. A realm is a palette plus a bundle of
 * numeric modifiers consumed by existing systems (world gen densities, fog,
 * particle behavior, gate visuals). Depth indexes into a fixed 6-realm cycle;
 * loops past the first escalate intensity and open with the gilded variant.
 * Pure module — no three.js, safe under node vitest.
 */

export interface RealmMods {
  /** Multipliers on the tier-crossfaded fog targets in visualTuning. */
  fogNearMult: number
  fogFarMult: number
  /** Post-fog medium: overall density and bass-lit inner-glow strength. */
  fogDensityMult: number
  fogGlowMult: number
  skySpinMult: number
  cloudGlowMult: number
  /** World generation (consumed by chunks.ts). */
  islandDensity: number
  islandScaleMult: number
  /** Scales the vertical spread of islands around the band center. */
  yBandMult: number
  bobMult: number
  /** Dressing. */
  shardDensity: number
  /** Per-island realm-dressing density (RealmDressing alloc + central count). */
  dressingDensity: number
  /** Ambient debris floor (0 = SHATTER-only, as the base game). */
  debrisFloor: number
  debrisMult: number
  auroraMax: number
  godrayMax: number
  spireDensity: number
  spireHeightMult: number
  /** Particles / comets. -1 fallDir means embers RISE (Lava Core). */
  fallRateMult: number
  fallDir: 1 | -1
  cometRateMult: number
  /** Psyche / movement. */
  tripBias: number
  warpMult: number
  /** Hover sink velocity (replaces the old -3 constant). Negative = sink. */
  sinkRate: number
  liftMult: number
  /** Horror pressure (consumed by enemyState's spawn director via modsGen). */
  enemyDensity: number
  enemyAggroMult: number
  enemySpeedMult: number
  wardenHpMult: number
}

export interface RealmConfig {
  id: string
  label: string
  paletteId: string
  mods: RealmMods
}

export const NEUTRAL_MODS: RealmMods = {
  fogNearMult: 1,
  fogFarMult: 1,
  fogDensityMult: 1,
  fogGlowMult: 1,
  skySpinMult: 1,
  cloudGlowMult: 1,
  islandDensity: 1,
  islandScaleMult: 1,
  yBandMult: 1,
  bobMult: 1,
  shardDensity: 1,
  dressingDensity: 1,
  debrisFloor: 0,
  debrisMult: 1,
  auroraMax: 1,
  godrayMax: 1,
  spireDensity: 1,
  spireHeightMult: 1,
  fallRateMult: 1,
  fallDir: 1,
  cometRateMult: 1,
  tripBias: 0,
  warpMult: 1,
  sinkRate: -3,
  liftMult: 1,
  enemyDensity: 1,
  enemyAggroMult: 1,
  enemySpeedMult: 1,
  wardenHpMult: 1,
}

function mods(overrides: Partial<RealmMods>): RealmMods {
  return { ...NEUTRAL_MODS, ...overrides }
}

/** Descent order — depth % 6 walks this list. */
export const REALMS: RealmConfig[] = [
  {
    id: 'astral',
    label: 'ASTRAL REALM',
    paletteId: 'ritualVoid',
    mods: mods({
      enemyDensity: 0.7,
      enemyAggroMult: 0.8,
      enemySpeedMult: 0.9,
      wardenHpMult: 0.85,
    }),
  },
  {
    id: 'jungle',
    label: 'TRIBAL JUNGLE SANCTUARY',
    paletteId: 'mossTeal',
    mods: mods({
      fogNearMult: 0.85,
      fogFarMult: 0.9,
      fogDensityMult: 0.85,
      fogGlowMult: 0.9,
      skySpinMult: 0.9,
      cloudGlowMult: 1.1,
      islandDensity: 1.25,
      islandScaleMult: 1.1,
      yBandMult: 0.8,
      shardDensity: 1.3,
      dressingDensity: 1.35,
      debrisMult: 0.9,
      godrayMax: 1.15,
      spireDensity: 1.2,
      spireHeightMult: 1.3,
      fallRateMult: 1.3,
      cometRateMult: 0.6,
      tripBias: 0.05,
      sinkRate: -2.5,
      enemyDensity: 1.1,
      enemySpeedMult: 1.05,
      wardenHpMult: 0.9,
    }),
  },
  {
    id: 'cathedral',
    label: 'VOID CATHEDRAL',
    paletteId: 'voidPurple',
    mods: mods({
      fogFarMult: 1.1,
      fogDensityMult: 0.7,
      fogGlowMult: 0.8,
      skySpinMult: 1.3,
      cloudGlowMult: 0.9,
      islandDensity: 0.75,
      islandScaleMult: 1.25,
      yBandMult: 1.3,
      bobMult: 0.9,
      shardDensity: 0.9,
      auroraMax: 1.2,
      godrayMax: 1.3,
      spireDensity: 1.5,
      spireHeightMult: 1.6,
      fallRateMult: 0.8,
      cometRateMult: 1.3,
      tripBias: 0.1,
      sinkRate: -3.5,
      liftMult: 1.1,
      enemyDensity: 0.85,
      enemyAggroMult: 0.9,
    }),
  },
  {
    id: 'ritual',
    label: 'ANCIENT RITUAL GROUNDS',
    paletteId: 'obsidianCrimson',
    mods: mods({
      fogNearMult: 0.9,
      fogFarMult: 0.95,
      fogDensityMult: 1.15,
      fogGlowMult: 1.2,
      islandScaleMult: 0.9,
      yBandMult: 0.9,
      shardDensity: 1.1,
      dressingDensity: 1.15,
      debrisFloor: 0.15,
      debrisMult: 1.1,
      auroraMax: 0.6,
      godrayMax: 0.8,
      tripBias: 0.15,
      warpMult: 1.1,
      enemyDensity: 1.15,
      enemyAggroMult: 1.2,
      enemySpeedMult: 0.95,
      wardenHpMult: 1.05,
    }),
  },
  {
    id: 'collapse',
    label: 'COLLAPSING REALM',
    paletteId: 'toxicGreen',
    mods: mods({
      fogNearMult: 0.75,
      fogFarMult: 0.8,
      fogDensityMult: 1.25,
      fogGlowMult: 0.9,
      skySpinMult: 1.2,
      cloudGlowMult: 0.8,
      islandDensity: 0.85,
      yBandMult: 1.4,
      bobMult: 1.5,
      shardDensity: 0.8,
      dressingDensity: 1.1,
      debrisFloor: 0.35,
      debrisMult: 1.3,
      auroraMax: 0.4,
      godrayMax: 0.5,
      spireDensity: 0.8,
      spireHeightMult: 0.9,
      fallRateMult: 1.6,
      cometRateMult: 0.7,
      tripBias: 0.25,
      warpMult: 1.25,
      sinkRate: -4.5,
      liftMult: 1.2,
      enemyDensity: 1.2,
      enemyAggroMult: 1.1,
      enemySpeedMult: 1.1,
      wardenHpMult: 1.15,
    }),
  },
  {
    id: 'lavacore',
    label: 'LAVA CORE',
    paletteId: 'infernalOrange',
    mods: mods({
      fogNearMult: 0.7,
      fogFarMult: 0.75,
      fogDensityMult: 1.1,
      fogGlowMult: 1.4,
      skySpinMult: 1.1,
      cloudGlowMult: 1.6,
      islandDensity: 1.1,
      yBandMult: 0.7,
      bobMult: 1.1,
      shardDensity: 1.2,
      dressingDensity: 1.2,
      debrisFloor: 0.2,
      debrisMult: 1.1,
      auroraMax: 0.3,
      godrayMax: 1.1,
      spireHeightMult: 1.2,
      fallRateMult: 2,
      fallDir: -1,
      cometRateMult: 1.2,
      tripBias: 0.2,
      warpMult: 1.1,
      sinkRate: -2,
      liftMult: 1.15,
      enemyDensity: 1.3,
      enemyAggroMult: 1.25,
      enemySpeedMult: 1.2,
      wardenHpMult: 1.25,
    }),
  },
]

export interface RealmAtDepth {
  realm: RealmConfig
  /** 0 on depths 0-5, 1 on 6-11, ... */
  loop: number
  /** realm.mods with loop escalation applied (fresh object). */
  mods: RealmMods
  /** Realm palette, except each loop's first realm returns gilded (ashGold). */
  paletteId: string
}

/**
 * Resolve the realm for a 0-based depth. Cycles the 6-realm ladder; each full
 * loop escalates motion/density modifiers (capped at loop 3) and re-enters
 * through a gilded Astral Realm so the repeat reads as intentional.
 */
export function getRealmForDepth(depth: number): RealmAtDepth {
  const d = Math.max(0, Math.floor(depth))
  const realm = REALMS[d % REALMS.length]
  const loop = Math.floor(d / REALMS.length)
  const e = Math.min(loop, 3)
  const m: RealmMods = { ...realm.mods }
  if (e > 0) {
    m.islandDensity *= 1 + 0.05 * e
    m.fallRateMult *= 1 + 0.1 * e
    m.cometRateMult *= 1 + 0.1 * e
    m.bobMult *= 1 + 0.08 * e
    m.tripBias += 0.05 * e
    m.debrisFloor = Math.min(0.5, m.debrisFloor + 0.06 * e)
    m.enemyDensity *= 1 + 0.12 * e
    m.enemyAggroMult *= 1 + 0.08 * e
    m.enemySpeedMult *= 1 + 0.05 * e
    m.wardenHpMult *= 1 + 0.15 * e
  }
  const paletteId = loop >= 1 && d % REALMS.length === 0 ? 'ashGold' : realm.paletteId
  return { realm, loop, mods: m, paletteId }
}

/** Points needed to charge the Realm Shift at a given depth: 6,8,10,12,14,14... */
export function shiftCostForDepth(depth: number): number {
  return Math.min(14, 6 + 2 * Math.max(0, Math.floor(depth)))
}

/** Score bonus for descending from `depth`; `hot` = shifted during PEAK/SHATTER. */
export function shiftBonus(depth: number, hot: boolean): number {
  return Math.round(400 * (Math.max(0, depth) + 1) * (hot ? 1.5 : 1))
}
