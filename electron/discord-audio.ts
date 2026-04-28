/**
 * Discord audio pipeline — reads audio files from disk and creates
 * AudioResource instances for @discordjs/voice to stream to Discord.
 */

import { exec } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
import { createAudioResource, StreamType } from '@discordjs/voice'
import prism from 'prism-media'

// ffmpeg path — use bundled ffmpeg-static if available
let ffmpegPath: string
try {
  ffmpegPath = require('ffmpeg-static') as string
} catch {
  ffmpegPath = 'ffmpeg'
}

/**
 * Create an AudioResource from a music file on disk.
 * Uses ffmpeg to decode any format to PCM s16le stereo 48kHz,
 * then pipes through an Opus encoder for Discord.
 * @param seekSeconds — start decoding at this offset (0 = beginning)
 */
export function createMusicResource(musicFolder: string, filename: string, volume = 1.0, seekSeconds = 0) {
  const filePath = join(musicFolder, filename)

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
export function createSfxResource(absolutePath: string, volume = 1.0) {
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

/**
 * Check if ffmpeg is available (needed for audio transcoding).
 */
function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`"${ffmpegPath}" -version`, (err) => {
      resolve(!err)
    })
  })
}
