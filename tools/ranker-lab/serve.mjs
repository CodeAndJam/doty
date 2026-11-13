#!/usr/bin/env node
/**
 * Serves the ranker lab with the dataset and the music library already loaded.
 *
 *   node tools/ranker-lab/serve.mjs            # then open the printed URL
 *   DOTY_MUSIC=~/Music node tools/ranker-lab/serve.mjs
 *
 * Binds loopback only, and every audio path is resolved inside the music folder,
 * so it cannot read anything else. No dependencies: a lab should not need a
 * toolchain to open.
 */
import fs from 'node:fs'
import http from 'node:http'
import { homedir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'

const HERE = import.meta.dirname
const ROOT = resolve(HERE, '..', '..')
const ROWS = join(ROOT, 'test-fixtures', 'ranker', 'rows.json')
const MUSIC = resolve((process.env.DOTY_MUSIC ?? join(homedir(), 'Documents', 'Music')).replace(/^~/, homedir()))
const PORT = Number(process.env.PORT ?? 4173)

const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac', '.opus'])

function index(dir, prefix = '') {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...index(join(dir, entry.name), rel))
    else if (AUDIO.has(extname(entry.name).toLowerCase())) out.push(rel)
  }
  return out
}

/** Resolve a requested relative path inside the music folder, or null. */
function safeMusicPath(requested) {
  const normal = normalize(requested).replace(/^([.]{2}[/\\])+/, '')
  const full = resolve(join(MUSIC, normal))
  if (!full.startsWith(MUSIC + sep)) return null
  return AUDIO.has(extname(full).toLowerCase()) ? full : null
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(200, 'text/html; charset=utf-8', fs.readFileSync(join(HERE, 'index.html')))
  }
  if (url.pathname === '/rows.json') {
    if (!fs.existsSync(ROWS)) return send(404, 'application/json', '{"error":"run pnpm ranker:rows"}')
    return send(200, 'application/json', fs.readFileSync(ROWS))
  }
  if (url.pathname === '/library.json') {
    return send(200, 'application/json', JSON.stringify({ folder: MUSIC, files: index(MUSIC) }))
  }
  if (url.pathname === '/audio') {
    const full = safeMusicPath(url.searchParams.get('path') ?? '')
    if (!full || !fs.existsSync(full)) return send(404, 'text/plain', 'not found')
    const stat = fs.statSync(full)
    res.writeHead(200, {
      'content-type': `audio/${extname(full).replace('.', '')}`,
      'content-length': stat.size,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    })
    return fs.createReadStream(full).pipe(res)
  }
  return send(404, 'text/plain', 'not found')
})

server.listen(PORT, '127.0.0.1', () => {
  const tracks = index(MUSIC).length
  console.log(`Ranker lab  http://127.0.0.1:${PORT}`)
  console.log(`library     ${MUSIC} (${tracks} tracks)`)
  console.log(`rows        ${fs.existsSync(ROWS) ? 'loaded' : 'missing — run pnpm ranker:rows'}`)
})
