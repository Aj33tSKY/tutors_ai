// Owns only a disposable project in /tmp. Never reads .env.local or links a hosted project.
import { mkdtemp, mkdir, cp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const directory = await mkdtemp(join(tmpdir(), "tutors-portable-test-"));
const project = `portable-test-${process.pid}`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(SUPABASE_|NEXT_PUBLIC_|VITE_|APP_|STRIPE_|R2_|LIVEKIT_|DEEPGRAM_|AI_GATEWAY_)/.test(key)) delete env[key];
const cli = join(root, "node_modules/.bin/supabase");
let localSecrets = [];
async function run(args, capture = false) {
  const result = await exec(cli, args, { cwd: directory, env, timeout: 600000, maxBuffer: 12 * 1024 * 1024 });
  if (!capture) console.info(`${args.slice(0, 2).join(" ")}: passed`);
  return result.stdout;
}
await mkdir(join(directory, "supabase"));
let config = await readFile(join(root, "supabase/config.toml"), "utf8");
config = config.replace('project_id = "tutors"', `project_id = "${project}"`).replaceAll(/543(\d\d)/g, "553$1");
config = config.replace(/\[db.seed\][\s\S]*?(?=\n\[)/, '[db.seed]\nenabled = false\nsql_paths = []\n');
await writeFile(join(directory, "supabase/config.toml"), config);
await cp(join(root, "supabase/migrations"), join(directory, "supabase/migrations"), { recursive: true });
await cp(join(root, "supabase/tests"), join(directory, "supabase/tests"), { recursive: true });
try {
  await run(["start", "-x", "studio,postgres-meta,logflare,vector,edge-runtime,imgproxy,realtime,supavisor"]);
  await run(["db", "reset", "--no-seed"]);
  await run(["db", "lint", "--level", "error", "--fail-on", "error"]);
  await run(["test", "db", "--local"]);
  const status = JSON.parse(await run(["status", "--output", "json"], true));
  // Some CLI versions wrap JSON output. Reject unknown shapes rather than inherit credentials.
  const state = status.API_URL ? status : status.data;
  if (!state?.API_URL || !state?.ANON_KEY || !state?.SERVICE_ROLE_KEY || !state?.DB_URL) throw new Error("Unrecognised local status shape");
  if (![state.API_URL, state.DB_URL].every((url) => ["127.0.0.1", "localhost"].includes(new URL(url).hostname))) throw new Error("Refusing nonlocal integration destination");
  localSecrets = [state.ANON_KEY, state.SERVICE_ROLE_KEY, state.DB_URL];
  await exec(process.execPath, ["--import", "tsx", "--test", "tests/portable/integration.local.ts"], {
    cwd: root, env: { ...env, LOCAL_API_URL: state.API_URL, LOCAL_ANON_KEY: state.ANON_KEY, LOCAL_SERVICE_KEY: state.SERVICE_ROLE_KEY, LOCAL_DATABASE_URL: state.DB_URL }, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  }).then(({ stdout }) => console.info(stdout));
} catch (error) {
  // CLI output may contain local generated credentials. Keep it off shared logs.
  console.error(`Disposable integration failed during ${error.cmd ? "a subprocess" : "setup"}. ${error.message?.split("\n")[0] ?? "See local runner"}`);
  let detail = String(error.stdout ?? "") + String(error.stderr ?? "");
  for (const secret of localSecrets) detail = detail.replaceAll(secret, "[local credential]");
  detail = detail.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]");
  await writeFile(join(directory, "failure.log"), detail, { mode: 0o600 });
  console.error(detail.split("\n").slice(-45).join("\n"));
  process.exitCode = 1;
} finally {
  await run(["stop", "--project-id", project, "--no-backup"]).catch(() => { console.error(`Could not stop owned project ${project}; inspect Docker before retrying`); process.exitCode = 1; });
}
