/**
 * The particle-burst vocabulary: every gameplay burst names a BURST style and
 * the Particles pool resolves it to an atlas sprite cell, a palette-role tint,
 * and a spawn envelope — so a soul collect, a strike, a kill, and a warden
 * detonation stop being chromatically identical puffs.
 *
 * Pure module (node-tested), no three imports.
 */

/** Atlas sprite cells in particle_atlas.png (2x2 grid of 128px cells). The id
 * IS the aCell vertex attribute; cellOffset() mirrors the shader's UV formula
 * `vec2(mod(aCell,2.), floor(aCell*.5)) * .5` under three's default flipY. */
export const PK = { GLOW: 0, SPARK: 1, EMBER: 2, WISP: 3 } as const

export function cellOffset(kind: number): readonly [number, number] {
  return [(kind % 2) * 0.5, Math.floor(kind / 2) * 0.5]
}

/** Palette-role indices into the ROLE_COUNT x 3 role-color array the scene
 * rebuilds per palette (color-writes-only realm swaps stay cheap). */
export const ROLE = {
  PARTICLE: 0,
  RUNE: 1,
  HORROR_EYE: 2,
  WARDEN_ACCENT: 3,
  PRIMARY: 4,
  WHITE: 5,
} as const
export const ROLE_COUNT = 6

/** Burst style ids carried on snapController.pendingBursts entries. */
export const BURST = {
  /** Pre-vocabulary burst — byte-for-byte the old spawnBurst defaults. */
  GENERIC: 0,
  /** Resonance-point collect: rune-gold motes released upward. */
  SOUL: 1,
  /** Snap-strike / nova / phoenix: white-hot fast sparks, short. */
  STRIKE: 2,
  /** Swarm death: eye-colored embers that sink as the body burns out. */
  KILL: 3,
  /** Warden phase moments: boss-scale slow ember plumes. */
  WARDEN: 4,
  /** Gate seal/ritual moments: primary flashed toward white. */
  GATE: 5,
  /** Non-lethal bolt connect: tiny white chip sparks, very short. */
  BOLT_HIT: 6,
  /** Bolt fire palm flash, near-instant. */
  MUZZLE: 7,
  /** Drop/shift player nova — byte-for-byte the old 6/8/1.6/0.8 call. */
  NOVA: 8,
  /** Cast release flash: hot primary sparks, short and bright. */
  CAST: 9,
  /** Charged-shot connect: meaty sinking embers. */
  CHARGED_IMPACT: 10,
  /** High-band shimmer: fast streak sparks sprayed by hi-hats/cymbals. */
  SHIMMER: 11,
  /** Bow materialize/dissolve: rising crystallization twinkle. */
  BOW_ASSEMBLE: 12,
  /** Resonance-storm release: up-rushing shard sparks. */
  STORM: 13,
} as const

export interface BurstStyle {
  cell: number
  role: number
  /** 0..1 lerp of the role color toward white (heat). */
  whiteMix: number
  /** Brightness gain folded into the tint at spawn. GENERIC's 1.8 is the
   * legacy burst envelope gain — the parity anchor the tests ratchet. */
  bright: number
  speedMin: number
  speedVar: number
  lifeMin: number
  lifeVar: number
  sizeMin: number
  sizeVar: number
  /** Vertical bias in u/s^2: positive sinks (dying embers), negative rises
   * (freed soul-motes), 0 = legacy ballistic drift. */
  grav: number
}

export const BURST_STYLES: readonly BurstStyle[] = [
  /* GENERIC */ { cell: PK.GLOW, role: ROLE.PARTICLE, whiteMix: 0, bright: 1.8, speedMin: 2, speedVar: 4, lifeMin: 1.2, lifeVar: 0.6, sizeMin: 0.9, sizeVar: 0.4, grav: 0 },
  /* SOUL */ { cell: PK.GLOW, role: ROLE.RUNE, whiteMix: 0.25, bright: 2.2, speedMin: 1.4, speedVar: 2.4, lifeMin: 1.5, lifeVar: 0.7, sizeMin: 1.0, sizeVar: 0.5, grav: -2.5 },
  /* STRIKE */ { cell: PK.SPARK, role: ROLE.PRIMARY, whiteMix: 0.65, bright: 2.6, speedMin: 5, speedVar: 7, lifeMin: 0.45, lifeVar: 0.35, sizeMin: 0.8, sizeVar: 0.5, grav: 0 },
  /* KILL */ { cell: PK.EMBER, role: ROLE.HORROR_EYE, whiteMix: 0.15, bright: 2.4, speedMin: 3, speedVar: 5, lifeMin: 0.9, lifeVar: 0.7, sizeMin: 0.9, sizeVar: 0.6, grav: 4 },
  /* WARDEN */ { cell: PK.EMBER, role: ROLE.WARDEN_ACCENT, whiteMix: 0.2, bright: 2.2, speedMin: 2.5, speedVar: 5, lifeMin: 1.3, lifeVar: 0.9, sizeMin: 1.2, sizeVar: 0.8, grav: 1.8 },
  /* GATE */ { cell: PK.GLOW, role: ROLE.PRIMARY, whiteMix: 0.55, bright: 2.4, speedMin: 3, speedVar: 5, lifeMin: 1.1, lifeVar: 0.6, sizeMin: 1.0, sizeVar: 0.5, grav: 0 },
  /* BOLT_HIT */ { cell: PK.SPARK, role: ROLE.WHITE, whiteMix: 0, bright: 2.2, speedMin: 4, speedVar: 6, lifeMin: 0.3, lifeVar: 0.25, sizeMin: 0.55, sizeVar: 0.35, grav: 0 },
  /* MUZZLE */ { cell: PK.SPARK, role: ROLE.PARTICLE, whiteMix: 0.5, bright: 1.6, speedMin: 1.5, speedVar: 2.5, lifeMin: 0.18, lifeVar: 0.15, sizeMin: 0.5, sizeVar: 0.3, grav: 0 },
  /* NOVA */ { cell: PK.GLOW, role: ROLE.PARTICLE, whiteMix: 0, bright: 1.8, speedMin: 6, speedVar: 8, lifeMin: 1.6, lifeVar: 0.8, sizeMin: 0.9, sizeVar: 0.4, grav: 0 },
  /* CAST */ { cell: PK.SPARK, role: ROLE.PRIMARY, whiteMix: 0.6, bright: 2.6, speedMin: 6, speedVar: 8, lifeMin: 0.3, lifeVar: 0.2, sizeMin: 0.6, sizeVar: 0.4, grav: 0 },
  /* CHARGED_IMPACT */ { cell: PK.EMBER, role: ROLE.PRIMARY, whiteMix: 0.45, bright: 2.6, speedMin: 4, speedVar: 7, lifeMin: 0.7, lifeVar: 0.5, sizeMin: 1.0, sizeVar: 0.6, grav: 3 },
  /* SHIMMER */ { cell: PK.SPARK, role: ROLE.PRIMARY, whiteMix: 0.6, bright: 2.6, speedMin: 9, speedVar: 9, lifeMin: 0.28, lifeVar: 0.22, sizeMin: 0.5, sizeVar: 0.3, grav: 0 },
  /* BOW_ASSEMBLE */ { cell: PK.SPARK, role: ROLE.PRIMARY, whiteMix: 0.5, bright: 2.2, speedMin: 1.2, speedVar: 2, lifeMin: 0.35, lifeVar: 0.2, sizeMin: 0.5, sizeVar: 0.3, grav: -1 },
  /* STORM */ { cell: PK.SPARK, role: ROLE.PRIMARY, whiteMix: 0.7, bright: 2.8, speedMin: 7, speedVar: 9, lifeMin: 0.5, lifeVar: 0.4, sizeMin: 0.8, sizeVar: 0.5, grav: -6 },
]

/** Parse '#rrggbb' into out[o..o+2] as 0..1 floats. */
export function hexToRgb(hex: string, out: Float32Array, o: number): void {
  const v = parseInt(hex.slice(1), 16)
  out[o] = ((v >> 16) & 0xff) / 255
  out[o + 1] = ((v >> 8) & 0xff) / 255
  out[o + 2] = (v & 0xff) / 255
}

/** Resolve a style's spawn tint (role color lerped toward white, x bright)
 * into out[o..o+2]. roles = ROLE_COUNT x 3 floats. */
export function styleTint(style: BurstStyle, roles: Float32Array, out: Float32Array, o: number): void {
  const j = style.role * 3
  for (let c = 0; c < 3; c++) {
    const base = roles[j + c]
    out[o + c] = (base + (1 - base) * style.whiteMix) * style.bright
  }
}
