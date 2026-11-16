// Pure lesson-processing work: no queue library. Any host can call these; the database claims make
// duplicate or overlapping calls safe (a second caller simply fails to claim).
import type { Pool } from "pg";
import { z } from "zod";
import { formatTranscript, transcribeStereoRecording } from "./transcription.js";

const claimSchema = z.object({ id: z.uuid(), token: z.uuid(), storagePath: z.string().min(1), offsetSeconds: z.number().nonnegative() });
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
