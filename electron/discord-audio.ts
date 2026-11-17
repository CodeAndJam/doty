/**
 * Discord audio pipeline — reads audio files from disk and creates
 * AudioResource instances for @discordjs/voice to stream to Discord.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { type AudioResource, createAudioResource, StreamType } from '@discordjs/voice'
import prism from 'prism-media'

const run = promisify(execFile)

// ffmpeg path — use bundled ffmpeg-static if available. A packaged build hands
// us a path inside app.asar, where spawn cannot execute; electron-builder unpacks
// the binary next to it, so point there instead (only when `.asar` ends a segment).
let ffmpegPath: string
try {
  ffmpegPath = (require('ffmpeg-static') as string).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
} catch {
  ffmpegPath = 'ffmpeg'
}

/** Diagnostic for "connected to Discord but silent". */
export async function ffmpegStatus(): Promise<{ path: string; ok: boolean; detail: string }> {
  if (!fs.existsSync(ffmpegPath)) return { path: ffmpegPath, ok: false, detail: 'file missing' }
  try {
    const { stdout } = await run(ffmpegPath, ['-version'])
    return { path: ffmpegPath, ok: true, detail: stdout.split('\n')[0] || 'ok' }
  } catch (err) {
    return { path: ffmpegPath, ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Create an AudioResource from a music file on disk.
 * Uses ffmpeg to decode any format to PCM s16le stereo 48kHz,
 * then pipes through an Opus encoder for Discord.
 * @param seekSeconds — start decoding at this offset (0 = beginning)
 */
export function createMusicResource(
  musicFolder: string,
  filename: string,
  volume = 1.0,
  seekSeconds = 0,
): AudioResource {
  // A track labelled as music may live in the effects folder; the renderer plays
  // it by absolute path, so the remote stream has to resolve it the same way.
  const filePath = isAbsolute(filename) ? filename : join(musicFolder, filename)

  if (!fs.existsSync(filePath)) {
    throw new Error(`[discord-audio] File not found: ${filePath}`)
  }

  // Use prism FFmpeg to decode the audio file to raw PCM
  const ffmpeg = new prism.FFmpeg({
    args: [
      // Seek BEFORE input so ffmpeg jumps directly (fast, no decoding skipped frames)
      ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
      '-i',
      filePath,
      '-analyzeduration',
      '0',
      '-loglevel',
      '0',
      '-f',
      's16le',
      '-ar',
      '48000',
      '-ac',
      '2',
    ],
  })

  // Use inlineVolume so the volume transformer can be adjusted at runtime
  const resource = createAudioResource(ffmpeg, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  })
  resource.volume?.setVolume(volume)
  return resource
}

/**
 * Create an AudioResource from an SFX file (absolute path).
 * Same pipeline as music but takes an absolute path directly.
 * @param absolutePath — absolute path to the SFX audio file
 * @param volume — playback volume 0..1
 */
export function createSfxResource(absolutePath: string, volume = 1.0): AudioResource {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`[discord-audio] SFX file not found: ${absolutePath}`)
  }

  const ffmpeg = new prism.FFmpeg({
    args: ['-i', absolutePath, '-analyzeduration', '0', '-loglevel', '0', '-f', 's16le', '-ar', '48000', '-ac', '2'],
  })

  const resource = createAudioResource(ffmpeg, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  })
  resource.volume?.setVolume(volume)
  return resource
}
