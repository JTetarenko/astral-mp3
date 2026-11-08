import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color } from 'three'
import type { AmbientLight, DirectionalLight, HemisphereLight } from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { T } from './visualTuning'
import type { Palette } from '../theme/palettes'

/**
 * The lit-surface rig (islands, debris, avatar cloak — everything else is
 * emissive/unlit), tier-driven: dimmer contemplative CALM, fuller PEAK.
 *
 * Four lights, no shadows (perf law):
 *  - hemisphere: cool void above / warm rune bounce below — the vertical
 *    color polarity that sells "floating in an abyss" (highs ride here)
 *  - ambient: reduced to a floor so the hemisphere polarity stays visible
 *  - key directional: unchanged high-side key
 *  - rim directional: opposite-and-below back light in the palette primary,
 *    separating island/cloak silhouettes from the fog
 */
export function SceneLights({ palette }: { palette: Palette }) {
  const hemi = useRef<HemisphereLight>(null)
  const ambient = useRef<AmbientLight>(null)
  const key = useRef<DirectionalLight>(null)
  const rim = useRef<DirectionalLight>(null)

  const tints = useMemo(
    () => ({
      hemiSky: new Color(palette.voidTop).lerp(new Color(palette.secondary), 0.55),
      hemiGround: new Color(palette.islandBase).lerp(new Color(palette.primary), 0.3),
    }),
    [palette],
  )

  useFrame(() => {
    if (hemi.current) {
      hemi.current.intensity = T(0.4, 0.5, 0.6, 0.55) + audioFrame.highs * 0.05
    }
    if (ambient.current) {
      ambient.current.intensity = T(0.14, 0.2, 0.26, 0.2)
    }
    if (key.current) {
      key.current.intensity = T(0.18, 0.25, 0.3, 0.35)
    }
    if (rim.current) {
      rim.current.intensity = T(0.1, 0.14, 0.2, 0.26)
    }
  })

  return (
    <>
      <hemisphereLight ref={hemi} intensity={0.5} color={tints.hemiSky} groundColor={tints.hemiGround} />
      <ambientLight ref={ambient} intensity={0.2} color={palette.secondary} />
      <directionalLight
        ref={key}
        position={[30, 60, 20]}
        intensity={0.25}
        color={palette.secondary}
      />
      <directionalLight
        ref={rim}
        position={[-35, 25, -40]}
        intensity={0.15}
        color={palette.primary}
      />
    </>
  )
}
