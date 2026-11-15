import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { queues } from "./queue.js";
import { formatTranscript, transcribeStereoRecording } from "./transcription.js";
import { summarizeLesson } from "./summarization.js";

const claimSchema = z.object({ id: z.uuid(), token: z.uuid(), storagePath: z.string().min(1), offsetSeconds: z.number().nonnegative() });
const jobSchema = z.object({ version: z.literal(1), recordingId: z.uuid() }).strict();
export interface RecordingStore {
  sign(path: string, ttlSeconds: number): Promise<string>;
  remove(path: string): Promise<void>;
}

export async function transcribeRecording(pool: Pool, recordingId: string, store: RecordingStore, transcribe = transcribeStereoRecording) {
  const result = await pool.query("select private.lesson_transcription_claim($1) as claim", [recordingId]);
  if (!result.rows[0]?.claim) return;
  const claim = claimSchema.parse(result.rows[0].claim);
  try {
    const url = await store.sign(claim.storagePath, 900);
    const transcript = formatTranscript(await transcribe(url), claim.offsetSeconds);
    const saved = await pool.query("select private.lesson_transcription_publish($1,$2,$3) as saved", [claim.id, claim.token, transcript]);
    if (!saved.rows[0]?.saved) throw new Error("Transcription lease lost or recording expired");
  } catch (error) {
    await pool.query("select private.lesson_transcription_release($1,$2)", [claim.id, claim.token]);
    throw error;
  }
}

export async function pruneRecordings(pool: Pool, store: RecordingStore) {
  const { rows } = await pool.query<{ id: string; storage_path: string }>("select * from private.lesson_retention_candidates()");
  let failed = false;
  for (const row of rows) {
    try {
      // Object deletion is idempotent: a crash before the DB marker is safe to replay.
      await store.remove(row.storage_path);
      await pool.query("select private.lesson_retention_complete($1,$2)", [row.id, row.storage_path]);
    } catch {
      failed = true;
      console.error(JSON.stringify({ event: "recording_retention_failed", recordingId: row.id }));
    }
  }
  if (failed) throw new Error("Some expired recordings could not be removed");
}

export async function registerLessonJobs(boss: PgBoss, pool: Pool, store: RecordingStore) {
  await boss.work(queues.transcribe, { localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) {
      const data = jobSchema.parse(job.data);
      await transcribeRecording(pool, data.recordingId, store);
    }
  });
  await boss.work(queues.retention, async (jobs) => {
    for (const job of jobs) {
      z.object({ version: z.literal(1) }).strict().parse(job.data);
      await pruneRecordings(pool, store);
    }
  });
  await boss.work(queues.summarize, async (jobs) => {
    for (const job of jobs) {
      const data = z.object({ version: z.literal(1), bookingId: z.uuid() }).strict().parse(job.data);
      await summarizeLesson(pool, data.bookingId);
    }
  });
}

export async function discoverLessonJobs(boss: PgBoss, pool: Pool) {
  const { rows } = await pool.query<{ id: string }>("select * from private.lesson_transcription_candidates()");
  for (const row of rows) await boss.send(queues.transcribe, { version: 1, recordingId: row.id }, { singletonKey: row.id, singletonSeconds: 60 });
  const summaries = await pool.query<{ id: string }>("select * from private.lesson_summary_candidates()");
  for (const row of summaries.rows) await boss.send(queues.summarize, { version: 1, bookingId: row.id }, { singletonKey: row.id, singletonSeconds: 60 });
  await boss.send(queues.retention, { version: 1 }, { singletonKey: "retention", singletonSeconds: 300 });
}
