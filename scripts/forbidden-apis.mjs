/**
 * Guards that only reading the source can enforce.
 *
 * `window.prompt` throws when called, and it types as a function, so neither the
 * typechecker nor a runtime probe finds it — only reading the source does. The
 * lane badge's "new session" button shipped with it once and created nothing.
 *
 * The e2e rule protects the opposite direction: a spec that runs against the
 * DM's real profile must put back the folder or model it changes. A local run
 * once left the developer's library pointing at `e2e/fixtures`.
 */
import fs from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'src')
const E2E = join(process.cwd(), 'e2e')
const BANNED = [
  {
    pattern: /\bwindow\.prompt\s*\(/,
    message: 'Electron does not implement window.prompt. Build an in-app field.',
  },
]

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const problems = []
for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const rule of BANNED) {
      if (rule.pattern.test(line)) problems.push(`${file}:${i + 1} ${rule.message}`)
    }
  })
}

for (const name of fs.readdirSync(E2E).filter((file) => file.endsWith('.spec.ts'))) {
  const file = join(E2E, name)
  const text = fs.readFileSync(file, 'utf8')
  // A temp HOME or profile is disposable; the real profile is not.
  if (/\bDOTY_PROFILE\b|\bHOME:/.test(text)) continue
  if (text.includes('setMusicFolder') && !text.includes('previousFolder')) {
    problems.push(`${file} changes the real profile's music folder without restoring it (add previousFolder)`)
  }
  if (text.includes('setSttModel') && !text.includes('previousModel')) {
    problems.push(`${file} changes the real profile's STT model without restoring it (add previousModel)`)
  }
}

if (problems.length > 0) {
  console.error('[forbidden-apis]\n' + problems.map((p) => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log('[forbidden-apis] none used')
