import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node verify-supabase-migration-history.mjs <migration-list.json>");
  process.exit(2);
}

let report;
try {
  const input = reportPath === "-" ? readFileSync(0, "utf8") : readFileSync(reportPath, "utf8");
  report = JSON.parse(input);
} catch (error) {
  console.error("Could not parse the Supabase migration-list report.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

if (!Array.isArray(report.migrations)) {
  console.error("Supabase CLI output did not contain a migrations array; refusing deployment.");
  process.exit(2);
}

const migrationDir = join(process.cwd(), "supabase", "migrations");
const localVersions = new Set(
  readdirSync(migrationDir)
    .map((file) => basename(file).match(/^(\d+)_.*\.sql$/)?.[1])
    .filter(Boolean),
);
const remoteVersions = report.migrations
  .map((migration) => migration.remote)
  .filter((version) => typeof version === "string" && version.length > 0);
const baselineVersion = process.env.SUPABASE_BASELINE_VERSION;

if (remoteVersions.length === 0) {
  console.error("Remote migration history is empty; baseline it before automated deployment.");
  process.exit(1);
}

// Every ordering decision below compares versions, so they must all be the same
// shape. A stray length would silently reorder a lexicographic comparison.
const malformedVersions = [...localVersions, ...remoteVersions].filter(
  (version) => !/^\d{14}$/.test(version),
);
if (malformedVersions.length > 0) {
  console.error(
    `Migration versions must be 14-digit timestamps; found: ${[...new Set(malformedVersions)].sort().join(", ")}`,
  );
  process.exit(1);
}

const duplicateRemoteVersions = remoteVersions.filter(
  (version, index) => remoteVersions.indexOf(version) !== index,
);
if (duplicateRemoteVersions.length > 0) {
  console.error(
    `Remote migration history records the same version more than once: ${[...new Set(duplicateRemoteVersions)].sort().join(", ")}`,
  );
  process.exit(1);
}

if (!baselineVersion || !localVersions.has(baselineVersion)) {
  console.error(
    "Set SUPABASE_BASELINE_VERSION in the GitHub Environment to the last migration verified as already represented by this database.",
  );
  process.exit(1);
}

if (!remoteVersions.includes(baselineVersion)) {
  console.error(
    "The configured baseline " + baselineVersion + " is not recorded in the remote migration history; refusing deployment.",
  );
  process.exit(1);
}

const untrackedRemoteVersions = remoteVersions.filter((version) => !localVersions.has(version));
if (untrackedRemoteVersions.length > 0) {
  console.error(
    `Remote migration history contains versions absent from this checkout: ${untrackedRemoteVersions.join(", ")}`,
  );
  console.error("Reconcile the migration history before deploying.");
  process.exit(1);
}

const missingBaselineVersions = [...localVersions].filter(
  (version) => version <= baselineVersion && !remoteVersions.includes(version),
);
if (missingBaselineVersions.length > 0) {
  console.error(
    "Repository migrations at or before baseline " + baselineVersion + " are not recorded remotely: " + missingBaselineVersions.sort().join(", "),
  );
  console.error("Reconcile the migration history before deploying.");
  process.exit(1);
}

// A pending migration stamped earlier than one already applied would have to be
// inserted into the middle of the remote history. `db push` refuses that without
// --include-all; say so here, where the message can name the files.
const latestRemoteVersion = remoteVersions.reduce((latest, version) =>
  version > latest ? version : latest,
);
const outOfOrderVersions = [...localVersions].filter(
  (version) => !remoteVersions.includes(version) && version < latestRemoteVersion,
);
if (outOfOrderVersions.length > 0) {
  console.error(
    `Unapplied migrations are stamped before the latest applied version ${latestRemoteVersion}: ${outOfOrderVersions.sort().join(", ")}`,
  );
  console.error("Re-stamp them after the remote head, or reconcile the history, before deploying.");
  process.exit(1);
}

console.log(
  `Migration history check passed: ${remoteVersions.length} remote versions are represented in the repository.`,
);
