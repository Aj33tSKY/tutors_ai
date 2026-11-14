import { createServer } from "node:http";
import { writeFile, readFile } from "node:fs/promises";
import { assertJobRuntimePrivileges, queue, queues } from "../../../packages/jobs/src/queue.js";

const connection = process.env.APP_JOBS_DATABASE_URL;
if (!connection) throw new Error("APP_JOBS_DATABASE_URL is required (direct or session connection)");
await assertJobRuntimePrivileges(connection);
const boss = queue(connection);
await boss.start();
// Infrastructure heartbeat only. Lesson schedules stay owned by the existing
// release until their durable handlers and scheduler handover are verified.
await boss.work<{ version: number }>(queues.heartbeat, async (jobs) => {
  for (const job of jobs) {
    if (job.data.version !== 1) throw new Error("Unsupported heartbeat version");
    await writeFile("/tmp/tutors-worker-heartbeat", String(Date.now()), { mode: 0o600 });
  }
});
const tick = async () => {
  await boss.send(queues.heartbeat, { version: 1 }, { singletonKey: "worker", singletonSeconds: 20 });
};
await tick();
const timer = setInterval(() => { void tick().catch(() => console.error(JSON.stringify({ event: "worker_heartbeat_failed" }))); }, 20000);
const health = createServer(async (_req, res) => {
  const stamp = await readFile("/tmp/tutors-worker-heartbeat", "utf8").catch(() => "0");
  const ready = Date.now() - Number(stamp) < 90000;
  res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: ready ? "ok" : "degraded" }));
}).listen(Number(process.env.PORT ?? 3002), "0.0.0.0");
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  health.close();
  void boss.stop({ graceful: true, timeout: 30000 }).then(() => process.exit(0), () => process.exit(1));
});
