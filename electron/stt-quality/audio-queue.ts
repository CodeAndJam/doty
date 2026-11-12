/**
 * Holds captured audio while the recognizer is still loading a model, then
 * replays it in order. A cold Metal model load takes ~10 s; without this the
 * first words of a session are dropped.
 */
export class AudioQueue {
  private items: Float32Array[] = []
  private readonly max: number

  constructor(max: number) {
    this.max = max
  }

  get length(): number {
    return this.items.length
  }

  /** Copies the samples: the caller's buffer is reused by the audio worklet. */
  push(samples: Float32Array): void {
    // Keep the most recent window: it stays contiguous with the live audio once
    // the model is ready, instead of replaying stale audio and dropping the tail.
    if (this.items.length >= this.max) this.items.shift()
    this.items.push(samples.slice())
  }

  /** Everything queued, oldest first; the queue is empty afterwards. */
  drain(): Float32Array[] {
    const out = this.items
    this.items = []
    return out
  }

  clear(): void {
    this.items = []
  }
}
