import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '#generated': path.resolve(__dirname, '.generated'),
      '#payments': path.resolve(__dirname, 'src/payments'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests spin up a real Postgres via Testcontainers — give them room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
