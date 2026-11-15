// The runtime image installs only each service's declared dependencies. A bundle that imports a
// package nobody declared builds fine and crashes on start, so check it after every build.
import { readFile } from "node:fs/promises";

const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const declared = async (...workspaces) => {
  const names = new Set();
  for (const workspace of workspaces) for (const name of Object.keys((await read(`${workspace}/package.json`)).dependencies ?? {})) names.add(name);
  return names;
};
// Which workspaces' dependencies each deployable can see (its own plus the shared packages it bundles).
const shared = ["packages/jobs", "packages/data", "packages/domain", "packages/contracts"];
const bundles = { "dist/api.mjs": ["apps/api", ...shared], "dist/worker.mjs": ["apps/worker", ...shared], "dist/migrate-jobs.mjs": ["apps/worker", ...shared], "dist/job-ownership.mjs": ["apps/worker", ...shared] };
const problems = [];
for (const [bundle, workspaces] of Object.entries(bundles)) {
  const source = await readFile(bundle, "utf8").catch(() => null);
  if (source === null) { problems.push(`${bundle} is missing; run npm run build:portable first.`); continue; }
  const available = await declared(...workspaces);
  const imports = new Set([...source.matchAll(/^(?:import|export)[^"'\n]*?from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]));
  for (const specifier of imports) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) continue;
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    if (!available.has(name)) problems.push(`${bundle} imports "${name}", which is not declared by ${workspaces.join(", ")}. The runtime image would not contain it.`);
  }
}
if (problems.length) { for (const problem of problems) console.error(`::error::${problem}`); process.exit(1); }
console.info("Every external import of the deployable bundles is a declared runtime dependency.");
