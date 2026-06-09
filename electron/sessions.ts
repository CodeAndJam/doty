import fs from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { store } from './store'

export interface SessionMeta {
  file: string
  name: string
  created: string
}

export interface VttCue {
  start: string
  end: string
  text: string
}

const DEFAULT_SESSIONS_DIR = join(app.getPath('home'), '.doty', 'sessions')

export function getSessionsDir(): string {
  const custom = store.get('transcriptFolder', '') as string
  return custom || DEFAULT_SESSIONS_DIR
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const s = String(totalSec % 60).padStart(2, '0')
  const millis = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s}.${millis}`
}

export function createSession(name?: string): SessionMeta {
  const dir = getSessionsDir()
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `session-${ts}.vtt`)
  const created = new Date().toISOString()
  const displayName = name || new Date().toLocaleString()

  const header = `WEBVTT\nNOTE\nName: ${displayName}\nCreated: ${created}\n\n`
  fs.writeFileSync(file, header, 'utf-8')

  store.set('lastSession', file)
  return { file, name: displayName, created }
}

export function listSessions(): SessionMeta[] {
  const dir = getSessionsDir()
  if (!fs.existsSync(dir)) return []
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.vtt'))
    .sort()
    .reverse()
  return files.map((f) => {
    const filePath = join(dir, f)
    const meta = parseNoteBlock(filePath)
    return { file: filePath, name: meta.name, created: meta.created }
  })
}

export function loadSession(file: string): VttCue[] {
  if (!fs.existsSync(file)) return []
  const content = fs.readFileSync(file, 'utf-8')
  const cues: VttCue[] = []
  const lines = content.split('\n')
  let i = 0
  // Skip header and NOTE block
  while (i < lines.length && !lines[i].includes('-->')) i++
  while (i < lines.length) {
    const line = lines[i]
    if (line.includes('-->')) {
      const [start, end] = line.split('-->').map((s) => s.trim())
      const textLines: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i])
        i++
      }
      cues.push({ start, end, text: textLines.join('\n') })
    } else {
      i++
    }
  }
  return cues
}

export function appendCue(file: string, elapsedMs: number, text: string): void {
  const start = formatTimestamp(elapsedMs)
  const end = formatTimestamp(elapsedMs + 3000)
  const cue = `${start} --> ${end}\n${text}\n\n`
  fs.appendFileSync(file, cue, 'utf-8')
}

export function renameSession(file: string, newName: string): void {
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf-8')
  const updated = content.replace(/^(NOTE\n)Name: .*/m, `$1Name: ${newName}`)
  fs.writeFileSync(file, updated, 'utf-8')
}

function parseNoteBlock(file: string): { name: string; created: string } {
  const content = fs.readFileSync(file, 'utf-8').slice(0, 500)
  const nameMatch = content.match(/^Name: (.+)$/m)
  const createdMatch = content.match(/^Created: (.+)$/m)
  const fallbackName = basename(file, '.vtt').replace('session-', '').replace(/T/, ' ').replace(/-/g, ':').slice(0, 16)
  return {
    name: nameMatch?.[1] || fallbackName,
    created: createdMatch?.[1] || '',
  }
}

export function getLastSession(): string | null {
  const last = store.get('lastSession', '') as string
  if (last && fs.existsSync(last)) return last
  return null
}

export function setLastSession(file: string): void {
  store.set('lastSession', file)
}

export function rewriteSessionCues(file: string, cues: Array<{ start: string; end: string; text: string }>): void {
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf-8')
  // Preserve WEBVTT header and NOTE block
  const noteEnd = content.indexOf('\n\n', content.indexOf('NOTE'))
  const header = noteEnd > 0 ? content.slice(0, noteEnd + 2) : 'WEBVTT\n\n'
  const body = cues.map((c) => `${c.start} --> ${c.end}\n${c.text}\n`).join('\n')
  fs.writeFileSync(file, header + body, 'utf-8')
}
