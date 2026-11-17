import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { queues } from "./queue.js";
import { summarizeLesson } from "./summarization.js";
import { pruneRecordings, transcribeRecording, type RecordingStore } from "./lesson-work.js";

export { pruneRecordings, transcribeRecording, type RecordingStore } from "./lesson-work.js";
const jobSchema = z.object({ version: z.literal(1), recordingId: z.uuid() }).strict();

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

export async function discoverLessonJobs(boss: PgBoss, pool: Pool, options: { summaries?: boolean } = {}) {
  const { rows } = await pool.query<{ id: string }>("select * from private.lesson_transcription_candidates()");
  for (const row of rows) await boss.send(queues.transcribe, { version: 1, recordingId: row.id }, { singletonKey: row.id, singletonSeconds: 60 });
  // Without an AI credential a summary would fail and burn a retry attempt, so none are queued.
  const summaries = options.summaries === false ? { rows: [] as { id: string }[] } : await pool.query<{ id: string }>("select * from private.lesson_summary_candidates()");
  for (const row of summaries.rows) await boss.send(queues.summarize, { version: 1, bookingId: row.id }, { singletonKey: row.id, singletonSeconds: 60 });
  await boss.send(queues.retention, { version: 1 }, { singletonKey: "retention", singletonSeconds: 300 });
}
