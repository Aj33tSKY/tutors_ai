// Entry point — this is the file `lk agent dev` / `node dist/agent.js start`
// actually runs. Its only jobs: load .env.local (when present — production/
// Cloud deployments get secrets injected as real env vars instead, no file
// needed) *before* anything that reads process.env at import time gets
// imported, then hand the framework session.ts's path to load per job.
//
// Deliberately does NOT import session.ts directly — see the comment at the
// top of session.ts for why that matters.
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerOptions, cli } from "@livekit/agents";

// This file lives in src/ (dev) or dist/ (compiled) — .env.local sits one
// level up, at the agent/ package root, in both cases.
const selfPath = fileURLToPath(import.meta.url);
const envPath = join(dirname(selfPath), "..", ".env.local");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// session.ts sits next to this file in both dev (src/*.ts) and the compiled
// build (dist/*.js) — reuse whichever extension this file itself has.
const sessionPath = join(dirname(selfPath), `session${extname(selfPath)}`);

cli.runApp(new WorkerOptions({
  agent: sessionPath,
  // A named agent uses explicit dispatch, so the app starts it only after
  // the tutor joins rather than for any student-created room.
  agentName: process.env.LIVEKIT_AGENT_NAME,
}));
