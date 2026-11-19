// Decides which CI checks a change can affect. Reads the changed file names, one per line, from stdin and prints
// `name=true|false` lines for $GITHUB_OUTPUT. A line of just `*` (or no usable list) means "unknown": everything runs.
// Releases and manual runs always pass `*`, so they always run the full suite.
//
// Each rule is the set of paths a check can fail on. Over-matching only costs time; under-matching lets a break through,
// so when in doubt add the path. tests/portable/ci-scope.test.ts pins the behaviour.
import { readFileSync } from "node:fs";

const manifests = String.raw`package(-lock)?\.json$`;
const thisWorkflow = String.raw`\.github/workflows/ci\.yml$|scripts/ci/changed-scope\.mjs$`;
export const rules = {
  // Anything that is not documentation: lint, types, unit tests and the portable build run for all code changes.
  code: new RegExp(String.raw`^(?!docs/|.*\.md$)`),
  // The Docker runtime and web images (the interim VPS path; retired with it).
  docker: new RegExp(String.raw`^(infra/app/|apps/(api|web|worker)/|packages/|scripts/migration/|src/(components|lib)/|src/app/(globals\.css|\(marketing\)/)|public/|tsconfig(\.portable)?\.json$|postcss\.config\.mjs$|${manifests}|${thisWorkflow})`),
  // The Worker booted in workerd.
  worker: new RegExp(String.raw`^(apps/(edge|api|web)/|packages/|scripts/ci/worker-smoke\.mjs$|scripts/migration/build|tsconfig(\.portable)?\.json$|${manifests}|${thisWorkflow})`),
  // The legacy Next application (typecheck and build); it imports the shared packages.
  next: new RegExp(String.raw`^(src/|packages/|public/|next\.config|tsconfig\.json$|postcss\.config\.mjs$|eslint\.config\.mjs$|vercel\.ts$|${manifests}|${thisWorkflow})`),
  // The superseded Cloudflare relay adapter in apps/web.
  webdeploy: new RegExp(String.raw`^(apps/web/|${manifests}|${thisWorkflow})`),
  // Workflow lint and the reusable-workflow permission check.
  workflows: new RegExp(String.raw`^(\.github/|scripts/ci/verify-workflow-permissions\.mjs$|${manifests})`),
};

export function scope(files) {
  const unknown = files.length === 0 || files.includes("*");
  return Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, unknown || files.some((file) => rule.test(file))]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readFileSync(0, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  for (const [name, needed] of Object.entries(scope(files))) console.log(`${name}=${needed}`);
}
