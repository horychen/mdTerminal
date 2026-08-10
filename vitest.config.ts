import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `dist` holds compiled copies of these same tests; running both doubles
    // the count and hides which source a failure came from.
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
