/**
 * Discord audio pipeline — reads audio files from disk and creates
 * AudioResource instances for @discordjs/voice to stream to Discord.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { type AudioResource, createAudioResource, StreamType } from '@discordjs/voice'
import { ffmpegBinary } from './ffmpeg'

/**
 * Decode a file to the raw PCM Discord wants.
 *
 * Spawned directly rather than through prism-media: prism owns its own ffmpeg
 * lookup and spawn call, so a packaged build made it spawn the in-archive path,
 * fail with ENOTDIR, and fall back to PATH — silent when the Mac has no ffmpeg.
 */
function decodePcm(filePath: string, seekSeconds: number): Readable {
  const child = spawn(
    ffmpegBinary(),
    [
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
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  )

  if (!child.stdout) throw new Error('[discord-audio] ffmpeg produced no output stream')
  // A spawn failure fires on the child; surface it on the stream so the player
  // reports it instead of sitting on a silent, idle resource.
  child.once('error', (err) => child.stdout?.destroy(err))
  // Stopping the player destroys the stream; take the decoder down with it.
  child.stdout.once('close', () => child.kill())

  return child.stdout
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
  const filePath = join(musicFolder, filename)

  if (!fs.existsSync(filePath)) {
    throw new Error(`[discord-audio] File not found: ${filePath}`)
  }

  // Use inlineVolume so the volume transformer can be adjusted at runtime
  const resource = createAudioResource(decodePcm(filePath, seekSeconds), {
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

  const resource = createAudioResource(decodePcm(absolutePath, 0), {
    inputType: StreamType.Raw,
    inlineVolume: true,
  })
  resource.volume?.setVolume(volume)
  return resource
}
