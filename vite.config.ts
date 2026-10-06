import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves project sites under /<repo>/. GITHUB_REPOSITORY is set by Actions,
// so the deployed base resolves itself and local builds stay at the root.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  base: repo ? `/${repo}/` : '/',
  plugins: [react(), tailwindcss()],
})
