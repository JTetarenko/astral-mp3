// Bakes the game's procedural texture assets into public/assets/*.png.
// Dependency-free: value-noise/fBm generators + a minimal PNG encoder (zlib is built in).
// Re-run with `npm run bake` after tweaking parameters. Deterministic per seed.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets')
fs.mkdirSync(OUT_DIR, { recursive: true })

// ---------- minimal PNG encoder (8-bit RGBA, no filtering) ----------

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0 // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  fs.writeFileSync(path.join(OUT_DIR, file), png)
  console.log(`baked ${file} (${width}x${height}, ${(png.length / 1024).toFixed(0)} kB)`)
}

// ---------- noise toolkit (tileable value noise + fBm + domain warp) ----------

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 144665) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = t => t * t * t * (t * (t * 6 - 15) + 10)

/** Value noise on a lattice that wraps at `period` cells in both axes. */
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const w = v => ((v % period) + period) % period
  const a = hash2(w(xi), w(yi), seed)
  const b = hash2(w(xi + 1), w(yi), seed)
  const c = hash2(w(xi), w(yi + 1), seed)
  const d = hash2(w(xi + 1), w(yi + 1), seed)
  const u = smooth(xf)
  const v = smooth(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x, y, period, seed, octaves = 5, gain = 0.5) {
  let sum = 0
  let amp = 1
  let norm = 0
  let p = period
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x, y, p, seed + o * 101) * amp
    norm += amp
    amp *= gain
    x *= 2
    y *= 2
    p *= 2
  }
  return sum / norm
}

const clamp01 = v => Math.max(0, Math.min(1, v))

const smoothstepJs = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// ---------- glyph toolkit (shared by runes.png and rune_emissive.png) ----------

// Each glyph: polyline strokes in 0..1 cell coordinates.
const GLYPHS = [
  [[[0.5, 0.08], [0.88, 0.75], [0.12, 0.75], [0.5, 0.08]], [[0.5, 0.75], [0.5, 0.95]]],
  [[[0.5, 0.05], [0.85, 0.5], [0.5, 0.95], [0.15, 0.5], [0.5, 0.05]], [[0.15, 0.5], [0.85, 0.5]]],
  [[[0.2, 0.1], [0.8, 0.1], [0.2, 0.5], [0.8, 0.5], [0.2, 0.9], [0.8, 0.9]]],
  [[[0.5, 0.05], [0.5, 0.95]], [[0.2, 0.3], [0.5, 0.55], [0.8, 0.3]], [[0.2, 0.6], [0.5, 0.85], [0.8, 0.6]]],
  [[[0.15, 0.1], [0.85, 0.1], [0.15, 0.9], [0.85, 0.9]], [[0.15, 0.1], [0.15, 0.35]], [[0.85, 0.65], [0.85, 0.9]]],
  [[[0.5, 0.05], [0.5, 0.95]], [[0.15, 0.25], [0.85, 0.25]], [[0.3, 0.05], [0.15, 0.25]], [[0.7, 0.05], [0.85, 0.25]]],
  [[[0.2, 0.9], [0.5, 0.1], [0.8, 0.9]], [[0.32, 0.58], [0.68, 0.58]], [[0.5, 0.58], [0.5, 0.9]]],
  [[[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85], [0.15, 0.15]], [[0.15, 0.15], [0.85, 0.85]]],
  [[[0.5, 0.05], [0.85, 0.3], [0.85, 0.7], [0.5, 0.95], [0.15, 0.7], [0.15, 0.3], [0.5, 0.05]], [[0.5, 0.3], [0.5, 0.7]]],
  [[[0.15, 0.5], [0.85, 0.5]], [[0.35, 0.2], [0.35, 0.8]], [[0.65, 0.2], [0.65, 0.8]]],
  [[[0.5, 0.05], [0.2, 0.95]], [[0.5, 0.05], [0.8, 0.95]], [[0.32, 0.55], [0.68, 0.55]]],
  [[[0.2, 0.2], [0.8, 0.2]], [[0.5, 0.2], [0.5, 0.6]], [[0.3, 0.6], [0.7, 0.6]], [[0.3, 0.6], [0.2, 0.9]], [[0.7, 0.6], [0.8, 0.9]]],
]

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = clamp01(t)
  const gx = ax + dx * t - px
  const gy = ay + dy * t - py
  return Math.sqrt(gx * gx + gy * gy)
}

// ---------- 1. mist.png — equirect murky void: layered horizontal mist bands ----------
{
  const W = 1024
  const H = 512
  const rgba = Buffer.alloc(W * H * 4)
  const P = 8 // lattice cells across the seam-free wrap
  for (let y = 0; y < H; y++) {
    const v = y / H
    const poleFade = Math.pow(Math.sin(v * Math.PI), 0.6)
    // mist pools below the horizon; the upper void stays near-empty
    const horizonBias = 0.35 + 0.65 * smoothstepJs(0.25, 0.75, v)
    for (let x = 0; x < W; x++) {
      const u = x / W
      const nx = u * P
      const ny = v * P * 2.6 // vertical compression -> horizontally stretched bands
      // gentle domain warp, deliberately NON-ridged: rolling banks, not filaments
      const wx = fbm(nx + 13.7, ny, P, 7, 4) * 1.5
      const wy = fbm(nx, ny + 71.3, P, 11, 4) * 1.5
      let n = fbm(nx + wx, ny + wy, P, 3, 5)
      n = Math.pow(clamp01(n), 1.6) * poleFade * horizonBias
      const g = Math.round(clamp01(n * 0.8) * 255)
      const i = (y * W + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
      rgba[i + 3] = 255
    }
  }
  writePng('mist.png', W, H, rgba)
}

// ---------- 2. stars.png — deep star field + inclined galactic band ----------
// Replaced void_motes.png (140 one-pixel dots): three PSF classes (70%
// pinpoint / 25% soft / 5% bright with a faint 4-arm cross), per-star color
// temperature (baked RGB so warmth survives the additive tint), and a
// filamentary band with its own dense dim-star lane.
{
  const W = 2048
  const H = 1024
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  const put = (x, y, r, g, b) => {
    // wrap in x (the equirect seam), clamp in y (poles)
    const px = ((Math.round(x) % W) + W) % W
    const py = Math.round(y)
    if (py < 0 || py >= H) return
    const i = (py * W + px) * 4
    rgba[i] = Math.min(255, rgba[i] + r)
    rgba[i + 1] = Math.min(255, rgba[i + 1] + g)
    rgba[i + 2] = Math.min(255, rgba[i + 2] + b)
  }
  let s = 987654
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  // temperature ramp: warm amber -> white -> ice blue
  const tempRgb = t => {
    if (t < 0.5) {
      const k = t / 0.5
      return [1, 0.82 + 0.18 * k, 0.62 + 0.38 * k]
    }
    const k = (t - 0.5) / 0.5
    return [1 - 0.3 * k, 1 - 0.17 * k, 1]
  }
  const splat = (x, y, peak, sigma, col) => {
    const rad = Math.ceil(sigma * 3.2)
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const g = peak * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
        if (g < 0.75) continue
        put(x + dx, y + dy, g * col[0], g * col[1], g * col[2])
      }
    }
  }
  const cross = (x, y, peak, arm, col) => {
    for (let d = 1; d <= arm; d++) {
      const g = peak * Math.exp(-d * 1.1)
      if (g < 1) break
      put(x + d, y, g * col[0], g * col[1], g * col[2])
      put(x - d, y, g * col[0], g * col[1], g * col[2])
      put(x, y + d, g * col[0], g * col[1], g * col[2])
      put(x, y - d, g * col[0], g * col[1], g * col[2])
    }
  }
  const star = (x, y, mag) => {
    const col = tempRgb(rnd())
    const cls = rnd()
    if (cls < 0.7) splat(x, y, 40 + mag * 60, 0.7, col)
    else if (cls < 0.95) splat(x, y, 55 + mag * 85, 1.3, col)
    else {
      const peak = 140 + mag * 95
      splat(x, y, peak, 2.0, col)
      cross(x, y, peak * 0.25, 4 + Math.round(mag * 3), col)
    }
  }
  // field stars — uniform-on-sphere row bias, like the old motes
  for (let n = 0; n < 1200; n++) {
    star(rnd() * W, (Math.acos(2 * rnd() - 1) / Math.PI) * H, Math.pow(rnd(), 2.2))
  }
  // inclined galactic band: anisotropic filament glow around a sine great
  // circle (features stretched along u), peak ~22/255 under the tint
  const latC = u => 0.5 + 0.18 * Math.sin(2 * Math.PI * (u - 0.13))
  const P = 10
  for (let y = 0; y < H; y++) {
    const v = y / H
    for (let x = 0; x < W; x++) {
      const u = x / W
      const d = (v - latC(u)) / 0.055
      const env = Math.exp(-d * d)
      if (env < 0.01) continue
      const tex = 0.55 + 0.45 * fbm(u * P, v * P * 3, P, 271, 5)
      const g = env * tex * 22
      const i = (y * W + x) * 4
      rgba[i] = Math.min(255, rgba[i] + g * 0.9)
      rgba[i + 1] = Math.min(255, rgba[i + 1] + g * 0.95)
      rgba[i + 2] = Math.min(255, rgba[i + 2] + g)
    }
  }
  // the band's own dim-star lane, triangular spread about the centerline
  for (let n = 0; n < 500; n++) {
    const u = rnd()
    const gy = (rnd() + rnd() + rnd() - 1.5) / 1.5
    star(u * W, (latC(u) + gy * 0.05) * H, Math.pow(rnd(), 3) * 0.6)
  }
  writePng('stars.png', W, H, rgba)
}

// ---------- 2b. nebula_b.png — ridged filament shell (mist's structural opposite) ----------
// The second nebula sphere finally gets its own structure: sharpened ridged
// filaments clustered by a coarse cell mask, arcing HIGH where mist pools low
// — the counter-rotating shells now read as different atmospheric layers.
{
  const W = 1024
  const H = 512
  const rgba = Buffer.alloc(W * H * 4)
  const P = 5
  for (let y = 0; y < H; y++) {
    const v = y / H
    const poleFade = Math.pow(Math.sin(v * Math.PI), 0.6)
    // inverted horizon bias vs mist
    const highBias = 0.55 + 0.45 * smoothstepJs(0.75, 0.25, v)
    for (let x = 0; x < W; x++) {
      const u = x / W
      const nx = u * P
      const ny = v * P
      const wx = fbm(nx + 5.2, ny + 1.7, P, 601, 4) * 2.5
      const wy = fbm(nx + 2.9, ny + 8.4, P, 603, 4) * 2.5
      const n = fbm(nx + wx, ny + wy, P, 605, 5)
      let r = 1 - Math.abs(2 * n - 1)
      r = Math.pow(clamp01(r), 5)
      // coarse cell mask carves holes: filaments cluster instead of carpeting
      const mask = smoothstepJs(0.35, 0.75, fbm(u * 3, v * 3, 3, 607, 3))
      const g = Math.round(clamp01(r * mask * poleFade * highBias * 1.5) * 255)
      const i = (y * W + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
      rgba[i + 3] = 255
    }
  }
  writePng('nebula_b.png', W, H, rgba)
}

// ---------- 3. rock_normal.png — tileable normal map from fBm height ----------

/** The one rock height field — rock_normal.png AND rock_albedo.png sample it,
 * so the albedo's cavity darkening CO-REGISTERS with the normal-map relief.
 * Extracting this must keep rock_normal.png byte-identical. */
const ROCK_P = 6
const rockHeight = (nx, ny) => {
  let h = fbm(nx, ny, ROCK_P, 41, 5)
  // crack-ish ridges layered on top
  const r = 1 - Math.abs(fbm(nx * 2 + 9, ny * 2 + 3, ROCK_P * 2, 43, 4) * 2 - 1)
  return h * 0.7 + Math.pow(r, 2.5) * 0.3
}

{
  const S = 512
  const P = ROCK_P
  const height = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      height[y * S + x] = rockHeight((x / S) * P, (y / S) * P)
    }
  }
  const rgba = Buffer.alloc(S * S * 4)
  const at = (x, y) => height[(((y % S) + S) % S) * S + (((x % S) + S) % S)]
  const STRENGTH = 2.2
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH
      const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * S + x) * 4
      rgba[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      rgba[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255)
      rgba[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      rgba[i + 3] = 255
    }
  }
  writePng('rock_normal.png', S, S, rgba)
}

// ---------- 3b. rock_albedo.png — tileable mineral albedo, cavity-darkened ----------
// Bright-mean (~0.74) by design: the map MULTIPLIES material.color (near-black
// palette.islandBase) x vertexColors (baked AO), so net island luminance stays
// within the tuned band while the surface finally carries mineral variation.
{
  const S = 512
  const rgba = Buffer.alloc(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / S) * ROCK_P
      const ny = (y / S) * ROCK_P
      const h = rockHeight(nx, ny)
      // cavities darken where the normal map recesses (co-registered field)
      const cavity = 1 - 0.45 * smoothstepJs(0.55, 0.25, h)
      // slow mineral tri-tone: cool basalt / neutral / warm iron bands
      const m = fbm(nx * 0.7 + 31, ny * 0.7 + 17, ROCK_P, 61, 4)
      const cool = smoothstepJs(0.55, 0.35, m)
      const warm = smoothstepJs(0.55, 0.75, m)
      let r = 0.75 * (1 - cool - warm) + 0.7 * cool + 0.8 * warm
      let g = 0.75 * (1 - cool - warm) + 0.74 * cool + 0.72 * warm
      let b = 0.75 * (1 - cool - warm) + 0.8 * cool + 0.66 * warm
      // sparse bright mineral flecks
      if (hash2(x, y, 909) > 0.995) {
        r += 0.1
        g += 0.1
        b += 0.1
      }
      const i = (y * S + x) * 4
      rgba[i] = Math.round(clamp01(r * cavity) * 255)
      rgba[i + 1] = Math.round(clamp01(g * cavity) * 255)
      rgba[i + 2] = Math.round(clamp01(b * cavity) * 255)
      rgba[i + 3] = 255
    }
  }
  writePng('rock_albedo.png', S, S, rgba)
}

// ---------- 4. runes.png — 4x3 atlas of angular glyphs (white on black) ----------
{
  const CELL = 128
  const COLS = 4
  const ROWS = 3
  const W = CELL * COLS
  const H = CELL * ROWS
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255

  const WIDTH_PX = 5
  const AA = 2
  GLYPHS.forEach((strokes, g) => {
    const cx = (g % COLS) * CELL
    const cy = Math.floor(g / COLS) * CELL
    const segs = []
    for (const line of strokes) {
      for (let i = 0; i < line.length - 1; i++) {
        segs.push([line[i][0] * CELL, line[i][1] * CELL, line[i + 1][0] * CELL, line[i + 1][1] * CELL])
      }
    }
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        let d = Infinity
        for (const [ax, ay, bx, by] of segs) {
          d = Math.min(d, distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by))
          if (d <= 0) break
        }
        const a = clamp01((WIDTH_PX / 2 + AA - d) / AA)
        // soft outer glow so the glyphs bloom nicely
        const glow = clamp01(1 - d / (WIDTH_PX * 2.2)) * 0.28
        const val = Math.round(clamp01(a + glow) * 255)
        if (val > 0) {
          const i = ((cy + y) * W + (cx + x)) * 4
          rgba[i] = Math.max(rgba[i], val)
          rgba[i + 1] = rgba[i]
          rgba[i + 2] = rgba[i]
        }
      }
    }
  })
  writePng('runes.png', W, H, rgba)
}

// ---------- 5. particle_soft.png — soft glow sprite with noisy breakup ----------

/** Shared soft-glow disc body — particle_soft.png AND the atlas GLOW cell use
 * this exact expression, so extracting it must keep both byte-identical. */
const softDiscVal = (x, y, S) => {
  const dx = (x + 0.5) / S - 0.5
  const dy = (y + 0.5) / S - 0.5
  const r = Math.sqrt(dx * dx + dy * dy) * 2
  const core = Math.exp(-r * r * 5)
  const halo = Math.exp(-r * r * 1.8) * 0.35
  // stronger breakup so ambient ash reads as irregular flakes, while
  // bursts/streams (many overlapping sprites) still average out to glow
  const breakup = 0.76 + 0.24 * fbm((x / S) * 4, (y / S) * 4, 4, 77, 3)
  return Math.round(clamp01((core + halo) * breakup) * 255)
}

{
  const S = 128
  const rgba = Buffer.alloc(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = softDiscVal(x, y, S)
      const i = (y * S + x) * 4
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  writePng('particle_soft.png', S, S, rgba)
}

// ---------- 6. aurora.png — horizontally tileable curtain ribbons ----------
{
  const W = 1024
  const H = 256
  const rgba = Buffer.alloc(W * H * 4)
  const P = 6
  for (let y = 0; y < H; y++) {
    const v = y / H
    const envelope = Math.pow(Math.sin(v * Math.PI), 1.4)
    const fringe = Math.pow(1 - v, 3) * 0.6
    for (let x = 0; x < W; x++) {
      const u = x / W
      // vertically-stretched ridged fBm = curtain folds (hard-sharpened so the
      // additive ribbon reads as sparse filaments, not a fog wall)
      const nx = u * P
      const ny = v * 0.25 * P
      let r = 1 - Math.abs(fbm(nx, ny, P, 57, 4) * 2 - 1)
      r = Math.pow(clamp01(r), 7)
      const val = clamp01(r * envelope * 1.6 + fringe * r)
      const g = Math.round(val * 255)
      const i = (y * W + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
      rgba[i + 3] = g
    }
  }
  writePng('aurora.png', W, H, rgba)
}

// ---------- 7. beam.png — godray cone streaks (length fade x tileable streak noise) ----------
{
  const S = 256
  const rgba = Buffer.alloc(S * S * 4)
  const P = 5
  for (let y = 0; y < S; y++) {
    const v = y / S
    const fade = Math.pow(1 - v, 1.8)
    for (let x = 0; x < S; x++) {
      const u = x / S
      const streaks = 0.75 + 0.25 * fbm(u * P, 0.5, P, 91, 3) // u-tileable, v-constant streaks
      const val = clamp01(fade * streaks)
      const g = Math.round(val * 255)
      const i = (y * S + x) * 4
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = g
    }
  }
  writePng('beam.png', S, S, rgba)
}

// ---------- 8. shimmer_noise.png — 3-channel tileable fBm for shader domain warp ----------
{
  const S = 256
  const rgba = Buffer.alloc(S * S * 4)
  const P = 4
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / S) * P
      const ny = (y / S) * P
      const i = (y * S + x) * 4
      rgba[i] = Math.round(clamp01(fbm(nx, ny, P, 201, 4)) * 255)
      rgba[i + 1] = Math.round(clamp01(fbm(nx + 37, ny + 11, P, 211, 4)) * 255)
      rgba[i + 2] = Math.round(clamp01(fbm(nx + 91, ny + 53, P, 221, 4)) * 255)
      rgba[i + 3] = 255
    }
  }
  writePng('shimmer_noise.png', S, S, rgba)
}

// ---------- 9. clouds.png — tileable soft cloud sea (RGB shading + A coverage) ----------
{
  const S = 512
  const P = 6
  const rgba = Buffer.alloc(S * S * 4)
  const sstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / S) * P
      const ny = (y / S) * P
      // gentle domain warp, deliberately non-ridged: billowing banks, not wisps
      const wx = fbm(nx + 5.2, ny + 1.3, P, 301, 4) * 1.8
      const wy = fbm(nx + 1.7, ny + 9.2, P, 307, 4) * 1.8
      const n = fbm(nx + wx, ny + wy, P, 311, 5)
      const cover = Math.pow(sstep(0.35, 0.85, n), 1.6)
      const shade = 0.55 + 0.45 * n
      const g = Math.round(clamp01(shade) * 255)
      const i = (y * S + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
      rgba[i + 3] = Math.round(cover * 255)
    }
  }
  writePng('clouds.png', S, S, rgba)
}

// ---------- 10. comet.png — streak sprite: gaussian head + exponential tail ----------
{
  const W = 128
  const H = 64
  const rgba = Buffer.alloc(W * H * 4)
  const P = 4
  for (let y = 0; y < H; y++) {
    const v = y / H - 0.5
    for (let x = 0; x < W; x++) {
      const u = x / W
      const du = (u - 0.15) * 2.2
      const head = Math.exp(-(du * du + v * v * 14) * 9)
      const tail = u > 0.15 ? Math.exp(-(u - 0.15) * 5) * Math.exp(-v * v * 26) * 0.6 : 0
      const streak = 0.8 + 0.2 * fbm(u * P, (v + 0.5) * P * 0.5, P, 401, 3)
      const g = Math.round(clamp01((head + tail) * streak) * 255)
      const i = (y * W + x) * 4
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = g
    }
  }
  writePng('comet.png', W, H, rgba)
}

// ---------- 11. rune_emissive.png — tileable obsidian rune-vein emission mask ----------
// Grayscale: thin ridged crack veins + a few stamped glyphs, soft-glowed so the
// island emissive layer blooms moss-green where the mask is lit.
{
  const S = 512
  const P = 6
  const rgba = Buffer.alloc(S * S * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255

  // vein layer: domain-warped ridged fBm, sharpened to thin cracks
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / S) * P
      const ny = (y / S) * P
      const wx = fbm(nx + 3.1, ny + 8.7, P, 501, 4) * 1.6
      const wy = fbm(nx + 9.4, ny + 2.2, P, 503, 4) * 1.6
      const n = fbm(nx + wx, ny + wy, P, 505, 4)
      const ridge = 1 - Math.abs(2 * n - 1)
      const vein = Math.pow(clamp01(ridge), 9)
      const halo = Math.pow(clamp01(ridge), 3) * 0.12 // faint wide glow around veins
      // knee keeps only the strongest cracks so most of the rock stays dark
      const v = clamp01((vein - 0.22) / 0.78) * 0.85 + halo
      const g = Math.round(clamp01(v) * 255)
      const i = (y * S + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
    }
  }

  // glyph stamps: seeded positions/rotations, wrapped writes keep tileability
  let s = 9911
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const STAMPS = 7
  const WIDTH_PX = 3
  const AA = 1.5
  for (let k = 0; k < STAMPS; k++) {
    const glyph = GLYPHS[Math.floor(rnd() * GLYPHS.length) % GLYPHS.length]
    const cell = 52 + Math.floor(rnd() * 14)
    const x0 = Math.floor(rnd() * S)
    const y0 = Math.floor(rnd() * S)
    const rot = Math.floor(rnd() * 4)
    const xf = (px, py) => {
      if (rot === 1) return [1 - py, px]
      if (rot === 2) return [1 - px, 1 - py]
      if (rot === 3) return [py, 1 - px]
      return [px, py]
    }
    const segs = []
    for (const line of glyph) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = xf(line[i][0], line[i][1])
        const [bx, by] = xf(line[i + 1][0], line[i + 1][1])
        segs.push([ax * cell, ay * cell, bx * cell, by * cell])
      }
    }
    for (let y = -4; y < cell + 4; y++) {
      for (let x = -4; x < cell + 4; x++) {
        let d = Infinity
        for (const [ax, ay, bx, by] of segs) {
          d = Math.min(d, distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by))
        }
        const a = clamp01((WIDTH_PX / 2 + AA - d) / AA)
        const glow = clamp01(1 - d / (WIDTH_PX * 2.5)) * 0.3
        const val = clamp01(a + glow)
        if (val > 0.003) {
          const px = (((x0 + x) % S) + S) % S
          const py = (((y0 + y) % S) + S) % S
          const i = (py * S + px) * 4
          const v = Math.round(val * 255)
          if (v > rgba[i]) {
            rgba[i] = v
            rgba[i + 1] = v
            rgba[i + 2] = v
          }
        }
      }
    }
  }
  writePng('rune_emissive.png', S, S, rgba)
}

// ---------- 12. particle_atlas.png — 2x2 burst-sprite vocabulary ----------
// Cells (col, row-from-BOTTOM, matching the Particles shader's vCellOff
// formula under three's default flipY): 0 GLOW (soft disc, byte-identical to
// particle_soft.png) / 1 SPARK (crossed hot star) / 2 EMBER (irregular flake)
// / 3 WISP (faint smoke puff). Consumed ONLY by Particles.tsx — every other
// sprite user keeps particle_soft.png.
{
  const S = 256
  const C = 128
  const rgba = Buffer.alloc(S * S * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255

  const bakeCell = (col, rowFromBottom, fn) => {
    const x0 = col * C
    const y0 = (1 - rowFromBottom) * C
    for (let ly = 0; ly < C; ly++) {
      for (let lx = 0; lx < C; lx++) {
        const v = fn(lx, ly)
        const i = ((y0 + ly) * S + x0 + lx) * 4
        rgba[i] = v
        rgba[i + 1] = v
        rgba[i + 2] = v
      }
    }
  }

  // cell 0 GLOW
  bakeCell(0, 0, (x, y) => softDiscVal(x, y, C))

  // cell 1 SPARK: two primary anisotropic arms + faint 45° pair + hot core.
  // Rotation-agnostic by design (gl_PointCoord can't rotate). Edge-killed so
  // nothing bleeds across the mip gutter.
  bakeCell(1, 0, (x, y) => {
    const dx = (x + 0.5) / C - 0.5
    const dy = (y + 0.5) / C - 0.5
    const arm = (t, l, g) => Math.exp(-Math.pow(Math.abs(t) * 14, 1.7)) * Math.exp(-(l * 2.2) * (l * 2.2)) * g
    const d1 = (dx + dy) * 0.7071
    const d2 = (dx - dy) * 0.7071
    const core = Math.exp(-(dx * dx + dy * dy) * 30) * 1.2
    const v = arm(dy, dx, 1) + arm(dx, dy, 1) + arm(d1, d2, 0.4) + arm(d2, d1, 0.4) + core
    const edge = smoothstepJs(0.5, 0.42, Math.max(Math.abs(dx), Math.abs(dy)))
    return Math.round(clamp01(v) * edge * 255)
  })

  // cell 2 EMBER: silhouette radius modulated by seam-free angular fbm
  // (sampled on the circle) — a chunky irregular flake with a hot heart.
  bakeCell(0, 1, (x, y) => {
    const dx = (x + 0.5) / C - 0.5
    const dy = (y + 0.5) / C - 0.5
    const r = Math.sqrt(dx * dx + dy * dy) * 2
    const th = Math.atan2(dy, dx)
    const n = fbm(Math.cos(th) * 2 + 4, Math.sin(th) * 2 + 4, 8, 909, 3)
    const rEdge = 0.52 * (0.72 + 0.28 * n)
    const body = smoothstepJs(rEdge + 0.1, rEdge - 0.08, r)
    const hot = Math.exp(-r * r * 6) * 0.9
    return Math.round(clamp01(body * (0.35 + hot)) * 255)
  })

  // cell 3 WISP: broad warped-fbm puff, deliberately faint (peak ~0.4) so it
  // reads as a veil under additive blending, not a glow.
  bakeCell(1, 1, (x, y) => {
    const u = x / C
    const v = y / C
    const dx = (x + 0.5) / C - 0.5
    const dy = (y + 0.5) / C - 0.5
    const r = Math.sqrt(dx * dx + dy * dy) * 2
    const wx = fbm(u * 3 + 11, v * 3 + 5, 3, 911, 3) * 0.8
    const wy = fbm(u * 3 + 2, v * 3 + 17, 3, 913, 3) * 0.8
    const n = fbm(u * 3 + wx, v * 3 + wy, 3, 915, 4)
    const envelope = Math.exp(-r * r * 2.2)
    return Math.round(clamp01(n * envelope * 0.7) * 255)
  })

  writePng('particle_atlas.png', S, S, rgba)
}

// ---------- 13. corona_streaks.png — eclipse corona ray sheet ----------
// θ-tileable angular streaks (noise sampled ON the circle — no seam) shaped
// by a ring envelope with ray tails dying inside the sheet edge. Alpha-only;
// the Eclipse shader rotates two taps against each other for living rays.
{
  const S = 256
  const rgba = Buffer.alloc(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5
      const dy = (y + 0.5) / S - 0.5
      const r = Math.sqrt(dx * dx + dy * dy) * 2
      const th = Math.atan2(dy, dx)
      const sN = fbm(Math.cos(th) * 4 + 8, Math.sin(th) * 4 + 8, 12, 811, 3)
      const streaks = Math.pow(clamp01(sN), 2.5)
      const ring = Math.exp(-Math.pow((r - 0.55) / 0.14, 2))
      const tails = smoothstepJs(0.5, 1.0, r) * Math.pow(Math.max(0, 1 - r), 1.4) * 0.8
      const v = clamp01((ring + tails * streaks * 2.2) * (0.35 + 0.65 * streaks))
      const i = (y * S + x) * 4
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = Math.round(v * 255)
    }
  }
  writePng('corona_streaks.png', S, S, rgba)
}

// ---------- 14. ring_soft.png — soft impact annulus (GroundRipples) ----------
// Annulus + faint inward wake, angular-fbm modulated so the expanding ring
// reads organic instead of vector-perfect. Replaces the 384-tri torus.
{
  const S = 256
  const rgba = Buffer.alloc(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5
      const dy = (y + 0.5) / S - 0.5
      const r = Math.sqrt(dx * dx + dy * dy) * 2
      const th = Math.atan2(dy, dx)
      const n = 0.85 + 0.15 * fbm(Math.cos(th) * 3 + 6, Math.sin(th) * 3 + 6, 9, 813, 3)
      const ring = Math.exp(-Math.pow((r - 0.72) / 0.09, 2))
      const wake = smoothstepJs(0.72, 0.3, r) * 0.12
      const v = clamp01((ring + wake) * n)
      const i = (y * S + x) * 4
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = Math.round(v * 255)
    }
  }
  writePng('ring_soft.png', S, S, rgba)
}

// ---------- 15. sky_canopy.png — jungle canopy silhouette lattice (NormalBlending) ----------
// The one non-additive sky feature: alpha DARKENS the sky behind it, so the
// jungle realm reads as flying under a world-canopy. Branch arcs are integer-
// frequency sine polylines (seam-perfect wrap in u); leaves cluster on the
// branches via fBm masked by branch proximity. Overhead band only — the
// equirect zenith rows are horizontally stretched on the sphere, so nothing
// is drawn above v=0.10 where the pinch would show.
{
  const W = 1024
  const H = 512
  const rgba = Buffer.alloc(W * H * 4)
  let s = 20261
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  // branch polylines in pixel space: v(u) = v0 + a*sin(2π(u*f + p)), f integer
  const segs = []
  const BRANCHES = 11
  for (let k = 0; k < BRANCHES; k++) {
    const v0 = 0.14 + rnd() * 0.26
    const amp = 0.02 + rnd() * 0.045
    const f = 1 + Math.floor(rnd() * 3)
    const ph = rnd()
    const wpx = 2.2 + rnd() * 2.6
    const STEPS = 48
    let px = 0
    let py = (v0 + amp * Math.sin(2 * Math.PI * ph)) * H
    for (let i = 1; i <= STEPS; i++) {
      const u = i / STEPS
      const x = u * W
      const y = (v0 + amp * Math.sin(2 * Math.PI * (u * f + ph))) * H
      segs.push([px, py, x, y, wpx])
      px = x
      py = y
    }
  }
  const P = 9
  for (let y = 0; y < H; y++) {
    const v = y / H
    // overhead band envelope: solid canopy near zenith, clear by the horizon
    const envelope = smoothstepJs(0.1, 0.2, v) * smoothstepJs(0.52, 0.34, v)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      rgba[i + 3] = 0
      if (envelope < 0.01) continue
      const u = x / W
      // nearest branch distance (pixel space; branches span full u so no wrap copies)
      let d = Infinity
      let w = 3
      for (const [ax, ay, bx, by, sw] of segs) {
        const dd = distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by)
        if (dd < d) {
          d = dd
          w = sw
        }
        if (d < 0.5) break
      }
      const stroke = clamp01((w + 1.5 - d) / 1.5)
      const prox = clamp01(1 - d / 46)
      // leaf clusters hug the branches; ridged high-freq frays the edges
      const leafField = smoothstepJs(0.45, 0.72, fbm(u * P, v * P * 2, P, 1101, 4))
      const fray = 0.55 + 0.45 * (1 - Math.abs(2 * fbm(u * P * 3, v * P * 6, P * 3, 1103, 3) - 1))
      const leaves = leafField * (0.25 + 0.75 * prox) * fray
      const a = clamp01(Math.max(stroke, leaves * 1.15)) * envelope
      if (a < 0.01) continue
      // near-black moss body; faint lit rim on the horizon-facing fringe
      const rim = clamp01((v - 0.3) / 0.2) * (1 - a) * 26
      rgba[i] = Math.round((10 + rim) * 0.85)
      rgba[i + 1] = Math.round(14 + rim)
      rgba[i + 2] = Math.round((10 + rim) * 0.8)
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  writePng('sky_canopy.png', W, H, rgba)
}

// ---------- 16. sky_cracks.png — fractured-sky filaments (collapse / lavacore shell) ----------
// Sharper than nebula_b (pow 12 vs 5): thin luminous fracture lines with node
// flares where crack strength peaks, clustered by a coarse cell mask so whole
// regions of sky stay intact between fault systems. Additive grayscale.
{
  const W = 1024
  const H = 512
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  const P = 6
  for (let y = 0; y < H; y++) {
    const v = y / H
    const poleFade = Math.pow(Math.sin(v * Math.PI), 0.5)
    for (let x = 0; x < W; x++) {
      const u = x / W
      const nx = u * P
      const ny = v * P
      const wx = fbm(nx + 4.1, ny + 7.3, P, 1201, 4) * 2.2
      const wy = fbm(nx + 8.8, ny + 1.9, P, 1203, 4) * 2.2
      // primary fault system
      const n1 = fbm(nx + wx, ny + wy, P, 1205, 5)
      let r1 = 1 - Math.abs(2 * n1 - 1)
      r1 = Math.pow(clamp01(r1), 12)
      // secondary finer web, half amplitude
      const n2 = fbm(nx * 2 + wx * 0.6 + 3, ny * 2 + wy * 0.6 + 5, P * 2, 1209, 4)
      let r2 = 1 - Math.abs(2 * n2 - 1)
      r2 = Math.pow(clamp01(r2), 12) * 0.5
      // coarse cell mask: cracks cluster along fault regions
      const mask = smoothstepJs(0.42, 0.72, fbm(u * 3 + 1, v * 3 + 6, 3, 1207, 3))
      // node flares where the primary crack burns hottest
      const flare = Math.pow(clamp01(r1), 3) * 0.8
      const g = Math.round(clamp01((r1 + r2 + flare) * mask * poleFade * 1.35) * 255)
      const i = (y * W + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
    }
  }
  writePng('sky_cracks.png', W, H, rgba)
}

// ---------- 17. sky_vortex.png — polar spiral maelstrom (cathedral / ritual shell) ----------
// Spiral arms winding around the zenith pole, filament-broken, dying well
// above the horizon. Arms fade into a uniform core disc near the pole so the
// equirect singularity (all u converge at v=0) never shows a pinwheel pinch.
{
  const W = 1024
  const H = 512
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  const P = 7
  for (let y = 0; y < H; y++) {
    const v = y / H // 0 = zenith pole
    const colat = v * Math.PI
    // dead below mid-sky; brightest in the 0.06..0.3 colatitude band
    const bandFade = smoothstepJs(0.55, 0.28, v)
    const armGain = smoothstepJs(0.02, 0.12, v) // uniform core inside
    for (let x = 0; x < W; x++) {
      const u = x / W
      const th = u * 2 * Math.PI
      const warp = (fbm(u * P, v * P, P, 1301, 4) - 0.5) * 3.2
      // 3-arm logarithmic-ish spiral: angle advances with colatitude
      const arm = 0.5 + 0.5 * Math.sin(th * 3 + colat * 9 + warp)
      let spiral = Math.pow(clamp01(arm), 3.5)
      // filament breakup along the arms
      const fil = 0.45 + 0.55 * (1 - Math.abs(2 * fbm(u * P * 2 + 5, v * P * 2 + 9, P * 2, 1303, 4) - 1))
      spiral *= fil * armGain
      // soft core disc at the pole itself
      const core = Math.exp(-Math.pow(v / 0.055, 2)) * 0.85
      const g = Math.round(clamp01((spiral * bandFade + core) * 1.25) * 255)
      const i = (y * W + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
    }
  }
  writePng('sky_vortex.png', W, H, rgba)
}

// ---------- 18. vein_vine.png — organic vine-vein emissive (jungle islands) ----------
// The rune_emissive recipe re-parameterized organic: coarser lattice, fatter
// ridges (pow 5), a lower knee for more coverage, seeded bud-dot stamps where
// the vines run strongest — and NO glyph stamps (script belongs to ritual).
{
  const S = 512
  const P = 4
  const rgba = Buffer.alloc(S * S * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  const veinAt = (x, y) => {
    const nx = (x / S) * P
    const ny = (y / S) * P
    const wx = fbm(nx + 2.7, ny + 6.1, P, 1401, 4) * 2.2
    const wy = fbm(nx + 7.9, ny + 3.4, P, 1403, 4) * 2.2
    const n = fbm(nx + wx, ny + wy, P, 1405, 4)
    return 1 - Math.abs(2 * n - 1)
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ridge = veinAt(x, y)
      const vein = Math.pow(clamp01(ridge), 7)
      const halo = Math.pow(clamp01(ridge), 4) * 0.1
      const v = clamp01((vein - 0.2) / 0.8) * 0.85 + halo
      const g = Math.round(clamp01(v) * 255)
      const i = (y * S + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
    }
  }
  // bud dots: lattice-seeded (wrapped), kept only where the vine runs strong
  const CELL = 32
  for (let cy = 0; cy < S / CELL; cy++) {
    for (let cx = 0; cx < S / CELL; cx++) {
      if (hash2(cx, cy, 1407) < 0.72) continue
      const bx = cx * CELL + Math.floor(hash2(cx, cy, 1409) * CELL)
      const by = cy * CELL + Math.floor(hash2(cx, cy, 1411) * CELL)
      if (veinAt(bx, by) < 0.8) continue
      const rad = 2.5 + hash2(cx, cy, 1413) * 2.5
      const r2max = Math.ceil(rad + 2)
      for (let dy = -r2max; dy <= r2max; dy++) {
        for (let dx = -r2max; dx <= r2max; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy)
          const a = clamp01((rad - d) / 1.5) + clamp01(1 - d / (rad * 2.4)) * 0.25
          if (a <= 0.01) continue
          const px = (((bx + dx) % S) + S) % S
          const py = (((by + dy) % S) + S) % S
          const i = (py * S + px) * 4
          const val = Math.round(clamp01(a) * 255)
          if (val > rgba[i]) {
            rgba[i] = val
            rgba[i + 1] = val
            rgba[i + 2] = val
          }
        }
      }
    }
  }
  writePng('vein_vine.png', S, S, rgba)
}

// ---------- 19. vein_tracery.png — gothic tracery emissive (cathedral islands) ----------
// Rectilinear carved linework: axis/45°-snapped segments on a loose grid plus
// quarter-arc ribs, drawn wrapped like the rune_emissive glyph stamps, over a
// whisper of ridged underlay so the rock never reads fully dead.
{
  const S = 512
  const rgba = Buffer.alloc(S * S * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  let s = 20263
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const segs = []
  // straight carved channels, endpoints snapped to a 32px grid
  const DIRS = [
    [1, 0],
    [0, 1],
    [0.7071, 0.7071],
    [0.7071, -0.7071],
  ]
  for (let k = 0; k < 34; k++) {
    const ax = Math.floor(rnd() * 16) * 32
    const ay = Math.floor(rnd() * 16) * 32
    const [dx, dy] = DIRS[Math.floor(rnd() * 4)]
    const len = (2 + Math.floor(rnd() * 4)) * 32
    segs.push([ax, ay, ax + dx * len, ay + dy * len])
  }
  // quarter-arc ribs (8-segment polylines)
  for (let k = 0; k < 9; k++) {
    const cx0 = Math.floor(rnd() * 16) * 32
    const cy0 = Math.floor(rnd() * 16) * 32
    const rad = 40 + rnd() * 56
    const q = Math.floor(rnd() * 4) * (Math.PI / 2)
    let px = cx0 + Math.cos(q) * rad
    let py = cy0 + Math.sin(q) * rad
    for (let i = 1; i <= 8; i++) {
      const a = q + (i / 8) * (Math.PI / 2)
      const x = cx0 + Math.cos(a) * rad
      const y = cy0 + Math.sin(a) * rad
      segs.push([px, py, x, y])
      px = x
      py = y
    }
  }
  const WIDTH_PX = 2.5
  const AA = 1.5
  // wrapped draw: each segment also tested against the 8 torus offsets
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d = Infinity
      for (const [ax, ay, bx, by] of segs) {
        for (let oy = -S; oy <= S; oy += S) {
          for (let ox = -S; ox <= S; ox += S) {
            const dd = distToSegment(x + 0.5, y + 0.5, ax + ox, ay + oy, bx + ox, by + oy)
            if (dd < d) d = dd
          }
        }
        if (d < 0.5) break
      }
      const a = clamp01((WIDTH_PX / 2 + AA - d) / AA)
      const glow = clamp01(1 - d / (WIDTH_PX * 3)) * 0.22
      const under = Math.pow(clamp01(1 - Math.abs(2 * fbm((x / S) * 5, (y / S) * 5, 5, 1501, 4) - 1)), 7) * 0.15
      const g = Math.round(clamp01(a + glow + under) * 255)
      const i = (y * S + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
    }
  }
  writePng('vein_tracery.png', S, S, rgba)
}

// ---------- 20. vein_fracture.png — voronoi fracture web (collapse islands) ----------
// Toroidal F2−F1 cell borders at two scales: thin bright cracks between crust
// cells, with node flares where three cells meet (F3−F1 also small) — the rock
// is visibly coming apart at the seams.
{
  const S = 512
  const rgba = Buffer.alloc(S * S * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  let s = 20265
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const mkPts = n => {
    const pts = []
    for (let k = 0; k < n; k++) pts.push([rnd() * S, rnd() * S])
    return pts
  }
  const fine = mkPts(90)
  const coarse = mkPts(22)
  const torDist = (ax, ay, bx, by) => {
    let dx = Math.abs(ax - bx)
    let dy = Math.abs(ay - by)
    if (dx > S / 2) dx = S - dx
    if (dy > S / 2) dy = S - dy
    return Math.sqrt(dx * dx + dy * dy)
  }
  const f123 = (pts, x, y) => {
    let f1 = Infinity
    let f2 = Infinity
    let f3 = Infinity
    for (const [px, py] of pts) {
      const d = torDist(x, y, px, py)
      if (d < f1) {
        f3 = f2
        f2 = f1
        f1 = d
      } else if (d < f2) {
        f3 = f2
        f2 = d
      } else if (d < f3) {
        f3 = d
      }
    }
    return [f1, f2, f3]
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const [a1, a2, a3] = f123(fine, x + 0.5, y + 0.5)
      const [b1, b2] = f123(coarse, x + 0.5, y + 0.5)
      const crackF = Math.pow(clamp01(1 - (a2 - a1) / 7), 6)
      const crackC = Math.pow(clamp01(1 - (b2 - b1) / 11), 6) * 0.85
      const node = Math.pow(clamp01(1 - (a3 - a1) / 16), 4) * 0.7
      const v = clamp01(crackF + crackC + node * crackF)
      const g = Math.round(v * 255)
      const i = (y * S + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
    }
  }
  writePng('vein_fracture.png', S, S, rgba)
}

// ---------- 21. vein_magma.png — magma crust emissive (lavacore islands) ----------
// Wide-halo ridged cracks (hot rock bleeds light) with a coarse plate mask
// darkening the crust between fissures and boosted white-hot crack cores —
// tuned to be sampled through an HDR uRuneColor that crosses bloom.
{
  const S = 512
  const P = 5
  const rgba = Buffer.alloc(S * S * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / S) * P
      const ny = (y / S) * P
      const wx = fbm(nx + 6.3, ny + 2.8, P, 1601, 4) * 1.8
      const wy = fbm(nx + 1.4, ny + 9.6, P, 1603, 4) * 1.8
      const n = fbm(nx + wx, ny + wy, P, 1605, 4)
      const ridge = 1 - Math.abs(2 * n - 1)
      const vein = Math.pow(clamp01(ridge), 8)
      const core = Math.pow(clamp01(ridge), 18) * 0.9 // white-hot centerline
      const halo = Math.pow(clamp01(ridge), 3.5) * 0.24 // hot rock bleed
      // crust plates: coarse mask dims the field between fissure systems
      const plate = 0.3 + 0.7 * smoothstepJs(0.35, 0.75, fbm((x / S) * 2.5 + 3, (y / S) * 2.5 + 8, 2.5, 1607, 3))
      const v = clamp01(((vein - 0.16) / 0.84) * 0.8 + halo) * plate + core * plate
      const g = Math.round(clamp01(v) * 255)
      const i = (y * S + x) * 4
      rgba[i] = g
      rgba[i + 1] = g
      rgba[i + 2] = g
    }
  }
  writePng('vein_magma.png', S, S, rgba)
}

console.log('done.')
