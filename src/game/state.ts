import { create } from 'zustand'
import * as engine from '../audio/audioEngine'
import { audioFrame, initBus, resetBus } from '../audio/reactiveBus'
import { loadSfxKit, setSfxVolume, sfxBeginRite, sfxTripStop } from '../audio/sfx'
import { preAnalyze } from '../audio/preAnalysis'
import { resetRun, runState } from './runState'
import { enemyState, resetEnemies } from './enemyState'
import { feel, resetFeel } from './feelSignals'
import { gameTime, resetGameTime } from './gameTime'
import { getRealmForDepth } from './realms'
import { loadProgress, recordRun } from './progress'
import {
  completeContractSlot,
  contractDef,
  contractGates,
  normalizeContracts,
} from './contracts'
import {
  buildRunLoadout,
  claimPendingDrop,
  equipRelic,
  grantRewards,
  levelForXp,
  loadRpg,
  saveRpg,
  setLoadoutSlot,
  spendPoint,
  tryBuy,
  unequipRelic,
  type AttributeId,
  type RpgData,
} from './rpg'
import { bountyComplete, bountyForDay, normalizeBounty, QUESTS_BY_ID, questAvailability } from './quests'
import { localDayString, settleRun, type RunCounters } from './rpgRun'
import { resetWorld, worldState } from './worldState'
import { governor } from '../scene/perfGovernor'
import { requestLock, snapController, type ViewMode } from '../scene/snapController'
import { forcing, resetVisuals, visuals } from '../scene/visualTuning'
import type { RunOutcome, RunResult, TrackAnalysis, TrackManifestEntry } from '../types'

export type Screen = 'select' | 'loading' | 'play' | 'end' | 'hub'

export interface Settings {
  sensitivity: number
  /** Music bus gain. The track is the point of the game — this stays loud. */
  musicVolume: number
  /** SFX bus gain. Defaults low so the music leads the mix. */
  sfxVolume: number
  /** Camera: third-person wraith (default) or classic first-person. */
  viewMode: ViewMode
  /** 0..1 master scale for the psychedelic visual stack. Doubles as the
   * difficulty dial: >=0.8 HARD, >=0.9 EXTREME (see game/immersion.ts). */
  visualIntensity: number
  /** Photosensitivity-safe mode: kaleidoscope off, tracers/warp/flashes reduced. */
  reducedMotion: boolean
}

export interface LoadingState {
  stage: 'download' | 'decode' | 'analyze' | 'build'
  progress: number
}

const SETTINGS_KEY = 'astral.settings.v1'

function loadSettings(): Settings {
  const defaults: Settings = {
    sensitivity: 1,
    musicVolume: 0.85,
    sfxVolume: 0.35,
    viewMode: 'third',
    visualIntensity: 0.8,
    reducedMotion: false,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<Settings> & {
      themeId?: unknown
      volume?: unknown
    }
    return {
      sensitivity: clampNum(parsed.sensitivity, 0.5, 3, defaults.sensitivity),
      // Legacy single `volume` migrates to the music bus; sfx keeps its own
      // stored value or the new low default (music-first mix).
      musicVolume: clampNum(parsed.musicVolume ?? parsed.volume, 0, 1, defaults.musicVolume),
      sfxVolume: clampNum(parsed.sfxVolume, 0, 1, defaults.sfxVolume),
      // Stale themeId from older saves is dropped silently.
      viewMode: parsed.viewMode === 'first' ? 'first' : 'third',
      visualIntensity: clampNum(parsed.visualIntensity, 0, 1, defaults.visualIntensity),
      reducedMotion: parsed.reducedMotion === true,
    }
  } catch {
    return defaults
  }
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

export function urlSeedOverride(): number | null {
  if (typeof location === 'undefined') return null
  const raw = new URLSearchParams(location.search).get('seed')
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n >>> 0 : null
}

/** ?depth=N boots straight into a deeper realm (debug/verification). */
export function urlDepthOverride(): number {
  if (typeof location === 'undefined') return 0
  const raw = new URLSearchParams(location.search).get('depth')
  if (raw == null) return 0
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? Math.min(64, n) : 0
}

export const DEBUG_MODE =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')

function humanError(e: unknown): string {
  if (e instanceof DOMException || (e instanceof Error && /decod/i.test(e.message))) {
    return "Couldn't decode that file — it may be corrupt, DRM-protected, or not real audio."
  }
  if (e instanceof Error && /HTTP/.test(e.message)) {
    return `Couldn't fetch the track (${e.message}). Is the file still in public/tracks?`
  }
  return 'Something went wrong loading the track.'
}

interface GameStore {
  screen: Screen
  tracks: TrackManifestEntry[]
  tracksLoaded: boolean
  error: string | null
  currentTrack: TrackManifestEntry | null
  analysis: TrackAnalysis | null
  /** Mirror of worldState.depth — the one React commit per realm shift. */
  depth: number
  loading: LoadingState
  /** Play screen: whether the CLICK TO BEGIN gate has been passed. */
  started: boolean
  paused: boolean
  result: RunResult | null
  settings: Settings
  /** Persistent RPG progression — the one store-resident save (hub UI needs
   * selector reactivity; frame loops still read only runState.stats). */
  rpg: RpgData

  refreshTracks(): Promise<void>
  selectTrack(track: TrackManifestEntry): Promise<void>
  begin(): void
  setPaused(paused: boolean): void
  resumeGame(): void
  quitToMenu(): void
  endRun(outcome?: RunOutcome): void
  replay(): void
  backToSelect(): void
  setSettings(patch: Partial<Settings>): void
  enterHub(): void
  leaveHub(): void

  // ---- Sanctum actions (each: pure applier -> set -> saveRpg) ----
  buyItem(itemId: string): void
  equipRelicSlot(itemId: string, slot: number): void
  unequipRelicSlot(slot: number): void
  setRiteSlot(slot: number, itemId: string | null): void
  spendAttributePoint(attr: AttributeId): void
  acceptQuest(questId: string): void
  turnInQuest(questId: string): void
  claimBounty(): void
  /** Claim one of the pending choice-of-3 drop offers; the others dissolve. */
  claimDrop(index: 0 | 1 | 2): void
  /** Turn in a completed rolling contract; the slot reseeds immediately. */
  turnInContract(slot: 0 | 1 | 2): void
  markNpcMet(npcId: string): void
}

export const useGameStore = create<GameStore>()((set, get) => ({
  screen: 'select',
  tracks: [],
  tracksLoaded: false,
  error: null,
  currentTrack: null,
  analysis: null,
  depth: 0,
  loading: { stage: 'download', progress: 0 },
  started: false,
  paused: false,
  result: null,
  settings: loadSettings(),
  rpg: loadRpg(),

  async refreshTracks() {
    try {
      const res = await fetch('/tracks/manifest.json', { cache: 'no-store' })
      const tracks = (await res.json()) as TrackManifestEntry[]
      set({ tracks, tracksLoaded: true })
    } catch {
      set({ tracks: [], tracksLoaded: true })
    }
  },

  async selectTrack(track) {
    engine.ensureContext()
    engine.setVolume(get().settings.musicVolume)
    setSfxVolume(get().settings.sfxVolume)
    void loadSfxKit() // tribal kit decodes in parallel with the track download
    set({
      screen: 'loading',
      currentTrack: track,
      error: null,
      result: null,
      loading: { stage: 'download', progress: 0 },
    })
    try {
      let lastUpdate = 0
      const buffer = await engine.loadTrack(track.file, p => {
        const now = performance.now()
        if (now - lastUpdate > 100 || p >= 1) {
          lastUpdate = now
          set({ loading: { stage: p >= 1 ? 'decode' : 'download', progress: p } })
        }
      })
      set({ loading: { stage: 'analyze', progress: 0 } })
      let lastA = 0
      const analysis = await preAnalyze(buffer, p => {
        const now = performance.now()
        if (now - lastA > 100 || p >= 1) {
          lastA = now
          set({ loading: { stage: 'analyze', progress: p } })
        }
      })
      const override = urlSeedOverride()
      if (override != null) analysis.seed = override
      set({ loading: { stage: 'build', progress: 1 } })
      const startDepth = urlDepthOverride()
      resetWorld(analysis.seed, startDepth)
      resetRun(startDepth, loadProgress().bestDepth, buildRunLoadout(get().rpg))
      resetEnemies(analysis.seed, startDepth)
      resetFeel()
      resetGameTime()
      snapController.reset()
      set({ analysis, depth: startDepth, screen: 'play', started: false, paused: false })
    } catch (e) {
      engine.releaseBuffer()
      set({ screen: 'select', error: humanError(e) })
    }
  },

  begin() {
    const { analysis, started } = get()
    if (!analysis || started) return
    engine.ensureContext()
    engine.setVolume(get().settings.musicVolume)
    sfxBeginRite()
    resetVisuals()
    initBus(analysis)
    engine.startPlayback(() => get().endRun('faded'))
    set({ started: true, paused: false })
    requestLock(snapController.canvasEl)
  },

  setPaused(paused) {
    if (get().screen !== 'play' || !get().started) return
    if (paused) engine.suspendAudio()
    set({ paused })
  },

  resumeGame() {
    if (get().screen !== 'play') return
    engine.resumeAudio()
    set({ paused: false })
    requestLock(snapController.canvasEl)
  },

  quitToMenu() {
    get().backToSelect()
  },

  endRun(outcome: RunOutcome = 'faded') {
    const st = get()
    if (st.screen !== 'play' || !st.started) return
    const durationPlayed = engine.getTime()
    engine.stopPlayback()
    resetBus()
    document.exitPointerLock?.()
    const humanDepth = worldState.depth + 1
    const trackFile = st.currentTrack?.file ?? ''
    const { newBest } = recordRun(trackFile, humanDepth)
    const c = runState.combat
    // ---- RPG settlement: fold the whole run into the persistent save
    // atomically (xp, shards, drops, quest ticks, charge burns) ----
    const counters: RunCounters = {
      outcome,
      depth: humanDepth,
      collected: runState.collected,
      perfects: runState.perfects,
      durationPlayed,
      killsByArchetype: [...c.killsByArchetype],
      wardenKillsByArchetype: [...c.wardenKillsByArchetype],
      shardsEarned: c.shardsEarned,
      latchesSuffered: c.latchesSuffered,
      consumablesUsed: [runState.consumablesUsed[0], runState.consumablesUsed[1]],
      loadout: [runState.loadout[0], runState.loadout[1]],
      seed: st.analysis?.seed ?? 0,
    }
    const settlement = settleRun(st.rpg, counters, localDayString())
    saveRpg(settlement.next)
    const result: RunResult = {
      trackName: st.currentTrack?.name ?? '',
      score: runState.scoreState.score,
      collected: runState.collected,
      snaps: runState.snaps,
      perfects: runState.perfects,
      goods: runState.goods,
      onBeats: runState.onBeats,
      bestChain: runState.scoreState.bestChain,
      depth: humanDepth,
      realmName: getRealmForDepth(worldState.depth).realm.label,
      realmsVisited: runState.shiftsDone + 1,
      newBest,
      durationPlayed,
      outcome,
      kills: c.kills,
      wardenKills: c.wardenKills,
      damageDealt: c.damageDealt,
      damageTaken: c.damageTaken,
      latchesSuffered: c.latchesSuffered,
      novasFired: c.novasFired,
      xpGained: settlement.xpGained,
      levelBefore: settlement.levelBefore,
      levelAfter: settlement.levelAfter,
      shardsGained: settlement.shardsGained,
      drops: settlement.drops,
      questTicks: settlement.questTicks,
    }
    set({ screen: 'end', result, paused: false, rpg: settlement.next })
  },

  replay() {
    const { analysis } = get()
    if (!analysis) return
    const startDepth = urlDepthOverride()
    resetWorld(analysis.seed, startDepth)
    resetRun(startDepth, loadProgress().bestDepth, buildRunLoadout(get().rpg))
    resetEnemies(analysis.seed, startDepth)
    resetFeel()
    resetGameTime()
    snapController.reset()
    set({ depth: startDepth, screen: 'play', started: false, paused: false, result: null })
  },

  backToSelect() {
    engine.stopPlayback()
    engine.releaseBuffer()
    resetBus()
    sfxTripStop() // the frame loop unmounts with us — the trip bed must not linger
    resetEnemies(0, 0)
    document.exitPointerLock?.()
    set({
      screen: 'select',
      analysis: null,
      result: null,
      currentTrack: null,
      depth: 0,
      started: false,
      paused: false,
    })
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    if (patch.musicVolume != null) {
      engine.setVolume(settings.musicVolume)
    }
    if (patch.sfxVolume != null) {
      setSfxVolume(settings.sfxVolume)
    }
    snapController.sensitivity = settings.sensitivity
    snapController.viewMode = settings.viewMode
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // storage unavailable — settings just won't persist
    }
  },

  enterHub() {
    const st = get()
    if (st.screen !== 'select' && st.screen !== 'end') return
    // entering the sanctum fills any empty unlocked contract slots so the
    // boards never sit bare (idempotent for a fixed counter/level)
    {
      const rpg = st.rpg
      const filled = normalizeContracts(
        rpg.contracts,
        levelForXp(rpg.xp),
        contractGates(rpg.quests),
      )
      if (filled !== rpg.contracts) {
        const next: RpgData = { ...rpg, contracts: filled }
        set({ rpg: next })
        saveRpg(next)
      }
    }
    if (st.screen === 'end') {
      // arriving from a finished run: the same audio/world teardown as
      // backToSelect, so the sanctum never leaks a dead run's resources
      engine.stopPlayback()
      engine.releaseBuffer()
      resetBus()
      sfxTripStop()
      resetEnemies(0, 0)
      document.exitPointerLock?.()
      set({
        screen: 'hub',
        analysis: null,
        result: null,
        currentTrack: null,
        depth: 0,
        started: false,
        paused: false,
      })
      return
    }
    set({ screen: 'hub' })
  },

  leaveHub() {
    if (get().screen !== 'hub') return
    set({ screen: 'select' })
  },

  // ---- Sanctum actions: pure applier -> commit -> persist ----
  buyItem(itemId) {
    const { next, ok } = tryBuy(get().rpg, itemId)
    if (!ok) return
    set({ rpg: next })
    saveRpg(next)
  },

  equipRelicSlot(itemId, slot) {
    const { next, ok } = equipRelic(get().rpg, itemId, slot)
    if (!ok) return
    set({ rpg: next })
    saveRpg(next)
  },

  unequipRelicSlot(slot) {
    const { next, ok } = unequipRelic(get().rpg, slot)
    if (!ok) return
    set({ rpg: next })
    saveRpg(next)
  },

  setRiteSlot(slot, itemId) {
    const { next, ok } = setLoadoutSlot(get().rpg, slot, itemId)
    if (!ok) return
    set({ rpg: next })
    saveRpg(next)
  },

  spendAttributePoint(attr) {
    const { next, ok } = spendPoint(get().rpg, attr)
    if (!ok) return
    set({ rpg: next })
    saveRpg(next)
  },

  acceptQuest(questId) {
    const rpg = get().rpg
    const def = QUESTS_BY_ID[questId]
    if (!def || questAvailability(def, rpg.quests) !== 'offered') return
    const next: RpgData = {
      ...rpg,
      quests: { ...rpg.quests, [questId]: { state: 'active' as const, progress: 0 } },
    }
    set({ rpg: next })
    saveRpg(next)
  },

  turnInQuest(questId) {
    const rpg = get().rpg
    const def = QUESTS_BY_ID[questId]
    if (!def || rpg.quests[questId]?.state !== 'complete') return
    let next = grantRewards(rpg, {
      xp: def.reward.xp,
      shards: def.reward.shards,
      items: def.reward.itemId ? { [def.reward.itemId]: def.reward.itemCount ?? 1 } : undefined,
    })
    next = {
      ...next,
      quests: {
        ...next.quests,
        [questId]: { state: 'turnedIn' as const, progress: rpg.quests[questId].progress },
      },
    }
    set({ rpg: next })
    saveRpg(next)
  },

  claimBounty() {
    const rpg = get().rpg
    const today = localDayString()
    if (!bountyComplete(rpg.bounty, today)) return
    const def = bountyForDay(today)
    let next = grantRewards(rpg, { xp: def.reward.xp, shards: def.reward.shards })
    next = { ...next, bounty: { ...normalizeBounty(rpg.bounty, today), claimed: true } }
    set({ rpg: next })
    saveRpg(next)
  },

  claimDrop(index) {
    const { next, ok } = claimPendingDrop(get().rpg, index)
    if (!ok) return
    set({ rpg: next })
    saveRpg(next)
  },

  turnInContract(slot) {
    const rpg = get().rpg
    const save = rpg.contracts.slots[slot]
    if (!save || save.state !== 'complete') return
    const def = contractDef(save, slot)
    let next = grantRewards(rpg, {
      xp: def.reward.xp,
      shards: def.reward.shards,
      items: def.reward.itemId ? { [def.reward.itemId]: 1 } : undefined,
    })
    // clear + counter++ then refill immediately with a fresh seed
    const cleared = completeContractSlot(next.contracts, slot)
    next = {
      ...next,
      contracts: normalizeContracts(cleared, levelForXp(next.xp), contractGates(next.quests)),
    }
    set({ rpg: next })
    saveRpg(next)
  },

  markNpcMet(npcId) {
    const rpg = get().rpg
    if (rpg.npcMet[npcId]) return
    const next: RpgData = { ...rpg, npcMet: { ...rpg.npcMet, [npcId]: true } }
    set({ rpg: next })
    saveRpg(next)
  },
}))

// Keep the controller in sync from initial load.
snapController.sensitivity = useGameStore.getState().settings.sensitivity
snapController.viewMode = useGameStore.getState().settings.viewMode
// Realm shifts happen deep in the frame loop; this is the one React commit.
snapController.onDepthChange = depth => {
  useGameStore.setState({ depth })
}
// The swarm dragged the player down — the run's second ending.
snapController.onDowned = () => {
  useGameStore.getState().endRun('downed')
}

// Headless/debug hooks for the __drive verification harness. __run/__audio/
// __visuals restore the external score/band-reading channel the numberless
// HUD no longer renders as DOM text.
if (DEBUG_MODE && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__game = useGameStore
  ;(window as unknown as Record<string, unknown>).__snap = snapController
  ;(window as unknown as Record<string, unknown>).__world = worldState
  ;(window as unknown as Record<string, unknown>).__run = runState
  ;(window as unknown as Record<string, unknown>).__audio = audioFrame
  ;(window as unknown as Record<string, unknown>).__visuals = visuals
  ;(window as unknown as Record<string, unknown>).__gov = governor
  ;(window as unknown as Record<string, unknown>).__enemies = enemyState
  ;(window as unknown as Record<string, unknown>).__forcing = forcing
  ;(window as unknown as Record<string, unknown>).__feel = feel
  ;(window as unknown as Record<string, unknown>).__gameTime = gameTime
  ;(window as unknown as Record<string, unknown>).__rpg = () => useGameStore.getState().rpg
}
