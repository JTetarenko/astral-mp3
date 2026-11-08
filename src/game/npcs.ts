/**
 * The Sanctum NPCs: pure data — roles, portrait glyphs, and dialog lines in
 * the game's mythic-tribal voice. Portraits compose procedurally from the
 * rune atlas; a PNG dropped at portraitSrc (public/assets/npc/<id>.png)
 * upgrades the frame without being required.
 */

export type DialogKey =
  | 'greetingFirst'
  | 'greeting'
  | 'browse'
  | 'buy'
  | 'poor'
  | 'questOffer'
  | 'questActive'
  | 'turnIn'
  | 'spend'
  | 'atCap'
  | 'contract'
  | 'idle'

export interface NpcDef {
  id: string
  name: string
  epithet: string
  role: 'shop' | 'hunts' | 'mirror'
  /** Rune-atlas glyph for the procedural portrait. */
  glyph: number
  /** Optional image drop-in; UI must look complete without it. */
  portraitSrc: string
  lines: Partial<Record<DialogKey, string[]>>
}

export const NPCS: NpcDef[] = [
  {
    id: 'elara',
    name: 'ELARA',
    epithet: 'THE LOREKEEPER',
    role: 'shop',
    glyph: 4,
    portraitSrc: '/assets/npc/elara.png',
    lines: {
      greetingFirst: ['A new signal in my margins. Sit — the ink was expecting you.'],
      greeting: [
        'The Deep turned another page while you were away.',
        'Back with all your feathers. The ledger approves.',
      ],
      browse: ['Take what the story needs. The vials already know your name.'],
      buy: ['Written. Sold. Remembered.'],
      poor: ['The shards say no, little wing. Come back heavier.'],
      questOffer: ['There is a blank line in the ledger shaped exactly like you.'],
      questActive: ['The line is still blank. The Deep is patient. I am less so.'],
      turnIn: ['So it is written — and now it is true.'],
      contract: [
        'The ledger never closes. Another line, another cut.',
        'Standing work, standing pay. The ink prefers regulars.',
      ],
      idle: [
        'My wings are only pages. Yours carry you. I take notes.',
        'Every warden was a sentence once. Some refuse to end.',
      ],
    },
  },
  {
    id: 'korr',
    name: 'KORR',
    epithet: 'THE BROKEN WARDEN',
    role: 'hunts',
    glyph: 7,
    portraitSrc: '/assets/npc/korr.png',
    lines: {
      greetingFirst: [
        'I guarded a gate once. Then the gate looked back. Buy me nothing. Kill me something.',
      ],
      greeting: ['Still breathing. Both of us. Annoying.'],
      questOffer: ['The swarms below wear my old colors. Strip them.'],
      questActive: ['Numbers, wing. I count corpses, not promises.'],
      turnIn: ['Good. The Deep is lighter by that much.'],
      contract: [
        'No end to this work, wing. Only rates.',
        'The board refills itself. So does the Deep. Race them.',
      ],
      idle: [
        'My other half still stands at Depth Six. Wave when you pass him.',
        "Wardens don't die. They wait. I got tired of waiting.",
      ],
    },
  },
  {
    id: 'vess',
    name: 'VESS',
    epithet: 'THE ATTUNEMENT MIRROR',
    role: 'mirror',
    glyph: 10,
    portraitSrc: '/assets/npc/vess.png',
    lines: {
      greetingFirst: ['You again. No — you FIRST. The other you comes later.'],
      greeting: ['Mirror, mirror. Sit. Spend yourself.'],
      spend: ['That was always in you. I only moved it forward.'],
      atCap: ['That string is taut. Pull another.'],
      idle: [
        'Vigor. Force. Grace. Attunement. Four strings, one chord.',
        'I reflect. The Deep refracts. Know the difference.',
      ],
    },
  },
]

export const NPCS_BY_ID: Record<string, NpcDef> = Object.fromEntries(NPCS.map(n => [n.id, n]))

/** Deterministic-enough line pick for a dialog key (falls back to idle). */
export function npcLine(npc: NpcDef, key: DialogKey, salt: number): string {
  const pool = npc.lines[key] ?? npc.lines.idle ?? ['...']
  return pool[Math.abs(salt) % pool.length]
}
