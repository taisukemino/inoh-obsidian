import { defineConfig } from '@playwright/test';

/**
 * End-to-end config for the Obsidian plugin against the local Supabase stack.
 *
 * One worker, always: the suite launches a real Obsidian process bound to a
 * fixed debug port, and two of those cannot coexist.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './artifacts/runs',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: './artifacts/report', open: 'never' }]],
  // Launching Obsidian and loading the plugin dominates the first test.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
