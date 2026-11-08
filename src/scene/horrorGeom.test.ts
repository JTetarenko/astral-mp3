import { describe, expect, it } from 'vitest'
import {
  buildEyeGem,
  buildHuskShell,
  buildLimbSpike,
  buildVeilShred,
  crumple,
  deathFling,
  EYE_PER,
  freshHorrorPose,
  HORROR_VISUALS,
  horrorPose,
  HUSK_PER,
  latchClingPose,
  latchCurve,
  leapCurve,
  LIMB_PER,
  partCounts,
  POSE_STATE,
  SHRED_PER,
  twitchPulse,
  WARDEN_EYE_CAP,
  WARDEN_HUSK_CAP,
  WARDEN_LIMB_CAP,
  WARDEN_SHRED_CAP,
  WARDEN_VISUALS,
  wardenPose,
  windupCurve,
  type HorrorPoseIn,
  type TriSoup,
} from './horrorGeom'
import { REALMS } from '../game/realms'

// ---------------------------------------------------------------------------
// geometry invariants (wingGeom.test idiom)
// ---------------------------------------------------------------------------

function signedVolume(soup: TriSoup): number {
  let vol = 0
  const p = soup.positions
  for (let f = 0; f < p.length / 9; f++) {
    const o = f * 9
    const ax = p[o]
    const ay = p[o + 1]
    const az = p[o + 2]
    const bx = p[o + 3]
    const by = p[o + 4]
    const bz = p[o + 5]
    const cx = p[o + 6]
    const cy = p[o + 7]
    const cz = p[o + 8]
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return vol
}

describe('part solids', () => {
  const solids: Array<[string, TriSoup, boolean]> = [
    ['husk', buildHuskShell(), true],
    ['limb', buildLimbSpike(), true],
    ['eye', buildEyeGem(), true],
    ['shred', buildVeilShred(), false], // flat plate: near-zero volume by design
  ]

  it('closed solids wind outward (positive signed volume)', () => {
    for (const [name, soup, closed] of solids) {
      if (!closed) continue
      expect(signedVolume(soup), name).toBeGreaterThan(0)
    }
  })

  it('along stays in [0,1] and arrays are consistent lengths', () => {
    for (const [name, soup] of solids) {
      expect(soup.positions.length % 9, name).toBe(0)
      expect(soup.along.length * 3, name).toBe(soup.positions.length)
      expect(soup.glow.length, name).toBe(soup.along.length)
      for (const v of soup.along) {
        expect(v).toBeGreaterThanOrEqual(-1e-6)
        expect(v).toBeLessThanOrEqual(1 + 1e-6)
      }
      for (const g of soup.glow) {
        expect(Number.isFinite(g)).toBe(true)
        expect(g).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('husk carries an HDR vein ridge; limb stays dark; eye is uniform', () => {
    const husk = buildHuskShell()
    expect(Math.max(...husk.glow)).toBeGreaterThan(2)
    const limb = buildLimbSpike()
    expect(Math.max(...limb.glow)).toBe(0)
    const eye = buildEyeGem()
    expect(Math.min(...eye.glow)).toBe(1)
    expect(Math.max(...eye.glow)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// layout tables
// ---------------------------------------------------------------------------

describe('HORROR_VISUALS', () => {
  it('has one visual per realm, id-aligned', () => {
    expect(HORROR_VISUALS.map(v => v.id)).toEqual(REALMS.map(r => r.id))
  })

  it('part counts never exceed the instanced-buffer budget', () => {
    for (const v of HORROR_VISUALS) {
      const [husk, limb, shred, eye] = partCounts(v)
      expect(husk, v.id).toBeLessThanOrEqual(HUSK_PER)
      expect(limb, v.id).toBeLessThanOrEqual(LIMB_PER)
      expect(shred, v.id).toBeLessThanOrEqual(SHRED_PER)
      expect(eye, v.id).toBeLessThanOrEqual(EYE_PER)
      expect(eye, v.id).toBeGreaterThan(0) // every horror has burning eyes
    }
  })

  it('husk parents form a valid forest (parents precede children)', () => {
    for (const v of HORROR_VISUALS) {
      let huskIdx = -1
      for (const part of v.parts) {
        if (part.part === 0) {
          huskIdx++
          if (part.parent >= 0) expect(part.parent, v.id).toBeLessThan(huskIdx)
        } else {
          expect(part.parent, v.id).toBeGreaterThanOrEqual(0)
          expect(part.parent, v.id).toBeLessThanOrEqual(huskIdx)
        }
      }
    }
  })

  it('every scale/len/wid is finite and positive', () => {
    for (const v of [...HORROR_VISUALS, ...WARDEN_VISUALS]) {
      expect(v.scale).toBeGreaterThan(0)
      for (const part of v.parts) {
        expect(part.len, v.id).toBeGreaterThan(0)
        expect(part.wid, v.id).toBeGreaterThan(0)
        expect(Number.isFinite(part.splay + part.pitch + part.yawO + part.t)).toBe(true)
      }
    }
  })
})

describe('WARDEN_VISUALS', () => {
  it('covers every realm at boss scale within the warden instance caps', () => {
    expect(WARDEN_VISUALS.length).toBe(REALMS.length)
    for (const v of WARDEN_VISUALS) {
      expect(v.scale).toBeGreaterThan(3)
      const [husk, limb, shred, eye] = partCounts(v)
      expect(husk, v.id).toBeLessThanOrEqual(WARDEN_HUSK_CAP)
      expect(limb, v.id).toBeLessThanOrEqual(WARDEN_LIMB_CAP)
      expect(shred, v.id).toBeLessThanOrEqual(WARDEN_SHRED_CAP)
      expect(eye, v.id).toBeLessThanOrEqual(WARDEN_EYE_CAP)
      expect(eye, v.id).toBeGreaterThanOrEqual(2)
    }
  })
})

// ---------------------------------------------------------------------------
// envelope curves
// ---------------------------------------------------------------------------

function numericDerivative(fn: (u: number) => number, u: number, h = 1e-4): number {
  return (fn(u + h) - fn(u - h)) / (2 * h)
}

describe('envelope curves', () => {
  it('windupCurve: 0 to 1 with zero-slope ends', () => {
    expect(windupCurve(0)).toBeCloseTo(0, 6)
    expect(windupCurve(1)).toBeCloseTo(1, 6)
    expect(Math.abs(numericDerivative(windupCurve, 0.001))).toBeLessThan(0.02)
    expect(Math.abs(numericDerivative(windupCurve, 0.999))).toBeLessThan(0.02)
    expect(windupCurve(-1)).toBe(0)
    expect(windupCurve(2)).toBe(1)
  })

  it('leapCurve: fast attack settling flat at 1', () => {
    expect(leapCurve(0)).toBe(0)
    expect(leapCurve(1)).toBe(1)
    expect(leapCurve(0.3)).toBeGreaterThan(0.3) // front-loaded
    expect(Math.abs(numericDerivative(leapCurve, 0.999))).toBeLessThan(0.02)
  })

  it('latchCurve: periodic, bounded, continuous across the wrap', () => {
    for (const u of [0, 0.25, 0.5, 0.99, 1.0, 1.37, 5.5]) {
      const v = latchCurve(u)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(latchCurve(0.9999)).toBeCloseTo(latchCurve(0.0001), 2)
    expect(
      Math.abs(numericDerivative(latchCurve, 0.9999) - numericDerivative(latchCurve, 1.0001)),
    ).toBeLessThan(0.05)
  })

  it('deathFling: kicks then settles to zero without a kink', () => {
    expect(deathFling(0)).toBe(0)
    expect(deathFling(0.35)).toBeGreaterThan(0.5)
    expect(deathFling(0.72)).toBeCloseTo(0, 3)
    expect(deathFling(1)).toBeCloseTo(0, 9)
    expect(Math.abs(numericDerivative(deathFling, 1 / 1.4))).toBeLessThan(0.02)
  })

  it('crumple: clamped smoothstep', () => {
    expect(crumple(0)).toBe(0)
    expect(crumple(1)).toBe(1)
    expect(crumple(0.5)).toBeCloseTo(0.5, 6)
  })

  it('twitchPulse: bounded, deterministic, and mostly dead still', () => {
    let nonZero = 0
    let samples = 0
    for (let s = 0; s < 8; s++) {
      const seed = s * 0.123
      for (let t = 0; t < 40; t += 0.05) {
        const v = twitchPulse(t, seed)
        expect(Number.isFinite(v)).toBe(true)
        expect(Math.abs(v)).toBeLessThanOrEqual(1)
        expect(twitchPulse(t, seed)).toBe(v) // pure in (t, seed)
        if (Math.abs(v) > 1e-4) nonZero++
        samples++
      }
    }
    const duty = nonZero / samples
    expect(duty).toBeGreaterThan(0.02) // it does fire...
    expect(duty).toBeLessThan(0.5) // ...but stillness dominates
  })

  it('twitchPulse: different seeds fire at different moments', () => {
    let diverged = 0
    for (let t = 0; t < 20; t += 0.1) {
      if (Math.abs(twitchPulse(t, 0.1) - twitchPulse(t, 0.7)) > 1e-4) diverged++
    }
    expect(diverged).toBeGreaterThan(5)
  })
})

// ---------------------------------------------------------------------------
// pose evaluator
// ---------------------------------------------------------------------------

function poseIn(over: Partial<HorrorPoseIn> = {}): HorrorPoseIn {
  return {
    state: POSE_STATE.CIRCLE,
    stateT: 0.5,
    stateU: 0,
    t: 12.34,
    speed: 5,
    barPulse: 0.4,
    seed: 0.37,
    ...over,
  }
}

describe('horrorPose', () => {
  it('all channels stay finite and bounded across a parameter sweep', () => {
    const out = freshHorrorPose()
    for (const v of [...HORROR_VISUALS, ...WARDEN_VISUALS]) {
      for (const state of Object.values(POSE_STATE)) {
        for (let s = 0; s < 12; s++) {
          horrorPose(out, poseIn({
            state,
            stateT: s * 0.37,
            stateU: Math.min(1, s / 8),
            t: 3 + s * 1.7,
            speed: s,
            seed: (s * 0.13) % 1,
          }), v)
          for (const [key, val] of Object.entries(out)) {
            expect(Number.isFinite(val), `${v.id} ${state} ${key}`).toBe(true)
            expect(Math.abs(val as number), `${v.id} ${state} ${key}`).toBeLessThan(6)
          }
        }
      }
    }
  })

  it('windup crouches, ignites eyes, and trembles toward launch', () => {
    const rest = freshHorrorPose()
    horrorPose(rest, poseIn({ state: POSE_STATE.CIRCLE }), HORROR_VISUALS[0])
    const wind = freshHorrorPose()
    horrorPose(wind, poseIn({ state: POSE_STATE.WINDUP, stateU: 1 }), HORROR_VISUALS[0])
    expect(wind.eyeHeat).toBeGreaterThan(rest.eyeHeat)
    expect(wind.tremble).toBeGreaterThan(rest.tremble)
    expect(wind.bobY).toBeLessThan(rest.bobY)
    expect(wind.shredFlare).toBeGreaterThan(rest.shredFlare)
  })

  it('leap stretches along the dive; dying flings and dims', () => {
    const leap = freshHorrorPose()
    horrorPose(leap, poseIn({ state: POSE_STATE.LEAP, stateU: 0.5 }), HORROR_VISUALS[2])
    expect(leap.stretch).toBeGreaterThan(0.3)
    expect(leap.pitch).toBeLessThan(0)
    const dying = freshHorrorPose()
    horrorPose(dying, poseIn({ state: POSE_STATE.DYING, stateU: 0.35 }), HORROR_VISUALS[2])
    expect(dying.fling).toBeGreaterThan(0.5)
    const dead = freshHorrorPose()
    horrorPose(dead, poseIn({ state: POSE_STATE.DYING, stateU: 1 }), HORROR_VISUALS[2])
    expect(dead.eyeHeat).toBe(0)
  })

  it('leap corkscrews mid-arc with seed-picked handedness', () => {
    const l = freshHorrorPose()
    horrorPose(l, poseIn({ state: POSE_STATE.LEAP, stateU: 0.5, seed: 0.9 }), HORROR_VISUALS[0])
    const r = freshHorrorPose()
    horrorPose(r, poseIn({ state: POSE_STATE.LEAP, stateU: 0.5, seed: 0.1 }), HORROR_VISUALS[0])
    expect(l.roll).toBeGreaterThan(0.3)
    expect(r.roll).toBeLessThan(-0.3)
    // roll unwinds by touchdown: the latch pose must inherit a level body
    const end = freshHorrorPose()
    horrorPose(end, poseIn({ state: POSE_STATE.LEAP, stateU: 1, seed: 0.9 }), HORROR_VISUALS[0])
    expect(Math.abs(end.roll)).toBeLessThan(1e-9)
  })

  it('dying keels sideways, not just a flat forward fold', () => {
    const d = freshHorrorPose()
    horrorPose(d, poseIn({ state: POSE_STATE.DYING, stateU: 0.9, seed: 0.8 }), HORROR_VISUALS[3])
    expect(Math.abs(d.roll)).toBeGreaterThan(0.3)
  })

  it('latch cling wraps limbs inward and gnaws', () => {
    const out = freshHorrorPose()
    latchClingPose(out, poseIn({ state: POSE_STATE.LATCHED, stateT: 0.3 }), HORROR_VISUALS[1])
    expect(out.limbSplayMul).toBeLessThan(0)
    expect(out.eyeHeat).toBeGreaterThan(0.7)
    expect(out.gaitLift).toBe(0)
  })

  it('zero allocation: the out struct is returned, not replaced', () => {
    const out = freshHorrorPose()
    const ret = horrorPose(out, poseIn(), HORROR_VISUALS[4])
    expect(ret).toBe(out)
  })
})

describe('wardenPose', () => {
  it('telegraph opens plates/shrouds/eyes; wounds slump the rig', () => {
    const calm = freshHorrorPose()
    wardenPose(calm, { ...poseIn(), telegraphT: 0, weakOpen: 0, hpFrac: 1 }, WARDEN_VISUALS[0])
    const tele = freshHorrorPose()
    wardenPose(tele, { ...poseIn(), telegraphT: 1, weakOpen: 0, hpFrac: 1 }, WARDEN_VISUALS[0])
    expect(tele.limbSplayMul).toBeGreaterThan(calm.limbSplayMul)
    expect(tele.shredFlare).toBeGreaterThan(calm.shredFlare)
    expect(tele.eyeHeat).toBeGreaterThan(calm.eyeHeat)
    const hurt = freshHorrorPose()
    wardenPose(hurt, { ...poseIn(), telegraphT: 0, weakOpen: 0, hpFrac: 0.2 }, WARDEN_VISUALS[0])
    expect(hurt.bobY).toBeLessThan(calm.bobY)
  })

  it('a warden past the last third seethes: rage tremble + hot eyes', () => {
    const calm = freshHorrorPose()
    wardenPose(calm, { ...poseIn(), telegraphT: 0, weakOpen: 0, hpFrac: 1 }, WARDEN_VISUALS[2])
    const enraged = freshHorrorPose()
    wardenPose(enraged, { ...poseIn(), telegraphT: 0, weakOpen: 0, hpFrac: 0.1 }, WARDEN_VISUALS[2])
    expect(enraged.tremble).toBeGreaterThan(calm.tremble)
    expect(enraged.tremble).toBeGreaterThanOrEqual(0.2)
    expect(enraged.eyeHeat).toBeGreaterThan(calm.eyeHeat)
  })
})
