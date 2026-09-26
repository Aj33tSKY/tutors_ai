// Staging and production should differ only in credentials and which resources
// they address — never in which variables exist. This compares the *shape* of
// both Vercel projects against config/required-env.json and against each other.
//
// It reads names only. Values are intentionally different and are never fetched,
// so nothing secret passes through this script or its output.
//
// Run before a production release: a variable missing from one project fails at
// runtime in that environment, and production is the environment where finding
// out late is expensive.
//
// Usage: node scripts/ci/verify-env-parity.mjs
// Needs: VERCEL_TOKEN, VERCEL_ORG_ID, PRODUCTION_VERCEL_PROJECT_ID,
//        STAGING_VERCEL_PROJECT_ID
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MANIFEST = "config/required-env.json";
const VERCEL_CLI = process.env.VERCEL_CLI_VERSION ?? "60.0.1";

const token = requireEnv("VERCEL_TOKEN");
const scope = requireEnv("VERCEL_ORG_ID");
const projects = {
  production: requireEnv("PRODUCTION_VERCEL_PROJECT_ID"),
  staging: requireEnv("STAGING_VERCEL_PROJECT_ID"),
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`::error::${name} is not set; the parity check cannot run.`);
    process.exit(2);
  }
  return value;
}

/**
 * Names defined in a project's Production scope. For the staging project that
 * scope is its live staging slot, not real production — the same wording means
 * different things per project, which is exactly why this is worth checking.
 */
function definedNames(projectId) {
  let raw;
  try {
    raw = execFileSync(
      "npx",
      ["--yes", `vercel@${VERCEL_CLI}`, "env", "ls", "production",
       "--project", projectId, "--scope", scope, "--token", token, "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    console.error(`::error::Could not list environment variables for ${projectId}.`);
    // stderr can echo the command, so print only the message, never the token.
    console.error(String(error.message).replace(token, "***"));
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`::error::Unexpected output from vercel env ls for ${projectId}; expected JSON.`);
    process.exit(2);
  }

  // The CLI has moved this shape around between versions, so accept the
  // variants rather than failing a release over a wrapper key.
  const entries = Array.isArray(parsed) ? parsed : (parsed.envs ?? parsed.env ?? parsed.variables ?? []);
  const names = entries
    .map((entry) => (typeof entry === "string" ? entry : entry?.key ?? entry?.name))
    .filter((name) => typeof name === "string" && name.length > 0);

  if (names.length === 0) {
    console.error(`::error::No environment variables found for ${projectId}. That is almost certainly a query problem, not an empty project.`);
    process.exit(2);
  }
  return new Set(names);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const required = manifest.variables.filter((v) => v.required).map((v) => v.name);
const optional = new Set(manifest.variables.filter((v) => !v.required).map((v) => v.name));

const defined = Object.fromEntries(
  Object.entries(projects).map(([label, id]) => [label, definedNames(id)]),
);

const problems = [];
const warnings = [];

for (const [label, names] of Object.entries(defined)) {
  for (const name of required) {
    if (!names.has(name)) {
      problems.push(`${label} is missing ${name}, which ${MANIFEST} marks required.`);
    }
  }
}

// Drift in either direction: something configured in one project and not the
// other. Optional variables are allowed to differ by design.
for (const [a, b] of [["production", "staging"], ["staging", "production"]]) {
  for (const name of defined[a]) {
    if (defined[b].has(name) || optional.has(name)) continue;
    const known = manifest.variables.some((v) => v.name === name);
    const note = known ? "" : ` It is not in ${MANIFEST} either, so nothing describes what it is for.`;
    warnings.push(`${name} is set in ${a} but not in ${b}.${note}`);
  }
}

for (const warning of warnings) console.log(`::warning::${warning}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}

console.log(
  `Configuration shape matches: all ${required.length} required variables are defined in ` +
    `production (${defined.production.size} total) and staging (${defined.staging.size} total).`,
);
if (warnings.length > 0) {
  console.log(`${warnings.length} name(s) differ between the projects; see the warnings above.`);
}
