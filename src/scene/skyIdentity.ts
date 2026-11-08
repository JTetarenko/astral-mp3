/**
 * Per-realm sky identity: the 4th feature shell's texture/blend/tint config
 * plus gain trims on the three existing shells (stars / mist / nebula_b).
 * Pure table, node-tested; Background.tsx consumes it at the epoch swap —
 * texture-pointer + color + blending-state writes only, never a rebuild.
 *
 * Resolvers key off DEPTH (never paletteId) so the gilded loop re-entry
 * (ashGold astral) can carry its own vortex halo while colors keep flowing
 * from the live palette.
 */

export type SkyFeatureTex = 'sky_canopy' | 'sky_cracks' | 'sky_vortex'
export type SkyTintRole = 'primary' | 'secondary' | 'rune' | 'fog'
export type SkyAudioBand = 'bass' | 'mids' | 'highs' | 'none'

export interface SkyIdentity {
  /** null hides the feature shell (astral keeps the pure void). */
  feature: SkyFeatureTex | null
  /** 'normal' darkens the sky behind it (jungle canopy silhouette). */
  blend: 'add' | 'normal'
  tintRole: SkyTintRole
  tintScale: number
  /** Material opacity (mostly matters for the normal-blend canopy). */
  opacity: number
  /** Static shell tilt [x, z] radians — aims the feature (zenith oculus,
   * low maelstrom, below-horizon fissures). */
  tilt: readonly [number, number]
  /** Spin multiplier on the shared sky spin (sign = direction). */
  featureSpin: number
  /** Which audio band swells the feature tint, and by how much. */
  audioBand: SkyAudioBand
  audioGain: number
  /** Gain trims multiplied into the existing shell tints. */
  starGain: number
  mistGain: number
  nebBGain: number
}

const BASE: Omit<SkyIdentity, 'feature'> = {
  blend: 'add',
  tintRole: 'secondary',
  tintScale: 0,
  opacity: 1,
  tilt: [0, 0],
  featureSpin: 0,
  audioBand: 'none',
  audioGain: 0,
  starGain: 1,
  mistGain: 1,
  nebBGain: 1,
}

/** Index == realm index (depth % 6). */
export const SKY_IDENTITIES: readonly SkyIdentity[] = [
  // astral — the home void stays pure star field
  { ...BASE, feature: null },
  // jungle — world-canopy silhouette overhead, sky dims behind the lattice
  {
    ...BASE,
    feature: 'sky_canopy',
    blend: 'normal',
    tintRole: 'fog',
    tintScale: 0.9,
    opacity: 0.85,
    tilt: [0.06, 0.03],
    featureSpin: 0.25,
    audioBand: 'mids',
    audioGain: 0.12,
    starGain: 0.75,
    mistGain: 1.1,
    nebBGain: 0.85,
  },
  // cathedral — overhead vortex oculus, bass-swelled
  {
    ...BASE,
    feature: 'sky_vortex',
    tintRole: 'secondary',
    tintScale: 0.4,
    featureSpin: 0.6,
    audioBand: 'bass',
    audioGain: 0.25,
    starGain: 1.25,
    mistGain: 0.85,
  },
  // ritual — low blood maelstrom, counter-spinning
  {
    ...BASE,
    feature: 'sky_vortex',
    tintRole: 'primary',
    tintScale: 0.22,
    tilt: [1.1, 0],
    featureSpin: -0.3,
    audioBand: 'mids',
    audioGain: 0.2,
    starGain: 0.8,
    mistGain: 1.15,
    nebBGain: 1.1,
  },
  // collapse — the sky itself fracturing, onset-flashed
  {
    ...BASE,
    feature: 'sky_cracks',
    tintRole: 'rune',
    tintScale: 0.35,
    tilt: [0.25, -0.2],
    featureSpin: 1.6,
    audioBand: 'highs',
    audioGain: 0.5,
    starGain: 0.9,
    mistGain: 0.9,
    nebBGain: 1.2,
  },
  // lavacore — fissure glow bleeding up from below the horizon
  {
    ...BASE,
    feature: 'sky_cracks',
    tintRole: 'primary',
    tintScale: 0.5,
    tilt: [Math.PI, 0],
    featureSpin: 0.2,
    audioBand: 'bass',
    audioGain: 0.4,
    starGain: 0.35,
    mistGain: 1.2,
    nebBGain: 1.5,
  },
]

/** Gilded loop re-entry: astral gains a soft gold vortex halo. */
export const SKY_IDENTITY_GILDED: SkyIdentity = {
  ...BASE,
  feature: 'sky_vortex',
  tintRole: 'secondary',
  tintScale: 0.25,
  featureSpin: 0.3,
  audioBand: 'mids',
  audioGain: 0.15,
  starGain: 1.1,
}

export function skyIdentityForDepth(depth: number): SkyIdentity {
  const d = Math.max(0, Math.floor(depth))
  if (d >= 6 && d % 6 === 0) return SKY_IDENTITY_GILDED
  return SKY_IDENTITIES[d % SKY_IDENTITIES.length]
}
