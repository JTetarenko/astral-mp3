import { describe, expect, it } from 'vitest'
import { edgeClamp, screenAngleFor, stereoPanFor, type EdgeOut } from './direction'

describe('stereoPanFor', () => {
  it('quadrants at yaw 0 (forward = -Z)', () => {
    expect(stereoPanFor(0, -10, 0)).toBeCloseTo(0, 6) // ahead
    expect(stereoPanFor(10, 0, 0)).toBeCloseTo(0.8, 6) // right
    expect(stereoPanFor(-10, 0, 0)).toBeCloseTo(-0.8, 6) // left
    expect(stereoPanFor(0, 10, 0)).toBeCloseTo(0, 6) // behind = centered
  })

  it('is yaw-invariant (rotating listener and source together)', () => {
    for (const yaw of [0.3, 1.2, -2.4, Math.PI]) {
      const s = Math.sin(yaw)
      const c = Math.cos(yaw)
      // "10 units to the listener's right" in world space
      const dx = 10 * c
      const dz = 10 * -s
      expect(stereoPanFor(dx, dz, yaw)).toBeCloseTo(0.8, 5)
    }
  })

  it('degenerate zero offset is centered', () => {
    expect(stereoPanFor(0, 0, 1.7)).toBe(0)
  })
})

describe('screenAngleFor', () => {
  it('bearings at yaw 0', () => {
    expect(screenAngleFor(0, -10, 0)).toBeCloseTo(0, 6)
    expect(screenAngleFor(10, 0, 0)).toBeCloseTo(Math.PI / 2, 6)
    expect(screenAngleFor(-10, 0, 0)).toBeCloseTo(-Math.PI / 2, 6)
    expect(Math.abs(screenAngleFor(0, 10, 0))).toBeCloseTo(Math.PI, 6)
  })

  it('is yaw-invariant', () => {
    for (const yaw of [0.7, -1.9, 2.8]) {
      const s = Math.sin(yaw)
      const c = Math.cos(yaw)
      // dead ahead in world space for this yaw
      expect(screenAngleFor(-10 * s, -10 * c, yaw)).toBeCloseTo(0, 5)
      // hard right
      expect(screenAngleFor(10 * c, -10 * s, yaw)).toBeCloseTo(Math.PI / 2, 5)
    }
  })
})

describe('edgeClamp', () => {
  it('passes through on-screen positions', () => {
    const out: EdgeOut = { x: 0, y: 0, edge: true }
    edgeClamp(0.4, -0.6, 0.1, out)
    expect(out).toEqual({ x: 0.4, y: -0.6, edge: false })
  })

  it('clamps off-screen positions to the padded rect and flags it', () => {
    const out: EdgeOut = { x: 0, y: 0, edge: false }
    edgeClamp(2.4, 0.2, 0.1, out)
    expect(out.x).toBeCloseTo(0.9, 6)
    expect(out.y).toBeCloseTo(0.2, 6)
    expect(out.edge).toBe(true)
    edgeClamp(-3, -8, 0.15, out)
    expect(out.x).toBeCloseTo(-0.85, 6)
    expect(out.y).toBeCloseTo(-0.85, 6)
    expect(out.edge).toBe(true)
  })
})
