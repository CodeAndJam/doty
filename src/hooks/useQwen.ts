import { useCallback, useEffect, useState } from 'react'
import { heuristicRecommend, type TrackMeta } from '../lib/heuristicRecommend'

type Status = 'loading' | 'ready'
type StatusCb = (status: Status) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResolveFn = (v: any) => void
type RejectFn = (e: Error) => void

let _worker: Worker | null = null
let _msgId = 0
const _pending = new Map<number, { resolve: ResolveFn; reject: RejectFn }>()
const _statusListeners = new Set<StatusCb>()
let _currentStatus: Status = 'loading'

function getWorker(): Worker {
  if (_worker) return _worker
  console.log('[qwen-hook] creating worker...')
  _worker = new Worker(new URL('../workers/qwen-worker.ts', import.meta.url))
  _worker.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'status') {
      console.log('[qwen-hook] status:', msg.status, msg.message ?? '')
      _currentStatus = msg.status
      _statusListeners.forEach(cb => cb(msg.status))
      return
    }
    const p = _pending.get(msg.id)
    if (!p) return
    _pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.output)
  }
  _worker.onerror = (e) => {
    console.error('[qwen-hook] worker onerror:', e.message, e.filename, e.lineno, e.error)
    for (const [id, p] of _pending) {
      _pending.delete(id)
      p.reject(new Error(e.message || 'worker error'))
    }
    _worker = null
  }
  _worker.onmessageerror = (e) => {
    console.error('[qwen-hook] worker messageerror:', e)
  }
  console.log('[qwen-hook] worker created')
  return _worker
}

function workerInfer(messages: unknown[], options: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++_msgId
    _pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, messages, options })
  })
}

function formatTrack(filename: string, index: number): string {
  return `${index + 1}. ${filename}`
}

export function useQwen() {
  const [modelStatus, setModelStatus] = useState<Status>(_currentStatus)

  useEffect(() => {
    const cb: StatusCb = (s) => setModelStatus(s)
    _statusListeners.add(cb)
    // Eagerly spin up the worker — model starts loading immediately
    getWorker()
    return () => { _statusListeners.delete(cb) }
  }, [])

  const recommend = useCallback(async (transcript: string, files: string[]): Promise<string[]> => {
    if (files.length === 0) return []

    // While model is loading or if it errors, use the heuristic ranker
    if (_currentStatus === 'loading') {
      console.log('[qwen-hook] model loading — using heuristic ranker')
      const metadata = await window.doty.getAllMetadata() as Record<string, TrackMeta>
      return heuristicRecommend(transcript, files, metadata)
    }

    try {
      const messages = [
        {
          role: 'system',
          content: 'You are a music mood matcher. Given a conversation transcript and a list of songs, pick the 5 best matching songs. Return ONLY a valid JSON array of exactly 5 filenames from the provided list. No explanation, no markdown, no code block. /no_think',
        },
        {
          role: 'user',
          content: `Transcript:\n"${transcript.slice(0, 600)}"\n\nSong list:\n${files.slice(0, 100).map(formatTrack).join('\n')}\n\nReturn a JSON array of 5 filenames.`,
        },
      ]
      const output = await workerInfer(messages, {
        max_new_tokens: 300,
        temperature: 0.3,
        do_sample: true,
      }) as Array<{ generated_text: Array<{ content: string }> }>

      const text = output?.[0]?.generated_text?.at(-1)?.content ?? ''
      console.log('[qwen-hook] raw output:', text.slice(0, 300))

      const match = text.match(/\[[\s\S]*\]/)
      if (!match) {
        console.log('[qwen-hook] no JSON — falling back to heuristic')
        const metadata = await window.doty.getAllMetadata() as Record<string, TrackMeta>
        return heuristicRecommend(transcript, files, metadata)
      }

      const parsed: string[] = JSON.parse(match[0])
      const normalised = parsed.map(f => f.replace(/^\d+\.\s*/, '').trim())
      const valid = normalised.filter(f => files.includes(f)).slice(0, 5)
      if (valid.length === 0) {
        console.log('[qwen-hook] no valid filenames — falling back to heuristic')
        const metadata = await window.doty.getAllMetadata() as Record<string, TrackMeta>
        return heuristicRecommend(transcript, files, metadata)
      }
      return valid
    } catch (e) {
      console.error('[qwen-hook] recommend error:', e)
      const metadata = await window.doty.getAllMetadata() as Record<string, TrackMeta>
      return heuristicRecommend(transcript, files, metadata)
    }
  }, [])

  return { recommend, modelStatus }
}
