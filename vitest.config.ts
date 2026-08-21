import { defineConfig } from 'vitest/config';

/**
 * Unit tests only — the pure modules under `src/`.
 *
 * The end-to-end specs under `e2e/` need a browser and a running local
 * Supabase stack, so they have their own config and their own script and must
 * not be swept up by `pnpm test`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
