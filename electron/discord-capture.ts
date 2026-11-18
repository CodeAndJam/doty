/**
 * Discord participants as their own transcript speakers.
 *
 * One speech burst per speaker is buffered from speaking-start to the next
 * pause, then decoded whole by a worker of its own. Batch-per-utterance needs no
 * per-speaker model and no concurrent stream, which is the cheap side of the
 * shape `spike/DISCORD-RECEIVE.md` left open.
 */
import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { Worker } from 'node:worker_threads'
import { EndBehaviorType, type VoiceReceiver } from '@discordjs/voice'
import { opus } from 'prism-media'
import { SpeakerLabels } from './capture/labels'
import {
  capSamples,
  longEnough,
  MAX_UTTERANCE_BYTES,
  MAX_UTTERANCE_SEC,
  RESAMPLE_ARGS,
  toSamples,
} from './capture/utterance'
import { ffmpegBinary } from './ffmpeg'
import {
  DEFAULT_STT_LANGUAGE,
  DEFAULT_STT_MODEL,
  getModelPath,
  getSttSideModelPath,
  type SttModelType,
} from './model-paths'
import { store } from './store'

const WORKER_PATH = join(__dirname, 'transcribe-worker.js')
const DECODE_TIMEOUT_MS = 20_000
const SILENCE_END_MS = 1200
/** ffmpeg trails the opus stream; give the tail of the utterance time to land. */
const TAIL_MS = 300

export type CaptureMode = 'local' | 'all'

export interface CaptureState {
  mode: CaptureMode
  /** Display names of the participants whose audio goes into the session. */
  names: string[]
  /** Why capture is not running, when it should be. */
  error: string | null
}

export interface RemoteSegment {
  /** The Discord display name, resolved once when the speaker is first heard. */
  speaker: string
  text: string
  /** 16 kHz mono, for the session's remote WAV. */
  samples: Float32Array
}

let onSegment: ((segment: RemoteSegment) => void) | null = null
let onState: ((state: CaptureState) => void) | null = null

export function setOnRemoteSegment(cb: (segment: RemoteSegment) => void): void {
  onSegment = cb
}

/** Who is being captured right now, for the tell beside the switch. */
export function setOnRemoteState(cb: (state: CaptureState) => void): void {
  onState = cb
}

export function getCaptureMode(): CaptureMode {
  return store.get('discordCaptureMode', 'local') === 'all' ? 'all' : 'local'
}

export function setCaptureMode(mode: CaptureMode): void {
  store.set('discordCaptureMode', mode)
}

let lastError: string | null = null

export function getCaptureState(): CaptureState {
  return { mode: getCaptureMode(), names: [...speakers.values()].map((s) => s.label), error: lastError }
}

function emitState(): void {
  onState?.(getCaptureState())
}

/** A failure the DM must be able to see: capture that stops silently is worse. */
function reportError(message: string): void {
  lastError = message
  emitState()
}

interface Speaker {
  label: string
  ffmpeg: ChildProcessByStdio<Writable, Readable, null>
  /** s16le mono 16 kHz, drained per utterance. */
  pcm: Buffer[]
  /** Bytes held in `pcm`, so a monologue is capped while it is buffered. */
  pcmBytes: number
  active: boolean
  /** Set when capture is torn down, so a late utterance cannot emit. */
  killed: boolean
  audio?: { destroy: () => void }
}

const speakers = new Map<string, Speaker>()
const labels = new SpeakerLabels()
let receiver: VoiceReceiver | null = null
let labelFor: ((userId: string) => string) | null = null
let speakingHandler: ((userId: string) => void) | null = null

let worker: Worker | null = null
let workerReady: Promise<void> | null = null
const waiting = new Map<number, (text: string) => void>()
let nextId = 1

/** Starts a receiver subscription for everyone already speaking, then live. */
export function attachCapture(recv: VoiceReceiver, label: (userId: string) => string): void {
  detachCapture()
  receiver = recv
  labelFor = label
  speakingHandler = (userId: string) => void handleSpeaking(userId)
  receiver.speaking.on('start', speakingHandler)
  void ensureWorker()
  for (const userId of receiver.speaking.users.keys()) void handleSpeaking(userId)
}

export function detachCapture(options: { resetLabels?: boolean } = {}): void {
  if (receiver && speakingHandler) receiver.speaking.off('start', speakingHandler)
  receiver = null
  speakingHandler = null
  labelFor = null
  for (const speaker of speakers.values()) {
    speaker.killed = true
    speaker.audio?.destroy()
    speaker.ffmpeg.kill()
  }
  speakers.clear()
  // A switch flip must not re-read names mid-session; leaving the call must.
  if (options.resetLabels) labels.reset()
  disposeWorker()
  lastError = null
  emitState()
}

function speakerState(userId: string): Speaker {
  const existing = speakers.get(userId)
  if (existing) return existing
  const ffmpeg = spawn(ffmpegBinary(), RESAMPLE_ARGS, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  const state: Speaker = {
    label: labels.label(userId, labelFor?.(userId) ?? ''),
    ffmpeg,
    pcm: [],
    pcmBytes: 0,
    active: false,
    killed: false,
  }
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    // Cap while buffering, not after: a speaker who never pauses would
    // otherwise hold the whole monologue in memory before the cap applied.
    if (state.pcmBytes >= MAX_UTTERANCE_BYTES) return
    state.pcm.push(chunk)
    state.pcmBytes += chunk.length
  })
  // The child outlives every utterance; a write after it dies must not throw.
  ffmpeg.stdin.on('error', () => {})
  speakers.set(userId, state)
  emitState()
  return state
}

async function handleSpeaking(userId: string): Promise<void> {
  const state = speakerState(userId)
  if (state.active) return
  state.active = true
  const recv = receiver
  if (!recv) {
    state.active = false
    return
  }
  try {
    // Subscribe before the model is ready: Discord hands us audio only once we
    // ask, and a slow first load must not eat the opening sentence.
    const audio = recv.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_END_MS },
    })
    state.audio = audio
    const decoder = new opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 })
    // end: false — the ffmpeg child is reused by the next utterance.
    decoder.pipe(state.ffmpeg.stdin, { end: false })
    audio.pipe(decoder)
    audio.on('end', () => {
      state.audio = undefined
      state.active = false
      decoder.unpipe(state.ffmpeg.stdin)
      void endUtterance(state)
    })
    audio.on('error', (err) => {
      state.active = false
      console.error('[capture] audio stream failed:', err.message)
    })
    void ensureWorker()
  } catch (err) {
    state.active = false
    console.error('[capture] subscribe failed:', err instanceof Error ? err.message : err)
  }
}

async function endUtterance(state: Speaker): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, TAIL_MS))
  if (state.killed) return
  const bytes = Buffer.concat(state.pcm)
  state.pcm = []
  state.pcmBytes = 0
  const samples = capSamples(toSamples(bytes), MAX_UTTERANCE_SEC)
  if (!longEnough(samples)) return
  await ensureWorker()
  const text = (await transcribe(samples)).trim()
  if (text && !state.killed) onSegment?.({ speaker: state.label, text, samples })
}

function transcribe(samples: Float32Array): Promise<string> {
  return new Promise((resolve) => {
    if (!worker) return resolve('')
    const id = nextId++
    // Without this a dead worker leaves the caller waiting forever and that
    // voice never comes back.
    const timer = setTimeout(() => {
      if (waiting.delete(id)) {
        console.error('[capture] decode timed out; dropping the utterance')
        reportError('Speech engine stalled — a line may be missing')
        resolve('')
      }
    }, DECODE_TIMEOUT_MS)
    waiting.set(id, (text) => {
      clearTimeout(timer)
      resolve(text)
    })
    const buffer = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer
    worker.postMessage({ type: 'transcribe', id, buffer }, [buffer])
  })
}

function ensureWorker(): Promise<void> {
  if (workerReady) return workerReady
  const modelId = store.get('sttModel', DEFAULT_STT_MODEL) as SttModelType
  // Same defaults as the mic lane (`asr.ts`): a different language here would
  // transcribe the same table in the same room two different ways.
  const language = store.get('sttLanguage', DEFAULT_STT_LANGUAGE) as string
  const w = new Worker(WORKER_PATH)
  worker = w
  workerReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('STT worker did not load in 60 s')), 60_000)
    w.on('message', (msg: any) => {
      if (msg.type === 'ready') {
        clearTimeout(timeout)
        lastError = null
        emitState()
        resolve()
      } else if (msg.type === 'result') {
        const done = waiting.get(msg.id)
        if (done) {
          waiting.delete(msg.id)
          done(msg.text ?? '')
        }
      } else if (msg.type === 'error') {
        console.error('[capture] stt error:', msg.error)
        reportError(`Speech engine: ${msg.error}`)
      }
    })
    w.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    w.on('exit', (code) => {
      // A worker that dies mid-session must not take the lane with it: settle
      // what it owed and let the next utterance start a fresh one.
      if (worker !== w) return
      console.error(`[capture] stt worker exited (${code})`)
      clearTimeout(timeout)
      disposeWorker()
    })
    w.postMessage({
      type: 'load',
      modelPath: getModelPath(modelId),
      language,
      vadPath: getSttSideModelPath('vad'),
    })
  }).catch((err) => {
    // A half-started worker polling forever is worse than a clean restart.
    console.error('[capture] worker unavailable:', err instanceof Error ? err.message : err)
    reportError(err instanceof Error ? err.message : 'Speech engine unavailable')
    disposeWorker()
  })
  return workerReady
}

/**
 * Settle every pending decode and drop the worker, so the next one can load.
 * A decode that never comes back is a voice the DM would otherwise lose in
 * silence, so it is reported rather than swallowed.
 */
function disposeWorker(): void {
  const owed = waiting.size
  for (const [id, done] of waiting) {
    waiting.delete(id)
    done('')
  }
  if (owed > 0) reportError('Speech engine restarted — a line may be missing')
  const w = worker
  worker = null
  workerReady = null
  if (!w) return
  try {
    w.postMessage({ type: 'dispose' })
  } catch {
    /* already gone */
  }
  setTimeout(() => void w.terminate(), 500)
}
