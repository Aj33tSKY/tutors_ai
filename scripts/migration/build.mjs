import { build } from "esbuild";
import { build as buildWeb } from "vite";

for (const [entry, outfile] of [
  ["apps/api/src/index.ts", "dist/api.mjs"],
  ["apps/worker/src/index.ts", "dist/worker.mjs"],
  ["scripts/migration/migrate-jobs.ts", "dist/migrate-jobs.mjs"],
]) {
  await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format: "esm", target: "node24", packages: "external", sourcemap: true });
}
await buildWeb({ configFile: "apps/web/vite.config.ts" });
