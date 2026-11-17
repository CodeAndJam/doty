/**
 * Browser APIs Electron does not implement.
 *
 * `window.prompt` throws when called, and it types as a function, so neither the
 * typechecker nor a runtime probe finds it — only reading the source does. The
 * lane badge's "new session" button shipped with it once and created nothing.
 */
import fs from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'src')
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

if (problems.length > 0) {
  console.error('[forbidden-apis]\n' + problems.map((p) => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log('[forbidden-apis] none used')
