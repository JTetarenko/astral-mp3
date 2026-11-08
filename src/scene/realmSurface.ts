/**
 * Per-realm island surface identity: which baked vein-emissive texture the
 * island shader samples, how hot it burns, and the three uSurfParams behaviors
 * (up-facing moss tint / down-facing HDR underglow / frost sparkle).
 * Pure table, node-tested; Islands.tsx writes it inside the one [palette]
 * effect per descent — texture + uniform writes only.
 */

export type VeinTexName =
  | 'rune_emissive'
  | 'vein_vine'
  | 'vein_tracery'
  | 'vein_fracture'
  | 'vein_magma'

/** Everything Islands.tsx must preload (swaps are tex->tex, never null->tex). */
export const VEIN_TEXTURES: readonly VeinTexName[] = [
  'rune_emissive',
  'vein_vine',
  'vein_tracery',
  'vein_fracture',
  'vein_magma',
]

export interface SurfaceIdentity {
  veinTex: VeinTexName
  /** Multiplies the existing uRuneColor gain (1.4 x palette.rune). */
  veinGain: number
  /** uSurfColor = palette[surfRole] lerped toward white, x surfScale. */
  surfRole: 'primary' | 'secondary' | 'rune'
  surfWhiteMix: number
  surfScale: number
  /** uSurfParams.x — up-facing diffuse tint amount (moss/sheen). */
  up: number
  /** uSurfParams.y — down-facing HDR emissive underglow. */
  down: number
  /** uSurfParams.z — per-facet hashed sparkle. */
  sparkle: number
}

/** Index == realm index (depth % 6); the gilded loop keeps astral behavior
 * (colors flow from the live ashGold palette automatically). */
export const SURFACE_IDENTITIES: readonly SurfaceIdentity[] = [
  // astral — frost-glinting starlit rock, the ritual script as-is
  {
    veinTex: 'rune_emissive',
    veinGain: 1.0,
    surfRole: 'secondary',
    surfWhiteMix: 0.5,
    surfScale: 1.2,
    up: 0,
    down: 0,
    sparkle: 0.7,
  },
  // jungle — moss carpets on crag tops, glowing vine veins
  {
    veinTex: 'vein_vine',
    veinGain: 1.1,
    surfRole: 'rune',
    surfWhiteMix: 0,
    surfScale: 0.45,
    up: 0.75,
    down: 0,
    sparkle: 0,
  },
  // cathedral — violet sheen + stained-glass glints over carved tracery
  {
    veinTex: 'vein_tracery',
    veinGain: 1.25,
    surfRole: 'secondary',
    surfWhiteMix: 0,
    surfScale: 0.5,
    up: 0.25,
    down: 0,
    sparkle: 0.25,
  },
  // ritual — the script burns hotter, faint smolder under the ledges
  {
    veinTex: 'rune_emissive',
    veinGain: 1.35,
    surfRole: 'primary',
    surfWhiteMix: 0,
    surfScale: 0.5,
    up: 0,
    down: 0.3,
    sparkle: 0,
  },
  // collapse — fracture webs, toxic seep glowing from below
  {
    veinTex: 'vein_fracture',
    veinGain: 1.2,
    surfRole: 'rune',
    surfWhiteMix: 0,
    surfScale: 0.6,
    up: 0,
    down: 0.35,
    sparkle: 0,
  },
  // lavacore — magma crust, ember underlighting crossing bloom
  {
    veinTex: 'vein_magma',
    veinGain: 1.5,
    surfRole: 'primary',
    surfWhiteMix: 0,
    surfScale: 1.8,
    up: 0,
    down: 1.0,
    sparkle: 0,
  },
]

export function surfaceForDepth(depth: number): SurfaceIdentity {
  const d = Math.max(0, Math.floor(depth))
  return SURFACE_IDENTITIES[d % SURFACE_IDENTITIES.length]
}
