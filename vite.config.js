import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { krakenEndpoint } from './server/kraken.js'

// GitHub Pages serves the site at https://<user>.github.io/<repo>/.
// In GitHub Actions, GITHUB_REPOSITORY is "<user>/<repo>"; locally it is unset.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repo && !repo.endsWith('.github.io') ? `/${repo}/` : '/'

// The kraken judge's endpoint, POST /api/kraken. It exists only in the dev server on your
// laptop (npm run dev), where it asks your Claude account through `claude -p`.
const kraken = {
  name: 'kraken-judge',
  configureServer(server) {
    server.middlewares.use('/api/kraken', krakenEndpoint)
  },
}

export default defineConfig({
  plugins: [react(), kraken],
  base,
  // Three pages: the walking app (index.html), the Bauhaus–Hauptbahnhof map (corridor.html)
  // and the flood game (flood.html).
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        corridor: resolve(import.meta.dirname, 'corridor.html'),
        flood: resolve(import.meta.dirname, 'flood.html'),
      },
    },
  },
})
