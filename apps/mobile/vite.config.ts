import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// Second Vite frontend: the mobile-first POC. Roots at apps/mobile, but reuses
// the repo-root .env and the shared source trees (api types, shared/ domain,
// drizzle schema) via explicit aliases. The main app (app/) is untouched.
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@m": path.resolve(repoRoot, "apps", "mobile", "src"),
      "@api": path.resolve(repoRoot, "api"),
      "@shared": path.resolve(repoRoot, "shared"),
      "@drizzle": path.resolve(repoRoot, "drizzle"),
    },
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  envDir: repoRoot,
  root: path.resolve(repoRoot, "apps", "mobile"),
  publicDir: path.resolve(repoRoot, "apps", "mobile", "public"),
  build: {
    outDir: path.resolve(repoRoot, "dist", "mobile"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
  },
});
