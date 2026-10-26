import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// GitHub Pages serves the site at https://<user>.github.io/<repo>/.
// In GitHub Actions, GITHUB_REPOSITORY is "<user>/<repo>"; locally it is unset.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repo && !repo.endsWith('.github.io') ? `/${repo}/` : '/'

export default defineConfig({
  plugins: [react()],
  base,
  // Two pages: the walking app (index.html) and the Bauhaus–Hauptbahnhof map (corridor.html).
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        corridor: resolve(import.meta.dirname, 'corridor.html'),
      },
    },
  },
})
