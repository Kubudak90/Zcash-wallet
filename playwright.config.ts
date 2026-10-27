import { defineConfig, devices } from '@playwright/test';

// UI flows run against the dev server with the scripted fake engine
// (VITE_FAKE_ENGINE=1), so they need neither wasm nor network access.
const PORT = 5199;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    env: { VITE_FAKE_ENGINE: '1' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
