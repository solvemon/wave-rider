import { defineConfig } from 'vite'

export default defineConfig({
  // relative asset paths so the build works on GitHub Pages project sites
  // (served from /<repo>/ rather than the domain root)
  base: './',
})
