import { defineConfig } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const origin = 'http://127.0.0.1:5179'
const python = process.env.E2E_PYTHON || (process.platform === 'win32' ? '.venv312/Scripts/python.exe' : 'python')
// Fresh synthetic test database and encryption key per invocation; never use an operator's DB.
const database = `sqlite:///./backend/data/e2e-${Date.now()}-${randomBytes(5).toString('hex')}.db`
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  use: { baseURL: origin, browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  reporter: 'list',
  webServer: [
    {
      command: `"${python}" -m uvicorn backend.main:app --host 127.0.0.1 --port 8011`,
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      url: 'http://127.0.0.1:8011/api/v1/health', timeout: 120000, reuseExistingServer: false,
      env: { APP_ENV: 'test', DATABASE_URL: database, FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64url') + '=', PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'false' },
    },
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5179 --strictPort',
      url: origin + '/api/v1/health', timeout: 120000, reuseExistingServer: false,
      env: { OPSBRIDGE_API_TARGET: 'http://127.0.0.1:8011' },
    },
  ],
})
