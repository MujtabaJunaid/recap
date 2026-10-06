/**
 * Transcripts are the most sensitive thing this product holds. Inside the workspace the
 * viewer is a participant and sees them verbatim; on a public share link the viewer is a
 * stranger holding a URL, so identifiers that are incidental to the clip are masked
 * before render.
 *
 * This is defence in depth, not the control. The real control is server-side: a share
 * token resolves to a clip and the surrounding meeting is never sent to the client at
 * all. Masking here limits what leaks if a clip's own lines happen to contain
 * identifiers, and it is why `redactForPublic` is applied at the public boundary only.
 */

export type RedactionKind = 'email' | 'phone' | 'card' | 'iban' | 'secret'

interface Rule {
  kind: RedactionKind
  pattern: RegExp
  label: string
}

const RULES: Rule[] = [
  { kind: 'email', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g, label: '[email removed]' },
  {
    kind: 'card',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    label: '[card number removed]',
  },
  {
    kind: 'iban',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    label: '[account number removed]',
  },
  {
    kind: 'phone',
    pattern: /(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?)?\d{3,4}[ -]\d{3,4}(?:[ -]\d{3,4})?\b/g,
    label: '[phone removed]',
  },
  {
    kind: 'secret',
    pattern: /\b(?:sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9-_]{12,}\b/g,
    label: '[credential removed]',
  },
]

export interface RedactionResult {
  text: string
  removed: RedactionKind[]
}

export function redactForPublic(text: string): RedactionResult {
  const removed = new Set<RedactionKind>()
  let out = text

  for (const rule of RULES) {
    // Rules carry /g, so reset lastIndex before reuse across calls.
    rule.pattern.lastIndex = 0
    out = out.replace(rule.pattern, (match) => {
      // Timecodes and ordinary figures should survive the phone rule.
      if (rule.kind === 'phone' && !/\d[ -]\d/.test(match)) return match
      removed.add(rule.kind)
      return rule.label
    })
  }

  return { text: out, removed: [...removed] }
}

export function redactLines<T extends { text: string }>(
  lines: T[],
): { lines: T[]; removed: RedactionKind[] } {
  const removed = new Set<RedactionKind>()
  const out = lines.map((line) => {
    const result = redactForPublic(line.text)
    for (const kind of result.removed) removed.add(kind)
    return result.text === line.text ? line : { ...line, text: result.text }
  })
  return { lines: out, removed: [...removed] }
}
