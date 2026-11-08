import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'
import { updateAudioFrame } from '../audio/reactiveBus'
import { feel } from '../game/feelSignals'
import { gameTime, updateGameTime } from '../game/gameTime'
import { getRealmForDepth } from '../game/realms'
import { useGameStore } from '../game/state'
import { getPalette } from '../theme/palettes'
import { setVisualSettings, updateVisualFrame } from './visualTuning'
import { AimThread } from './AimThread'
import { AstralBolts } from './AstralBolts'
import { AstralBow } from './AstralBow'
import { BoltTrails } from './BoltTrails'
import { AuroraRibbons } from './AuroraRibbons'
import { Background } from './Background'
import { BanishNova } from './BanishNova'
import { Comets } from './Comets'
import { CrystalShards } from './CrystalShards'
import { DebrisRing } from './DebrisRing'
import { Eclipse } from './Eclipse'
import { Effects } from './Effects'
import { EnemyDirector } from './EnemyDirector'
import { FarRealm } from './FarRealm'
import { GodrayShafts } from './GodrayShafts'
import { GroundRipples } from './GroundRipples'
import { HorrorSwarm } from './HorrorSwarm'
import { HudBridge } from './HudBridge'
import { Islands } from './Islands'
import { IslandTendrils } from './IslandTendrils'
import { SceneLights } from './SceneLights'
import { RealmGate } from './Mandala'
import { Particles } from './Particles'
import { PlayerAvatar } from './PlayerAvatar'
import { PlayerRig } from './PlayerRig'
import { PlayerTrail } from './PlayerTrail'
import { RealmDressing } from './RealmDressing'
import { RealmLandmark } from './RealmLandmark'
import { ResonancePoints } from './ResonancePoints'
import { RuneStones } from './RuneStones'
import { Tethers } from './Tethers'
import { WardenRig } from './WardenRig'
import { WorldStreamer } from './WorldStreamer'

/** Runs before every other useFrame callback (negative priorities): audio bus
 * first (REAL dt, never pauses), then the hit-stop clock (REAL dt — it is
 * the source of worldScale), then the visual tuning snapshot. */
function FrameDriver() {
  useFrame((_, dt) => {
    updateAudioFrame(Math.min(dt, 0.1))
  }, -100)
  useFrame((_, dt) => {
    updateGameTime(Math.min(dt, 0.1))
    feel.hitStopActive = gameTime.stopLeft > 0
    feel.hitStopT = gameTime.stopLeft
    feel.hitStopCount = gameTime.stopCount
  }, -95)
  useFrame((_, dt) => {
    updateVisualFrame(Math.min(dt, 0.1))
  }, -90)
  return null
}

export function PlayScene() {
  const analysis = useGameStore(s => s.analysis)
  const depth = useGameStore(s => s.depth)
  // The realm decides the look; the store depth commit at each shift's
  // whiteout peak is the single React re-render of the descent.
  const palette = useMemo(() => getPalette(getRealmForDepth(depth).paletteId), [depth])

  // Mirror the visual settings into the non-React tuning module.
  useEffect(() => {
    const push = () => {
      const s = useGameStore.getState().settings
      setVisualSettings(s.visualIntensity, s.reducedMotion)
    }
    push()
    return useGameStore.subscribe(push)
  }, [])

  if (!analysis) return null

  return (
    <div className="canvas-wrap">
      <Canvas
        // `flat` = NoToneMapping at the material level: every surface writes raw
        // scene-linear HDR into the composer's HalfFloat buffer, and the single
        // display transform lives at the END of the post chain (Effects.tsx).
        // Without it R3F defaults to per-material ACES, which compressed the
        // islands' HDR rune veins below the bloom threshold before the composer
        // ever saw them.
        flat
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 75, near: 0.1, far: 500, position: [0, 4, 40] }}
      >
        <FrameDriver />
        <Suspense fallback={null}>
          <WorldStreamer />
          <EnemyDirector />
          <Background palette={palette} />
          <Eclipse palette={palette} />
          <FarRealm palette={palette} />
          <RealmLandmark palette={palette} />
          <SceneLights palette={palette} />
          <Islands palette={palette} />
          <IslandTendrils palette={palette} />
          <CrystalShards palette={palette} />
          <RealmDressing palette={palette} />
          <DebrisRing palette={palette} />
          <GroundRipples palette={palette} />
          <Tethers palette={palette} />
          <Comets palette={palette} />
          <AuroraRibbons palette={palette} />
          <GodrayShafts palette={palette} />
          <RealmGate palette={palette} />
          <Particles palette={palette} />
          <ResonancePoints palette={palette} />
          <PlayerRig />
          {/* after PlayerRig: the DOM HUD projects with THIS frame's camera */}
          <HudBridge />
          <AimThread palette={palette} />
          <RuneStones palette={palette} />
          <PlayerAvatar palette={palette} />
          {/* after PlayerAvatar: latch cling reads avatarFrame same-frame */}
          <HorrorSwarm palette={palette} />
          <WardenRig palette={palette} />
          {/* after PlayerAvatar (avatarFrame) and before AstralBolts: the
              bolts read bowFrame.manifest same-frame to yield the muzzle orb */}
          <AstralBow palette={palette} />
          <AstralBolts palette={palette} />
          <BoltTrails palette={palette} />
          <BanishNova palette={palette} />
          <PlayerTrail palette={palette} />
          <Effects palette={palette} />
        </Suspense>
      </Canvas>
    </div>
  )
}
