import { describe, expect, it } from 'vitest'
import { coneHalfFor, reticleKindFor } from './reticleState'

describe('reticleKindFor', () => {
  it('decodes every sentinel band', () => {
    expect(reticleKindFor(-1, false)).toBe('none')
    expect(reticleKindFor(0, false)).toBe('point')
    expect(reticleKindFor(15, false)).toBe('point')
    expect(reticleKindFor(100, false)).toBe('gate')
    expect(reticleKindFor(200, false)).toBe('enemy')
    expect(reticleKindFor(223, false)).toBe('enemy')
    expect(reticleKindFor(300, false)).toBe('warden')
  })

  it('surfaces the sealed gate only when nothing else is locked', () => {
    expect(reticleKindFor(-1, true)).toBe('sealed')
    expect(reticleKindFor(3, true)).toBe('point') // a real lock outranks the denial
  })
})

describe('coneHalfFor', () => {
  it('mirrors the aim configs', () => {
    expect(coneHalfFor('point')).toBeCloseTo(0.122, 6)
    expect(coneHalfFor('enemy')).toBeCloseTo(0.16, 6)
    expect(coneHalfFor('warden')).toBeCloseTo(0.2, 6)
    expect(coneHalfFor('gate')).toBeCloseTo(0.18, 6)
    expect(coneHalfFor('sealed')).toBeCloseTo(0.18, 6)
    expect(coneHalfFor('none')).toBeCloseTo(0.122, 6)
  })
})
