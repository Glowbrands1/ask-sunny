import { defineConfig } from "@playwright/test";

/**
 * Browser QA for the invitation pages. Runs against the DISPOSABLE local stack
 * and a dev server pointed at it — see e2e/README.md. Never against Production.
 *
 *   npm run stack:up
 *   (set -a; . /tmp/ask-sunny-local-stack/env; set +a; \
 *    NEXT_PUBLIC_SUPABASE_URL=$LOCAL_STACK_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$LOCAL_ANON_KEY \
 *    SUPABASE_SECRET_KEY=$LOCAL_SERVICE_ROLE_KEY NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 \
 *    npx next dev -p 3000 -H 127.0.0.1) &
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
    screenshot: "only-on-failure",
  },
});
