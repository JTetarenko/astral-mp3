import { describe, expect, it } from 'vitest'
import { createGovernor, GOV, updateGovernor } from './perfGovernor'

function feed(g: ReturnType<typeof createGovernor>, ms: number, frames: number, startSec: number, fps = 60) {
  const events: number[] = []
  for (let i = 0; i < frames; i++) {
    const lvl = updateGovernor(g, ms, startSec + i / fps)
    if (lvl !== null) events.push(lvl)
  }
  return events
}

describe('perfGovernor', () => {
  it('steps down after a sustained over-budget window, once per cooldown', () => {
    const g = createGovernor()
    const events = feed(g, 22, 600, 0) // 10s of 22ms frames
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0]).toBe(1)
    expect(events[1]).toBe(2)
    expect(g.level).toBeLessThanOrEqual(GOV.maxLevel)
  })

  it('never exceeds max level', () => {
    const g = createGovernor()
    feed(g, 30, 6000, 0)
    expect(g.level).toBe(GOV.maxLevel)
  })

  it('steps back up only after sustained headroom', () => {
    const g = createGovernor()
    feed(g, 22, 400, 0) // drive it down at least one level
    const droppedTo = g.level
    expect(droppedTo).toBeGreaterThanOrEqual(1)
    feed(g, 16, 200, 50) // neutral frames flush the bad window without up-credit
    const events = feed(g, 8, 1400, 100) // 23s of clear headroom
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(g.level).toBeLessThan(droppedTo)
    // no headroom -> no up-step before the streak threshold
    const g2 = createGovernor()
    feed(g2, 22, 400, 0)
    const lvl = g2.level
    feed(g2, 16, 300, 50)
    expect(g2.level).toBe(lvl)
  })

  it('does not oscillate on borderline frames', () => {
    const g = createGovernor()
    // 16ms frames: under badMs but over goodMs -> no steps either way
    const events = feed(g, 16, 2000, 0)
    expect(events).toEqual([])
    expect(g.level).toBe(0)
  })

  it('respects the cooldown between steps', () => {
    const g = createGovernor()
    const events: Array<[number, number]> = []
    for (let i = 0; i < 1200; i++) {
      const now = i / 60
      const lvl = updateGovernor(g, 25, now)
      if (lvl !== null) events.push([lvl, now])
    }
    for (let i = 1; i < events.length; i++) {
      expect(events[i][1] - events[i - 1][1]).toBeGreaterThanOrEqual(GOV.cooldownSec - 1 / 60)
    }
  })
})
