/**
 * Fails the build if anything credential-shaped reached the published bundle.
 *
 * Gitignoring .env keeps a key out of git, not out of the browser: Vite inlines every
 * VITE_-prefixed variable into the built JavaScript. This is the guard that actually
 * enforces the rule, by inspecting the artefact that ships rather than the source.
 *
 *   node scripts/check-secrets.mjs [dir=dist]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'dist'

const PATTERNS = [
  { name: 'Groq key', re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { name: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Bearer literal', re: /\bAuthorization['"\s:]+Bearer\s+[A-Za-z0-9._-]{20,}/gi },
]

const TEXT = /\.(js|mjs|cjs|css|html|json|map|txt|svg)$/i

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

let scanned = 0
const findings = []

try {
  statSync(root)
} catch {
  console.error(`check-secrets: "${root}" does not exist. Build first.`)
  process.exit(1)
}

for (const file of walk(root)) {
  if (!TEXT.test(file)) continue
  scanned += 1
  const content = readFileSync(file, 'utf8')
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0
    const match = re.exec(content)
    if (match) {
      // Report enough to locate it, never the value itself.
      findings.push({ file, name, hint: `${match[0].slice(0, 6)}…${match[0].length} chars` })
    }
  }
}

if (findings.length > 0) {
  console.error(`check-secrets: ${findings.length} credential-shaped string(s) in ${root}\n`)
  for (const f of findings) console.error(`  ${f.name} in ${f.file}  (${f.hint})`)
  console.error('\nA key in the bundle is public. Move it behind a backend proxy.')
  process.exit(1)
}

console.log(`check-secrets: clean (${scanned} files scanned in ${root})`)
