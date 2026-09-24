import { createAdminClient } from "@/lib/supabase/admin";

const RECORDINGS_BUCKET = "session-recordings";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: expired, error } = await admin
    .from("session_recordings")
    .select("id, storage_path")
    .neq("status", "expired")
    .lte("expires_at", new Date().toISOString())
    .limit(100);
  if (error) return Response.json({ error: "Could not load expired recordings" }, { status: 500 });

  let deleted = 0;
  for (const recording of expired ?? []) {
    const { error: removeError } = await admin.storage.from(RECORDINGS_BUCKET).remove([recording.storage_path]);
    if (removeError) {
      console.error(`Failed to delete expired recording ${recording.id}:`, removeError);
      return Response.json({ error: "Could not delete an expired recording" }, { status: 500 });
    }
    const { error: updateError } = await admin
      .from("session_recordings")
      .update({ status: "expired" })
      .eq("id", recording.id);
    if (updateError) return Response.json({ error: "Could not mark recording as expired" }, { status: 500 });
    deleted += 1;
  }

  return Response.json({ deleted });
}
