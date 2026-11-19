import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error plain .mjs module without type declarations
import { scope } from "../../scripts/ci/changed-scope.mjs";

const run = (...files: string[]) => scope(files) as Record<string, boolean>;
const only = (result: Record<string, boolean>) => Object.keys(result).filter((key) => result[key]).sort();

test("documentation-only changes run nothing", () => assert.deepEqual(only(run("docs/plan.md", "README.md", "infra/livekit/README.md")), []));
test("an unknown change set runs everything (releases, manual runs)", () => {
  assert.deepEqual(only(run("*")), ["code", "docker", "next", "webdeploy", "worker", "workflows"]);
  assert.deepEqual(only(run()), ["code", "docker", "next", "webdeploy", "worker", "workflows"]);
});
test("a workflow-only change runs workflow lint and not the heavy builds", () => assert.deepEqual(only(run(".github/workflows/deploy-cloudflare.yml")), ["code", "workflows"]));
test("editing ci.yml itself runs every check it defines", () => assert.deepEqual(only(run(".github/workflows/ci.yml")), ["code", "docker", "next", "webdeploy", "worker", "workflows"]));
test("Worker-only code runs the Worker check, not Docker or the legacy builds", () => assert.deepEqual(only(run("apps/edge/src/jobs.ts")), ["code", "worker"]));
test("shared packages can break every runtime", () => assert.deepEqual(only(run("packages/domain/src/chat.ts")), ["code", "docker", "next", "worker"]));
test("the legacy Next app runs only its own checks", () => assert.deepEqual(only(run("src/app/api/cron/summarize-sessions/route.ts")), ["code", "next"]));
test("container files run only the Docker check", () => assert.deepEqual(only(run("infra/app/Caddyfile")), ["code", "docker"]));
test("dependency manifests run everything that installs them", () => assert.deepEqual(only(run("package-lock.json")), ["code", "docker", "next", "webdeploy", "worker", "workflows"]));
test("tests and migrations alone run only the base checks", () => assert.deepEqual(only(run("supabase/migrations/20261120000000_x.sql", "tests/portable/api.test.ts")), ["code"]));
