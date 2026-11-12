import { describe, expect, it } from 'vitest'
import { AudioQueue } from './audio-queue'

describe('AudioQueue', () => {
  it('replays chunks oldest first', () => {
    const q = new AudioQueue(10)
    q.push(new Float32Array([1]))
    q.push(new Float32Array([2]))
    expect(q.drain().map((c) => c[0])).toEqual([1, 2])
    expect(q.length).toBe(0)
  })

  it('copies the caller buffer', () => {
    const q = new AudioQueue(10)
    const chunk = new Float32Array([0.5])
    q.push(chunk)
    chunk[0] = 1
    expect(q.drain()[0][0]).toBe(0.5)
  })

  it('drops audio past the cap instead of growing without bound', () => {
    const q = new AudioQueue(2)
    q.push(new Float32Array([1]))
    q.push(new Float32Array([2]))
    q.push(new Float32Array([3]))
    expect(q.length).toBe(2)
    expect(q.drain().map((c) => c[0])).toEqual([1, 2])
  })

  it('clears queued audio', () => {
    const q = new AudioQueue(2)
    q.push(new Float32Array([1]))
    q.clear()
    expect(q.drain()).toEqual([])
  })
})
