/**
 * A track's sound, from a file to a `music` / `sfx` / `uncertain` verdict.
 *
 * The chain is fixed by the model's export: ffmpeg decodes one mono 16 kHz
 * window, `mel.ts` builds the log-mel the audio encoder was trained on, the
 * fused graph embeds the clip into the same 768-d space as text, and two text
 * queries decide the kind. Nothing here classifies by filename or duration.
 *
 * Failure is not an error the caller has to handle: a missing encoder, a codec
 * ffmpeg refuses, or a clip too short to frame all come back as `uncertain`, so
 * the duration/genre classifier still has the last word.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ffmpegBinary } from '../../ffmpeg'
import { EMBEDDING_MODEL, type Embedder } from '../embedder-files'
import { decideKindFor, KIND_QUERIES, type KindAnchors, type KindDecision } from '../kindDecision'

/**
 * The vector store key: model + the audio recipe. A new model or a new clip rule
 * makes old vectors incomparable, so the key changes and the pass re-embeds.
 */
export const AUDIO_EMBEDDING_KEY = `${EMBEDDING_MODEL}+audio1`

/** One window is enough: a cue's character does not change every thirty seconds. */
export const AUDIO_SECONDS = 30

const run = promisify(execFile)

export interface ClipWindow {
  seconds: number
  offset: number
}

/**
 * Where to sample a track. Effects are short, so the start is the whole thing;
 * a long cue often opens with a fade-in or silence, so a tenth in is a fairer
 * read of what the DM actually hears.
 */
export function clipWindow(duration?: number | null): ClipWindow {
  const seconds = Math.max(1, Math.round(duration ?? AUDIO_SECONDS))
  if (!Number.isFinite(seconds) || seconds <= 45) return { seconds: AUDIO_SECONDS, offset: 0 }
  return { seconds: AUDIO_SECONDS, offset: Math.round(seconds * 0.1) }
}

/** Mono 16 kHz PCM. ffmpeg does the decoding; the model never sees a container. */
export async function decodePcm(
  path: string,
  { seconds = AUDIO_SECONDS, offset = 0 }: Partial<ClipWindow> = {},
): Promise<Float32Array> {
  const binary = ffmpegBinary()
  const args = ['-v', 'error']
  if (offset > 0) args.push('-ss', String(offset))
  args.push('-i', path, '-t', String(seconds), '-ar', '16000', '-ac', '1', '-f', 'f32le', 'pipe:1')
  const { stdout } = await run(binary, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const buffer = stdout as unknown as Buffer
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const pcm = new Float32Array(Math.floor(buffer.byteLength / 4))
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getFloat32(i * 4, true)
  return pcm
}

/** The two query vectors, or null when the audio encoder is not installed. */
export async function loadKindAnchors(embedder: Embedder): Promise<KindAnchors | null> {
  if (!embedder.embedAudio) return null
  const [music, sfx] = await Promise.all([
    embedder.embedQuery(KIND_QUERIES.music),
    embedder.embedQuery(KIND_QUERIES.sfx),
  ])
  return { music, sfx }
}

/** The track's vector, or null when audio cannot be embedded for any reason. */
export async function embedTrackAudio(
  embedder: Embedder,
  path: string,
  window: Partial<ClipWindow> = {},
): Promise<Float32Array | null> {
  if (!embedder.embedAudio) return null
  try {
    return await embedder.embedAudio(await decodePcm(path, window))
  } catch {
    return null
  }
}

/** Classify a file. Never throws: every failure degrades to `uncertain`. */
export async function classifyAudio(
  embedder: Embedder,
  path: string,
  anchors: KindAnchors | null,
  window: Partial<ClipWindow> = {},
): Promise<KindDecision> {
  if (!anchors) return { kind: 'uncertain', margin: 0, reason: 'the audio encoder is not installed' }
  const vector = await embedTrackAudio(embedder, path, window)
  if (!vector) return { kind: 'uncertain', margin: 0, reason: 'no usable audio embedding' }
  return decideKindFor(vector, anchors)
}
