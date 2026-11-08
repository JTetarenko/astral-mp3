import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const AUDIO_EXT = /\.(mp3|ogg|wav)$/i

interface TrackEntry {
  file: string
  name: string
  sizeBytes: number
}

function scanTracks(dir: string): TrackEntry[] {
  const entries: TrackEntry[] = []
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!AUDIO_EXT.test(f)) continue
      const stat = fs.statSync(path.join(dir, f))
      if (!stat.isFile()) continue
      entries.push({
        file: '/tracks/' + encodeURIComponent(f),
        name: f.replace(AUDIO_EXT, '').replace(/_/g, ' '),
        sizeBytes: stat.size,
      })
    }
  } catch {
    // tracks folder missing — treat as empty
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}

/**
 * Makes GET /tracks/manifest.json work in both dev and build.
 * Dev: middleware re-reads public/tracks on every request (no-store, so the
 * in-game Rescan button picks up newly dropped files without a restart).
 * Build: emits a static tracks/manifest.json into dist.
 */
export function tracksManifestPlugin(): Plugin {
  let tracksDir = ''
  return {
    name: 'astral-tracks-manifest',
    configResolved(config) {
      tracksDir = path.join(config.publicDir, 'tracks')
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/tracks/manifest.json') {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(scanTracks(tracksDir)))
          return
        }
        next()
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'tracks/manifest.json',
        source: JSON.stringify(scanTracks(tracksDir)),
      })
    },
  }
}
