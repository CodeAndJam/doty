/**
 * Turning a growing ASR hypothesis into append-only transcript text, and
 * cutting a live PCM stream into decodable chunks for non-streaming models.
 *
 * Why this exists: streaming models can leave `committed` frozen for tens of
 * seconds while `full` keeps growing (measured: Nemotron 3.5 commits once, then
 * never again for a 48s clip). The transcript must not wait for session stop.
 */

const SENTENCE_END = /[.!?…]+["»”']?(?=\s|$)/g

/**
 * The part of `full` that will not change any more: everything up to the last
 * sentence terminator. Text after it is still being revised, so it stays
 * "tentative" in the UI until the next update or a forced flush.
 */
export function stablePrefix(full: string, minChars = 8): string {
  let end = 0
  SENTENCE_END.lastIndex = 0
  for (let m = SENTENCE_END.exec(full); m; m = SENTENCE_END.exec(full)) end = m.index + m[0].length
  if (end < minChars) return ''
  return full.slice(0, end).trimEnd()
}

/**
 * Emits each new stable slice of a hypothesis exactly once. A hypothesis that
 * gets rewritten behind the emitted text is ignored rather than duplicated —
 * the transcript is append-only.
 */
export class FlushTracker {
  private emitted = ''

  reset(): void {
    this.emitted = ''
  }

  /** Text already handed to the transcript. */
  get settled(): string {
    return this.emitted
  }

  /**
   * @param full current hypothesis (committed + tentative)
   * @param opts `force` commits unfinished sentences (long speech, a pause);
   *             `final` commits everything, including the trailing word
   * @returns newly final text, or '' when nothing new is stable
   */
  update(full: string, opts: { force?: boolean; final?: boolean } = {}): string {
    let stable: string
    if (opts.final) {
      stable = full.trimEnd()
    } else if (opts.force) {
      // Hold back the last word: the model may still be extending it, and a
      // force flush lands in the middle of continuous speech.
      stable = full.trimEnd().replace(/\s+\S+$/, '')
    } else {
      stable = stablePrefix(full)
    }
    if (stable.length <= this.emitted.length) return ''
    // The model rewrote text already emitted: keep the transcript (append-only)
    // and wait for a hypothesis that extends what was settled.
    if (!stable.startsWith(this.emitted)) return ''

    const delta = stable.slice(this.emitted.length).trim()
    this.emitted = stable
    // A lone "." or "," adds nothing to the transcript but must still advance
    // the pointer so it is not re-emitted later.
    if (!/[\p{L}\p{N}]/u.test(delta)) return ''
    return delta
  }
}

/** Max time text may sit inside the hypothesis before it is committed. */
export const MAX_PENDING_MS = 4000
/** Don't force-flush a stray word or two. */
const MIN_FORCED_WORDS = 3

/**
 * The streaming policy: complete sentences go out as soon as they are stable,
 * long unpunctuated speech is committed after {@link MAX_PENDING_MS}, and a
 * pause commits what is left. Time is passed in so the quality gate can drive
 * it deterministically from audio position.
 */
export class LiveWriter {
  private tracker = new FlushTracker()
  private lastEmitMs = 0

  reset(startMs = 0): void {
    this.tracker.reset()
    this.lastEmitMs = startMs
  }

  get settled(): string {
    return this.tracker.settled
  }

  /** Feed a new hypothesis; returns text to append, if any. */
  onHypothesis(full: string, nowMs: number): string {
    const delta = this.tracker.update(full)
    if (delta) {
      this.lastEmitMs = nowMs
      return delta
    }
    const pending = full.slice(this.tracker.settled.length).trim()
    const words = pending ? pending.split(/\s+/).length : 0
    if (nowMs - this.lastEmitMs >= MAX_PENDING_MS && words >= MIN_FORCED_WORDS) {
      const forced = this.tracker.update(full, { force: true })
      if (forced) this.lastEmitMs = nowMs
      return forced
    }
    return ''
  }

  /** The speaker paused: commit the rest of the hypothesis (minus its last word). */
  onSilence(full: string, nowMs: number): string {
    const delta = this.tracker.update(full, { force: true })
    if (delta) this.lastEmitMs = nowMs
    return delta
  }

  /** Session end: commit everything, including the trailing word. */
  onFinal(full: string): string {
    return this.tracker.update(full, { final: true })
  }
}

export interface ChunkBufferOptions {
  /** Hard cut, so text never waits longer than this. */
  maxSamples: number
  /** Never cut before this much audio, even in silence. */
  minSamples?: number
  /** RMS below this counts as silence (~-50 dBFS). */
  silenceRms?: number
  /** Continuous silence needed before an early cut. */
  silenceSamples?: number
  /** How far back from the hard limit to look for a quiet cut point. */
  searchSamples?: number
}

/**
 * Accumulates live PCM and yields chunks for batch-only models. Cuts on a hard
 * maximum, or early once the speaker has clearly stopped.
 *
 * At the hard limit it cuts in the quietest 100ms window of the preceding few
 * seconds instead of mid-word: a blind cut loses the word that straddles it.
 */
export class ChunkBuffer {
  private buf = new Float32Array(0)
  private silentRun = 0
  private readonly maxSamples: number
  private readonly minSamples: number
  private readonly silenceRms: number
  private readonly silenceSamples: number
  private readonly searchSamples: number

  constructor(opts: ChunkBufferOptions) {
    this.maxSamples = opts.maxSamples
    this.minSamples = opts.minSamples ?? 16000 * 2
    this.silenceRms = opts.silenceRms ?? 0.003
    this.silenceSamples = opts.silenceSamples ?? 16000 * 1.5
    this.searchSamples = opts.searchSamples ?? 16000 * 2.5
  }

  get pendingSamples(): number {
    return this.buf.length
  }

  reset(): void {
    this.buf = new Float32Array(0)
    this.silentRun = 0
  }

  push(samples: Float32Array): void {
    const next = new Float32Array(this.buf.length + samples.length)
    next.set(this.buf)
    next.set(samples, this.buf.length)
    this.buf = next
    this.silentRun = rms(samples) < this.silenceRms ? this.silentRun + samples.length : 0
  }

  /** A chunk is ready: hard limit reached, or speech followed by a clear pause. */
  ready(): boolean {
    if (this.buf.length >= this.maxSamples) return true
    return this.buf.length >= this.minSamples && this.silentRun >= this.silenceSamples
  }

  /**
   * Remove the next chunk. Audio after the chosen cut point stays buffered for
   * the next chunk, so nothing is dropped.
   */
  take(): Float32Array {
    if (this.silentRun >= this.silenceSamples) {
      const out = this.buf
      this.reset()
      return out
    }
    const cut = this.quietCut()
    const out = this.buf.slice(0, cut)
    this.buf = this.buf.slice(cut)
    this.silentRun = 0
    return out
  }

  /** Cut point at the quietest 100ms frame within the search window. */
  private quietCut(): number {
    const frame = 1600
    const hop = 800
    const end = Math.min(this.buf.length, this.maxSamples)
    const floor = Math.max(this.minSamples, end - this.searchSamples)
    let cut = end
    let quietest = Number.POSITIVE_INFINITY
    for (let start = floor; start + frame <= end; start += hop) {
      const level = rms(this.buf.subarray(start, start + frame))
      if (level < quietest) {
        quietest = level
        cut = start + frame / 2
      }
    }
    return cut
  }
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}
