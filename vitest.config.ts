import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: [
      "api/**/*.test.ts",
      "shared/**/*.test.ts",
      "scripts/**/*.test.ts",
      "app/src/**/*.test.{ts,tsx}",
    ],
    passWithNoTests: true,
  },
});
