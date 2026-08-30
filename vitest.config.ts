import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // examples/ holds deliberately broken code. The engine reads it as text;
    // nothing in there is ever imported or run.
    exclude: ['node_modules/**', 'examples/**'],
  },
});
