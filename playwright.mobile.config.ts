import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Optional Safari-engine coverage; install with `npx playwright install webkit`.
// Do not inherit the desktop Chrome channel when launching WebKit.
const { channel: _desktopChannel, ...sharedUse } = base.use || {};
export default defineConfig({
  ...base,
  use: sharedUse,
  testMatch: "mobile.spec.ts",
  projects: [
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
