import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['src/**/*.test.js'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.js'],
      exclude: ['src/lib/ai-entry.js', 'src/lib/export-entry.js']
    }
  }
});
