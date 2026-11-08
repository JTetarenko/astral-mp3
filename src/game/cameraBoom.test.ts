import { describe, expect, it } from 'vitest'
import { BOOM, boomClearT, islandOccluderRadius, type Occluder } from './cameraBoom'

function isl(x: number, y: number, z: number, scale: number, used?: boolean): Occluder {
  return { x, y, z, scale, used }
}

describe('boomClearT', () => {
  it('returns 1 with no islands and for degenerate segments', () => {
    expect(boomClearT(0, 0, 0, 0, 0, -5.5, [])).toBe(1)
    expect(boomClearT(1, 2, 3, 1, 2, 3, [isl(1, 2, 3, 4)])).toBe(1)
  })

  it('clips at the analytic entry point for a blocking sphere', () => {
    // Segment from origin toward -z, length 10; sphere at z=-5, scale s.t. radius 2.
    const scale = (2 - BOOM.occluderPad) / BOOM.occluderRadK
    const t = boomClearT(0, 0, 0, 0, 0, -10, [isl(0, 0, -5, scale)])
    // entry at z = -3 -> t = 0.3
    expect(t).toBeCloseTo(0.3, 5)
  })

  it('skips spheres containing the segment start (hovering above an island)', () => {
    // Player 2.2u above an island top: island center within its inflated radius.
    const island = isl(0, -3, 0, 4) // radius = 4*1.2+0.4 = 5.2; player at dist 3 -> inside
    expect(boomClearT(0, 0, 0, 0, 2, -5, [island])).toBe(1)
  })

  it('ignores spheres behind the start', () => {
    expect(boomClearT(0, 0, 0, 0, 0, -10, [isl(0, 0, 8, 3)])).toBe(1)
  })

  it('ignores spheres beyond the far-side entry (tHit > 1 region)', () => {
    // Sphere centered past B, entry beyond the segment end.
    const t = boomClearT(0, 0, 0, 0, 0, -10, [isl(0, 0, -14, 2)])
    expect(t).toBe(1)
  })

  it('misses tangent/grazing spheres offset beyond their radius', () => {
    const scale = 1 // radius 1.6
    expect(boomClearT(0, 0, 0, 0, 0, -10, [isl(0, 2.2, -5, scale)])).toBe(1)
  })

  it('skips slots marked unused', () => {
    const blocker = isl(0, 0, -5, 3, false)
    expect(boomClearT(0, 0, 0, 0, 0, -10, [blocker])).toBe(1)
  })

  it('takes the nearest of several blockers', () => {
    const a = isl(0, 0, -7, (2 - BOOM.occluderPad) / BOOM.occluderRadK)
    const b = isl(0, 0, -4, (1.5 - BOOM.occluderPad) / BOOM.occluderRadK)
    const t = boomClearT(0, 0, 0, 0, 0, -10, [a, b])
    expect(t).toBeCloseTo((4 - 1.5) / 10, 5)
  })
})

describe('islandOccluderRadius', () => {
  it('scales linearly with island scale', () => {
    expect(islandOccluderRadius(0)).toBeCloseTo(BOOM.occluderPad)
    expect(islandOccluderRadius(5)).toBeCloseTo(5 * BOOM.occluderRadK + BOOM.occluderPad)
  })
})
