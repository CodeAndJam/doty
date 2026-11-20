import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { DOTY_HOME } from './profile'
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
  /** Set when the cue is a WebVTT voice span (`<v Ana>…</v>`). */
  speaker?: string
}

const DEFAULT_SESSIONS_DIR = join(DOTY_HOME, 'sessions')

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
  activeSession = file
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
      const parsed = parseVoiceSpan(textLines.join('\n'))
      cues.push({ start, end, ...parsed })
    } else {
      i++
    }
  }
  return cues
}

let appendFailed = false

export function appendCue(file: string, elapsedMs: number, text: string, speaker?: string): void {
  const start = formatTimestamp(elapsedMs)
  const end = formatTimestamp(elapsedMs + 3000)
  // WebVTT voice span: the file stays valid for any player, and loadSession
  // reads the tag back into a speaker instead of showing it as text.
  const body = speaker ? `<v ${safeVoiceName(speaker)}>${safeVoiceText(text)}</v>` : text
  const cue = `${start} --> ${end}\n${body}\n\n`
  try {
    fs.appendFileSync(file, cue, 'utf-8')
  } catch (e) {
    // An ejected disk or a full volume must not take the session down with it.
    // One line, then silence: the transcript is still in the UI and the WAV.
    if (!appendFailed) {
      appendFailed = true
      console.error('[session] transcript append failed:', e instanceof Error ? e.message : e)
    }
  }
}

/** Write a whole file through a temp name, so a crash leaves the old one intact. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, file)
}

/**
 * A display name is user input: `>` closes the tag early, and a newline ends the
 * cue. Both would make the file parse as a different speaker than it says.
 */
function safeVoiceName(name: string): string {
  return (
    name
      .replace(/[<>\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Remote'
  )
}

/** The closing tag must survive the text as well. */
function safeVoiceText(text: string): string {
  return text.replace(/<\/v>/gi, '')
}

/**
 * WebVTT's own speaker markup. A cue with no `<v>` span is the DM's mic, which
 * is every session recorded before participant capture existed.
 */
function parseVoiceSpan(text: string): { text: string; speaker?: string } {
  const match = /^<v(?:\.[^ >]+)*\s+([^>]+)>([\s\S]*)<\/v>$/.exec(text.trim())
  if (!match) return { text }
  return { text: match[2], speaker: match[1].trim() }
}

/** Start timestamp of the last cue in a session, in ms (0 for a new/empty file). */
export function getLastCueStartMs(file: string): number {
  try {
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      // A cue *text* may contain "-->"; only a line that starts with a timestamp
      // is a cue header.
      const m = /^(\d+):(\d+):(\d+)\.(\d+)\s+-->/.exec(lines[i].trim())
      if (!m) continue
      return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4])
    }
  } catch {
    /* unreadable session */
  }
  return 0
}

export function renameSession(file: string, newName: string): void {
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf-8')
  // A function replacement: a typed `$&` is part of the name, not a pattern.
  const safe = newName
    .replace(/[\r\n]+/g, ' ')
    .replace(/-->/g, '->')
    .trim()
  const updated = content.replace(/^(NOTE\n)Name: .*/m, (_match, note: string) => `${note}Name: ${safe}`)
  writeAtomic(file, updated)
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

/** Session that new transcript cues are appended to (may differ from last viewed). */
let activeSession: string | null = null

export function setActiveSession(file: string | null): void {
  activeSession = file
}

export function getActiveSession(): string | null {
  if (activeSession && fs.existsSync(activeSession)) return activeSession
  return null
}

/** True when `file` is a .vtt inside the configured sessions directory. */
export function isSessionPath(file: string): boolean {
  const dir = resolve(getSessionsDir())
  const resolved = resolve(file)
  return resolved.startsWith(dir + sep) && resolved.endsWith('.vtt')
}

export function rewriteSessionCues(file: string, cues: Array<{ start: string; end: string; text: string }>): void {
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf-8')
  // Preserve WEBVTT header and NOTE block
  const noteEnd = content.indexOf('\n\n', content.indexOf('NOTE'))
  const header = noteEnd > 0 ? content.slice(0, noteEnd + 2) : 'WEBVTT\n\n'
  const body = cues.map((c) => `${c.start} --> ${c.end}\n${c.text}\n`).join('\n')
  writeAtomic(file, header + body)
}

export async function loadSessionAsync(file: string): Promise<VttCue[]> {
  try {
    const content = await fsPromises.readFile(file, 'utf-8')
    return parseVttCues(content)
  } catch {
    return []
  }
}

function parseVttCues(content: string): VttCue[] {
  const cues: VttCue[] = []
  const lines = content.split('\n')
  let i = 0
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
      const parsed = parseVoiceSpan(textLines.join('\n'))
      cues.push({ start, end, ...parsed })
    } else {
      i++
    }
  }
  return cues
}

export function deleteSession(file: string): void {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    const wavPath = file.replace(/\.vtt$/, '.wav')
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath)
    // The remote lane keeps its own take beside the mic's.
    const remoteWavPath = file.replace(/\.vtt$/, '-remote.wav')
    if (fs.existsSync(remoteWavPath)) fs.unlinkSync(remoteWavPath)
  } catch {
    /* non-fatal */
  }
}
