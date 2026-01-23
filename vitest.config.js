import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    ui: false,
    watch: false,
  },
  resolve: {
    alias: {
      '@': '/docs/src',
    },
  },
});
