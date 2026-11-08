/**
 * Runtime world singleton for the endless descent: island slot pools fed by
 * chunk streaming, the infinite resonance-point pool, the realm gate, depth /
 * realm-mod blending, and the realm swap. Mutated from frame loops, read by
 * scene components (which detect slot reassignment via per-slot serials).
 * Pure of three.js — fully node-testable.
 *
 * Determinism contract: chunk generation always uses modsGen (the exact mods
 * for the current depth), never the blended modsCur (visual-only), so a chunk
 * re-streamed mid-blend is identical to one streamed later.
 */
import { CHUNK, chunkKey, generateChunkIslands } from './chunks'
import { variantTop } from './islandVariants'
import { getRealmForDepth, NEUTRAL_MODS, type RealmMods } from './realms'
import { LAYOUT } from './layout'
import { hashInts, mulberry32, range } from './seededRandom'

export const WORLD = {
  VARIANTS: 4,
  SLOTS_PER_VARIANT: 48,
  TOTAL_SLOTS: 192,
  SHARD_POOL: 288,
  SHARDS_MAX_PER_ISLAND: 6,
  POINT_POOL: 16,
  /** Uncollected points maintained near the player. */
  POINT_TARGET: 6,
  POINT_NEAR: 24,
  // clamped inside AIM.maxDist (70) so nothing glowing is ever unsnappable
  POINT_FAR: 68,
  POINT_DESPAWN: 140,
  /** Distance band the ahead-bias scoring peaks at. */
  POINT_AHEAD_PEAK: 55,
  /** Reject candidates more than this far behind the travel direction. */
  POINT_BEHIND_DOT: -0.35,
  GATE_DIST: 55,
  GATE_RESPAWN_DIST: 160,
  /** Seconds a collected point keeps its slot for the flash to play out. */
  POINT_FLASH_HOLD: 0.6,
}

export interface IslandSlot {
  used: boolean
  /** Bumped on every assign AND free — consumers store (idx, serial) and validate. */
  serial: number
  /** Deterministic ChunkIsland id; seeds derived dressing (shards, debris). */
  id: number
  x: number
  y: number
  z: number
  scale: number
  rotY: number
  bobPhase: number
  bobSpeed: number
  bobAmp: number
  bassGain: number
  variant: number
  /** Clock time of assignment, drives the grow-in ease. */
  bornAt: number
}

export interface WorldPoints {
  active: Uint8Array
  x: Float32Array
  y: Float32Array
  z: Float32Array
  islandSlot: Int32Array
  islandSerial: Int32Array
  /** Bumped on every spawn — ResonancePoints re-picks glyphs on diff. */
  serial: Uint32Array
  /** Clock time of collection (0 = never); slot reusable after the flash. */
  flashAt: Float32Array
}

export interface GateState {
  active: boolean
  x: number
  y: number
  z: number
  openedAt: number
  /** 0..1 materialize ease. */
  openT: number
}

interface ChunkRecord {
  cx: number
  cz: number
  slots: number[]
}

export interface WorldStateData {
  trackSeed: number
  depth: number
  /** Bumped on every realm swap / reset; components clear transient state on diff. */
  epoch: number
  /** Bumped on any slot alloc/free; consumers rebuild derived lists on diff. */
  slotVersion: number
  /** Blended mods for visuals (slewed toward modsTarget). */
  modsCur: RealmMods
  modsTarget: RealmMods
  /** Exact mods for world generation — NEVER blended. */
  modsGen: RealmMods
  chunks: Map<number, ChunkRecord>
  slots: IslandSlot[]
  freeByVariant: number[][]
  points: WorldPoints
  gate: GateState
  rngPoints: () => number
  /** World position of the last stream pass (NaN forces a re-stream). */
  lastStreamX: number
  lastStreamZ: number
}

function makeSlot(variant: number): IslandSlot {
  return {
    used: false,
    serial: 0,
    id: 0,
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    rotY: 0,
    bobPhase: 0,
    bobSpeed: 0.2,
    bobAmp: 0,
    bassGain: 1,
    variant,
    bornAt: 0,
  }
}

function freshState(): WorldStateData {
  const slots: IslandSlot[] = []
  const freeByVariant: number[][] = []
  for (let v = 0; v < WORLD.VARIANTS; v++) {
    const free: number[] = []
    for (let i = 0; i < WORLD.SLOTS_PER_VARIANT; i++) {
      const idx = v * WORLD.SLOTS_PER_VARIANT + i
      slots.push(makeSlot(v))
      free.push(idx)
    }
    freeByVariant.push(free)
  }
  const n = WORLD.POINT_POOL
  return {
    trackSeed: 1,
    depth: 0,
    epoch: 0,
    slotVersion: 0,
    modsCur: { ...NEUTRAL_MODS },
    modsTarget: { ...NEUTRAL_MODS },
    modsGen: { ...NEUTRAL_MODS },
    chunks: new Map(),
    slots,
    freeByVariant,
    points: {
      active: new Uint8Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
      z: new Float32Array(n),
      islandSlot: new Int32Array(n).fill(-1),
      islandSerial: new Int32Array(n),
      serial: new Uint32Array(n),
      flashAt: new Float32Array(n),
    },
    gate: { active: false, x: 0, y: 0, z: 0, openedAt: 0, openT: 0 },
    rngPoints: mulberry32(1),
    lastStreamX: Number.NaN,
    lastStreamZ: Number.NaN,
  }
}

// Dev HMR guard (sfx.ts pattern): a hot update must not orphan the pools the
// live scene components hold references into.
export const worldState: WorldStateData = import.meta.env.DEV
  ? (((globalThis as Record<string, unknown>).__astralWorld ??= freshState()) as WorldStateData)
  : freshState()

function freeSlot(idx: number): void {
  const slot = worldState.slots[idx]
  if (!slot.used) return
  slot.used = false
  slot.serial++
  worldState.freeByVariant[Math.floor(idx / WORLD.SLOTS_PER_VARIANT)].push(idx)
  worldState.slotVersion++
}

function allocSlot(preferredVariant: number): number {
  const free = worldState.freeByVariant
  let pool = free[preferredVariant]
  if (pool.length === 0) {
    // Preferred variant exhausted — borrow from the fullest other pool.
    let best = -1
    let bestLen = 0
    for (let v = 0; v < WORLD.VARIANTS; v++) {
      if (free[v].length > bestLen) {
        bestLen = free[v].length
        best = v
      }
    }
    if (best < 0) return -1
    pool = free[best]
  }
  return pool.pop() ?? -1
}

function freeChunk(rec: ChunkRecord): void {
  for (const idx of rec.slots) freeSlot(idx)
  rec.slots.length = 0
}

function clearAllSlots(): void {
  for (const rec of worldState.chunks.values()) freeChunk(rec)
  worldState.chunks.clear()
  // Defensive: also free anything not tracked by a chunk (shouldn't happen).
  for (let i = 0; i < worldState.slots.length; i++) {
    if (worldState.slots[i].used) freeSlot(i)
  }
}

/**
 * Rebuild free-lists in canonical order after a full clear, so allocation
 * order (and everything sampled from it) is independent of pre-swap history —
 * same (trackSeed, depth) always assigns islands to the same slots.
 */
function resetFreeLists(): void {
  for (let v = 0; v < WORLD.VARIANTS; v++) {
    const free = worldState.freeByVariant[v]
    free.length = 0
    for (let i = WORLD.SLOTS_PER_VARIANT - 1; i >= 0; i--) {
      free.push(v * WORLD.SLOTS_PER_VARIANT + i)
    }
  }
}

function clearPoints(): void {
  const p = worldState.points
  p.active.fill(0)
  p.flashAt.fill(0)
  p.islandSlot.fill(-1)
}

function reseedPointRng(): void {
  worldState.rngPoints = mulberry32(hashInts(worldState.trackSeed, worldState.depth, 0x9d07, 0))
}

/** Reset for a new run. Immediate (no blend) realm mods for startDepth. */
export function resetWorld(trackSeed: number, startDepth = 0): void {
  const ws = worldState
  ws.trackSeed = trackSeed >>> 0
  ws.depth = Math.max(0, Math.floor(startDepth))
  ws.epoch++
  clearAllSlots()
  resetFreeLists()
  clearPoints()
  ws.gate.active = false
  ws.gate.openT = 0
  const at = getRealmForDepth(ws.depth)
  ws.modsGen = { ...at.mods }
  ws.modsCur = { ...at.mods }
  ws.modsTarget = { ...at.mods }
  reseedPointRng()
  ws.lastStreamX = Number.NaN
  ws.lastStreamZ = Number.NaN
  streamWorld(LAYOUT.spawn.x, LAYOUT.spawn.z, 0)
}

/** Depth+1 world regen; called at the shift transition's whiteout peak. */
export function performRealmSwap(clockT: number): void {
  const ws = worldState
  ws.depth++
  ws.epoch++
  clearAllSlots()
  resetFreeLists()
  clearPoints()
  ws.gate.active = false
  ws.gate.openT = 0
  const at = getRealmForDepth(ws.depth)
  ws.modsGen = { ...at.mods }
  ws.modsTarget = { ...at.mods } // modsCur slews there over ~0.4s under the flash
  ws.modsCur.fallDir = at.mods.fallDir // discrete field snaps
  reseedPointRng()
  ws.lastStreamX = Number.NaN
  ws.lastStreamZ = Number.NaN
  streamWorld(LAYOUT.spawn.x, LAYOUT.spawn.z, clockT)
}

const MOD_KEYS = Object.keys(NEUTRAL_MODS) as (keyof RealmMods)[]

/** Slew blended visual mods toward the target (~96% in 0.4s). */
export function updateRealmBlend(dt: number): void {
  const cur = worldState.modsCur as unknown as Record<string, number>
  const tgt = worldState.modsTarget as unknown as Record<string, number>
  const k = 1 - Math.exp(-dt / 0.12)
  for (const key of MOD_KEYS) {
    if (key === 'fallDir') {
      cur.fallDir = tgt.fallDir
      continue
    }
    const c = cur[key]
    const t = tgt[key]
    const d = t - c
    cur[key] = Math.abs(d) < 1e-4 ? t : c + d * k
  }
}

const scratchCells: { cx: number; cz: number; dSq: number }[] = []

/**
 * Stream chunks around the player. No-op until the player has moved half a
 * cell from the last pass (or a swap/reset forced it), so the coverage disc is
 * never more than 24u stale — well inside the freeRadius-genRadius hysteresis.
 * Frees beyond freeRadius, allocates within genRadius nearest-first so pool
 * exhaustion drops the farthest, fog-shrouded chunks. Never throws.
 */
export function streamWorld(px: number, pz: number, clockT: number): void {
  const ws = worldState
  const moveX = px - ws.lastStreamX
  const moveZ = pz - ws.lastStreamZ
  const threshold = CHUNK.size / 2
  if (moveX * moveX + moveZ * moveZ < threshold * threshold) return
  ws.lastStreamX = px
  ws.lastStreamZ = pz
  const cellX = Math.floor(px / CHUNK.size)
  const cellZ = Math.floor(pz / CHUNK.size)

  // Free pass (hysteresis radius).
  const freeSq = CHUNK.freeRadius * CHUNK.freeRadius
  for (const [key, rec] of ws.chunks) {
    const cxw = (rec.cx + 0.5) * CHUNK.size
    const czw = (rec.cz + 0.5) * CHUNK.size
    const dSq = (cxw - px) * (cxw - px) + (czw - pz) * (czw - pz)
    if (dSq > freeSq) {
      freeChunk(rec)
      ws.chunks.delete(key)
    }
  }

  // Gather wanted cells, nearest first.
  const ring = Math.ceil(CHUNK.genRadius / CHUNK.size)
  const genSq = CHUNK.genRadius * CHUNK.genRadius
  scratchCells.length = 0
  for (let cx = cellX - ring; cx <= cellX + ring; cx++) {
    for (let cz = cellZ - ring; cz <= cellZ + ring; cz++) {
      const cxw = (cx + 0.5) * CHUNK.size
      const czw = (cz + 0.5) * CHUNK.size
      const dSq = (cxw - px) * (cxw - px) + (czw - pz) * (czw - pz)
      if (dSq <= genSq && !ws.chunks.has(chunkKey(cx, cz))) {
        scratchCells.push({ cx, cz, dSq })
      }
    }
  }
  scratchCells.sort((a, b) => a.dSq - b.dSq)

  for (const cell of scratchCells) {
    const islands = generateChunkIslands(ws.trackSeed, ws.depth, cell.cx, cell.cz, ws.modsGen)
    const rec: ChunkRecord = { cx: cell.cx, cz: cell.cz, slots: [] }
    for (const spec of islands) {
      const idx = allocSlot(spec.variant)
      if (idx < 0) break // pool exhausted — skip the rest (farthest chunks lose)
      const slot = ws.slots[idx]
      slot.used = true
      slot.serial++
      slot.id = spec.id
      slot.x = spec.x
      slot.y = spec.y
      slot.z = spec.z
      slot.scale = spec.scale
      slot.rotY = spec.rotY
      slot.bobPhase = spec.bobPhase
      slot.bobSpeed = spec.bobSpeed
      slot.bobAmp = spec.bobAmp
      slot.bassGain = spec.bassGain
      slot.variant = Math.floor(idx / WORLD.SLOTS_PER_VARIANT)
      slot.bornAt = clockT
      rec.slots.push(idx)
      ws.slotVersion++
    }
    ws.chunks.set(chunkKey(cell.cx, cell.cz), rec)
  }
}

export function countActivePoints(): number {
  const a = worldState.points.active
  let n = 0
  for (let i = 0; i < a.length; i++) n += a[i]
  return n
}

const liveScratch: number[] = []

/**
 * Point pool housekeeping + spawner: despawn stranded points, then keep
 * POINT_TARGET active points near/ahead of the player (≤1 spawn per call).
 */
export function spawnPointsIfNeeded(
  px: number,
  py: number,
  pz: number,
  fx: number,
  fz: number,
  clockT: number,
): void {
  const ws = worldState
  const p = ws.points

  // Housekeeping: drop points whose island streamed out or that fell too far behind.
  for (let i = 0; i < WORLD.POINT_POOL; i++) {
    if (!p.active[i]) continue
    const isl = p.islandSlot[i]
    if (isl >= 0 && (!ws.slots[isl].used || ws.slots[isl].serial !== p.islandSerial[i])) {
      p.active[i] = 0
      continue
    }
    const dx = p.x[i] - px
    const dy = p.y[i] - py
    const dz = p.z[i] - pz
    if (dx * dx + dy * dy + dz * dz > WORLD.POINT_DESPAWN * WORLD.POINT_DESPAWN) {
      p.active[i] = 0
    }
  }

  if (countActivePoints() >= WORLD.POINT_TARGET) return

  // Find a reusable slot (inactive, flash played out).
  let slot = -1
  for (let i = 0; i < WORLD.POINT_POOL; i++) {
    if (p.active[i]) continue
    if (p.flashAt[i] > 0 && clockT - p.flashAt[i] < WORLD.POINT_FLASH_HOLD) continue
    slot = i
    break
  }
  if (slot < 0) return

  // Normalize travel forward (XZ).
  const fl = Math.hypot(fx, fz)
  const nfx = fl > 1e-4 ? fx / fl : 0
  const nfz = fl > 1e-4 ? fz / fl : -1

  // Collect live islands once.
  liveScratch.length = 0
  for (let i = 0; i < ws.slots.length; i++) {
    if (ws.slots[i].used) liveScratch.push(i)
  }
  if (liveScratch.length === 0) return

  let bestScore = -Infinity
  let bx = 0
  let by = 0
  let bz = 0
  let bIsl = -1
  for (let attempt = 0; attempt < 12; attempt++) {
    const islIdx = liveScratch[Math.min(liveScratch.length - 1, Math.floor(ws.rngPoints() * liveScratch.length))]
    const isl = ws.slots[islIdx]
    const cx = isl.x
    // variantTop tracks the sculpted silhouette (monoliths reach ~1.8x scale)
    const cy = isl.y + isl.scale * variantTop(isl.variant) + range(ws.rngPoints, 1.5, 3)
    const cz = isl.z
    const dx = cx - px
    const dz = cz - pz
    const distXZ = Math.hypot(dx, dz)
    const dist = Math.hypot(dx, cy - py, dz)
    if (dist < WORLD.POINT_NEAR || dist > WORLD.POINT_FAR) continue
    // Ahead bias: reject only hard-behind candidates.
    const dot = distXZ > 1e-4 ? (dx / distXZ) * nfx + (dz / distXZ) * nfz : 0
    if (dot < WORLD.POINT_BEHIND_DOT) continue
    // Keep clear of active points and the gate.
    let blocked = false
    for (let j = 0; j < WORLD.POINT_POOL; j++) {
      if (!p.active[j]) continue
      const qx = p.x[j] - cx
      const qy = p.y[j] - cy
      const qz = p.z[j] - cz
      if (qx * qx + qy * qy + qz * qz < LAYOUT.pointMinPairDist * LAYOUT.pointMinPairDist) {
        blocked = true
        break
      }
    }
    if (blocked) continue
    if (ws.gate.active) {
      const gx = ws.gate.x - cx
      const gy = ws.gate.y - cy
      const gz = ws.gate.z - cz
      if (gx * gx + gy * gy + gz * gz < 20 * 20) continue
    }
    const bandFit = Math.max(0, 1 - Math.abs(dist - WORLD.POINT_AHEAD_PEAK) / WORLD.POINT_AHEAD_PEAK)
    const score = (dot + 1) * (0.3 + bandFit)
    if (score > bestScore) {
      bestScore = score
      bx = cx
      by = cy
      bz = cz
      bIsl = islIdx
    }
  }
  if (bIsl < 0) return

  p.active[slot] = 1
  p.x[slot] = bx
  p.y[slot] = by
  p.z[slot] = bz
  p.islandSlot[slot] = bIsl
  p.islandSerial[slot] = ws.slots[bIsl].serial
  p.serial[slot]++
  p.flashAt[slot] = 0
}

export function collectPoint(i: number, clockT: number): void {
  const p = worldState.points
  if (i < 0 || i >= WORLD.POINT_POOL) return
  p.active[i] = 0
  p.flashAt[i] = clockT
}

/** Materialize the gate ahead of the player, nudged off island centers. */
export function openGate(
  px: number,
  py: number,
  pz: number,
  fx: number,
  fz: number,
  clockT: number,
): void {
  const ws = worldState
  const fl = Math.hypot(fx, fz)
  const nfx = fl > 1e-4 ? fx / fl : 0
  const nfz = fl > 1e-4 ? fz / fl : -1
  let d = WORLD.GATE_DIST
  let gx = px + nfx * d
  let gz = pz + nfz * d
  for (let tries = 0; tries < 3; tries++) {
    let tooClose = false
    for (const slot of ws.slots) {
      if (!slot.used) continue
      const dx = slot.x - gx
      const dz = slot.z - gz
      if (dx * dx + dz * dz < 12 * 12) {
        tooClose = true
        break
      }
    }
    if (!tooClose) break
    d += 10
    gx = px + nfx * d
    gz = pz + nfz * d
  }
  ws.gate.active = true
  ws.gate.x = gx
  ws.gate.y = Math.max(-20, Math.min(40, py + 6))
  ws.gate.z = gz
  ws.gate.openedAt = clockT
  ws.gate.openT = 0
}

/** Advance gate materialization; re-place it ahead if the player strays. */
export function updateGate(
  dt: number,
  px: number,
  py: number,
  pz: number,
  fx: number,
  fz: number,
  clockT: number,
): void {
  const g = worldState.gate
  if (!g.active) return
  g.openT = Math.min(1, g.openT + dt / 1.2)
  const dx = g.x - px
  const dy = g.y - py
  const dz = g.z - pz
  if (dx * dx + dy * dy + dz * dz > WORLD.GATE_RESPAWN_DIST * WORLD.GATE_RESPAWN_DIST) {
    // The gate haunts the player rather than being losable.
    const keepT = g.openT
    openGate(px, py, pz, fx, fz, clockT)
    g.openT = keepT
  }
}
