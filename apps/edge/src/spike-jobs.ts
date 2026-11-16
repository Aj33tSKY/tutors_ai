// SPIKE ONLY: proves the background-job building blocks on the Workers runtime before the worker process is removed.
// Read-only against real staging data: it lists candidates, probes LiveKit with an egress id and room that do not exist,
// makes one read-only Stripe test-mode call, and round-trips a throwaway object under `spike/` in the recordings bucket.
import Stripe from "stripe";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AccessToken } from "livekit-server-sdk";
import { livekitEgress } from "../../../packages/jobs/src/livekit-egress.js";
import { recordingStore } from "../../../packages/jobs/src/recording-store.js";
import { generateLessonSummary } from "../../../packages/jobs/src/summarization.js";

type QueueMessage = { body: { kind: string; sentAt: string }; attempts: number; ack(): void; retry(options?: { delaySeconds?: number }): void };
export type SpikeJobsEnv = { SPIKE_JOBS?: string; JOBS?: { send(body: unknown): Promise<void> } };

async function step(fn: () => Promise<unknown>) {
  const started = Date.now();
  try { return { ok: true, ms: Date.now() - started, detail: await fn() }; }
  catch (error) { return { ok: false, ms: Date.now() - started, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 220) : String(error) }; }
}

export async function spikeScheduled(env: SpikeJobsEnv) {
  if (env.SPIKE_JOBS !== "1") return;
  const results: Record<string, unknown> = {};

  // Database: the restricted job login, one connection per invocation, through the transaction pooler.
  results.database = await step(async () => {
    const { Pool } = await import("pg");
    const url = new URL(process.env.APP_JOBS_DATABASE_URL!);
    url.port = "6543";
    const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 8000 });
    try {
      const count = async (fn: string) => (await pool.query(`select count(*)::int as n from private.${fn}()`)).rows[0].n;
      return { role: (await pool.query("select current_user as u")).rows[0].u, transcription: await count("lesson_transcription_candidates"), summary: await count("lesson_summary_candidates"), retention: await count("lesson_retention_candidates") };
    } finally { await pool.end(); }
  });

  // LiveKit: the real adapter, aimed at things that do not exist, plus token minting.
  results.livekit = await step(async () => {
    const egress = livekitEgress(process.env);
    if (!egress) throw new Error("LiveKit or R2 is not configured");
    const described = await egress.describe("EG_spike_does_not_exist");
    await egress.stopStray("spike-room-that-does-not-exist", []);
    const token = await new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { identity: "spike" }).toJwt();
    return { describeMissing: described, tokenLength: token.length };
  });

  // Stripe: the same construction the app uses (default HTTP client), one read-only test-mode call.
  results.stripe = await step(async () => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, timeout: 20000 });
    const list = await stripe.customers.list({ limit: 1 });
    return { object: list.object, testMode: process.env.STRIPE_SECRET_KEY!.startsWith("sk_test_") };
  });

  // R2: presigned upload, the app's own sign() and remove(), then confirm the object is gone.
  results.r2 = await step(async () => {
    const key = `spike/${crypto.randomUUID()}.txt`;
    const client = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
    const putUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn: 60 });
    const put = await fetch(putUrl, { method: "PUT", body: "spike" });
    const store = recordingStore();
    const read = await fetch(await store.sign(key, 60));
    const body = await read.text();
    await store.remove(key);
    const after = await fetch(await store.sign(key, 60));
    return { put: put.status, read: read.status, bodyMatches: body === "spike", afterDelete: after.status };
  });

  if (env.JOBS) {
    await env.JOBS.send({ kind: "retry-test", sentAt: new Date().toISOString() });
    await env.JOBS.send({ kind: "summary-test", sentAt: new Date().toISOString() });
  }
  console.info(JSON.stringify({ event: "spike_scheduled", results }));
}

const transcript = [
  "[Tutor 00:01] Today we're looking at Newton's second law and how force, mass and acceleration relate.",
  "[Student 00:09] So force equals mass times acceleration?",
  "[Tutor 00:14] Exactly. If a 2 kilogram trolley accelerates at 3 metres per second squared, what's the resultant force?",
  "[Student 00:25] Six newtons.",
  "[Tutor 00:28] Good. Now what if friction of 2 newtons acts against it with the same 6 newton push?",
  "[Student 00:41] Then the resultant is 4 newtons, so the acceleration is 2.",
  "[Tutor 00:47] Perfect, you handled the resultant force correctly without a prompt.",
].join("\n");

export async function spikeQueue(batch: { messages: QueueMessage[] }) {
  for (const message of batch.messages) {
    if (message.body.kind === "retry-test") {
      if (message.attempts < 2) { console.info(JSON.stringify({ event: "spike_queue_retry", attempts: message.attempts })); message.retry({ delaySeconds: 5 }); }
      else { console.info(JSON.stringify({ event: "spike_queue_retry_acked", attempts: message.attempts })); message.ack(); }
      continue;
    }
    if (message.body.kind === "summary-test") {
      const started = Date.now();
      const result = await step(() => generateLessonSummary({ id: crypto.randomUUID(), token: crypto.randomUUID(), transcript, summary: null, subject: "physics", examBoard: "aqa" }));
      const aiMs = Date.now() - started;
      // Longer than the 30 s that `waitUntil` would allow, to prove a consumer can wait on slow providers.
      await new Promise((resolve) => setTimeout(resolve, 40000));
      const detail = result.ok ? result.detail as { summary: Record<string, unknown>; chunks: { embedding: number[] }[] } : null;
      console.info(JSON.stringify({ event: "spike_queue_summary", ok: result.ok, error: result.ok ? undefined : result.error, aiMs, wallMs: Date.now() - started,
        summaryFields: detail ? Object.keys(detail.summary).length : 0, chunks: detail?.chunks.length ?? 0, dimensions: detail?.chunks[0]?.embedding.length ?? 0 }));
      message.ack();
    }
  }
}
