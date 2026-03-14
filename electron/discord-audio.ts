/**
 * Discord audio pipeline — reads audio files from disk and creates
 * AudioResource instances for @discordjs/voice to stream to Discord.
 */
import { createAudioResource, StreamType } from '@discordjs/voice'
import { join } from 'path'
import fs from 'fs'
import prism from 'prism-media'
import { exec } from 'child_process'

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
      '-i', filePath,
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
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
 * Create a raw PCM s16le stereo 48kHz readable stream from a file.
 * Used by the mixer to get decodable audio data.
 * @param filePath — absolute path to the audio file
 * @param seekSeconds — start decoding at this offset (0 = beginning)
 */
export function createPcmStream(filePath: string, seekSeconds = 0): prism.FFmpeg {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[discord-audio] File not found: ${filePath}`)
  }

  return new prism.FFmpeg({
    args: [
      ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
      '-i', filePath,
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
    ],
  })
}

/**
 * Create a raw PCM stream for an SFX file (absolute path).
 */
export function createSfxPcmStream(absolutePath: string): prism.FFmpeg {
  return createPcmStream(absolutePath, 0)
}

/**
 * Check if ffmpeg is available (needed for audio transcoding).
 */
export function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`"${ffmpegPath}" -version`, (err) => {
      resolve(!err)
    })
  })
}
