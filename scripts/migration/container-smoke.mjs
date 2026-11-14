import { execFile } from "node:child_process";
import { promisify } from "node:util";

const image = process.argv[2];
if (!image) throw new Error("Usage: node scripts/migration/container-smoke.mjs <image>");
const script = `
import assert from 'node:assert/strict';
assert.notEqual(process.getuid(), 0);
let nextInstalled = true;
try { import.meta.resolve('next'); } catch { nextInstalled = false; }
assert.equal(nextInstalled, false);
await import('./dist/api.mjs');
let ready = false;
for (let i=0;i<40;i++) {
  try {
    const response = await fetch('http://127.0.0.1:3001/health/live');
    if (response.ok) { assert.equal((await response.json()).commit,'container-smoke'); ready=true; break; }
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,50));
}
assert.ok(ready,'container API must listen');
const denied = await fetch('http://127.0.0.1:3001/v1/bookings/aaaaaaaa-0000-4000-8000-000000000001');
assert.equal(denied.status,401);
const wrongOrigin = await fetch('http://127.0.0.1:3001/v1/auth/sign-in',{method:'POST',headers:{origin:'https://attacker.example'}});
assert.equal(wrongOrigin.status,403);
console.info('Container smoke passed: non-root, no Next, HTTP health, access denial and graceful SIGTERM');
process.kill(process.pid,'SIGTERM');
`;
const { stdout } = await promisify(execFile)("docker", ["run", "--rm",
  "-e", "APP_WEB_ORIGIN=https://app.example.test", "-e", "APP_COMMIT_SHA=container-smoke",
  "-e", "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321", "-e", "NEXT_PUBLIC_SUPABASE_ANON_KEY=local-smoke-key",
  image, "node", "--input-type=module", "-e", script], { timeout: 60000, maxBuffer: 1024 * 1024 });
console.info(stdout);
