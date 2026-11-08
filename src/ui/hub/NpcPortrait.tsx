import { useEffect, useState } from 'react'
import type { NpcDef } from '../../game/npcs'
import { GlitchText } from '../fx/GlitchText'
import { SigilRing } from '../fx/MenuAtmosphere'
import { runeMaskStyle } from '../fx/menuGlyphs'
import { useDecodeText } from '../fx/useDecodeText'

/** Fanned "manuscript-page wing" rune arc angles (deg) — Elara's folio wings
 * echoed procedurally for every sanctum keeper. */
const WING_ANGLES = [-64, -32, 0, 32, 64]

/**
 * A sanctum keeper's portrait: layered procedural composition (glow, scoped
 * sigil ring, rune wing-fan, central glyph, glitch nameplate) that is
 * complete with zero images — an optional PNG dropped at the NPC's
 * portraitSrc (public/assets/npc/<id>.png) overlays seamlessly when present.
 */
export function NpcPortrait({ npc, line }: { npc: NpcDef; line: string }) {
  const [imgOk, setImgOk] = useState(false)
  const decoded = useDecodeText(line)
  useEffect(() => setImgOk(false), [npc.id])
  return (
    <div className="npc-portrait" data-testid={`npc-${npc.id}`}>
      <div className="npc-frame">
        <div className="npc-glow" />
        <div className="npc-sigil-wrap">
          <SigilRing />
        </div>
        <div className="npc-wing-runes">
          {WING_ANGLES.map((deg, i) => (
            <i
              key={deg}
              className="atlas-rune wing-rune"
              style={{
                ...runeMaskStyle((npc.glyph + i * 5) % 12),
                transform: `rotate(${deg}deg) translateY(-46px)`,
              }}
            />
          ))}
        </div>
        <i className="atlas-rune npc-glyph" style={runeMaskStyle(npc.glyph)} />
        {/* optional art drop-in: hidden until loaded, removed on error */}
        <img
          className="npc-img"
          src={npc.portraitSrc}
          alt=""
          style={{ opacity: imgOk ? 1 : 0 }}
          onLoad={() => setImgOk(true)}
          onError={e => {
            ;(e.target as HTMLImageElement).remove()
          }}
        />
      </div>
      <GlitchText as="div" className="npc-name" text={npc.name} />
      <div className="npc-epithet">{npc.epithet}</div>
      <div className="npc-line">“{decoded}”</div>
    </div>
  )
}
