import { defineConfig, devices } from '@playwright/test';

// Smoke test of the production build with the real WebZjs engine against
// Zcash mainnet. Needs vendor/ (scripts/build-webzjs.sh), `npm run build`
// and network access to the lightwalletd proxy.
const PORT = 5299;

export default defineConfig({
  testDir: 'tests/e2e-real',
  timeout: 10 * 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
