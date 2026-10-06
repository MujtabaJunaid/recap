import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { MEETINGS, SHARED_CLIPS } from './src/data'
import { STATIC_ROUTES } from './src/routes/manifest'

// GitHub Pages serves project sites under /<repo>/. GITHUB_REPOSITORY is set by Actions,
// so the deployed base resolves itself and local builds stay at the root.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]

/**
 * Pages has no SPA rewrite, so a deep link would otherwise fall through to 404.html and
 * be served with a 404 status even though the app renders. Every route is known at build
 * time, so each one gets a real index.html and a real 200 — which matters most for shared
 * clip links, where a 404 breaks link unfurling in Slack and the like.
 */
function staticRoutes(): Plugin {
  const routes = [
    ...STATIC_ROUTES,
    ...MEETINGS.map((m) => `m/${m.id}`),
    ...SHARED_CLIPS.map((c) => `share/${c.id}`),
  ]

  return {
    name: 'recap:static-routes',
    apply: 'build',
    closeBundle() {
      const dist = resolve(__dirname, 'dist')
      const index = resolve(dist, 'index.html')

      // connect-src stays 'self' unless a proxy is configured, so the default build
      // cannot talk to anything at all.
      const api = process.env.VITE_API_BASE_URL
      if (api) {
        const origin = new URL(api).origin
        const html = readFileSync(index, 'utf8').replace(
          "connect-src 'self'",
          `connect-src 'self' ${origin}`,
        )
        writeFileSync(index, html)
        this.info(`CSP connect-src extended to ${origin}`)
      }

      copyFileSync(index, resolve(dist, '404.html'))
      for (const route of routes) {
        const dir = resolve(dist, route)
        mkdirSync(dir, { recursive: true })
        copyFileSync(index, resolve(dir, 'index.html'))
      }
      this.info(`emitted ${routes.length} static routes + 404 fallback`)
    },
  }
}

export default defineConfig({
  base: repo ? `/${repo}/` : '/',
  plugins: [react(), tailwindcss(), staticRoutes()],
})
