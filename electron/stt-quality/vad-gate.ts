/**
 * Speech gating for live mic audio.
 *
 * Why this exists: in a real room the mic hears music, dice, chairs and several
 * people. An RMS gate cannot separate that from speech — the music is *louder*
 * than the DM — so whatever the gate lets through gets decoded, and a forced
 * language makes the decoder render noise as its own language ("Yeah, it's
 * trying to make things" under a Portuguese hint). Silero VAD scores the audio
 * for *speech*, not loudness, and only those frames reach the recogniser.
 *
 * This class is the pure part: frame probabilities in, decodable audio out. The
 * model-backed half lives in `transcribe-worker.ts`.
 */

/** p >= threshold on a frame is speech (Silero's own default). */
export const VAD_THRESHOLD = 0.5
/**
 * Once a segment is open, keep frames at this probability. Silero dips inside a
 * word (measured: a real Portuguese phrase has 32 ms frames at 0.2 mid-word);
 * dropping those clips the word, and a closed segment restarts the decoder.
 */
export const VAD_HOLD_THRESHOLD = 0.35

export interface SpeechGateOptions {
  /** Samples per VAD frame (Silero: 512 = 32 ms at 16 kHz). */
  frameSamples?: number
  /** Speech must last this long before a segment opens: a click is not a word. */
  minSpeechMs?: number
  /** Silence this long closes an open segment. */
  minSilenceMs?: number
  /** Audio kept before the first speech frame, so the onset is not clipped. */
  prerollMs?: number
  /** Coalesce decoded audio to at least this many samples; 0 = whole segments. */
  emitSamples?: number
  /** Force-emit an open segment at this size; 0 = never (live audio). */
  maxSamples?: number
}

export interface SpeechGateDrain {
  chunks: Float32Array[]
  /** A segment closed: the sentence is over, commit what the decoder has. */
  closed: boolean
}

const SAMPLE_RATE = 16000

/**
 * Turns VAD frame probabilities into the audio a decoder should see.
 *
 * Two shapes, one state machine: `emitSamples: 0` emits a whole segment when it
 * closes (batch decoders, `maxSamples` caps a long monologue), while a positive
 * `emitSamples` emits coalesced chunks as the segment runs (streaming decoders).
 * Short gaps inside a segment ride along with the speech — at most
 * `minSilenceMs` of it, which is the price of not cutting a phrase in two.
 */
export class SpeechGate {
  private readonly frameSamples: number
  private readonly threshold: number
  private readonly minSpeechFrames: number
  private readonly minSilenceFrames: number
  private readonly prerollFrames: number
  private readonly emitSamples: number
  private readonly maxSamples: number

  /** Frames the VAD has not scored yet, starting on a frame boundary. */
  private undecided: Float32Array[] = []
  private undecidedLen = 0
  /** Audio held before a segment opens: pre-roll plus the unconfirmed onset. */
  private pending: Float32Array[] = []
  private pendingLen = 0
  /** Decided speech waiting to be emitted. */
  private acc: Float32Array[] = []
  private accLen = 0
  private out: Float32Array[] = []

  private speechRun = 0
  private silenceRun = 0
  private open = false
  private closedSinceDrain = false

  constructor(opts: SpeechGateOptions = {}) {
    const frames = (ms: number) => Math.max(1, Math.round((ms * SAMPLE_RATE) / 1000 / (opts.frameSamples ?? 512)))
    this.frameSamples = opts.frameSamples ?? 512
    this.threshold = VAD_THRESHOLD
    this.minSpeechFrames = frames(opts.minSpeechMs ?? 250)
    this.minSilenceFrames = frames(opts.minSilenceMs ?? 300)
    this.prerollFrames = frames(opts.prerollMs ?? 200)
    this.emitSamples = opts.emitSamples ?? 0
    this.maxSamples = opts.maxSamples ?? 0
  }

  /** True while a speech segment is open. */
  get inSpeech(): boolean {
    return this.open
  }

  /**
   * Append audio and the probabilities of the frames it completed, in order.
   * A trailing partial frame stays buffered until the next call; an empty push
   * means "no new audio", which is how the VAD's zero-padded flush frame is
   * scored.
   */
  push(samples: Float32Array, probs: readonly number[]): void {
    if (samples.length > 0) {
      this.undecided.push(samples)
      this.undecidedLen += samples.length
    }
    const complete = Math.floor(this.undecidedLen / this.frameSamples)
    const frames = Math.min(probs.length, samples.length === 0 ? probs.length : complete)
    for (let i = 0; i < frames; i++) this.onFrame(this.takeFrame(), probs[i] ?? 0)
  }

  /** Decided speech chunks since the last drain. */
  drain(): SpeechGateDrain {
    const chunks = this.out
    this.out = []
    const closed = this.closedSinceDrain
    this.closedSinceDrain = false
    return { chunks, closed }
  }

  /** Session end: emit everything still held, including an open segment's tail. */
  flush(): SpeechGateDrain {
    const wasOpen = this.open
    this.open = false
    this.speechRun = 0
    this.silenceRun = 0
    this.pending = []
    this.pendingLen = 0
    this.emitAcc()
    if (wasOpen) this.closedSinceDrain = true
    return this.drain()
  }

  reset(): void {
    this.undecided = []
    this.undecidedLen = 0
    this.pending = []
    this.pendingLen = 0
    this.acc = []
    this.accLen = 0
    this.out = []
    this.speechRun = 0
    this.silenceRun = 0
    this.open = false
    this.closedSinceDrain = false
  }

  private onFrame(samples: Float32Array, prob: number): void {
    // Hysteresis: open on a confident frame, stay open while it only dips.
    if (prob >= (this.open ? VAD_HOLD_THRESHOLD : this.threshold)) {
      this.silenceRun = 0
      if (this.open) {
        this.append(samples)
        return
      }
      this.pushPending(samples)
      this.speechRun++
      if (this.speechRun >= this.minSpeechFrames) this.openSegment()
      return
    }

    if (!this.open) {
      this.speechRun = 0
      this.pushPending(samples)
      return
    }

    // Inside a segment: a short gap is part of the phrase, a long one ends it.
    this.silenceRun++
    this.append(samples)
    if (this.silenceRun >= this.minSilenceFrames) this.closeSegment()
  }

  private openSegment(): void {
    this.open = true
    this.speechRun = 0
    this.silenceRun = 0
    for (const piece of this.pending) this.append(piece)
    this.pending = []
    this.pendingLen = 0
  }

  private closeSegment(): void {
    this.open = false
    this.speechRun = 0
    this.silenceRun = 0
    this.emitAcc()
    this.closedSinceDrain = true
  }

  private pushPending(samples: Float32Array): void {
    this.pending.push(samples)
    this.pendingLen += samples.length
    // Keep only the pre-roll window: the onset is at most minSpeechMs away.
    const keep = (this.prerollFrames + this.minSpeechFrames) * this.frameSamples
    while (this.pendingLen > keep && this.pending.length > 1) {
      const dropped = this.pending.shift() as Float32Array
      this.pendingLen -= dropped.length
    }
  }

  private append(samples: Float32Array): void {
    this.acc.push(samples)
    this.accLen += samples.length
    if (this.emitSamples > 0 && this.accLen >= this.emitSamples) this.emitAcc()
    else if (this.maxSamples > 0 && this.accLen >= this.maxSamples) this.emitAcc()
  }

  private emitAcc(): void {
    if (this.accLen === 0) return
    const merged = new Float32Array(this.accLen)
    let offset = 0
    for (const piece of this.acc) {
      merged.set(piece, offset)
      offset += piece.length
    }
    this.acc = []
    this.accLen = 0
    this.out.push(merged)
  }

  private takeFrame(): Float32Array {
    const head = this.undecided[0]
    if (head && head.length >= this.frameSamples) {
      this.undecidedLen -= this.frameSamples
      if (head.length === this.frameSamples) this.undecided.shift()
      else this.undecided[0] = head.subarray(this.frameSamples)
      return head.subarray(0, this.frameSamples)
    }
    // A short tail is the VAD's zero-padded flush frame.
    this.undecidedLen = Math.max(0, this.undecidedLen - this.frameSamples)
    const frame = new Float32Array(this.frameSamples)
    let filled = 0
    while (filled < this.frameSamples && this.undecided.length > 0) {
      const piece = this.undecided[0]
      const take = Math.min(piece.length, this.frameSamples - filled)
      frame.set(piece.subarray(0, take), filled)
      filled += take
      if (take === piece.length) this.undecided.shift()
      else this.undecided[0] = piece.subarray(take)
    }
    return frame
  }
}
