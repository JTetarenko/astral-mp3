/**
 * Per-realm ambient-drifter vocabulary (burstVocab's sibling): the 400
 * reserved ambient particle slots stop being one universal ash and become
 * star motes, fireflies + spore veils, rising incense, heavy ashfall, falling
 * grit, and ember columns through heat shimmer — the WISP atlas cell finally
 * earns its bake.
 *
 * Pure module, node-tested. Style assignment is a deterministic index
 * partition over cumulative fracs (zero RNG, stable across re-entry at the
 * same depth); per-particle variation stays on the existing ambient hash.
 */
import { PK } from './burstVocab'

export type AmbientRole = 'particle' | 'rune' | 'primary' | 'secondary' | 'white'

export interface AmbientStyle {
  /** Fraction of the ambient slots this style claims (fracs sum to 1). */
  frac: number
  /** particle_atlas cell (PK.*). */
  cell: number
  sizeMin: number
  sizeVar: number
  /** Multiplies the realm settle velocity; negative RISES against the realm's
   * fall direction (cathedral incense). */
  settleMult: number
  swayAmp: number
  swayFreq: number
  /** Blink oscillation (fireflies / votives); 0 = steady. rm zeroes depth. */
  blinkRate: number
  blinkDepth: number
  /** Tint = lerp(roleA, roleB, per-particle hash) x bright. */
  roleA: AmbientRole
  roleB: AmbientRole
  bright: number
}

export interface AmbientRecipe {
  /** == REALMS[i].id, test-aligned. */
  id: string
  styles: readonly AmbientStyle[]
  /** Atlas cell for the island-rim stardust falls (was hardcoded GLOW). */
  fallCell: number
}

const style = (s: AmbientStyle) => s

/** Index == realm index (depth % 6). */
export const AMBIENT_RECIPES: readonly AmbientRecipe[] = [
  {
    id: 'astral',
    fallCell: PK.GLOW,
    styles: [
      style({ frac: 0.62, cell: PK.GLOW, sizeMin: 0.5, sizeVar: 0.6, settleMult: 0.15, swayAmp: 0.7, swayFreq: 0.6, blinkRate: 0.35, blinkDepth: 0.35, roleA: 'secondary', roleB: 'white', bright: 1 }),
      style({ frac: 0.38, cell: PK.SPARK, sizeMin: 0.35, sizeVar: 0.3, settleMult: 0.05, swayAmp: 0.4, swayFreq: 0.5, blinkRate: 0.18, blinkDepth: 0.85, roleA: 'white', roleB: 'white', bright: 1.15 }),
    ],
  },
  {
    id: 'jungle',
    fallCell: PK.WISP,
    styles: [
      style({ frac: 0.45, cell: PK.SPARK, sizeMin: 0.4, sizeVar: 0.35, settleMult: 0.1, swayAmp: 1.6, swayFreq: 1.3, blinkRate: 1.1, blinkDepth: 0.9, roleA: 'rune', roleB: 'particle', bright: 1.3 }),
      style({ frac: 0.35, cell: PK.WISP, sizeMin: 1.4, sizeVar: 1.0, settleMult: 0.35, swayAmp: 0.9, swayFreq: 0.4, blinkRate: 0, blinkDepth: 0, roleA: 'secondary', roleB: 'secondary', bright: 0.4 }),
      style({ frac: 0.2, cell: PK.EMBER, sizeMin: 0.55, sizeVar: 0.5, settleMult: 0.8, swayAmp: 0.8, swayFreq: 0.8, blinkRate: 0, blinkDepth: 0, roleA: 'particle', roleB: 'rune', bright: 0.8 }),
    ],
  },
  {
    id: 'cathedral',
    fallCell: PK.GLOW,
    styles: [
      style({ frac: 0.4, cell: PK.WISP, sizeMin: 1.6, sizeVar: 1.2, settleMult: -0.35, swayAmp: 0.35, swayFreq: 0.3, blinkRate: 0, blinkDepth: 0, roleA: 'secondary', roleB: 'white', bright: 0.45 }),
      style({ frac: 0.42, cell: PK.GLOW, sizeMin: 0.45, sizeVar: 0.4, settleMult: 0.05, swayAmp: 0.2, swayFreq: 0.2, blinkRate: 0, blinkDepth: 0, roleA: 'particle', roleB: 'secondary', bright: 0.8 }),
      style({ frac: 0.18, cell: PK.SPARK, sizeMin: 0.4, sizeVar: 0.3, settleMult: 0.08, swayAmp: 0.3, swayFreq: 0.4, blinkRate: 0.5, blinkDepth: 0.7, roleA: 'primary', roleB: 'white', bright: 1.2 }),
    ],
  },
  {
    id: 'ritual',
    fallCell: PK.EMBER,
    styles: [
      style({ frac: 0.6, cell: PK.EMBER, sizeMin: 0.65, sizeVar: 1.1, settleMult: 1.35, swayAmp: 0.8, swayFreq: 0.7, blinkRate: 0, blinkDepth: 0, roleA: 'particle', roleB: 'particle', bright: 1 }),
      style({ frac: 0.22, cell: PK.GLOW, sizeMin: 0.5, sizeVar: 0.45, settleMult: 0.9, swayAmp: 0.6, swayFreq: 0.6, blinkRate: 0.7, blinkDepth: 0.45, roleA: 'primary', roleB: 'particle', bright: 1.1 }),
      style({ frac: 0.18, cell: PK.WISP, sizeMin: 1.5, sizeVar: 1.1, settleMult: 0.5, swayAmp: 0.7, swayFreq: 0.35, blinkRate: 0, blinkDepth: 0, roleA: 'particle', roleB: 'particle', bright: 0.35 }),
    ],
  },
  {
    id: 'collapse',
    fallCell: PK.EMBER,
    styles: [
      style({ frac: 0.5, cell: PK.SPARK, sizeMin: 0.35, sizeVar: 0.35, settleMult: 1.6, swayAmp: 2.2, swayFreq: 2.0, blinkRate: 0, blinkDepth: 0, roleA: 'particle', roleB: 'rune', bright: 1.1 }),
      style({ frac: 0.3, cell: PK.EMBER, sizeMin: 0.6, sizeVar: 0.7, settleMult: 1.9, swayAmp: 1.4, swayFreq: 1.6, blinkRate: 0, blinkDepth: 0, roleA: 'particle', roleB: 'particle', bright: 0.9 }),
      style({ frac: 0.2, cell: PK.WISP, sizeMin: 1.4, sizeVar: 1.0, settleMult: 0.7, swayAmp: 1.0, swayFreq: 0.9, blinkRate: 0, blinkDepth: 0, roleA: 'rune', roleB: 'particle', bright: 0.4 }),
    ],
  },
  {
    id: 'lavacore',
    fallCell: PK.EMBER,
    styles: [
      style({ frac: 0.55, cell: PK.EMBER, sizeMin: 0.6, sizeVar: 0.7, settleMult: 1.5, swayAmp: 1.0, swayFreq: 0.9, blinkRate: 0.9, blinkDepth: 0.3, roleA: 'primary', roleB: 'particle', bright: 1.25 }),
      style({ frac: 0.3, cell: PK.WISP, sizeMin: 1.8, sizeVar: 1.2, settleMult: 0.6, swayAmp: 1.2, swayFreq: 0.5, blinkRate: 0, blinkDepth: 0, roleA: 'primary', roleB: 'secondary', bright: 0.4 }),
      style({ frac: 0.15, cell: PK.SPARK, sizeMin: 0.35, sizeVar: 0.3, settleMult: 2.2, swayAmp: 1.1, swayFreq: 1.4, blinkRate: 0, blinkDepth: 0, roleA: 'white', roleB: 'primary', bright: 1.3 }),
    ],
  },
]

export function ambientRecipeForDepth(depth: number): AmbientRecipe {
  const d = Math.max(0, Math.floor(depth))
  return AMBIENT_RECIPES[d % AMBIENT_RECIPES.length]
}

/**
 * Deterministic index partition: slot i of `total` gets the style whose
 * cumulative-frac window contains i. Pure and stable — no RNG, so the same
 * depth always deals the same ambient population.
 */
export function ambientStyleForSlot(recipe: AmbientRecipe, i: number, total: number): AmbientStyle {
  const u = (i + 0.5) / total
  let cum = 0
  for (const s of recipe.styles) {
    cum += s.frac
    if (u <= cum) return s
  }
  return recipe.styles[recipe.styles.length - 1]
}
