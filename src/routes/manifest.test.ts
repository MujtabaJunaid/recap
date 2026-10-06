import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DYNAMIC_ROUTE_PREFIXES, STATIC_ROUTES } from './manifest'

/**
 * Reads the router source rather than the module, because the goal is to catch a route
 * someone added to App.tsx and forgot to prerender. Importing App would only tell us
 * what the manifest already says.
 */
function declaredPaths(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== '*' && p !== '/')
}

describe('route manifest', () => {
  it('covers every path declared in the router', () => {
    const covered = new Set<string>([...STATIC_ROUTES, ...DYNAMIC_ROUTE_PREFIXES])

    const missing = declaredPaths().filter((path) => {
      const head = path.replace(/^\//, '').split('/')[0]
      return !covered.has(head)
    })

    expect(missing, `add these to src/routes/manifest.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('finds the routes it is meant to be checking', () => {
    // Guards against the regex silently matching nothing and the test passing vacuously.
    expect(declaredPaths().length).toBeGreaterThan(2)
  })
})
