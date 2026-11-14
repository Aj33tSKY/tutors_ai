import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.resolve(import.meta.dirname, "public"),
  build: { outDir: "dist", emptyOutDir: true, rolldownOptions: { onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); } } },
  server: { host: "127.0.0.1", port: 5173, proxy: { "/v1": "http://127.0.0.1:3001", "/health": "http://127.0.0.1:3001" } },
});
