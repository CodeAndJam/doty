/**
 * Opt-in debug logging — the file a DM can bring back from another Mac.
 *
 * Off by default. When on, main-process console output is mirrored to
 * `~/.doty/logs/doty.log`; nothing is uploaded and no telemetry is added.
 */
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { format } from 'node:util'
import { DOTY_HOME } from './profile'

const MAX_BYTES = 2 * 1024 * 1024
const TAIL_BYTES = 128 * 1024

export interface DebugLogger {
  readonly path: string
  isEnabled(): boolean
  setEnabled(enabled: boolean): void
  ensure(): void
  write(level: 'log' | 'warn' | 'error', args: unknown[]): void
  /** Last `limit` lines, oldest first. */
  tail(limit?: number): string
}

export function createDebugLogger(path: string): DebugLogger {
  let enabled = false

  const write = (level: 'log' | 'warn' | 'error', args: unknown[]): void => {
    if (!enabled) return
    try {
      fs.mkdirSync(dirname(path), { recursive: true })
      if (fs.existsSync(path) && fs.statSync(path).size > MAX_BYTES) fs.renameSync(path, `${path}.1`)
      fs.appendFileSync(path, `${new Date().toISOString()} ${level} ${format(...args)}\n`)
    } catch {
      // A failed log write must never be the reason playback stops.
    }
  }

  return {
    path,
    isEnabled: () => enabled,
    setEnabled(on) {
      enabled = on
      if (on) write('log', [`[debug] logging to ${path}`])
    },
    ensure() {
      try {
        fs.mkdirSync(dirname(path), { recursive: true })
        fs.closeSync(fs.openSync(path, 'a'))
      } catch {
        // The log viewer says "no entries" if this fails; it does not crash.
      }
    },
    write,
    tail(limit = 200) {
      try {
        const size = fs.statSync(path).size
        const start = Math.max(0, size - TAIL_BYTES)
        const buffer = Buffer.alloc(size - start)
        const fd = fs.openSync(path, 'r')
        fs.readSync(fd, buffer, 0, buffer.length, start)
        fs.closeSync(fd)
        return buffer.toString('utf8').split('\n').filter(Boolean).slice(-limit).join('\n')
      } catch {
        return ''
      }
    },
  }
}

export const debugLogger = createDebugLogger(join(DOTY_HOME, 'logs', 'doty.log'))

let capturing = false

/** Turn file logging on or off, and mirror console output once it is on. */
export function enableDebugLogging(enabled: boolean): void {
  debugLogger.setEnabled(enabled)
  if (capturing) return
  capturing = true
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level]
    console[level] = (...args: unknown[]) => {
      original(...args)
      debugLogger.write(level, args)
    }
  }
}
