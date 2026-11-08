/**
 * Menu-side helpers for the baked rune atlas + runic display charset.
 * The same 12 glyphs the world engraves on resonance points and the realm
 * gate identify tracks in the menu — one deterministic rune per file, so a
 * track "owns" its sigil across the select row, the loading ritual and the
 * begin gate.
 */
import type { CSSProperties } from 'react'
import { fnv1a } from '../../game/seededRandom'
import { ATLAS_COLS, ATLAS_ROWS, RUNE_GLYPHS } from '../../scene/runeAtlas'

/** Elder Futhark — glitch-scramble charset (Segoe UI Historic renders these). */
export const RUNE_CHARS = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ'

export function randomRuneChar(): string {
  return RUNE_CHARS[(Math.random() * RUNE_CHARS.length) | 0]
}

export function hashString(s: string): number {
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff
  return fnv1a(bytes)
}

/** Stable atlas glyph index for a track file (or any string). */
export function runeForString(s: string): number {
  return hashString(s) % RUNE_GLYPHS
}

/**
 * Inline style selecting one atlas cell. The atlas is white-on-black, so the
 * CSS side uses `mask-mode: luminance` (see `.atlas-rune`); with N cells the
 * percentage that pins cell c is c/(N-1).
 */
export function runeMaskStyle(glyph: number): CSSProperties {
  const g = glyph % RUNE_GLYPHS
  const col = g % ATLAS_COLS
  const row = Math.floor(g / ATLAS_COLS)
  const x = (col / (ATLAS_COLS - 1)) * 100
  const y = (row / (ATLAS_ROWS - 1)) * 100
  return { maskPosition: `${x}% ${y}%` }
}
