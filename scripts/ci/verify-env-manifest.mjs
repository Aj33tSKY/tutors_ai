// The manifest in config/required-env.json must describe exactly what the app
// reads. A manifest that drifts from the code is worse than none: the parity
// check trusts it, so a name missing from it is a name nobody verifies in either
// Vercel project.
//
// Runs on every pull request. Needs no credentials.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MANIFEST = "config/required-env.json";
const SOURCE_DIR = "src";
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]);

// Supplied by the platform or the framework, so they are never configured by hand.
const PROVIDED_BY_PLATFORM = new Set([
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "CI",
  "PORT",
]);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const declared = new Map(manifest.variables.map((v) => [v.name, v]));

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (CODE_EXTENSIONS.has(extname(entry))) found.push(path);
  }
  return found;
}

const used = new Map();
for (const file of sourceFiles(SOURCE_DIR)) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
    const name = match[1];
    if (PROVIDED_BY_PLATFORM.has(name)) continue;
    if (!used.has(name)) used.set(name, new Set());
    used.get(name).add(file);
  }
}

const problems = [];

for (const [name, files] of [...used].sort()) {
  if (!declared.has(name)) {
    problems.push(
      `${name} is read by ${[...files].join(", ")} but is not in ${MANIFEST}. ` +
        `Add it, or the parity check will not verify it exists in either Vercel project.`,
    );
  }
}

for (const [name] of [...declared].sort()) {
  if (!used.has(name)) {
    problems.push(
      `${name} is declared in ${MANIFEST} but nothing under ${SOURCE_DIR}/ reads it. ` +
        `Remove it, or the manifest overstates what the app needs.`,
    );
  }
}

for (const variable of manifest.variables) {
  for (const field of ["name", "required", "secret", "purpose"]) {
    if (!(field in variable)) {
      problems.push(`${variable.name ?? "(unnamed entry)"} is missing "${field}".`);
    }
  }
  // A blank purpose defeats the point: the next person cannot tell what to set.
  if (typeof variable.purpose === "string" && variable.purpose.trim().length < 10) {
    problems.push(`${variable.name} needs a real purpose, not "${variable.purpose}".`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}

const required = manifest.variables.filter((v) => v.required).length;
console.log(
  `Manifest matches the code: ${declared.size} variables declared (${required} required), ` +
    `${used.size} read under ${SOURCE_DIR}/.`,
);
