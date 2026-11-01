import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    environment: 'node',
    // Rebuilds the dedicated test database before the run (nothing without TEST_DATABASE_URL).
    globalSetup: ['tests/support/global-setup.ts'],
    // The database tests share one database: one test file at a time.
    fileParallelism: false,
    // Password hashing (Argon2) is deliberately slow.
    testTimeout: 20_000,
  },
});
