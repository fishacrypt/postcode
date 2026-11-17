import { defineConfig, devices } from '@playwright/test'

/**
 * Runs against the dev servers (web on 5173, API on 3001). Start both first: `bun run dev` and `bun run dev:api`.
 * Needs system libraries for Chromium (`bunx playwright install --with-deps chromium` on a machine where you can use sudo).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
})
