/**
 * Music protocol handler logic — extracted for testability.
 *
 * Handles serving audio files with proper HTTP Range support so that
 * Chromium's <audio> element can seek (set currentTime) correctly.
 */
import fs from 'node:fs'
import { join, resolve, sep } from 'node:path'

/** MIME type lookup for audio files. */
export function audioMime(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** Parse a music:// URL into a relative filename. */
export function parseMusicUrl(raw: string): string {
  const prefix = 'music://play/'
  return decodeURIComponent(raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.slice('music://'.length))
}

/** Build a ReadableStream from a Node fs.ReadStream, guarding against
 *  enqueue-after-close crashes that happen when Chromium cancels a request
 *  mid-stream (e.g. rapid seeking). */
function nodeStreamToWeb(nodeStream: fs.ReadStream): ReadableStream {
  let closed = false
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer | string) => {
        if (!closed) {
          try {
            controller.enqueue(chunk)
          } catch {
            closed = true
            nodeStream.destroy()
          }
        }
      })
      nodeStream.on('end', () => {
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
      })
      nodeStream.on('error', (err) => {
        if (!closed) {
          closed = true
          try {
            controller.error(err)
          } catch {
            /* already errored */
          }
        }
      })
    },
    cancel() {
      closed = true
      nodeStream.destroy()
    },
  })
}

export interface MusicRequestInfo {
  url: string
  rangeHeader: string | null
}

export interface MusicProtocolOptions {
  musicFolder: string
  /** Absolute-path SFX live here; requests may reference them directly. */
  sfxFolder?: string
}

/**
 * Handle a music:// protocol request.
 * Returns a Response with proper Range support for audio seeking.
 */
export function handleMusicRequest(request: MusicRequestInfo, options: MusicProtocolOptions): Response {
  const { musicFolder, sfxFolder } = options
  const filename = parseMusicUrl(request.url)

  // Support absolute paths (for SFX) or relative paths (for music).
  // Chromium normalises %2F → / in custom-scheme URLs, so an absolute path
  // like /Users/x/sfx/boom.mp3 arrives as "Users/x/sfx/boom.mp3" (leading
  // slash consumed by the music://play/ prefix). Try the relative path first;
  // if it doesn't exist, retry as an absolute path with "/" prepended.
  let filePath = filename.startsWith('/') ? filename : join(musicFolder, filename)
  if (!fs.existsSync(filePath) && !filename.startsWith('/')) {
    const abs = `/${filename}`
    if (fs.existsSync(abs)) filePath = abs
  }

  // Only serve files from the configured music/SFX folders — this handler is
  // reachable from renderer code, so an absolute path must not read arbitrary files.
  const resolved = resolve(filePath)
  const roots = [musicFolder, sfxFolder].filter(Boolean).map((root) => resolve(root as string))
  if (!roots.some((root) => resolved === root || resolved.startsWith(root + sep))) {
    return new Response('Forbidden', { status: 403 })
  }

  if (!fs.existsSync(resolved)) {
    return new Response('Not found', { status: 404 })
  }

  const stat = fs.statSync(resolved)
  const total = stat.size
  const ext = resolved.slice(resolved.lastIndexOf('.'))
  const mime = audioMime(ext)

  // Handle Range requests — required for audio seeking.
  if (request.rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(request.rangeHeader)
    const start = match ? parseInt(match[1], 10) : 0
    const end = match?.[2] ? parseInt(match[2], 10) : total - 1

    // Validate range bounds
    if (start >= total || end >= total || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      })
    }

    const chunkSize = end - start + 1

    const readable = nodeStreamToWeb(fs.createReadStream(resolved, { start, end }))

    return new Response(readable, {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }

  // Full file response — advertise Accept-Ranges so Chromium knows
  // it can send Range requests for seeking.
  const readable = nodeStreamToWeb(fs.createReadStream(resolved))

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
    },
  })
}
