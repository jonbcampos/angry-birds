import { defineConfig } from 'vite';

// `base` matters for GitHub Pages, which serves from /<repo>/ rather than /.
// The deploy workflow sets GH_PAGES_BASE=/angry-birds/; local dev stays at '/'.
export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? '/',
  server: { host: true },
  build: { target: 'es2022' },
});
