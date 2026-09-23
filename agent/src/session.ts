// Bootstrap for the file the framework actually dynamically imports per job
// (see agent.ts's WorkerOptions.agent). Needs its own env-loading, same as
// agent.ts — the two run as separate processes (@livekit/agents forks a
// fresh child per job), so whatever agent.ts loaded into its own
// process.env doesn't carry over here.
//
// The actual defineAgent logic lives in session-impl.ts, loaded via dynamic
// import below rather than a static one — @livekit/agents-plugin-deepgram
// reads process.env.DEEPGRAM_API_KEY into a module-level default the
// instant it's imported, and a static import would be hoisted above the
// loadEnvFile() call no matter where it's written in this file.
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives in src/ (dev) or dist/ (compiled) — .env.local sits one
// level up, at the agent/ package root, in both cases.
const selfPath = fileURLToPath(import.meta.url);
const envPath = join(dirname(selfPath), "..", ".env.local");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const implPath = join(dirname(selfPath), `session-impl${extname(selfPath)}`);
const { default: agentDefinition } = await import(implPath);

export default agentDefinition;
