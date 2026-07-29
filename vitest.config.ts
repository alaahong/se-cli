import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests start browser daemons which need more time
    testTimeout: 120000,
  },
});
