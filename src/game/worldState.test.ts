import { beforeEach, describe, expect, it } from 'vitest'
import { CHUNK, chunkKey } from './chunks'
import { LAYOUT } from './layout'
import {
  collectPoint,
  countActivePoints,
  openGate,
  performRealmSwap,
  resetWorld,
  spawnPointsIfNeeded,
  streamWorld,
  updateGate,
  updateRealmBlend,
  WORLD,
  worldState,
} from './worldState'
import { variantTop } from './islandVariants'

function usedCount(): number {
  return worldState.slots.filter(s => s.used).length
}

function freeCount(): number {
  return worldState.freeByVariant.reduce((n, f) => n + f.length, 0)
}

/** Map of island id -> "x,y,z" for all live slots. */
function liveIslandMap(): Map<number, string> {
  const m = new Map<number, string>()
  for (const s of worldState.slots) {
    if (s.used) m.set(s.id, `${s.x.toFixed(4)},${s.y.toFixed(4)},${s.z.toFixed(4)}`)
  }
  return m
}

/** Walk in steps so every intermediate cell crossing streams. */
function walkTo(x: number, z: number, from = { x: 0, z: 0 }, step = 24): { x: number; z: number } {
  let cx = from.x
  let cz = from.z
  const dx = x - cx
  const dz = z - cz
  const dist = Math.hypot(dx, dz)
  const n = Math.max(1, Math.ceil(dist / step))
  for (let i = 1; i <= n; i++) {
    streamWorld(cx + (dx * i) / n, cz + (dz * i) / n, i)
  }
  return { x, z }
}

beforeEach(() => {
  resetWorld(1234, 0)
})

describe('slot pools', () => {
  it('conserves slots: used + free == TOTAL, no index duplicated', () => {
    const seen = new Set<number>()
    for (const f of worldState.freeByVariant) {
      for (const idx of f) {
        expect(seen.has(idx)).toBe(false)
        seen.add(idx)
      }
    }
    for (let i = 0; i < worldState.slots.length; i++) {
      if (worldState.slots[i].used) {
        expect(seen.has(i)).toBe(false)
        seen.add(i)
      }
    }
    expect(seen.size).toBe(WORLD.TOTAL_SLOTS)
    expect(usedCount() + freeCount()).toBe(WORLD.TOTAL_SLOTS)
  })

  it('keeps conservation through a long wander', () => {
    let at = { x: 0, z: 0 }
    at = walkTo(300, 0, at)
    at = walkTo(300, 400, at)
    at = walkTo(-200, 100, at)
    expect(usedCount() + freeCount()).toBe(WORLD.TOTAL_SLOTS)
    expect(usedCount()).toBeGreaterThan(40)
  })
})

describe('streaming window', () => {
  it('covers every cell within genRadius and none beyond freeRadius', () => {
    streamWorld(0, 0, 0)
    const ring = Math.ceil(CHUNK.genRadius / CHUNK.size)
    for (let cx = -ring; cx <= ring; cx++) {
      for (let cz = -ring; cz <= ring; cz++) {
        const cxw = (cx + 0.5) * CHUNK.size
        const czw = (cz + 0.5) * CHUNK.size
        const d = Math.hypot(cxw, czw)
        if (d <= CHUNK.genRadius) {
          expect(worldState.chunks.has(chunkKey(cx, cz))).toBe(true)
        }
      }
    }
    for (const rec of worldState.chunks.values()) {
      const d = Math.hypot((rec.cx + 0.5) * CHUNK.size, (rec.cz + 0.5) * CHUNK.size)
      expect(d).toBeLessThanOrEqual(CHUNK.freeRadius + 1e-9)
    }
  })

  it('frees chunks left behind and re-streams them identically (recycling determinism)', () => {
    // Reference disc center: resetWorld streams at the spawn (0, 40).
    streamWorld(0, 0, 0)
    const before = liveIslandMap()
    expect(before.size).toBeGreaterThan(0)

    let at = { x: 0, z: 0 }
    at = walkTo(600, 0, at) // far enough that origin chunks are freed
    const awayIds = liveIslandMap()
    for (const id of before.keys()) {
      expect(awayIds.has(id)).toBe(false)
    }

    walkTo(0, 0, at)
    const after = liveIslandMap()
    // Compare the region guaranteed covered by both passes (stream centers can
    // differ by up to half a cell, and both discs are centered near origin).
    let compared = 0
    for (const [id, pos] of before) {
      const [x, , z] = pos.split(',').map(Number)
      if (Math.hypot(x, z) <= CHUNK.genRadius - CHUNK.size) {
        expect(after.get(id)).toBe(pos)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(10)
  })

  it('bumps slot serial on every reassign and free', () => {
    streamWorld(0, 0, 0)
    const firstUsed = worldState.slots.findIndex(s => s.used)
    const serial0 = worldState.slots[firstUsed].serial
    let at = walkTo(600, 0)
    expect(worldState.slots[firstUsed].serial).toBeGreaterThan(serial0)
    const serialFreed = worldState.slots[firstUsed].serial
    walkTo(0, 0, at)
    if (worldState.slots[firstUsed].used) {
      expect(worldState.slots[firstUsed].serial).toBeGreaterThan(serialFreed)
    }
  })

  it('survives pool exhaustion without throwing (density spike)', () => {
    worldState.modsGen.islandDensity = 10
    worldState.lastStreamX = Number.NaN
    expect(() => streamWorld(0, 0, 0)).not.toThrow()
    expect(usedCount()).toBe(WORLD.TOTAL_SLOTS)
    expect(freeCount()).toBe(0)
    // and recovers when walking with normal density
    worldState.modsGen.islandDensity = 1
    expect(() => walkTo(500, 0)).not.toThrow()
    expect(usedCount() + freeCount()).toBe(WORLD.TOTAL_SLOTS)
  })
})

describe('point spawner', () => {
  function pump(px: number, py: number, pz: number, fx: number, fz: number, t: number, n = 30) {
    for (let i = 0; i < n; i++) spawnPointsIfNeeded(px, py, pz, fx, fz, t + i * 0.016)
  }

  it('maintains POINT_TARGET active points with valid distances', () => {
    pump(0, 4, 40, 0, -1, 1)
    expect(countActivePoints()).toBe(WORLD.POINT_TARGET)
    const p = worldState.points
    for (let i = 0; i < WORLD.POINT_POOL; i++) {
      if (!p.active[i]) continue
      const d = Math.hypot(p.x[i] - 0, p.y[i] - 4, p.z[i] - 40)
      expect(d).toBeGreaterThanOrEqual(WORLD.POINT_NEAR - 1e-6)
      expect(d).toBeLessThanOrEqual(WORLD.POINT_FAR + 1e-6)
      for (let j = i + 1; j < WORLD.POINT_POOL; j++) {
        if (!p.active[j]) continue
        const pair = Math.hypot(p.x[i] - p.x[j], p.y[i] - p.y[j], p.z[i] - p.z[j])
        expect(pair).toBeGreaterThanOrEqual(LAYOUT.pointMinPairDist - 1e-6)
      }
    }
  })

  it('spawns points above the sculpted variant top, never inside a monolith', () => {
    pump(0, 4, 40, 0, -1, 1)
    const p = worldState.points
    let checked = 0
    for (let i = 0; i < WORLD.POINT_POOL; i++) {
      if (!p.active[i]) continue
      const isl = worldState.slots[p.islandSlot[i]]
      expect(p.y[i]).toBeGreaterThanOrEqual(isl.y + isl.scale * variantTop(isl.variant) + 1.4)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('replenishes after collection and biases spawns ahead', () => {
    let t = 1
    pump(0, 4, 40, 0, -1, t)
    const dots: number[] = []
    for (let round = 0; round < 40; round++) {
      const p = worldState.points
      for (let i = 0; i < WORLD.POINT_POOL; i++) {
        if (p.active[i]) collectPoint(i, t)
      }
      t += 1 // let flashes expire
      pump(0, 4, 40, 0, -1, t)
      for (let i = 0; i < WORLD.POINT_POOL; i++) {
        if (!p.active[i]) continue
        const dx = p.x[i] - 0
        const dz = p.z[i] - 40
        const l = Math.hypot(dx, dz)
        if (l > 1e-4) dots.push((dz / l) * -1)
      }
    }
    expect(dots.length).toBeGreaterThan(50)
    const mean = dots.reduce((a, b) => a + b, 0) / dots.length
    expect(mean).toBeGreaterThan(0.15)
    for (const d of dots) expect(d).toBeGreaterThanOrEqual(WORLD.POINT_BEHIND_DOT - 1e-6)
  })

  it('holds a collected slot until the flash plays out', () => {
    pump(0, 4, 40, 0, -1, 1)
    const p = worldState.points
    const idx = p.active.findIndex(a => a === 1)
    collectPoint(idx, 10)
    const serialAtCollect = p.serial[idx]
    // immediately after: slot must not be re-used
    spawnPointsIfNeeded(0, 4, 40, 0, -1, 10.1)
    expect(p.serial[idx]).toBe(serialAtCollect)
    // after the hold, it becomes reusable
    for (let i = 0; i < 30; i++) spawnPointsIfNeeded(0, 4, 40, 0, -1, 11 + i * 0.016)
    expect(countActivePoints()).toBe(WORLD.POINT_TARGET)
  })

  it('drops points whose island streamed out', () => {
    pump(0, 4, 40, 0, -1, 1)
    const p = worldState.points
    const idx = p.active.findIndex(a => a === 1)
    const islIdx = p.islandSlot[idx]
    // Manually free the backing island (simulates stream-out).
    worldState.slots[islIdx].used = false
    worldState.slots[islIdx].serial++
    spawnPointsIfNeeded(1000, 4, 1000, 0, -1, 2) // housekeeping runs even far away
    expect(p.active[idx]).toBe(0)
  })

  it('replays identically on a fixed trajectory (same seed)', () => {
    const record = (): string[] => {
      resetWorld(777, 0)
      const out: string[] = []
      let t = 0
      const p = worldState.points
      // Serials persist across resets by design — baseline from current state.
      const lastSerials = Uint32Array.from(p.serial)
      for (let step = 0; step < 200; step++) {
        const x = step * 1.5
        const z = 40 - step * 2
        t += 0.05
        streamWorld(x, z, t)
        spawnPointsIfNeeded(x, 4, z, 1.5, -2, t)
        for (let i = 0; i < WORLD.POINT_POOL; i++) {
          if (p.serial[i] !== lastSerials[i]) {
            lastSerials[i] = p.serial[i]
            out.push(`${i}:${p.x[i].toFixed(3)},${p.y[i].toFixed(3)},${p.z[i].toFixed(3)}`)
          }
        }
      }
      return out
    }
    const a = record()
    const b = record()
    expect(a.length).toBeGreaterThan(10)
    expect(a).toEqual(b)
  })
})

describe('gate', () => {
  it('opens ahead of the player and materializes over time', () => {
    openGate(0, 4, 40, 0, -1, 5)
    const g = worldState.gate
    expect(g.active).toBe(true)
    expect(g.z).toBeLessThan(40 - WORLD.GATE_DIST + 31) // forward, allowing nudges
    expect(g.openT).toBe(0)
    updateGate(0.6, 0, 4, 40, 0, -1, 5.6)
    expect(g.openT).toBeCloseTo(0.5, 5)
    updateGate(2, 0, 4, 40, 0, -1, 7.6)
    expect(g.openT).toBe(1)
  })

  it('re-places itself ahead when the player strays too far', () => {
    openGate(0, 4, 40, 0, -1, 5)
    updateGate(0.5, 0, 4, 40, 0, -1, 5.5)
    const before = { x: worldState.gate.x, z: worldState.gate.z, openT: worldState.gate.openT }
    // Player teleports 500u away, facing +x.
    updateGate(0.016, 500, 4, 500, 1, 0, 6)
    const g = worldState.gate
    expect(g.x).not.toBe(before.x)
    expect(Math.hypot(g.x - 500, g.z - 500)).toBeLessThanOrEqual(WORLD.GATE_DIST + 30 + 1e-6)
    // Materialization progress kept (within the one dt tick that just ran).
    expect(g.openT).toBeGreaterThanOrEqual(before.openT)
    expect(g.openT).toBeLessThan(before.openT + 0.05)
  })
})

describe('realm swap', () => {
  it('increments depth/epoch, clears points and gate, restreams at spawn', () => {
    spawnPointsIfNeeded(0, 4, 40, 0, -1, 1)
    openGate(0, 4, 40, 0, -1, 1)
    const epoch0 = worldState.epoch
    performRealmSwap(10)
    expect(worldState.depth).toBe(1)
    expect(worldState.epoch).toBe(epoch0 + 1)
    expect(countActivePoints()).toBe(0)
    expect(worldState.gate.active).toBe(false)
    expect(usedCount()).toBeGreaterThan(40) // jungle density 1.25
    // shift cost escalates via realms.ts; here just verify mods target moved
    expect(worldState.modsTarget.islandDensity).toBeCloseTo(1.25, 6)
    // gen mods snap immediately (never blended)
    expect(worldState.modsGen.islandDensity).toBeCloseTo(1.25, 6)
  })

  it('produces the same world at depth N regardless of pre-swap wandering', () => {
    performRealmSwap(10)
    const clean = liveIslandMap()

    resetWorld(1234, 0)
    let at = { x: 0, z: 0 }
    at = walkTo(400, -300, at)
    walkTo(-100, 250, at)
    performRealmSwap(99)
    const wandered = liveIslandMap()

    expect(wandered.size).toBe(clean.size)
    for (const [id, pos] of clean) {
      expect(wandered.get(id)).toBe(pos)
    }
  })

  it('blends visual mods toward the new realm while gen mods snap', () => {
    performRealmSwap(10)
    expect(worldState.modsCur.islandDensity).not.toBeCloseTo(1.25, 2) // still blending from 1
    for (let i = 0; i < 120; i++) updateRealmBlend(0.016)
    expect(worldState.modsCur.islandDensity).toBeCloseTo(1.25, 3)
    expect(worldState.modsCur.sinkRate).toBeCloseTo(-2.5, 3)
    expect(worldState.modsCur.fallDir).toBe(1)
  })

  it('?depth-style start: resetWorld at depth 4 uses collapse mods immediately', () => {
    resetWorld(555, 4)
    expect(worldState.depth).toBe(4)
    expect(worldState.modsCur.tripBias).toBeCloseTo(0.25, 6)
    expect(worldState.modsGen.islandDensity).toBeCloseTo(0.85, 6)
  })
})
