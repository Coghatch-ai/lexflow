import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Tailwind 3 is wired via postcss.config.js (autodetected by Vite) — the POC
// design uses @tailwind directives + tailwind.config.js. (Convention default
// is Tailwind 4 via @tailwindcss/vite; kept on 3 to preserve the POC styling.)
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "app", "src"),
      "@drizzle": path.resolve(import.meta.dirname, "drizzle"),
    },
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "app"),
  publicDir: path.resolve(import.meta.dirname, "app", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/app"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
  },
});
