import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  // One copy of the images, shared with the legacy app until it is retired.
  publicDir: path.resolve(import.meta.dirname, "../../public"),
  // The shared components were written against Next. These aliases give them the three Next modules
// they use, backed by the router, so the Vite build contains no Next runtime.
  resolve: { alias: [
    { find: "@", replacement: path.resolve(import.meta.dirname, "../../src") },
    { find: /^next\/link$/, replacement: path.resolve(import.meta.dirname, "src/shims/link.tsx") },
    { find: /^next\/image$/, replacement: path.resolve(import.meta.dirname, "src/shims/image.tsx") },
    { find: /^next\/navigation$/, replacement: path.resolve(import.meta.dirname, "src/shims/navigation.ts") },
  ] },
  build: { outDir: "dist", emptyOutDir: true, rolldownOptions: { onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); } } },
  server: { host: "127.0.0.1", port: 5173, proxy: { "/v1": "http://127.0.0.1:3001", "/health": "http://127.0.0.1:3001" } },
});
