export interface Palette {
  id: string
  label: string
  /** Menu gradient top / scene void + gradient bottom. */
  voidTop: string
  voidBottom: string
  fog: string
  islandBase: string
  /** Main emissive: mandala rings, resonance point cores. */
  primary: string
  /** Secondary emissive: light tint, shells, nebula accent. */
  secondary: string
  particle: string
  rune: string
  trail: string
  hudAccent: string
  hudGlow: string
  /** Horror layer: near-black husk tint + HDR accent hue (deliberately
   * contrasting `rune`/`primary` so horrors never read as pickups). */
  horrorBody: string
  horrorEye: string
  /** Gate warden: weak-point relic core + armor trim / telegraph base. */
  wardenCore: string
  wardenAccent: string
}

export const PALETTES: Palette[] = [
  {
    id: 'ritualVoid',
    label: 'Ritual Void',
    voidTop: '#0e120c',
    voidBottom: '#060806',
    fog: '#10150f',
    islandBase: '#15171c',
    primary: '#ff6b2e',
    secondary: '#8fa886',
    particle: '#ffb066',
    rune: '#5fe08a',
    trail: '#ff9e57',
    hudAccent: '#d8b45a',
    hudGlow: '#63d97c',
    horrorBody: '#07090a',
    horrorEye: '#ff3b30',
    wardenCore: '#ffd24a',
    wardenAccent: '#8f4a3a',
  },
  {
    id: 'midnightBlue',
    label: 'Midnight & Blue',
    voidTop: '#0a1030',
    voidBottom: '#050510',
    fog: '#0a1028',
    islandBase: '#1a2035',
    primary: '#3b6cff',
    secondary: '#8a4dff',
    particle: '#9fc8ff',
    rune: '#66aaff',
    trail: '#6ea8ff',
    hudAccent: '#d8b45a',
    hudGlow: '#4d7dff',
    horrorBody: '#05070f',
    horrorEye: '#ff6a5c',
    wardenCore: '#9fc8ff',
    wardenAccent: '#3a4a8f',
  },
  {
    id: 'voidPurple',
    label: 'Void Purple',
    voidTop: '#1a0a30',
    voidBottom: '#0a0514',
    fog: '#150a26',
    islandBase: '#221a38',
    primary: '#8a4dff',
    secondary: '#c9a0ff',
    particle: '#d5b8ff',
    rune: '#a874ff',
    trail: '#b48aff',
    hudAccent: '#d8b45a',
    hudGlow: '#a06dff',
    horrorBody: '#0c0716',
    horrorEye: '#64ffc8',
    wardenCore: '#e8d4ff',
    wardenAccent: '#5a3a8f',
  },
  {
    id: 'obsidianCrimson',
    label: 'Obsidian & Crimson',
    voidTop: '#1c0a0a',
    voidBottom: '#0a0505',
    fog: '#160808',
    islandBase: '#2a1518',
    primary: '#ff2e4d',
    secondary: '#ff8a5c',
    particle: '#ff9fb0',
    rune: '#ff5c78',
    trail: '#ff7a92',
    hudAccent: '#e8c06a',
    hudGlow: '#ff4d68',
    horrorBody: '#0e0607',
    horrorEye: '#ffefcf',
    wardenCore: '#ff8a5c',
    wardenAccent: '#6a2430',
  },
  {
    id: 'mossTeal',
    label: 'Moss & Teal',
    voidTop: '#0a2018',
    voidBottom: '#04100c',
    fog: '#081a14',
    islandBase: '#14281f',
    primary: '#2fd6a8',
    secondary: '#9ff0c8',
    particle: '#b8f5d8',
    rune: '#5ce8bc',
    trail: '#7aeec8',
    hudAccent: '#d8b45a',
    hudGlow: '#3dd6b2',
    horrorBody: '#05100b',
    horrorEye: '#ffc14d',
    wardenCore: '#b8f5d8',
    wardenAccent: '#2a5a48',
  },
  {
    id: 'ashGold',
    label: 'Ash & Gold',
    voidTop: '#241e12',
    voidBottom: '#12100c',
    fog: '#1c1810',
    islandBase: '#2e2818',
    primary: '#ffc857',
    secondary: '#fff2c0',
    particle: '#ffe8a8',
    rune: '#ffd87a',
    trail: '#ffdf90',
    hudAccent: '#ffc857',
    hudGlow: '#ffb838',
    horrorBody: '#100e08',
    horrorEye: '#ff3b30',
    wardenCore: '#fff2c0',
    wardenAccent: '#7a6430',
  },
  {
    id: 'toxicGreen',
    label: 'Collapse & Venom',
    voidTop: '#122408',
    voidBottom: '#081203',
    fog: '#0e1c08',
    islandBase: '#1c2a14',
    primary: '#7dff3d',
    secondary: '#c8ff8a',
    particle: '#b8ff9a',
    rune: '#9dff5c',
    trail: '#a8ff70',
    hudAccent: '#d8b45a',
    hudGlow: '#8aff4d',
    horrorBody: '#081005',
    horrorEye: '#ff5c2e',
    wardenCore: '#e8ffb8',
    wardenAccent: '#3a5a1c',
  },
  {
    id: 'infernalOrange',
    label: 'Infernal Orange',
    voidTop: '#2a1006',
    voidBottom: '#140803',
    fog: '#200c05',
    islandBase: '#2e1810',
    primary: '#ff6a1a',
    secondary: '#ffd08a',
    particle: '#ffb878',
    rune: '#ff8a3d',
    trail: '#ff9a52',
    hudAccent: '#ffb838',
    hudGlow: '#ff7a2a',
    horrorBody: '#120705',
    horrorEye: '#66e8ff',
    wardenCore: '#ffd08a',
    wardenAccent: '#7a3010',
  },
]

export const DEFAULT_THEME_ID = 'ritualVoid'

export function getPalette(id: string): Palette {
  return PALETTES.find(p => p.id === id) ?? PALETTES[0]
}

/** Applies HUD/menu CSS variables and returns the palette for scene use. */
export function applyTheme(id: string): Palette {
  const p = getPalette(id)
  const root = document.documentElement.style
  root.setProperty('--hud-accent', p.hudAccent)
  root.setProperty('--hud-glow', p.hudGlow)
  root.setProperty('--primary', p.primary)
  root.setProperty('--secondary', p.secondary)
  root.setProperty('--void-top', p.voidTop)
  root.setProperty('--void-bottom', p.voidBottom)
  return p
}
