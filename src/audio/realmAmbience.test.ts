import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../game/seededRandom'
import { REALMS } from '../game/realms'
import {
  BED_MASTER,
  LOOPABLE,
  makeAmbienceState,
  REALM_BEDS,
  realmBedForDepth,
  SHOT_CEIL,
  stepAmbience,
  type AmbienceInputs,
} from './realmAmbience'

const quiet: AmbienceInputs = {
  now: 0,
  energy: 1,
  barWrap: 0,
  onDownbeat: false,
  onBeat: false,
  onOffbeat: false,
}

describe('REALM_BEDS', () => {
  it('covers the ladder; loops only use loop-safe samples', () => {
    expect(REALM_BEDS.length).toBe(REALMS.length)
    for (let i = 0; i < REALM_BEDS.length; i++) {
      const bed = REALM_BEDS[i]
      expect(bed.id).toBe(REALMS[i].id)
      if (bed.loop) {
        expect(LOOPABLE).toContain(bed.loop.sample)
        expect(bed.loop.gain).toBeLessThanOrEqual(BED_MASTER)
        expect(bed.loop.gain).toBeGreaterThan(0)
        expect(bed.loop.wet).toBeGreaterThanOrEqual(0)
        expect(bed.loop.wet).toBeLessThanOrEqual(1)
      }
      for (const layer of bed.layers) {
        expect(layer.gain).toBeLessThanOrEqual(SHOT_CEIL)
        expect(layer.gain).toBeGreaterThan(0)
        if (layer.mode === 'everyNBars') expect(layer.n).toBeGreaterThanOrEqual(1)
        if (layer.mode === 'random') {
          expect(layer.minGap).toBeGreaterThan(0)
          expect(layer.maxGap!).toBeGreaterThanOrEqual(layer.minGap!)
        }
      }
    }
  })

  it('never touches the trip/dread-owned voices', () => {
    for (const bed of REALM_BEDS) {
      const names: string[] = bed.layers.map(l => l.sample as string)
      if (bed.loop) names.push(bed.loop.sample as string)
      expect(names).not.toContain('heart_beat')
      expect(names).not.toContain('latch_gnaw_loop')
    }
  })
})

describe('stepAmbience', () => {
  it('is deterministic under an injected rng and fake clock', () => {
    const run = () => {
      const st = makeAmbienceState()
      const rng = mulberry32(42)
      const fired: string[] = []
      for (let tick = 0; tick < 400; tick++) {
        const t = tick * 0.05
        const intents = stepAmbience(st, REALM_BEDS[4], {
          ...quiet,
          now: t,
          barWrap: Math.floor(t / 2),
        }, rng)
        for (const i of intents) fired.push(`${t.toFixed(2)}:${i.sample}:${i.pan.toFixed(3)}`)
      }
      return fired
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('fires everyNBars layers only on wrap multiples', () => {
    const st = makeAmbienceState()
    const rng = mulberry32(7)
    const bed = REALM_BEDS[2] // cathedral: gong every 4 bars
    stepAmbience(st, bed, { ...quiet, barWrap: 0 }, rng) // prime
    const hits: number[] = []
    for (let bar = 1; bar <= 12; bar++) {
      const intents = stepAmbience(st, bed, { ...quiet, barWrap: bar }, rng)
      if (intents.some(i => i.sample === 'gong_swell')) hits.push(bar)
    }
    expect(hits).toEqual([4, 8, 12])
  })

  it('beat-mode layers respect their energy gates', () => {
    const st = makeAmbienceState()
    const rng = mulberry32(9)
    const bed = REALM_BEDS[1] // jungle: didge on offbeats above 0.5 energy
    const low = stepAmbience(st, bed, { ...quiet, energy: 0.3, onOffbeat: true }, rng)
    expect(low.some(i => i.sample === 'didge_pulse')).toBe(false)
    const high = stepAmbience(st, bed, { ...quiet, energy: 0.8, onOffbeat: true }, rng)
    expect(high.some(i => i.sample === 'didge_pulse')).toBe(true)
  })

  it('random layers respect their gap windows', () => {
    const st = makeAmbienceState()
    const rng = mulberry32(5)
    const bed = REALM_BEDS[5] // lavacore: roar every 9-16s
    const roars: number[] = []
    for (let tick = 0; tick < 2400; tick++) {
      const t = tick * 0.05
      const intents = stepAmbience(st, bed, { ...quiet, now: t, barWrap: Math.floor(t / 2) }, rng)
      if (intents.some(i => i.sample === 'warden_roar')) roars.push(t)
    }
    expect(roars.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < roars.length; i++) {
      const gap = roars[i] - roars[i - 1]
      expect(gap).toBeGreaterThanOrEqual(9 - 0.06)
      expect(gap).toBeLessThanOrEqual(16 + 0.06)
    }
  })

  it('pans stay inside the layer spread', () => {
    const st = makeAmbienceState()
    const rng = mulberry32(11)
    for (let tick = 0; tick < 600; tick++) {
      const t = tick * 0.05
      const intents = stepAmbience(st, REALM_BEDS[1], { ...quiet, now: t, barWrap: Math.floor(t / 2) }, rng)
      for (const i of intents) {
        expect(Math.abs(i.pan)).toBeLessThanOrEqual(0.7)
      }
    }
  })

  it('resolves by depth with ladder wrap', () => {
    expect(realmBedForDepth(0).id).toBe('astral')
    expect(realmBedForDepth(8).id).toBe('cathedral')
  })
})
