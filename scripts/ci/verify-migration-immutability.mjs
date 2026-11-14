// Existing migrations are history. New SQL files are allowed, but every SQL
// file on the PR's base branch must retain its path, content and file mode.
import { execFileSync } from "node:child_process";

const baseSha = process.argv[2];
if (!baseSha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(baseSha)) {
  console.error("Usage: node verify-migration-immutability.mjs <base-commit-sha>");
  process.exit(2);
}

function migrationsAt(ref) {
  const entries = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", ref, "--", "supabase/migrations/"],
    { encoding: "utf8" },
  );
  return new Map(
    entries.split("\0").filter(Boolean).flatMap((entry) => {
      const tab = entry.indexOf("\t");
      const path = entry.slice(tab + 1);
      return path.endsWith(".sql") ? [[path, entry.slice(0, tab)]] : [];
    }),
  );
}

try {
  const base = migrationsAt(baseSha);
  const current = migrationsAt("HEAD");
  const changed = [...base].filter(([path, blob]) => current.get(path) !== blob);
  if (changed.length > 0) {
    for (const [path] of changed) {
      console.error(`::error::Existing migration was edited, deleted or renamed: ${path}`);
    }
    console.error("Restore those files and create a new migration for your change.");
    process.exit(1);
  }
  console.log(`Migration history preserved: ${base.size} existing SQL files unchanged.`);
} catch (error) {
  console.error("Could not compare migration history; refusing to pass.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
