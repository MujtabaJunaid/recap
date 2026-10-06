/**
 * Every route that must exist as a real page in the build.
 *
 * GitHub Pages has no SPA rewrite, so a route missing from this list is served from
 * 404.html: it renders, but with a 404 status. `vite.config.ts` reads this to emit one
 * index.html per route, and `manifest.test.ts` fails if a path declared in App.tsx is
 * missing here — that drift has bitten twice.
 */
export const STATIC_ROUTES = ['actions', 'highlights', 'search', 'signin'] as const

/** Parameterised routes are expanded from seed data at build time. */
export const DYNAMIC_ROUTE_PREFIXES = ['m', 'share'] as const
