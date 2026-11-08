import { beforeEach, describe, expect, it } from 'vitest'
import { audioFrame } from '../audio/reactiveBus'
import { feel } from '../game/feelSignals'
import { runState } from '../game/runState'
import { worldState } from '../game/worldState'
import { governor } from './perfGovernor'
import {
  combatSignals,
  combatWavePush,
  dropWavePush,
  forcing,
  fxSignals,
  resetVisuals,
  runeRank,
  setVisualSettings,
  slew,
  smoothstep,
  T,
  triggerBanishNova,
  triggerCombatImpact,
  updateVisualFrame,
  visuals,
} from './visualTuning'
import { freshCombatCounters } from '../game/runState'

function setFrame(over: Partial<typeof audioFrame>): void {
  Object.assign(audioFrame, {
    tier: 0,
    tierFrom: 0,
    tierBlend: 1,
    intensity: 0,
    bass: 0,
    mids: 0,
    highs: 0,
    onset: false,
    onsetStrength: 0,
    midOnsetStrength: 0,
    nextTier: -1,
    timeToDrop: Infinity,
    rise: 0,
    dropCommitCount: 0,
    gridConfidence: 0,
    barConfidence: 0,
    gridPhase: 0,
    barPhase: 0,
    time: 0,
    duration: 0,
    ...over,
  })
}

beforeEach(() => {
  resetVisuals()
  setVisualSettings(0.8, false)
  forcing.tier = -1
  forcing.intensity = -1
  forcing.psychePreview = 0
  forcing.echoPreview = false
  forcing.dropCharge = -1
  forcing.impactNow = false
  forcing.cometNow = false
  // Contract tests pin the classic fold; style variety is tested separately.
  forcing.peakStyle = 0
  forcing.horrorDemo = -1
  governor.level = 0
  runState.combat = freshCombatCounters()
  setFrame({})
  updateVisualFrame(1 / 60)
})

describe('tier weights', () => {
  it('sum to 1 at every blend position', () => {
    for (const blend of [0, 0.2, 0.5, 0.8, 1]) {
      setFrame({ tier: 2, tierFrom: 0, tierBlend: blend })
      updateVisualFrame(1 / 60)
      expect(visuals.w0 + visuals.w1 + visuals.w2 + visuals.w3).toBeCloseTo(1, 6)
    }
  })

  it('T() is continuous across a tier switch', () => {
    setFrame({ tier: 1, tierFrom: 0, tierBlend: 1 })
    updateVisualFrame(1 / 60)
    const before = T(10, 20, 30, 40)
    // new switch starts: tier 2 from 1 at blend 0 must equal tier 1 fully
    setFrame({ tier: 2, tierFrom: 1, tierBlend: 0 })
    updateVisualFrame(1 / 60)
    const atSwitch = T(10, 20, 30, 40)
    expect(atSwitch).toBeCloseTo(before, 6)
  })

  it('full blend lands exactly on the target tier value', () => {
    setFrame({ tier: 3, tierFrom: 1, tierBlend: 1 })
    updateVisualFrame(1 / 60)
    expect(T(1, 2, 3, 4)).toBeCloseTo(4, 6)
  })
})

describe('runeRank', () => {
  it('is a permutation of 0..11', () => {
    const ranks = Array.from({ length: 12 }, (_, i) => runeRank(i)).sort((a, b) => a - b)
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
})

describe('slew', () => {
  it('clamps rise and fall rates', () => {
    expect(slew(0, 1, 2, 1, 0.1)).toBeCloseTo(0.2, 6)
    expect(slew(1, 0, 2, 1, 0.1)).toBeCloseTo(0.9, 6)
    expect(slew(0.99, 1, 2, 1, 0.1)).toBe(1)
  })
})

describe('reducedMotion contract', () => {
  it('kaleidoscope is hard OFF and echo capped at 0.5', () => {
    setVisualSettings(1, true)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 600; i++) updateVisualFrame(1 / 60)
    expect(visuals.kaleidoMix).toBe(0)
    expect(visuals.echoDamp).toBeLessThanOrEqual(0.5)
    expect(visuals.fovBreathAmp).toBe(0)
  })

  it('kaleidoscope engages at SHATTER without reducedMotion', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    // playability cap: strong fold, but the world never fully dissolves
    expect(visuals.kaleidoMix).toBeGreaterThan(0.6)
    expect(visuals.kaleidoMix).toBeLessThanOrEqual(0.8)
    expect(visuals.echoDamp).toBeGreaterThan(0.6)
  })

  it('low visualIntensity slider also disables the kaleidoscope', () => {
    setVisualSettings(0.2, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.kaleidoMix).toBe(0)
  })
})

describe('scene signals', () => {
  it('rune ignition rises with intensity and slews smoothly', () => {
    setFrame({ tier: 1, tierFrom: 1, tierBlend: 1, intensity: 0.9 })
    let prev = visuals.runeIgnition
    for (let i = 0; i < 60; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.runeIgnition - prev).toBeLessThanOrEqual(6 / 60 + 1e-6)
      prev = visuals.runeIgnition
    }
    expect(visuals.runeIgnition).toBeGreaterThan(3)
  })

  it('debris follows the SHATTER weight and returns after', () => {
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    for (let i = 0; i < 240; i++) updateVisualFrame(1 / 60)
    expect(visuals.debrisAmount).toBeGreaterThan(0.9)
    setFrame({ tier: 1, tierFrom: 3, tierBlend: 1, intensity: 0.3 })
    for (let i = 0; i < 400; i++) updateVisualFrame(1 / 60)
    expect(visuals.debrisAmount).toBeLessThan(0.05)
  })

  it('breath stays within -1..1.3', () => {
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, intensity: 0.8, bass: 1 })
    for (let i = 0; i < 600; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.breath).toBeGreaterThanOrEqual(-1)
      expect(visuals.breath).toBeLessThanOrEqual(1.3)
    }
  })
})

describe('smoothstep', () => {
  it('clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6)
  })
})

describe('drop anticipation', () => {
  it('charges toward a known drop and reaches a strong level', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, intensity: 0.8, nextTier: 3, timeToDrop: 0.15, rise: 1 })
    for (let i = 0; i < 120; i++) updateVisualFrame(1 / 60)
    expect(visuals.dropCharge).toBeGreaterThan(0.7)
    expect(visuals.dropInhale).toBeGreaterThan(0.9)
    expect(visuals.dropFovPull).toBeGreaterThan(2)
  })

  it('a false-positive prediction breathes back out without one-shots', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, nextTier: 3, timeToDrop: 1, rise: 1 })
    const nova0 = visuals.novaCount
    for (let i = 0; i < 90; i++) updateVisualFrame(1 / 60)
    expect(visuals.dropCharge).toBeGreaterThan(0.4)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, nextTier: 1, timeToDrop: Infinity })
    for (let i = 0; i < 90; i++) updateVisualFrame(1 / 60)
    expect(visuals.dropCharge).toBeLessThan(0.05)
    expect(visuals.novaCount).toBe(nova0)
  })
})

describe('drop impact', () => {
  it('fires the full one-shot suite on a dropCommitCount edge and decays', () => {
    setVisualSettings(0.8, false)
    const nova0 = visuals.novaCount
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, dropCommitCount: 1 })
    updateVisualFrame(1 / 60)
    expect(visuals.impactPulse).toBe(1)
    expect(visuals.blastProgress).toBeLessThan(0.1)
    expect(visuals.novaCount).toBe(nova0 + 1)
    expect(visuals.skyFlash).toBeGreaterThan(0.5)
    expect(visuals.dropWaveStrength).toBeGreaterThan(0.5)
    for (let i = 0; i < 18; i++) updateVisualFrame(1 / 60) // ~0.3s
    expect(visuals.blastProgress).toBeCloseTo(0.5 + 1 / 60 / 0.6, 1)
    for (let i = 0; i < 42; i++) updateVisualFrame(1 / 60) // past 0.6s total
    expect(visuals.blastProgress).toBe(1)
    expect(visuals.impactPulse).toBeLessThan(0.1)
    // no re-fire without a new edge
    expect(visuals.novaCount).toBe(nova0 + 1)
  })

  it('dropWavePush is a bounded expanding ring that dies by 1.2s', () => {
    visuals.dropWaveStrength = 1
    visuals.dropWaveAge = 0
    expect(dropWavePush(0)).toBeGreaterThan(0.5) // ring at dist 0, age 0
    visuals.dropWaveAge = 0.5
    expect(dropWavePush(55)).toBeGreaterThan(0.3) // ring reaches ~55u at 0.5s
    expect(dropWavePush(300)).toBeLessThan(1e-6)
    visuals.dropWaveAge = 1.3
    expect(dropWavePush(55)).toBe(0)
    visuals.dropWaveAge = 0.1
    visuals.dropWaveStrength = 0
    expect(dropWavePush(10)).toBe(0)
  })
})

describe('beat-locked pulses', () => {
  it('are hard OFF below the grid-confidence gate', () => {
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, gridConfidence: 0.3, barConfidence: 1, gridPhase: 0.01, barPhase: 0.01 })
    updateVisualFrame(1 / 60)
    expect(visuals.beatPulse).toBe(0)
    expect(visuals.barPulse).toBe(0)
    expect(visuals.barSync).toBe(0)
  })

  it('pulse right after the beat, decay before the next', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, gridConfidence: 1, barConfidence: 1, gridPhase: 0.02, barPhase: 0.02 })
    updateVisualFrame(1 / 60)
    const early = visuals.beatPulse
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, gridConfidence: 1, barConfidence: 1, gridPhase: 0.7, barPhase: 0.7 })
    updateVisualFrame(1 / 60)
    expect(early).toBeGreaterThan(0.5)
    expect(visuals.beatPulse).toBeLessThan(early * 0.1)
  })

  it('bar wraps bump barWrapCount and pluck tethers', () => {
    setVisualSettings(1, false)
    const wraps0 = visuals.barWrapCount
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, gridConfidence: 1, barConfidence: 1, barPhase: 0.95 })
    updateVisualFrame(1 / 60)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, gridConfidence: 1, barConfidence: 1, barPhase: 0.05 })
    updateVisualFrame(1 / 60)
    expect(visuals.barWrapCount).toBe(wraps0 + 1)
    expect(visuals.tetherPluck).toBeGreaterThan(0.8)
  })
})

describe('reducedMotion contract — song-structure additions', () => {
  it('caps every new effect under rm', () => {
    setVisualSettings(1, true)
    setFrame({
      tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1,
      nextTier: 3, timeToDrop: 0.2, rise: 1,
      gridConfidence: 1, barConfidence: 1, gridPhase: 0.01, barPhase: 0.01,
    })
    forcing.impactNow = true
    // drive the rite auras + hit-stop so their rm caps are exercised too
    runState.activeEffects.stasisT = 4
    runState.activeEffects.veilT = 6
    runState.activeEffects.frenzyT = 8
    feel.hitStopActive = true
    feel.hitStopT = 0.08
    let maxPulse = 0
    let maxSky = 0
    let maxBeat = 0
    let maxBar = 0
    let maxBlastAmp = 0
    for (let i = 0; i < 600; i++) {
      updateVisualFrame(1 / 60)
      maxPulse = Math.max(maxPulse, visuals.impactPulse)
      maxSky = Math.max(maxSky, visuals.skyFlash)
      maxBeat = Math.max(maxBeat, visuals.beatPulse)
      maxBar = Math.max(maxBar, visuals.barPulse)
      maxBlastAmp = Math.max(maxBlastAmp, visuals.blastAmp)
      expect(visuals.dropFovPull).toBe(0)
      expect(visuals.tetherPluck).toBe(0)
      expect(visuals.tripLevel).toBeLessThanOrEqual(0.3 + 1e-9)
      expect(visuals.stasisAura).toBeLessThanOrEqual(0.6 + 1e-9)
      expect(visuals.veilAura).toBeLessThanOrEqual(0.6 + 1e-9)
      expect(visuals.frenzyAura).toBeLessThanOrEqual(0.6 + 1e-9)
      expect(visuals.freezeFrame).toBeLessThanOrEqual(0.5 + 1e-9)
      expect(visuals.trailWidthGain).toBeLessThanOrEqual(1 + 1e-9)
      expect(visuals.threadWidthGain).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(maxPulse).toBeLessThanOrEqual(0.6)
    expect(maxSky).toBeLessThanOrEqual(0.5)
    expect(maxBeat).toBeLessThanOrEqual(0.6)
    expect(maxBar).toBeLessThanOrEqual(0.6)
    expect(maxBlastAmp).toBeLessThanOrEqual(0.02)
    expect(visuals.cometSpeedMult).toBeLessThanOrEqual(0.6)
    expect(visuals.gradeGrain).toBe(0)
    expect(visuals.gradeContrast).toBeGreaterThanOrEqual(0.95)
    expect(visuals.gradeContrast).toBeLessThanOrEqual(1.05)
    runState.activeEffects.stasisT = 0
    runState.activeEffects.veilT = 0
    runState.activeEffects.frenzyT = 0
    feel.hitStopActive = false
    feel.hitStopT = 0
  })
})

describe('ribbon width gains', () => {
  it('the thread width never vanishes at vi=0 (the thread is UX)', () => {
    setVisualSettings(0, false)
    updateVisualFrame(1 / 60)
    expect(visuals.threadWidthGain).toBeGreaterThan(0)
    expect(visuals.trailWidthGain).toBeGreaterThan(0)
  })
})

describe('island tendrils', () => {
  it('tendrilCount follows the governor ladder and dies entirely at L4', () => {
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    updateVisualFrame(1 / 60)
    const full = visuals.tendrilCount
    expect(full).toBeGreaterThan(0)
    governor.level = 3
    updateVisualFrame(1 / 60)
    expect(visuals.tendrilCount).toBeLessThan(full)
    governor.level = 4
    updateVisualFrame(1 / 60)
    expect(visuals.tendrilCount).toBe(0)
    governor.level = 0
  })
})

describe('realm dressing + landmark', () => {
  it('dressingCount follows the governor ladder, dies at L4, scales with the realm mod', () => {
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    updateVisualFrame(1 / 60)
    const full = visuals.dressingCount
    expect(full).toBeGreaterThan(0)
    governor.level = 3
    updateVisualFrame(1 / 60)
    expect(visuals.dressingCount).toBeLessThan(full)
    governor.level = 4
    updateVisualFrame(1 / 60)
    expect(visuals.dressingCount).toBe(0)
    governor.level = 0
    const before = worldState.modsTarget.dressingDensity
    worldState.modsTarget.dressingDensity = 2
    worldState.modsCur.dressingDensity = 2
    updateVisualFrame(1 / 60)
    expect(visuals.dressingCount).toBeGreaterThan(full)
    worldState.modsTarget.dressingDensity = before
    worldState.modsCur.dressingDensity = before
  })

  it('landmarkGlow never fully dies at CALM and rm-caps under flashes', () => {
    setFrame({ tier: 0, tierFrom: 0, tierBlend: 1, intensity: 0 })
    updateVisualFrame(1 / 60)
    expect(visuals.landmarkGlow).toBeGreaterThan(0.2)
    setVisualSettings(1, true)
    visuals.skyFlash = 1
    visuals.impactPulse = 1
    updateVisualFrame(1 / 60)
    expect(visuals.landmarkGlow).toBeLessThanOrEqual(1.0)
  })
})

describe('arrivalPulse (realm-arrival bloom)', () => {
  it('fires on an epoch diff and decays past the whiteout', () => {
    updateVisualFrame(1 / 60)
    expect(visuals.arrivalPulse).toBe(0)
    worldState.epoch++
    updateVisualFrame(1 / 60)
    expect(visuals.arrivalPulse).toBeGreaterThan(0.9)
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.arrivalPulse).toBeLessThan(0.5)
    expect(visuals.arrivalPulse).toBeGreaterThan(0.1)
  })

  it('rm caps the bloom at 0.6', () => {
    setVisualSettings(1, true)
    worldState.epoch++
    updateVisualFrame(1 / 60)
    expect(visuals.arrivalPulse).toBeLessThanOrEqual(0.6)
    expect(visuals.arrivalPulse).toBeGreaterThan(0.5)
  })

  it('resetVisuals arms the edge — a fresh run never phantom-blooms', () => {
    worldState.epoch++
    resetVisuals()
    updateVisualFrame(1 / 60)
    expect(visuals.arrivalPulse).toBe(0)
  })
})

describe('freezeFrame (hit-stop signature)', () => {
  it('jumps while frozen and releases fast after', () => {
    setVisualSettings(1, false)
    feel.hitStopActive = true
    feel.hitStopT = 0.06
    updateVisualFrame(1 / 60)
    expect(visuals.freezeFrame).toBeGreaterThan(0.9)
    feel.hitStopActive = false
    feel.hitStopT = 0
    for (let i = 0; i < 30; i++) updateVisualFrame(1 / 60)
    expect(visuals.freezeFrame).toBeLessThan(0.01)
  })

  it('desaturates and bites the grade while active', () => {
    setVisualSettings(1, false)
    updateVisualFrame(1 / 60)
    const satBefore = visuals.gradeSat
    const conBefore = visuals.gradeContrast
    feel.hitStopActive = true
    feel.hitStopT = 0.08
    updateVisualFrame(1 / 60)
    expect(visuals.gradeSat).toBeLessThan(satBefore)
    expect(visuals.gradeContrast).toBeGreaterThan(conBefore)
    feel.hitStopActive = false
    feel.hitStopT = 0
  })
})

describe('rite auras', () => {
  it('rise while a rite runs and decay after it ends', () => {
    runState.activeEffects.frenzyT = 8
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.frenzyAura).toBeGreaterThan(0.9)
    runState.activeEffects.frenzyT = 0
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.frenzyAura).toBeLessThan(0.05)
  })

  it('blink through the final stretch — but stay steady under rm', () => {
    runState.activeEffects.stasisT = 4
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    runState.activeEffects.stasisT = 1.2
    let dipped = 1
    for (let i = 0; i < 120; i++) {
      updateVisualFrame(1 / 60)
      dipped = Math.min(dipped, visuals.stasisAura)
    }
    expect(dipped).toBeLessThan(0.85)
    setVisualSettings(1, true)
    for (let i = 0; i < 120; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.stasisAura).toBeLessThanOrEqual(0.6 + 1e-9)
    }
    runState.activeEffects.stasisT = 0
  })
})

describe('trip proximity', () => {
  it('rises into the kaleidoscope trip and decays on the way out', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 400; i++) updateVisualFrame(1 / 60)
    expect(visuals.tripLevel).toBeGreaterThan(0.6)
    setFrame({ tier: 0, tierFrom: 0, tierBlend: 1, intensity: 0 })
    for (let i = 0; i < 600; i++) updateVisualFrame(1 / 60)
    expect(visuals.tripLevel).toBeLessThan(0.05)
  })

  it('pre-drop charge alone lifts tripLevel partway', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, nextTier: 3, timeToDrop: 0.3, rise: 1 })
    for (let i = 0; i < 200; i++) updateVisualFrame(1 / 60)
    expect(visuals.tripLevel).toBeGreaterThan(0.3)
    expect(visuals.tripLevel).toBeLessThan(0.9)
  })

  it('boosts the shimmer melt and its ceiling while tripping', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 400; i++) updateVisualFrame(1 / 60)
    expect(visuals.shimmerAmp).toBeGreaterThan(0.006)
  })
})

describe('peak styles', () => {
  it('TUNNEL never folds and widens the aim tunnel', () => {
    setVisualSettings(1, false)
    forcing.peakStyle = 1
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.kaleidoMix).toBe(0)
    expect(visuals.centerClear).toBeCloseTo(0.4, 5)
  })

  it('FRACTAL folds shallow with high fold counts', () => {
    setVisualSettings(1, false)
    forcing.peakStyle = 3
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.kaleidoMix).toBeGreaterThan(0.3)
    expect(visuals.kaleidoMix).toBeLessThanOrEqual(0.45)
    expect(visuals.kaleidoN1).toBeGreaterThanOrEqual(7)
  })

  it('STROBE is remapped away under reducedMotion', () => {
    setVisualSettings(1, true)
    forcing.peakStyle = 2
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.peakStyle).toBe(1)
  })

  it('KALEIDO keeps the default aim tunnel clear radius', () => {
    setVisualSettings(1, false)
    forcing.peakStyle = 0
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.centerClear).toBeCloseTo(0.28, 5)
  })
})

describe('color grade', () => {
  it('is identity at vi=0', () => {
    setVisualSettings(0, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.gradeTempR).toBeCloseTo(1, 5)
    expect(visuals.gradeTempB).toBeCloseTo(1, 5)
    expect(visuals.gradeLift).toBeCloseTo(0, 5)
    expect(visuals.gradeSat).toBeCloseTo(1, 5)
    expect(visuals.gradeContrast).toBeCloseTo(1, 5)
    expect(visuals.gradeGrain).toBe(0)
  })

  it('total saturation (psyche x grade) stays bounded', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.satBoost * visuals.gradeSat).toBeLessThanOrEqual(1.35 + 1e-6)
  })

  it('warms and saturates toward SHATTER', () => {
    setVisualSettings(0.8, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 0.5 })
    updateVisualFrame(1 / 60)
    expect(visuals.gradeTempR).toBeGreaterThan(1)
    expect(visuals.gradeTempB).toBeLessThan(1)
    expect(visuals.gradeContrast).toBeGreaterThan(1)
    expect(visuals.gradeGrain).toBeGreaterThan(0)
  })
})

describe('governor-scaled spawn gains', () => {
  it('fallRate and cometRate degrade with governor level', () => {
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    governor.level = 0
    updateVisualFrame(1 / 60)
    const full = visuals.fallRate
    expect(full).toBeGreaterThan(10)
    expect(visuals.cometRate).toBeGreaterThan(0.5)
    governor.level = 2
    updateVisualFrame(1 / 60)
    expect(visuals.fallRate).toBeCloseTo(full * 0.6, 5)
    governor.level = 3
    updateVisualFrame(1 / 60)
    expect(visuals.cometRate).toBe(0)
    governor.level = 4
    updateVisualFrame(1 / 60)
    expect(visuals.fallRate).toBe(0)
    governor.level = 0
  })
})

describe('fog atmosphere', () => {
  it('fogGlow rises with bass at SHATTER, slew-limited, and resets', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    let prev = visuals.fogGlow
    for (let i = 0; i < 120; i++) {
      updateVisualFrame(1 / 60)
      expect(Math.abs(visuals.fogGlow - prev)).toBeLessThanOrEqual(5 / 60 + 1e-6)
      prev = visuals.fogGlow
    }
    expect(visuals.fogGlow).toBeGreaterThan(0.4)
    resetVisuals()
    expect(visuals.fogGlow).toBe(0)
  })

  it('fogGlow stays rm-capped at 0.5 even with impact kicks', () => {
    setVisualSettings(1, true)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    forcing.impactNow = true
    for (let i = 0; i < 300; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.fogGlow).toBeLessThanOrEqual(0.5 + 1e-9)
    }
  })

  it('fogDensity obeys the governor ladder and the vi gate', () => {
    setVisualSettings(0.8, false)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, intensity: 0.8 })
    governor.level = 0
    updateVisualFrame(1 / 60)
    const full = visuals.fogDensity
    expect(full).toBeGreaterThan(0.5)
    governor.level = 2
    updateVisualFrame(1 / 60)
    expect(visuals.fogDensity).toBeCloseTo(full * 0.7, 2)
    governor.level = 3
    updateVisualFrame(1 / 60)
    expect(visuals.fogDensity).toBe(0)
    governor.level = 0
    setVisualSettings(0.02, false)
    updateVisualFrame(1 / 60)
    expect(visuals.fogDensity).toBe(0)
  })

  it('fogNear stays below fogFar across tiers with skyFlash lifts', () => {
    for (const tier of [0, 1, 2, 3]) {
      setFrame({
        tier,
        tierFrom: tier,
        tierBlend: 1,
        intensity: 1,
        dropCommitCount: tier + 1,
      })
      updateVisualFrame(1 / 60) // the commit edge fires an impact -> skyFlash
      expect(visuals.fogNear).toBeLessThan(visuals.fogFar)
    }
  })
})

describe('runeGlow', () => {
  it('pulses with mid onsets on top of the tier base', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, intensity: 0.8, midOnsetStrength: 1.2 })
    updateVisualFrame(1 / 60)
    const pulsed = visuals.runeGlow
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1, intensity: 0.8, midOnsetStrength: 0 })
    updateVisualFrame(1 / 60)
    expect(pulsed).toBeGreaterThan(visuals.runeGlow)
    expect(visuals.runeGlow).toBeGreaterThan(0)
  })

  it('is 0 at vi=0 and rm-capped at 1.0', () => {
    setVisualSettings(0, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, midOnsetStrength: 2 })
    updateVisualFrame(1 / 60)
    expect(visuals.runeGlow).toBe(0)
    setVisualSettings(1, true)
    updateVisualFrame(1 / 60)
    expect(visuals.runeGlow).toBeLessThanOrEqual(1.0)
  })
})

describe('ash field', () => {
  it('ambientCount follows the governor ladder', () => {
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    governor.level = 0
    updateVisualFrame(1 / 60)
    expect(visuals.ambientCount).toBe(400)
    governor.level = 3
    updateVisualFrame(1 / 60)
    expect(visuals.ambientCount).toBe(240)
    governor.level = 4
    updateVisualFrame(1 / 60)
    expect(visuals.ambientCount).toBe(140)
    governor.level = 0
  })

  it('emberFlareGain halves under rm', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    updateVisualFrame(1 / 60)
    const full = visuals.emberFlareGain
    expect(full).toBeGreaterThan(0.5)
    setVisualSettings(1, true)
    updateVisualFrame(1 / 60)
    expect(visuals.emberFlareGain).toBeCloseTo(full * 0.5, 5)
  })
})

describe('diegetic HUD signals', () => {
  it('auraGlow tracks the score multiplier with slew and resets', () => {
    runState.scoreState.multiplier = 5
    setFrame({})
    let prev = visuals.auraGlow
    for (let i = 0; i < 90; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.auraGlow - prev).toBeLessThanOrEqual(2.5 / 60 + 1e-6)
      prev = visuals.auraGlow
    }
    expect(visuals.auraGlow).toBeGreaterThan(0.9)
    runState.scoreState.multiplier = 1
    for (let i = 0; i < 600; i++) updateVisualFrame(1 / 60)
    expect(visuals.auraGlow).toBeLessThan(0.05)
    runState.scoreState.multiplier = 5
    updateVisualFrame(1 / 60)
    resetVisuals()
    expect(visuals.auraGlow).toBe(0)
    runState.scoreState.multiplier = 1
  })

  it('gateOpenPulse fires once per gate open, decays, and is rm-capped', () => {
    setVisualSettings(1, false)
    worldState.gate.active = true
    worldState.gate.openedAt = 12.5
    updateVisualFrame(1 / 60)
    expect(visuals.gateOpenPulse).toBe(1)
    updateVisualFrame(1 / 60)
    expect(visuals.gateOpenPulse).toBeLessThan(1)
    const decaying = visuals.gateOpenPulse
    updateVisualFrame(1 / 60)
    expect(visuals.gateOpenPulse).toBeLessThan(decaying) // no re-fire, same openedAt
    setVisualSettings(1, true)
    worldState.gate.openedAt = 20
    updateVisualFrame(1 / 60)
    expect(visuals.gateOpenPulse).toBe(0.5)
    worldState.gate.active = false
    worldState.gate.openedAt = 0
  })

  it('eclipseProgress clamps to track time; eclipseGlow rm-capped at 1.6', () => {
    setFrame({ time: 30, duration: 120 })
    updateVisualFrame(1 / 60)
    expect(visuals.eclipseProgress).toBeCloseTo(0.25, 5)
    setFrame({ time: 500, duration: 120 })
    updateVisualFrame(1 / 60)
    expect(visuals.eclipseProgress).toBe(1)
    setVisualSettings(1, true)
    forcing.dropCharge = 1
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1 })
    for (let i = 0; i < 120; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.eclipseGlow).toBeLessThanOrEqual(1.6 + 1e-9)
    }
    forcing.dropCharge = -1
  })

  it('threadNoise calms x0.4 under rm; threadGlow never vanishes at vi=0', () => {
    setVisualSettings(1, false)
    setFrame({ tier: 2, tierFrom: 2, tierBlend: 1 })
    updateVisualFrame(1 / 60)
    const full = visuals.threadNoise
    setVisualSettings(1, true)
    updateVisualFrame(1 / 60)
    expect(visuals.threadNoise).toBeCloseTo(full * 0.4, 5)
    setVisualSettings(0, false)
    updateVisualFrame(1 / 60)
    expect(visuals.threadGlow).toBeGreaterThan(0.4)
  })
})

describe('tunnel vision', () => {
  it('vignetteDark bounded at 0.88 and vignetteOffset floored at 0.18', () => {
    setVisualSettings(1, false)
    forcing.dropCharge = 1
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 300; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.vignetteDark).toBeLessThanOrEqual(0.88 + 1e-9)
      expect(visuals.vignetteOffset).toBeGreaterThanOrEqual(0.18 - 1e-9)
    }
    expect(visuals.tunnelDepth).toBeGreaterThan(0.5)
    forcing.dropCharge = -1
  })

  it('rm caps tunnelDepth at 0.5 and vignetteDark at 0.85; vi=0 disables', () => {
    setVisualSettings(1, true)
    forcing.dropCharge = 1
    setFrame({ tier: 3, tierFrom: 3, tierBlend: 1, intensity: 1, bass: 1 })
    for (let i = 0; i < 300; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.tunnelDepth).toBeLessThanOrEqual(0.5 + 1e-9)
      expect(visuals.vignetteDark).toBeLessThanOrEqual(0.85 + 1e-9)
    }
    forcing.dropCharge = -1
    setVisualSettings(0, false)
    updateVisualFrame(1 / 60)
    expect(visuals.tunnelDepth).toBe(0)
  })
})

describe('fxSignals', () => {
  it('resetVisuals bumps echoClear and zeroes structure state', () => {
    const before = fxSignals.echoClear
    visuals.dropCharge = 0.7
    visuals.impactPulse = 0.9
    resetVisuals()
    expect(fxSignals.echoClear).toBe(before + 1)
    expect(visuals.dropCharge).toBe(0)
    expect(visuals.impactPulse).toBe(0)
    expect(visuals.blastProgress).toBe(1)
  })
})

describe('horror combat layer', () => {
  it('latchDread rises toward the latch load and rm-caps at 0.6', () => {
    combatSignals.latchedCount = 3
    combatSignals.maxLatch = 3
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.latchDread).toBeGreaterThan(0.9)
    setVisualSettings(0.8, true)
    for (let i = 0; i < 60; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.latchDread).toBeLessThanOrEqual(0.6 + 1e-9)
    }
    combatSignals.latchedCount = 0
    setVisualSettings(0.8, false)
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.latchDread).toBeLessThan(0.05)
  })

  it('hpDread rises below 35% hp, rm-caps at 0.6, and clears on refill', () => {
    combatSignals.hpFrac = 0.1
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.hpDread).toBeGreaterThan(0.4)
    setVisualSettings(0.8, true)
    for (let i = 0; i < 60; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.hpDread).toBeLessThanOrEqual(0.6 + 1e-9)
    }
    setVisualSettings(0.8, false)
    combatSignals.hpFrac = 1
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.hpDread).toBeLessThan(0.05)
    // healthy pool never darkens the screen
    combatSignals.hpFrac = 0.6
    for (let i = 0; i < 120; i++) updateVisualFrame(1 / 60)
    expect(visuals.hpDread).toBeLessThan(0.01)
  })

  it('latchBite fires once per latchesSuffered bump and decays', () => {
    runState.combat.latchesSuffered++
    updateVisualFrame(1 / 60)
    expect(visuals.latchBite).toBe(1)
    updateVisualFrame(1 / 60)
    expect(visuals.latchBite).toBeLessThan(1)
    const decaying = visuals.latchBite
    updateVisualFrame(1 / 60)
    expect(visuals.latchBite).toBeLessThan(decaying)
  })

  it('triggerCombatImpact drives combatPulse + world wave, rm-capped', () => {
    triggerCombatImpact(1.2, 5, 6, 7)
    expect(visuals.combatPulse).toBe(1)
    expect(visuals.combatWaveAge).toBe(0)
    expect(visuals.combatWaveX).toBe(5)
    expect(visuals.combatWaveY).toBe(6)
    expect(visuals.combatWaveZ).toBe(7)
    const full = visuals.combatWaveStrength
    expect(full).toBeGreaterThan(0)
    setVisualSettings(0.8, true)
    triggerCombatImpact(1.2, 0, 0, 0)
    expect(visuals.combatPulse).toBeLessThanOrEqual(0.6)
    expect(visuals.combatWaveStrength).toBeLessThan(full)
  })

  it('combatWavePush is a bounded expanding ring, dead after 0.9s', () => {
    triggerCombatImpact(1, 0, 0, 0)
    expect(combatWavePush(0)).toBeGreaterThan(0)
    for (let i = 0; i < 30; i++) updateVisualFrame(1 / 60)
    // ~0.5s in: the ring is out at ~35u, origin push has faded
    expect(combatWavePush(70 * visuals.combatWaveAge)).toBeGreaterThan(combatWavePush(0))
    for (let i = 0; i < 40; i++) updateVisualFrame(1 / 60)
    expect(combatWavePush(0)).toBe(0)
    expect(combatWavePush(60)).toBe(0)
  })

  it('triggerBanishNova arms the ring which then completes', () => {
    triggerBanishNova(1)
    expect(visuals.banishProgress).toBe(0)
    expect(visuals.banishStrength).toBeGreaterThan(0)
    expect(visuals.combatPulse).toBeGreaterThanOrEqual(0.8)
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.banishProgress).toBe(1)
  })

  it('downedFade rises while downed and drains the grade', () => {
    setFrame({ tier: 1, tierFrom: 1, tierBlend: 1, intensity: 0.5 })
    updateVisualFrame(1 / 60)
    const satBefore = visuals.gradeSat
    combatSignals.downed = true
    for (let i = 0; i < 200; i++) updateVisualFrame(1 / 60)
    expect(visuals.downedFade).toBeGreaterThan(0.9)
    expect(visuals.gradeSat).toBeLessThan(satBefore)
    expect(visuals.vignetteDark).toBeGreaterThan(0.55)
    combatSignals.downed = false
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    expect(visuals.downedFade).toBeLessThan(0.05)
  })

  it('wardenPresence follows proximity while alive and rm-caps at 0.7', () => {
    combatSignals.wardenAlive = true
    combatSignals.wardenDist = 25
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.wardenPresence).toBeGreaterThan(0.5)
    setVisualSettings(0.8, true)
    for (let i = 0; i < 60; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.wardenPresence).toBeLessThanOrEqual(0.7 + 1e-9)
    }
    combatSignals.wardenAlive = false
    setVisualSettings(0.8, false)
    for (let i = 0; i < 400; i++) updateVisualFrame(1 / 60)
    expect(visuals.wardenPresence).toBeLessThan(0.05)
  })

  it('resetVisuals clears the combat layer and its input signals', () => {
    combatSignals.latchedCount = 4
    combatSignals.wardenAlive = true
    combatSignals.downed = true
    triggerCombatImpact(1, 1, 2, 3)
    triggerBanishNova(1)
    resetVisuals()
    expect(visuals.latchDread).toBe(0)
    expect(visuals.combatPulse).toBe(0)
    expect(visuals.banishProgress).toBe(1)
    expect(visuals.combatWaveStrength).toBe(0)
    expect(visuals.downedFade).toBe(0)
    expect(combatSignals.latchedCount).toBe(0)
    expect(combatSignals.wardenAlive).toBe(false)
    expect(combatSignals.downed).toBe(false)
  })
})

describe('bow ignition layer', () => {
  it('bowHeat slews toward the combo tier and rm-caps at 0.6', () => {
    combatSignals.castComboTier = 3
    for (let i = 0; i < 300; i++) updateVisualFrame(1 / 60)
    expect(visuals.bowHeat).toBeGreaterThan(0.9)
    setVisualSettings(0.8, true)
    for (let i = 0; i < 60; i++) {
      updateVisualFrame(1 / 60)
      expect(visuals.bowHeat).toBeLessThanOrEqual(0.6 + 1e-9)
    }
    setVisualSettings(0.8, false)
    combatSignals.castComboTier = 0
    for (let i = 0; i < 400; i++) updateVisualFrame(1 / 60)
    expect(visuals.bowHeat).toBeLessThan(0.05)
  })

  it('heat cools slower than it flares (a tier-up reads, a lull lingers)', () => {
    combatSignals.castComboTier = 3
    for (let i = 0; i < 30; i++) updateVisualFrame(1 / 60)
    const flared = visuals.bowHeat
    expect(flared).toBeGreaterThan(0.5)
    combatSignals.castComboTier = 0
    for (let i = 0; i < 30; i++) updateVisualFrame(1 / 60)
    expect(visuals.bowHeat).toBeGreaterThan(flared - (flared - 0) * 0.6)
  })

  it('stormGlow follows the armed flag both ways', () => {
    combatSignals.stormArmed = true
    for (let i = 0; i < 120; i++) updateVisualFrame(1 / 60)
    expect(visuals.stormGlow).toBeGreaterThan(0.9)
    combatSignals.stormArmed = false
    for (let i = 0; i < 200; i++) updateVisualFrame(1 / 60)
    expect(visuals.stormGlow).toBeLessThan(0.05)
  })

  it('resetVisuals clears the bow fields and their input signals', () => {
    combatSignals.castComboTier = 3
    combatSignals.castComboCount = 11
    combatSignals.stormArmed = true
    combatSignals.castOver = 1
    for (let i = 0; i < 60; i++) updateVisualFrame(1 / 60)
    resetVisuals()
    expect(visuals.bowHeat).toBe(0)
    expect(visuals.stormGlow).toBe(0)
    expect(combatSignals.castComboTier).toBe(0)
    expect(combatSignals.castComboCount).toBe(0)
    expect(combatSignals.stormArmed).toBe(false)
    expect(combatSignals.castOver).toBe(0)
  })
})
