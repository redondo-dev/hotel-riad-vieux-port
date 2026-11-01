import { defineConfig } from 'vitest/config';

// Unit tests for pure TypeScript logic (no Angular rendering), run with `npm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
