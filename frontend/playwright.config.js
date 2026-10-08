import { defineConfig, devices } from '@playwright/test'

// End-to-end tests (e2e/). Unit tests stay in vitest beside the code in src/lib; these drive
// the real app in a browser. `npm run test:e2e` boots the Vite dev server itself — no API is
// needed for screens that work in guest mode.
const port = Number(process.env.E2E_PORT || 5173)
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Use a preinstalled Chromium instead of `npx playwright install` (e.g. a CI image or sandbox)
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ],
  // Point E2E_BASE_URL at an already-running instance (e.g. docker compose) to skip this.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI
  }
})
