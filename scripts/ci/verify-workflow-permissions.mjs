// A reusable workflow cannot request more permissions than its caller grants.
// GitHub only enforces this when the workflow runs, so adding a scope to a
// called workflow silently invalidates every caller until one of them tries to
// start — which is how an unrunnable staging.yml reached develop twice.
//
// actionlint does not check this, so this does.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");
const LEVELS = { none: 0, read: 1, write: 2 };

const workflows = new Map();
for (const file of readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name))) {
  try {
    workflows.set(file, yaml.load(readFileSync(join(WORKFLOW_DIR, file), "utf8")));
  } catch (error) {
    console.error(`${file}: could not be parsed as YAML — ${error.message}`);
    process.exit(2);
  }
}

/** `permissions: read-all` and friends are shorthands rather than objects. */
function scopesOf(permissions) {
  if (permissions === "read-all") return { __all: "read" };
  if (permissions === "write-all") return { __all: "write" };
  if (permissions && typeof permissions === "object") return permissions;
  return {};
}

function granted(callerScopes, scope) {
  if (callerScopes.__all) return callerScopes.__all;
  return callerScopes[scope] ?? "none";
}

const problems = [];
for (const [file, workflow] of workflows) {
  const callerScopes = scopesOf(workflow?.permissions);

  for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
    const uses = typeof job?.uses === "string" ? job.uses : null;
    // Only local reusable workflows can be checked; a remote one is not in tree.
    if (!uses?.startsWith("./.github/workflows/")) continue;

    const calledName = uses.replace("./.github/workflows/", "").split("@")[0];
    const called = workflows.get(calledName);
    if (!called) {
      problems.push(`${file}: job "${jobName}" calls ${calledName}, which does not exist`);
      continue;
    }

    for (const [scope, needed] of Object.entries(scopesOf(called.permissions))) {
      if (scope === "__all") continue;
      const have = granted(callerScopes, scope);
      if ((LEVELS[have] ?? 0) < (LEVELS[needed] ?? 0)) {
        problems.push(
          `${file}: job "${jobName}" calls ${calledName}, which requests ` +
            `${scope}: ${needed}, but ${file} only grants ${scope}: ${have}. ` +
            `Add "${scope}: ${needed}" to ${file}'s permissions.`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}

console.log("Reusable workflow permissions check passed.");
