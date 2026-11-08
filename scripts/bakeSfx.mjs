// Bakes the tribal/mythic sample kit into public/assets/sfx/*.wav.
// Dependency-free offline synthesis: RBJ biquads, modal resonators, granular
// noise, additive band-limited oscillators, tanh saturation. Deterministic
// (seeded PRNG) — re-run with `npm run bake:sfx` after tweaking recipes.
// Everything bakes at 44.1 kHz and passes master() — DC-block, soft-knee glue
// comp, level staging, soft limiter — before writeWav. Recipes are append-only:
// never renumber; new ones go after the last block.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'sfx')
fs.mkdirSync(OUT_DIR, { recursive: true })

const SR = 44100
const TAU = Math.PI * 2

// ---------- deterministic rng ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(0xa57a17)

// ---------- WAV writer (16-bit PCM) ----------
let totalBytes = 0
function writeWav(file, channels, sampleRate) {
  const ch = channels.length
  const n = channels[0].length
  const dataSize = n * ch * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * ch * 2, 28)
  buf.writeUInt16LE(ch * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  let peak = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]))
      peak = Math.max(peak, Math.abs(x))
      sumSq += x * x
      buf.writeInt16LE(Math.round(x * 32767), 44 + (i * ch + c) * 2)
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, file), buf)
  totalBytes += buf.length
  const rms = Math.sqrt(sumSq / (n * ch))
  const db = v => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf')
  console.log(
    `baked ${file.padEnd(20)} ${(n / sampleRate).toFixed(2)}s  peak ${db(peak)}dB  rms ${db(rms)}dB  ${(buf.length / 1024).toFixed(0)} kB`,
  )
}

// ---------- DSP toolkit ----------

/** RBJ cookbook biquad. */
function biquad(type, f0, Q, gainDb, sr) {
  const st = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }
  setCoeffs(st, type, f0, Q, gainDb, sr)
  return st
}
function setCoeffs(st, type, f0, Q, gainDb, sr) {
  const w0 = (TAU * Math.min(f0, sr * 0.49)) / sr
  const cw = Math.cos(w0)
  const sw = Math.sin(w0)
  const alpha = sw / (2 * Q)
  const A = Math.pow(10, (gainDb ?? 0) / 40)
  let b0, b1, b2, a0, a1, a2
  switch (type) {
    case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
      break
    default:
      throw new Error(`unknown biquad type ${type}`)
  }
  st.b0 = b0 / a0; st.b1 = b1 / a0; st.b2 = b2 / a0
  st.a1 = a1 / a0; st.a2 = a2 / a0
}
function tick(st, x) {
  const y = st.b0 * x + st.b1 * st.x1 + st.b2 * st.x2 - st.a1 * st.y1 - st.a2 * st.y2
  st.x2 = st.x1; st.x1 = x
  st.y2 = st.y1; st.y1 = y
  return y
}
function filterBuf(buf, type, f0, Q, gainDb, sr) {
  const st = biquad(type, f0, Q, gainDb, sr)
  for (let i = 0; i < buf.length; i++) buf[i] = tick(st, buf[i])
  return buf
}

/** Decaying-sine modal resonator: sum of exp(-t/tau)*sin(2*pi*f*t). */
function modalStrike(n, modes, sr, detunePct = 0) {
  const out = new Float32Array(n)
  for (const [freq, amp, tau] of modes) {
    const f = freq * (1 + (rng() * 2 - 1) * detunePct)
    const phase0 = rng() * TAU
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] += amp * Math.exp(-t / tau) * Math.sin(TAU * f * t + phase0)
    }
  }
  return out
}

function tanhSat(buf, drive) {
  const norm = Math.tanh(drive)
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / norm
  return buf
}

function noiseBuf(n) {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1
  return out
}

function normalize(buf, peakTarget) {
  let peak = 0
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
  if (peak > 0) {
    const g = peakTarget / peak
    for (let i = 0; i < buf.length; i++) buf[i] *= g
  }
  return buf
}

function mixInto(dest, src, gain = 1, offsetSamples = 0) {
  for (let i = 0; i < src.length && i + offsetSamples < dest.length; i++) {
    dest[i + offsetSamples] += src[i] * gain
  }
  return dest
}

/** 2ms fade-in / 8ms fade-out click-proofing for one-shots. */
function edgeFades(buf, sr, inMs = 2, outMs = 8) {
  const nIn = Math.round((sr * inMs) / 1000)
  const nOut = Math.round((sr * outMs) / 1000)
  for (let i = 0; i < nIn && i < buf.length; i++) buf[i] *= i / nIn
  for (let i = 0; i < nOut && i < buf.length; i++) {
    buf[buf.length - 1 - i] *= i / nOut
  }
  return buf
}

const secs = (s, sr = SR) => Math.round(s * sr)

// ---------- mastering chain ----------
// Every sample passes DC-block -> soft-knee glue comp -> level staging -> soft
// limiter before writeWav. One-shots (ONESHOT) stage to a -3 dBFS peak; loops
// and beds (BED) stage to a shared RMS so they sit at one loudness — this
// REPLACES the old per-recipe normalize() targets. Stateful stages (DC-block,
// comp envelope) would smear a loop seam, so for loops they run on a doubled
// buffer and keep the second pass: the kept cycle is the steady-state response
// to a periodic input, i.e. still sample-exact seamless.
const ONESHOT = { peak: Math.pow(10, -3 / 20) } // -3 dBFS
const BED = { rms: Math.pow(10, -16 / 20) } // consistent loop/bed loudness

/** One-pole DC blocker, ~25 Hz corner (y = x - x1 + R*y1). */
function dcBlock(buf, sr, hz = 25) {
  const R = Math.exp((-TAU * hz) / sr)
  let x1 = 0
  let y1 = 0
  for (let i = 0; i < buf.length; i++) {
    const y = buf[i] - x1 + R * y1
    x1 = buf[i]
    y1 = y
    buf[i] = y
  }
  return buf
}

/** Feed-forward soft-knee glue compressor, ~2:1 above -12 dBFS. */
function glueComp(buf, sr, threshDb = -12, ratio = 2, kneeDb = 8) {
  const aA = Math.exp(-1 / (0.006 * sr)) // 6 ms attack
  const aR = Math.exp(-1 / (0.14 * sr)) // 140 ms release
  let env = 0
  let gSm = 1
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i])
    const c = a > env ? aA : aR
    env = c * env + (1 - c) * a
    const eDb = 20 * Math.log10(Math.max(env, 1e-7))
    const over = eDb - threshDb
    let grDb = 0
    if (over > kneeDb / 2) {
      grDb = over * (1 / ratio - 1)
    } else if (over > -kneeDb / 2) {
      const d = over + kneeDb / 2
      grDb = ((1 / ratio - 1) * d * d) / (2 * kneeDb)
    }
    const g = Math.pow(10, grDb / 20)
    const gc = g < gSm ? aA : aR
    gSm = gc * gSm + (1 - gc) * g
    buf[i] *= gSm
  }
  return buf
}

/** Soft ceiling at 0.95: untouched below the 0.8 knee, tanh squash above. */
function limiter(buf, ceiling = 0.95, knee = 0.8) {
  const head = ceiling - knee
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i])
    if (a > knee) {
      buf[i] = Math.sign(buf[i]) * (knee + head * Math.tanh((a - knee) / head))
    }
  }
  return buf
}

function master(channels, sr, target) {
  const loopSafe = target.rms !== undefined
  for (let c = 0; c < channels.length; c++) {
    const buf = channels[c]
    if (loopSafe) {
      const ext = new Float32Array(buf.length * 2)
      ext.set(buf)
      ext.set(buf, buf.length)
      dcBlock(ext, sr)
      glueComp(ext, sr)
      channels[c] = ext.subarray(buf.length)
    } else {
      dcBlock(buf, sr)
      glueComp(buf, sr)
    }
  }
  // one staging gain across all channels so stereo balance survives
  let g = 1
  if (target.peak !== undefined) {
    let peak = 0
    for (const buf of channels) {
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
    }
    if (peak > 0) g = target.peak / peak
  } else {
    let sumSq = 0
    let n = 0
    for (const buf of channels) {
      for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i]
      n += buf.length
    }
    const rms = Math.sqrt(sumSq / Math.max(1, n))
    if (rms > 0) g = target.rms / rms
  }
  for (const buf of channels) {
    if (g !== 1) for (let i = 0; i < buf.length; i++) buf[i] *= g
    limiter(buf)
  }
  return channels
}

// ---------- 1. frame drums ----------
// Sub-thump (pitch-dropping 40-60 Hz sine) + membrane + skin-slap transient +
// a short room tail, glued by shared saturation.
function bakeFrameDrum(file, startHz, slapHz) {
  const n = secs(0.7)
  const drop = startHz - 36
  const membrane = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 36 + drop * Math.exp(-t / 0.035)
    phase += (TAU * f) / SR
    const attack = Math.min(1, t / 0.002)
    membrane[i] = Math.sin(phase) * attack * Math.exp(-t / 0.16)
  }
  // sub-thump: a lower sine dropping 58 -> 42 Hz, outlasting the head
  const sub = new Float32Array(n)
  let subPhase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 42 + 16 * Math.exp(-t / 0.05)
    subPhase += (TAU * f) / SR
    sub[i] = Math.sin(subPhase) * Math.min(1, t / 0.004) * Math.exp(-t / 0.24)
  }
  // skin-slap: two noise bands (palm + fingertips)
  const slap = noiseBuf(secs(0.06))
  filterBuf(slap, 'bandpass', slapHz, 0.9, 0, SR)
  for (let i = 0; i < slap.length; i++) slap[i] *= Math.exp(-(i / SR) / 0.015)
  const slapHi = noiseBuf(secs(0.03))
  filterBuf(slapHi, 'bandpass', slapHz * 2.4, 1.4, 0, SR)
  for (let i = 0; i < slapHi.length; i++) slapHi[i] *= Math.exp(-(i / SR) / 0.007)

  const hoop = modalStrike(secs(0.08), [[190, 0.4, 0.06], [318, 0.2, 0.04]], SR, 0.01)
  // short room tail: dense lowpassed noise swelling then dying
  const room = noiseBuf(n)
  filterBuf(room, 'lowpass', 900, 0.7, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    room[i] *= Math.min(1, t / 0.02) * Math.exp(-t / 0.11)
  }

  const out = new Float32Array(n)
  mixInto(out, membrane, 0.9)
  mixInto(out, sub, 0.85)
  mixInto(out, slap, 0.35)
  mixInto(out, slapHi, 0.22)
  mixInto(out, hoop, 0.5)
  mixInto(out, room, 0.18)
  tanhSat(out, 2.2)
  filterBuf(out, 'lowpass', 6000, 0.7, 0, SR)
  writeWav(file, master([edgeFades(out, SR)], SR, ONESHOT), SR)
}
bakeFrameDrum('frame_drum_1.wav', 52, 1400)
bakeFrameDrum('frame_drum_2.wav', 48, 1150)

// ---------- 2. sub layer ----------
{
  const n = secs(0.5)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 38 + 14 * Math.exp(-t / 0.06) // 52 -> 38 Hz drop
    phase += (TAU * f) / SR
    out[i] = Math.sin(phase) * Math.min(1, t / 0.004) * Math.exp(-t / 0.14)
  }
  // faint skin slap so it shares the frame drums' character
  const slap = noiseBuf(secs(0.04))
  filterBuf(slap, 'bandpass', 1000, 1.1, 0, SR)
  for (let i = 0; i < slap.length; i++) slap[i] *= Math.exp(-(i / SR) / 0.012)
  mixInto(out, slap, 0.15)
  // short room tail
  const room = noiseBuf(n)
  filterBuf(room, 'lowpass', 500, 0.7, 0, SR)
  for (let i = 0; i < n; i++) {
    room[i] *= Math.min(1, i / SR / 0.02) * Math.exp(-(i / SR) / 0.09)
  }
  mixInto(out, room, 0.12)
  tanhSat(out, 1.5)
  writeWav('frame_drum_sub.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 3. log drums ----------
// Pitch-drop body + wood modes + a short knock partial + woody band-passed
// noise at the attack.
function bakeLogDrum(file, F) {
  const n = secs(0.45)
  // pitch-drop body: the bar's fundamental sags ~4% after the hit
  const body = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = F * (1 - 0.04 * (1 - Math.exp(-t / 0.02)))
    phase += (TAU * f) / SR
    body[i] = Math.sin(phase) * Math.min(1, t / 0.0015) * Math.exp(-t / 0.24)
  }
  // wood modes
  const modes = modalStrike(
    n,
    [
      [F * 1.7, 0.55, 0.16],
      [F * 2.61, 0.3, 0.09],
      [F * 3.55, 0.12, 0.05],
    ],
    SR,
    0.02,
  )
  mixInto(body, modes, 1)
  // knock partial: short stiff high modes
  const knock = modalStrike(secs(0.06), [[F * 5.1, 0.5, 0.018], [F * 7.3, 0.2, 0.01]], SR, 0.01)
  mixInto(body, knock, 0.6)
  // woody band-passed noise burst at the attack
  const exciter = noiseBuf(secs(0.012))
  filterBuf(exciter, 'bandpass', 800, 1.2, 0, SR)
  for (let i = 0; i < exciter.length; i++) exciter[i] *= Math.exp(-(i / SR) / 0.004)
  mixInto(body, exciter, 0.5)
  tanhSat(body, 1.6)
  filterBuf(body, 'highpass', 90, 0.7, 0, SR)
  writeWav(file, master([edgeFades(body, SR)], SR, ONESHOT), SR)
}
bakeLogDrum('log_drum_1.wav', 172)
bakeLogDrum('log_drum_2.wav', 218)
bakeLogDrum('log_drum_3.wav', 147)

// ---------- 4. bone clicks ----------
// Click + the knuckle's low body resonance, scattered subtly across two ears
// (detuned body, decorrelated transient, sub-millisecond right-ear lag).
function bakeBoneClick(file, pitchMult) {
  const n = secs(0.055)
  const mkEar = (det, transientGain) => {
    const body = modalStrike(
      n,
      [
        [2350 * pitchMult * det, 1.0, 0.012],
        [3900 * pitchMult * det, 0.5, 0.008],
        [610 * pitchMult * det, 0.45, 0.02],
        [920 * pitchMult * det, 0.2, 0.012],
      ],
      SR,
      0.01,
    )
    const transient = noiseBuf(secs(0.003))
    filterBuf(transient, 'highpass', 1800, 0.8, 0, SR)
    mixInto(body, transient, transientGain)
    return body
  }
  const L = mkEar(1.0, 0.6)
  const R = mkEar(1.003, 0.5)
  const lag = secs(0.0004)
  const Rs = new Float32Array(n)
  for (let i = lag; i < n; i++) Rs[i] = R[i - lag]
  writeWav(file, master([edgeFades(L, SR, 1, 5), edgeFades(Rs, SR, 1, 5)], SR, ONESHOT), SR)
}
bakeBoneClick('bone_click_1.wav', 0.92)
bakeBoneClick('bone_click_2.wav', 1.0)
bakeBoneClick('bone_click_3.wav', 1.12)

// ---------- 5. rattle ----------
{
  const n = secs(0.8)
  const out = new Float32Array(n)
  let grainLeft = 0
  let grainAmp = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const density = 900 * Math.exp(-t / 0.22)
    if (grainLeft <= 0 && rng() < density / SR) {
      grainLeft = 3 + Math.floor(rng() * 6)
      grainAmp = 0.4 + rng() * 0.6
    }
    if (grainLeft > 0) {
      out[i] = (rng() * 2 - 1) * grainAmp
      grainLeft--
    }
  }
  filterBuf(out, 'bandpass', 4200, 1.2, 0, SR)
  filterBuf(out, 'bandpass', 5100, 1.0, 0, SR)
  for (let i = 0; i < n; i++) out[i] *= Math.pow(1 - i / n, 1.5) * 3
  writeWav('rattle.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 6/7. gongs ----------
// Detuned inharmonic partial stack [freq, amp, tauFast, tauSlow, rise]. Struck
// partials ring with a dual-slope decay: a fast early bloom, then a long tail.
const GONG_PARTIALS = [
  [93, 1.0, 0.9, 3.4, 0.3],
  [141, 0.72, 0.8, 2.9, 0.25],
  [211, 0.52, 0.6, 2.2, 0.12],
  [283, 0.4, 0.45, 1.8, 0.06],
  [347, 0.34, 0.4, 1.4, 0.02],
  [456, 0.22, 0.3, 1.0, 0.02],
  [528, 0.18, 0.25, 0.8, 0.02],
  [681, 0.1, 0.2, 0.6, 0.015],
]
function gongStack(n, sr, swell) {
  const out = new Float32Array(n)
  for (const [f, amp, tauF, tauS, rise] of GONG_PARTIALS) {
    const p1 = rng() * TAU
    const p2 = rng() * TAU
    const det = 1 + (rng() * 2 - 1) * 0.003
    for (let i = 0; i < n; i++) {
      const t = i / sr
      const dual = 0.6 * Math.exp(-t / tauF) + 0.4 * Math.exp(-t / tauS)
      const env = swell
        ? Math.pow(Math.min(1, t / 1.0), 2) * Math.exp(-Math.max(0, t - 1.0) / 0.5)
        : (1 - Math.exp(-t / rise)) * dual
      out[i] +=
        amp * env * 0.5 * (Math.sin(TAU * (f * det - 0.35) * t + p1) + Math.sin(TAU * (f * det + 0.35) * t + p2))
    }
  }
  return out
}
{
  const n = secs(3.8)
  const out = gongStack(n, SR, false)
  const strike = noiseBuf(secs(0.03))
  filterBuf(strike, 'bandpass', 900, 1.0, 0, SR)
  mixInto(out, strike, 0.3)
  // high shimmer band: brushed-metal air over the tail
  const shimmer = noiseBuf(n)
  filterBuf(shimmer, 'bandpass', 6800, 1.6, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    shimmer[i] *= Math.min(1, t / 0.08) * (0.5 * Math.exp(-t / 0.5) + 0.5 * Math.exp(-t / 2.2))
  }
  mixInto(out, shimmer, 0.05)
  tanhSat(out, 1.3)
  filterBuf(out, 'lowpass', 9000, 0.7, 0, SR)
  writeWav('gong_dark.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}
{
  const n = secs(2.2)
  const out = gongStack(n, SR, true)
  // shimmer swelling with the partials
  const shimmer = noiseBuf(n)
  filterBuf(shimmer, 'bandpass', 7200, 1.8, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    shimmer[i] *= Math.pow(Math.min(1, t / 1.2), 2) * Math.exp(-Math.max(0, t - 1.2) / 0.4)
  }
  mixInto(out, shimmer, 0.04)
  tanhSat(out, 1.2)
  writeWav('gong_swell.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 8. bells cluster ----------
// Inharmonic stacks (hum, prime, tierce-ish, nominal) with staggered decays.
{
  const n = secs(2.2)
  const out = new Float32Array(n)
  const fundamentals = [1244, 1382, 1567, 1866, 2093]
  const starts = [0, 0.09, 0.19, 0.31, 0.46]
  for (let k = 0; k < 5; k++) {
    const f = fundamentals[k]
    const bell = modalStrike(
      secs(1.4),
      [
        [f * 0.5, 0.3, 0.5],
        [f, 1.0, 1.1],
        [f * 2.02, 0.35, 0.55],
        [f * 2.76, 0.4, 0.4],
        [f * 5.4, 0.15, 0.18],
        [f * 8.9, 0.06, 0.08],
      ],
      SR,
      0.015,
    )
    mixInto(out, bell, 0.8 * Math.pow(0.85, k), secs(starts[k]))
  }
  tanhSat(out, 1.4)
  writeWav('bells_cluster.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 9. breath whoosh ----------
// Formant-swept multi-band noise: three parallel bands swept at their own
// rates over a chest-rumble floor.
{
  const n = secs(0.5)
  const src = noiseBuf(n)
  const out = new Float32Array(n)
  const bpLow = biquad('bandpass', 300, 1.1, 0, SR)
  const bpMid = biquad('bandpass', 600, 1.3, 0, SR)
  const bpHigh = biquad('bandpass', 1200, 1.5, 0, SR)
  const flutterPhase = rng() * TAU
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const k = Math.min(1, t / 0.35)
    if (i % 64 === 0) {
      setCoeffs(bpLow, 'bandpass', 300 * Math.pow(700 / 300, k), 1.1, 0, SR)
      setCoeffs(bpMid, 'bandpass', 600 * Math.pow(2600 / 600, k), 1.3, 0, SR)
      setCoeffs(bpHigh, 'bandpass', 1200 * Math.pow(3400 / 1200, Math.min(1, t / 0.28)), 1.5, 0, SR)
    }
    const env = t < 0.06 ? t / 0.06 : Math.exp(-(t - 0.06) / 0.13)
    const flutter = 1 + 0.35 * Math.sin(TAU * 12 * t + flutterPhase)
    out[i] =
      (tick(bpMid, src[i]) * 1.0 + tick(bpLow, src[i]) * 0.6 + tick(bpHigh, src[i]) * 0.45) *
      env *
      flutter
  }
  const chest = noiseBuf(n)
  filterBuf(chest, 'lowpass', 400, 0.7, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = t < 0.06 ? t / 0.06 : Math.exp(-(t - 0.06) / 0.13)
    out[i] += chest[i] * 0.4 * env
  }
  tanhSat(out, 1.2)
  writeWav('breath_whoosh.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 10. didge pulse ----------
{
  const n = secs(1.8)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 58 + 0.4 * Math.sin(TAU * 5 * t)
    phase += (TAU * f) / SR
    // band-limited saw: sum sin(k*phase)/k
    let saw = 0
    for (let k = 1; k <= 40; k++) saw += Math.sin(k * phase) / k
    saw *= 2 / Math.PI
    const growl = 1 + 0.28 * Math.sin(TAU * 9.5 * t)
    const env =
      t < 0.15 ? t / 0.15 : t < 1.1 ? 1 : Math.exp(-(t - 1.1) / 0.28)
    out[i] = (saw + 0.5 * Math.sin(phase)) * growl * env
  }
  const f1 = biquad('peaking', 250, 5, 10, SR)
  const f2 = biquad('peaking', 900, 5, 10, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    if (i % 64 === 0) {
      const k = Math.min(1, t / 1.2)
      setCoeffs(f1, 'peaking', 250 + 170 * k, 5, 10, SR)
      setCoeffs(f2, 'peaking', 900 + 500 * k, 5, 10, SR)
    }
    out[i] = tick(f2, tick(f1, out[i]))
  }
  tanhSat(out, 2.5)
  filterBuf(out, 'lowpass', 3200, 0.7, 0, SR)
  writeWav('didge_pulse.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 11. chant loop (stereo, seamless) ----------
{
  const LOOP = 8
  const renderN = secs(LOOP + 2)
  const voice = new Float32Array(renderN)
  let phase = 0
  for (let i = 0; i < renderN; i++) {
    const t = i / SR
    const f = 82 * (1 + 0.003 * Math.sin((TAU * t) / LOOP))
    phase += (TAU * f) / SR
    let saw = 0
    for (let k = 1; k <= 30; k++) saw += Math.sin(k * phase) / k
    saw *= 2 / Math.PI
    let sq = 0
    for (let k = 1; k <= 29; k += 2) sq += Math.sin(k * phase) / k
    sq *= 4 / Math.PI
    voice[i] = saw * 0.6 + sq * 0.4
  }
  // loop-periodic formant morph
  const fA = biquad('peaking', 400, 6, 12, SR)
  const fB = biquad('peaking', 800, 6, 12, SR)
  const fC = biquad('peaking', 2400, 6, 12, SR)
  for (let i = 0; i < renderN; i++) {
    const t = i / SR
    if (i % 64 === 0) {
      const m = 0.5 - 0.5 * Math.cos((TAU * t) / LOOP)
      setCoeffs(fA, 'peaking', 400 + 250 * m, 6, 12, SR)
      setCoeffs(fB, 'peaking', 800 + 280 * m, 6, 12, SR)
      setCoeffs(fC, 'peaking', 2400 + 200 * m, 6, 12, SR)
    }
    voice[i] = tick(fC, tick(fB, tick(fA, voice[i]))) * 0.35
  }
  // overtone whistle, opposite phase of the vowel morph
  for (let i = 0; i < renderN; i++) {
    const t = i / SR
    const w = 0.5 - 0.5 * Math.cos((TAU * t) / LOOP + Math.PI)
    voice[i] += 0.06 * w * Math.sin(TAU * 656 * t)
  }
  const mkChannel = () => {
    const breath = noiseBuf(renderN)
    filterBuf(breath, 'lowpass', 900, 0.7, 0, SR)
    const chan = new Float32Array(renderN)
    for (let i = 0; i < renderN; i++) chan[i] = voice[i] + breath[i] * 0.05
    return chan
  }
  const left = mkChannel()
  const right = mkChannel()
  const haas = secs(0.013)
  for (let i = renderN - 1; i >= haas; i--) right[i] += 0.25 * voice[i - haas]

  const loopN = secs(LOOP)
  const fadeN = secs(2)
  const makeLoop = src => {
    const out = new Float32Array(loopN)
    for (let i = 0; i < loopN; i++) {
      if (i < fadeN) {
        const w = ((i / fadeN) * Math.PI) / 2
        out[i] = Math.sin(w) * src[i] + Math.cos(w) * src[i + loopN]
      } else {
        out[i] = src[i]
      }
    }
    return out
  }
  const L = makeLoop(left)
  const R = makeLoop(right)
  writeWav('chant_loop.wav', master([L, R], SR, BED), SR)
}

// ---------- 12. cavern impulse response (stereo) ----------
// Early-reflection cluster in the first ~80 ms, then a dual-slope exponential
// noise tail (~2.8 s) with progressive lowpass tilt. L/R render from their own
// decorrelated seeds for width; the runtime convolver normalizes level itself.
{
  const n = secs(2.8)
  const mkChannel = seed => {
    const irRng = mulberry32(seed)
    const out = new Float32Array(n)
    // late body: dual-slope decaying noise (fast bloom, long tail) with a
    // progressive lowpass tilt as the cavern eats the highs
    let lp = 0
    let lpK = 1
    for (let i = 0; i < n; i++) {
      const t = i / SR
      if (i % 128 === 0) {
        // recompute one-pole coefficient
        const fc = 300 + 7000 * Math.exp(-t / 1.1)
        lpK = 1 - Math.exp((-TAU * fc) / SR)
      }
      const env = 0.65 * Math.exp(-t / 0.28) + 0.35 * Math.exp(-t / 0.95)
      const x = (irRng() * 2 - 1) * env
      lp += (x - lp) * lpK
      out[i] = lp
    }
    // early-reflection cluster: discrete taps through the first ~80 ms
    for (let k = 0; k < 9; k++) {
      const at = 0.008 + 0.072 * Math.pow(k / 8, 1.3) + irRng() * 0.004
      const start = Math.min(n - 1, secs(at))
      const g = 0.55 * Math.pow(0.78, k) * (irRng() < 0.5 ? -1 : 1)
      for (let i = 0; i < secs(0.0016); i++) {
        if (start + i < n) out[start + i] += (irRng() * 2 - 1) * g
      }
    }
    // zero the direct-sound head (predelay), Hann-fade the tail
    for (let i = 0; i < secs(0.005); i++) out[i] = 0
    const fadeN = secs(0.2)
    for (let i = 0; i < fadeN; i++) {
      out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeN)
    }
    return out
  }
  writeWav('ir_cavern.wav', master([mkChannel(0xca7e01), mkChannel(0xca7e02)], SR, ONESHOT), SR)
}

// ---------- 13. trip drone (mono, seamless) — the DMT-trip bed ----------
// Deep didgeridoo-adjacent drone: band-limited saw fundamental with slow
// breath vibrato, loop-periodic formant sweep, a subharmonic under-voice and
// a faint overtone whistle. Everything organic — no synth edges.
{
  const LOOP = 8
  const renderN = secs(LOOP + 2)
  const out = new Float32Array(renderN)
  let phase = 0
  for (let i = 0; i < renderN; i++) {
    const t = i / SR
    const vib = 1 + 0.004 * Math.sin((TAU * 2 * t) / LOOP) + 0.002 * Math.sin(TAU * 4.7 * t)
    const f = 55 * vib
    phase += (TAU * f) / SR
    let saw = 0
    for (let k = 1; k <= 25; k++) saw += Math.sin(k * phase) / k
    saw *= 2 / Math.PI
    const growl = 1 + 0.22 * Math.sin(TAU * 8.2 * t)
    const sub = 0.18 * Math.sin(phase / 2)
    out[i] = (saw * 0.75 + 0.35 * Math.sin(phase) + sub) * growl
  }
  // loop-periodic formant morph (throat cavity slowly opening)
  const fA = biquad('peaking', 210, 5, 11, SR)
  const fB = biquad('peaking', 660, 5, 9, SR)
  for (let i = 0; i < renderN; i++) {
    const t = i / SR
    if (i % 64 === 0) {
      const m = 0.5 - 0.5 * Math.cos((TAU * t) / LOOP)
      setCoeffs(fA, 'peaking', 210 + 160 * m, 5, 11, SR)
      setCoeffs(fB, 'peaking', 660 + 380 * m, 5, 9, SR)
    }
    out[i] = tick(fB, tick(fA, out[i])) * 0.4
  }
  // faint overtone whistle riding the opposite phase of the morph
  for (let i = 0; i < renderN; i++) {
    const t = i / SR
    const w = 0.5 - 0.5 * Math.cos((TAU * t) / LOOP + Math.PI)
    out[i] += 0.045 * w * Math.sin(TAU * 550 * t + 0.3 * Math.sin(TAU * 0.9 * t))
  }
  tanhSat(out, 1.6)
  filterBuf(out, 'lowpass', 2600, 0.7, 0, SR)
  const loopN = secs(LOOP)
  const fadeN = secs(2)
  const looped = new Float32Array(loopN)
  for (let i = 0; i < loopN; i++) {
    if (i < fadeN) {
      const w = ((i / fadeN) * Math.PI) / 2
      looped[i] = Math.sin(w) * out[i] + Math.cos(w) * out[i + loopN]
    } else {
      looped[i] = out[i]
    }
  }
  writeWav('trip_drone.wav', master([looped], SR, BED), SR)
}

// ---------- 14. trip shimmer (mono, seamless) — high spirit-voices layer ----------
// Bowed-metal inharmonic partials swelling independently + airy breath. Joins
// above the drone only deep in the trip.
{
  const LOOP = 8
  const renderN = secs(LOOP + 2)
  const out = new Float32Array(renderN)
  const partials = [
    [622, 0.9, 0.11],
    [933, 0.7, 0.17],
    [1244, 0.8, 0.23],
    [1866, 0.5, 0.31],
    [2280, 0.35, 0.41],
  ]
  for (const [f, amp, rate] of partials) {
    const p0 = rng() * TAU
    const swellPhase = rng() * TAU
    const det = 1 + (rng() * 2 - 1) * 0.004
    for (let i = 0; i < renderN; i++) {
      const t = i / SR
      // integer swell cycles per loop so the seam stays coherent
      const cycles = Math.max(1, Math.round(rate * LOOP))
      const swell = Math.pow(0.5 - 0.5 * Math.cos((TAU * cycles * t) / LOOP + swellPhase), 2)
      out[i] += amp * swell * Math.sin(TAU * f * det * t + p0 + 0.2 * Math.sin(TAU * 0.7 * t))
    }
  }
  const breath = noiseBuf(renderN)
  filterBuf(breath, 'bandpass', 3300, 1.1, 0, SR)
  for (let i = 0; i < renderN; i++) {
    const t = i / SR
    const w = 0.5 - 0.5 * Math.cos((TAU * 2 * t) / LOOP)
    out[i] = out[i] * 0.25 + breath[i] * 0.05 * w
  }
  const loopN = secs(LOOP)
  const fadeN = secs(2)
  const looped = new Float32Array(loopN)
  for (let i = 0; i < loopN; i++) {
    if (i < fadeN) {
      const w = ((i / fadeN) * Math.PI) / 2
      looped[i] = Math.sin(w) * out[i] + Math.cos(w) * out[i + loopN]
    } else {
      looped[i] = out[i]
    }
  }
  writeWav('trip_shimmer.wav', master([looped], SR, BED), SR)
}

// ---------- 15. heart beat — lub-dub, accelerates as the drop nears ----------
{
  const n = secs(0.7)
  const out = new Float32Array(n)
  const thump = (start, f0, gain, decay) => {
    const s0 = secs(start)
    let ph = 0
    for (let i = 0; s0 + i < n; i++) {
      const t = i / SR
      const f = 38 + (f0 - 38) * Math.exp(-t / 0.02)
      ph += (TAU * f) / SR
      out[s0 + i] += gain * Math.sin(ph) * Math.min(1, t / 0.003) * Math.exp(-t / decay)
    }
  }
  // sub layer: a ~30 Hz shadow under each thud
  const sub = (start, gain, decay) => {
    const s0 = secs(start)
    let ph = 0
    for (let i = 0; s0 + i < n; i++) {
      const t = i / SR
      const f = 26 + 9 * Math.exp(-t / 0.05)
      ph += (TAU * f) / SR
      out[s0 + i] += gain * Math.sin(ph) * Math.min(1, t / 0.005) * Math.exp(-t / decay)
    }
  }
  thump(0, 64, 1.0, 0.085) // lub
  thump(0.3, 54, 0.7, 0.07) // dub
  sub(0, 0.55, 0.12)
  sub(0.3, 0.4, 0.1)
  tanhSat(out, 1.8)
  filterBuf(out, 'lowpass', 320, 0.7, 0, SR)
  writeWav('heart_beat.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 16. trip horn — conch swell for trip entry ----------
{
  const n = secs(2.4)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const scoop = 0.94 + 0.06 * Math.min(1, t / 0.5) // shell horn pitch scoop
    const f = 98 * scoop * (1 + 0.003 * Math.sin(TAU * 4.6 * t))
    phase += (TAU * f) / SR
    let tone = 0
    for (let k = 1; k <= 8; k++) tone += Math.sin(k * phase) / Math.pow(k, 1.3)
    const env =
      t < 0.6 ? Math.pow(t / 0.6, 1.6) : t < 1.5 ? 1 : Math.exp(-(t - 1.5) / 0.35)
    out[i] = tone * env
  }
  const breath = noiseBuf(n)
  filterBuf(breath, 'bandpass', 700, 1.0, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = t < 0.6 ? Math.pow(t / 0.6, 1.6) : t < 1.5 ? 1 : Math.exp(-(t - 1.5) / 0.35)
    out[i] = out[i] * 0.8 + breath[i] * 0.07 * env
  }
  tanhSat(out, 1.7)
  filterBuf(out, 'lowpass', 2400, 0.7, 0, SR)
  writeWav('trip_horn.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 17. horror hiss — an inhale through teeth (the latch threat) ----------
// APPEND-ONLY ZONE: recipes 17+ were added for the horror-combat kit. New
// recipes must append after every existing one so the shared RNG stream order
// stays stable across the kit.
function bakeHorrorHiss(file, seedJitter) {
  const n = secs(0.45)
  const out = noiseBuf(n)
  // inverse breath: a bandpass swept DOWN 2600 -> 650 Hz with a 9 Hz flutter,
  // plus a counter-band climbing 700 -> 1900 Hz so the breath writhes
  const bp = biquad('bandpass', 2600, 1.4, 0, SR)
  const bp2 = biquad('bandpass', 700, 1.8, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 650 + (2600 - 650) * Math.exp(-t / 0.16) * (1 + 0.12 * Math.sin(TAU * 9 * t + seedJitter))
    setCoeffs(bp, 'bandpass', f, 1.4, 0, SR)
    const f2 = 700 + (1900 - 700) * Math.min(1, t / 0.3) * (1 + 0.1 * Math.sin(TAU * 7 * t + seedJitter * 1.7))
    setCoeffs(bp2, 'bandpass', f2, 1.8, 0, SR)
    const env = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.22)
    const wobble = 0.75 + 0.25 * Math.sin(TAU * 5.3 * t + seedJitter)
    out[i] = (tick(bp, out[i]) + 0.5 * tick(bp2, out[i])) * env * wobble
  }
  filterBuf(out, 'highpass', 300, 0.7, 0, SR)
  writeWav(file, master([edgeFades(out, SR)], SR, ONESHOT), SR)
}
bakeHorrorHiss('horror_hiss_1.wav', 0.0)
bakeHorrorHiss('horror_hiss_2.wav', 2.1)

// ---------- 18. bone snap — a kill's dry crack ----------
// Crack modes + the low body resonance of the mass that snapped, scattered
// subtly across two ears (detuned body, 0.5 ms right-ear lag).
{
  const n = secs(0.14)
  const mkEar = det => {
    const body = modalStrike(
      n,
      [
        [620 * det, 1.0, 0.03],
        [990 * det, 0.5, 0.02],
        [1480 * det, 0.25, 0.012],
        [210 * det, 0.5, 0.05],
        [330 * det, 0.25, 0.03],
      ],
      SR,
      0.015,
    )
    const knock = noiseBuf(secs(0.02))
    filterBuf(knock, 'lowpass', 2400, 0.8, 0, SR)
    for (let i = 0; i < knock.length; i++) knock[i] *= Math.exp(-(i / SR) / 0.006)
    mixInto(body, knock, 0.8)
    return body
  }
  const L = mkEar(1.0)
  const R = mkEar(1.004)
  const lag = secs(0.0005)
  const Rs = new Float32Array(n)
  for (let i = lag; i < n; i++) Rs[i] = R[i - lag]
  tanhSat(L, 1.8)
  tanhSat(Rs, 1.8)
  writeWav('bone_snap.wav', master([edgeFades(L, SR), edgeFades(Rs, SR)], SR, ONESHOT), SR)
}

// ---------- 19. latch gnaw — seamless wet bone-scrape bed (dread loop) ----------
{
  const GEN = 4
  const LOOP = 2
  const n = secs(GEN)
  const out = new Float32Array(n)
  // sparse granular scrape: ~120 short lowpassed grains per second
  const grainN = secs(0.014)
  const grains = Math.round(GEN * 120)
  for (let g = 0; g < grains; g++) {
    const at = Math.floor(rng() * (n - grainN))
    const gain = 0.25 + 0.75 * rng()
    const f = 500 + rng() * 900
    const grain = noiseBuf(grainN)
    filterBuf(grain, 'bandpass', f, 2.2, 0, SR)
    normalize(grain, 1) // bandpass peak-gain is Q-dependent; pin grain peaks
    for (let i = 0; i < grainN; i++) {
      const w = Math.sin((Math.PI * i) / grainN)
      out[at + i] += grain[i] * gain * w * 0.4
    }
  }
  filterBuf(out, 'lowpass', 2000, 0.7, 0, SR)
  // tame grain-stack spikes so the bed stages cleanly under the limiter
  tanhSat(out, 3)
  // slow chew swell so the bed breathes at ~1.4 Hz
  for (let i = 0; i < n; i++) {
    const t = i / SR
    out[i] *= 0.55 + 0.45 * (0.5 - 0.5 * Math.cos(TAU * 1.4 * t))
  }
  // crossfade-loop (trip_shimmer idiom): equal-power blend of head and tail
  const loopN = secs(LOOP)
  const fadeN = secs(0.8)
  const looped = new Float32Array(loopN)
  for (let i = 0; i < loopN; i++) {
    if (i < fadeN) {
      const w = ((i / fadeN) * Math.PI) / 2
      looped[i] = Math.sin(w) * out[i] + Math.cos(w) * out[i + loopN]
    } else {
      looped[i] = out[i]
    }
  }
  writeWav('latch_gnaw_loop.wav', master([looped], SR, BED), SR)
}

// ---------- 20. warden roar — didge-voiced growl over a gong sub ----------
// Layered sub-octave growl + formant resonance + breath noise.
{
  const n = secs(2.4)
  const out = new Float32Array(n)
  let phase = 0
  let subPh = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // deep fundamental with a 6.5 Hz throat growl, plus a sub-octave shadow
    const f = 38 * (1 + 0.06 * Math.sin(TAU * 6.5 * t)) * (1 + 0.04 * Math.min(1, t / 0.4))
    phase += (TAU * f) / SR
    subPh += (TAU * f * 0.5) / SR
    let tone = 0
    for (let k = 1; k <= 10; k++) tone += Math.sin(k * phase) / Math.pow(k, 1.15)
    const growlAM = 1 + 0.3 * Math.sin(TAU * 6.5 * t + 1.1)
    const env = t < 0.35 ? Math.pow(t / 0.35, 1.4) : t < 1.6 ? 1 : Math.exp(-(t - 1.6) / 0.4)
    out[i] = (tone + 0.7 * Math.sin(subPh) * growlAM) * env
  }
  // formant peaks give it a mouth
  filterBuf(out, 'peaking', 180, 1.6, 9, SR)
  filterBuf(out, 'peaking', 620, 2.2, 7, SR)
  tanhSat(out, 2.4)
  // gong sub layer under the throat
  const sub = modalStrike(n, [[52, 1.0, 0.9], [83, 0.5, 0.7], [124, 0.3, 0.5]], SR, 0.01)
  // breath through the teeth, riding the same envelope
  const breath = noiseBuf(n)
  filterBuf(breath, 'bandpass', 1100, 0.9, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = t < 0.35 ? Math.pow(t / 0.35, 1.4) : t < 1.6 ? 1 : Math.exp(-(t - 1.6) / 0.4)
    out[i] = out[i] * 0.8 + sub[i] * 0.35 * Math.min(1, t / 0.2) + breath[i] * 0.08 * env
  }
  filterBuf(out, 'lowpass', 1800, 0.7, 0, SR)
  writeWav('warden_roar.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 21. bow draw loop — seamless sinew-creak + rising shimmer ----------
// Rate-ramped 0.9..1.4 in-game, so one loop covers the whole draw.
{
  const GEN = 2.4
  const LOOP = 1.2
  const n = secs(GEN)
  const out = new Float32Array(n)
  // sinew creak: sparse slow bandpassed stick-slip grains
  const grainN = secs(0.03)
  const grains = Math.round(GEN * 46)
  for (let g = 0; g < grains; g++) {
    const at = Math.floor(rng() * (n - grainN))
    const f = 260 + rng() * 340
    const grain = noiseBuf(grainN)
    filterBuf(grain, 'bandpass', f, 5, 0, SR)
    for (let i = 0; i < grainN; i++) {
      const w = Math.sin((Math.PI * i) / grainN)
      out[at + i] += grain[i] * (0.3 + 0.7 * rng()) * w * 0.5
    }
  }
  // taut-string shimmer: two detuned high partials breathing at ~0.7 Hz
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const breathe = 0.5 - 0.5 * Math.cos(TAU * 0.7 * t)
    out[i] +=
      (Math.sin(TAU * 1244 * t) * 0.045 + Math.sin(TAU * 1867 * t) * 0.03) * breathe
  }
  filterBuf(out, 'lowpass', 3200, 0.7, 0, SR)
  // crossfade-loop (latch_gnaw idiom)
  const loopN = secs(LOOP)
  const fadeN = secs(0.45)
  const looped = new Float32Array(loopN)
  for (let i = 0; i < loopN; i++) {
    if (i < fadeN) {
      const w = ((i / fadeN) * Math.PI) / 2
      looped[i] = Math.sin(w) * out[i] + Math.cos(w) * out[i + loopN]
    } else {
      looped[i] = out[i]
    }
  }
  writeWav('bow_draw_loop.wav', master([looped], SR, BED), SR)
}

// ---------- 22. heavy release — sub thump + air-rip + modal twang ----------
{
  const n = secs(0.7)
  const out = new Float32Array(n)
  // sub thump (frame_drum_sub recipe, lower fundamental)
  const sub = modalStrike(n, [[40, 1.0, 0.22], [64, 0.5, 0.14], [96, 0.28, 0.09]], SR, 0.008)
  mixInto(out, sub, 1)
  // air rip: highpassed noise burst tearing away
  const rip = noiseBuf(secs(0.22))
  filterBuf(rip, 'highpass', 900, 0.8, 0, SR)
  for (let i = 0; i < rip.length; i++) rip[i] *= Math.exp(-(i / SR) / 0.06)
  mixInto(out, rip, 0.55)
  // string twang: short stiff modes
  const twang = modalStrike(secs(0.3), [[311, 1.0, 0.05], [622, 0.45, 0.035], [934, 0.2, 0.02]], SR, 0.004)
  mixInto(out, twang, 0.5)
  tanhSat(out, 1.7)
  filterBuf(out, 'lowpass', 5200, 0.7, 0, SR)
  writeWav('heavy_release.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// ---------- 23. arcane impact — modal thud + crystalline debris tail ----------
{
  const n = secs(1.1)
  const out = new Float32Array(n)
  const thud = modalStrike(n, [[168, 1.0, 0.07], [255, 0.6, 0.05], [402, 0.3, 0.03]], SR, 0.006)
  mixInto(out, thud, 1)
  // crystalline debris: ringing high grains scattered over a long tail
  const shards = 26
  for (let s = 0; s < shards; s++) {
    const at = Math.floor(secs(0.02 + rng() * 0.75))
    const f = 1400 + rng() * 3400
    const decay = 0.025 + rng() * 0.09
    const len = secs(decay * 4)
    const g = 0.14 * (0.4 + 0.6 * rng())
    const ph0 = rng() * TAU
    for (let i = 0; i < len && at + i < n; i++) {
      const t = i / SR
      out[at + i] += Math.sin(TAU * f * t + ph0) * Math.exp(-t / decay) * g
    }
  }
  // glassy air band decaying under the shards
  const air = noiseBuf(n)
  filterBuf(air, 'bandpass', 5600, 1.4, 0, SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    air[i] *= Math.min(1, t / 0.01) * Math.exp(-t / 0.28)
  }
  mixInto(out, air, 0.1)
  tanhSat(out, 1.5)
  writeWav('arcane_impact.wav', master([edgeFades(out, SR)], SR, ONESHOT), SR)
}

// Budget raised 3.5 MB -> 6.5 MB with the 44.1 kHz remaster: every sample now
// bakes at full rate (loops roughly doubled in size) and the IR grew a 2.8 s
// stereo tail. If it ever overflows, trim tail durations — never sample rate.
console.log(
  `total ${(totalBytes / 1048576).toFixed(2)} MB${totalBytes > 6.5 * 1048576 ? '  ⚠ OVER 6.5 MB BUDGET' : ''}`,
)
