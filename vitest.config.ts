import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      obsidian: new URL("./tests/obsidian-mock.ts", import.meta.url).pathname,
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
