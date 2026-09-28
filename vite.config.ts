import { defineConfig } from 'vite';

export default defineConfig({
  // Pre-bundling moves maplibre's module out of dist/, which breaks the relative URL of its web worker.
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
