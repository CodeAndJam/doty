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
 */
export function createMusicResource(musicFolder: string, filename: string, volume = 1.0) {
  const filePath = join(musicFolder, filename)

  if (!fs.existsSync(filePath)) {
    throw new Error(`[discord-audio] File not found: ${filePath}`)
  }

  // Use prism FFmpeg to decode the audio file to raw PCM
  const ffmpeg = new prism.FFmpeg({
    args: [
      '-i', filePath,
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      // Apply volume filter if not 1.0
      ...(volume !== 1.0 ? ['-af', `volume=${volume}`] : []),
    ],
  })

  return createAudioResource(ffmpeg, {
    inputType: StreamType.Raw,
  })
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
