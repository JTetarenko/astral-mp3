import { describe, expect, it } from 'vitest'
import { hudProjection, makeScreenPoint, projectToScreen } from './hudProjection'

/** Column-major identity-ish orthographic helper for known-answer tests. */
function identity(): Float32Array {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

describe('projectToScreen', () => {
  it('maps NDC space to CSS pixels with the y flip', () => {
    const out = makeScreenPoint()
    // identity matrix: world == clip, w = 1
    projectToScreen(identity(), 0, 0, 0, 200, 100, out)
    expect(out.visible).toBe(true)
    expect(out.x).toBeCloseTo(100, 6)
    expect(out.y).toBeCloseTo(50, 6)
    projectToScreen(identity(), 1, 1, 0, 200, 100, out)
    expect(out.x).toBeCloseTo(200, 6) // right edge
    expect(out.y).toBeCloseTo(0, 6) // TOP (y flipped)
  })

  it('flags points behind the camera invisible', () => {
    const m = identity()
    m[11] = -1 // w = -z: negative z in front, positive behind
    m[15] = 0
    const out = makeScreenPoint()
    projectToScreen(m, 0, 0, -5, 100, 100, out)
    expect(out.visible).toBe(true)
    expect(out.depth).toBeCloseTo(5, 6)
    projectToScreen(m, 0, 0, 5, 100, 100, out)
    expect(out.visible).toBe(false)
  })

  it('tolerates slight NDC overshoot but culls far off-frame points', () => {
    const out = makeScreenPoint()
    projectToScreen(identity(), 1.05, 0, 0, 100, 100, out)
    expect(out.visible).toBe(true) // inside the 1.08 pad
    projectToScreen(identity(), 1.5, 0, 0, 100, 100, out)
    expect(out.visible).toBe(false)
  })

  it('the shared struct starts inert', () => {
    expect(hudProjection.gen).toBe(0)
    expect(hudProjection.m.length).toBe(16)
  })
})
