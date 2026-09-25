import { notFound } from "next/navigation";
import {
  BookOpenCheck,
  CircleAlert,
  ClipboardCheck,
  FileText,
  Play,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReturnToDashboardLink } from "@/components/dashboard/return-to-dashboard-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Booking, SessionAnalytics, SessionRecording } from "@/lib/types";

const RECORDINGS_BUCKET = "session-recordings";

export default async function StudentSessionReviewPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createClient();

  // Booking RLS is the access check. It deliberately includes the booking id
  // in the query, so a student cannot use this route to load another session.
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();

  if (!booking || booking.status !== "completed") notFound();

  const { data: analytics, error: analyticsError } = await supabase
    .from("session_analytics")
    .select("*")
    .eq("booking_id", booking.id)
    .maybeSingle<SessionAnalytics>();

  const { data: recordings } = await supabase
    .from("session_recordings")
    .select("id, booking_id, egress_id, storage_path, status, started_at, ended_at, expires_at, created_at")
    .eq("booking_id", booking.id)
    .order("started_at", { ascending: true })
    .returns<SessionRecording[]>();

  // Older sessions can still have the single recording_path value.
  const readyRecordings = recordings?.filter((recording) => recording.status === "ready") ?? [];
  const hasPendingRecordings = recordings?.some((recording) => ["starting", "active", "stopping"].includes(recording.status)) ?? false;
  const recordingPaths = readyRecordings.length
    ? readyRecordings.map((recording) => ({ id: recording.id, path: recording.storage_path, startedAt: recording.started_at }))
    : analytics?.recording_path
      ? [{ id: "legacy", path: analytics.recording_path, startedAt: booking.started_at ?? booking.start_time }]
      : [];
  const recordingPlayers = await Promise.all(recordingPaths.map(async (recording) => {
    const { data } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(recording.path, 60 * 60);
    return { ...recording, url: data?.signedUrl ?? null };
  }));

  // Transcript audio is deliberately unreadable by every user, including this
  // lesson's own participants, so its status cannot be read with the caller's
  // client. Whether transcription is still running is not sensitive though, and
  // the booking above was already authorised under RLS, so read just the status
  // with the service role scoped to that booking.
  const { data: transcriptAudio } = await createAdminClient()
    .from("session_transcript_audio")
    .select("status")
    .eq("booking_id", booking.id);
  // "ready" means the audio was captured but the transcribe cron has not run yet.
  const transcriptPending = (transcriptAudio ?? []).some((segment) =>
    ["starting", "active", "ready"].includes(segment.status),
  );

  const summary = analytics?.summary_notes;
  const startedAt = new Date(booking.start_time).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ReturnToDashboardLink />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display-md">{booking.lesson_name || subjectLabel(booking.subject)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {startedAt} · {boardLabel(booking.exam_board)}
          </p>
        </div>
        <Badge variant="secondary">Completed</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="size-4 text-saffron" /> Session recording
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recordingPlayers.length ? (
            <div className="space-y-5">
              {hasPendingRecordings && <p className="text-sm text-muted-foreground">The latest recording segment is still being finalized.</p>}
              {recordingPlayers.map((recording, index) => (
                <div key={recording.id}>
                  <p className="mb-2 text-sm font-medium">{recordingPlayers.length > 1 ? `Recording segment ${index + 1}` : "Session video"} · {new Date(recording.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  {recording.url ? <video controls playsInline preload="metadata" className="aspect-video w-full bg-black"><source src={recording.url} type="video/mp4" />Your browser does not support session video playback.</video> : <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">This recording is not available right now.</p>}
                </div>
              ))}
            </div>
          ) : hasPendingRecordings ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
              <Play className="size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">Recording is being finalized</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">The session video will appear here once LiveKit has finished saving it. Refresh this page shortly.</p>
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
              <Play className="size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">No recording is available</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Recordings appear here when recording was enabled for this session.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {analyticsError ? (
        <ProcessingState title="Session notes are unavailable" description="We couldn't load the session analysis. Please refresh shortly." />
      ) : !analytics?.full_transcript ? (
        transcriptPending ? (
          <ProcessingState
            title="Transcript is being prepared"
            description="This lesson's audio was captured and is being transcribed. It usually appears within a few minutes of the session ending."
          />
        ) : (
          <ProcessingState title="No transcript was captured" description="This session ended without a saved transcript, so notes cannot be generated." />
        )
      ) : !summary ? (
        <ProcessingState />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-saffron" /> Tutor session summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {summary.overview?.trim() || "This existing session is being refreshed with a short overview."}
              </p>
              {analytics.talk_ratio != null && (
                <p className="eyebrow">
                  {analytics.talk_ratio === 0
                    ? "No tutor speech was transcribed in this session"
                    : `Tutor spoke for ${Math.round(analytics.talk_ratio * 100)}% of transcribed words`}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <ListCard
              icon={BookOpenCheck}
              title="Topics covered"
              empty="No specific specification topics were identified."
              items={(summary.covered_topics ?? []).map((topic) =>
                topic.spec_point ? `${topic.spec_point} — ${topic.title}` : topic.title,
              )}
            />
            <ListCard
              icon={ClipboardCheck}
              title="Action points"
              empty="No follow-up actions were assigned in this session."
              items={summary.homework ?? []}
            />
          </div>

          <ListCard
            icon={CircleAlert}
            title="Things to revisit"
            empty="No misconceptions were evidenced in the transcript."
            items={summary.misconceptions ?? []}
          />

          <details className="rounded-2xl border border-border bg-card shadow-sm">
            <summary className="cursor-pointer px-6 py-5 font-heading text-lg font-semibold">Full transcript</summary>
            <div className="border-t border-border px-6 py-5">
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {analytics.full_transcript}
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function ProcessingState({
  title = "Your session notes are still processing",
  description = "The transcript and action points usually appear within a few minutes of the session ending.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function ListCard({
  icon: Icon,
  title,
  items,
  empty,
}: {
  icon: typeof BookOpenCheck;
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-saffron" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item} className="rounded-xl border border-border px-3 py-2 text-sm">
                {item}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
