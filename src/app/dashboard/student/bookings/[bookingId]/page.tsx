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
import { createClient } from "@/lib/supabase/server";
import { MAX_TRANSCRIBE_ATTEMPTS } from "@/lib/transcription";
import type { Booking, SessionAnalytics, SessionRecording } from "@/lib/types";
import { LessonPlayer, type ScreenSegment } from "./lesson-player";

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
    .select("id, booking_id, egress_id, storage_path, status, started_at, ended_at, expires_at, created_at, transcribed_at, transcribe_attempts, kind, track_sid")
    .eq("booking_id", booking.id)
    .order("started_at", { ascending: true })
    .returns<SessionRecording[]>();

  const signedUrl = async (path: string) =>
    (await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(path, 60 * 60)).data?.signedUrl ?? null;

  const isPending = (recording: SessionRecording) => ["starting", "active", "stopping"].includes(recording.status);
  const hasPendingRecordings = recordings?.some(isPending) ?? false;
  const readyAudio = recordings?.filter((recording) => recording.kind === "audio" && recording.status === "ready") ?? [];

  // Older sessions can still have the single recording_path value.
  const audioPaths = readyAudio.length
    ? readyAudio.map((recording) => ({ id: recording.id, path: recording.storage_path, startedAt: recording.started_at, endedAt: recording.ended_at }))
    : analytics?.recording_path
      ? [{ id: "legacy", path: analytics.recording_path, startedAt: booking.started_at ?? booking.start_time, endedAt: null }]
      : [];
  const audioPlayers = await Promise.all(audioPaths.map(async (recording) => ({ ...recording, url: await signedUrl(recording.path) })));

  const screenSegments = (
    await Promise.all(
      (recordings ?? [])
        .filter((recording) => recording.kind === "screen" && recording.status === "ready" && recording.ended_at)
        .map(async (recording): Promise<ScreenSegment | null> => {
          const src = await signedUrl(recording.storage_path);
          return src
            ? {
                id: recording.id,
                src,
                type: recording.storage_path.endsWith(".webm") ? "video/webm" : "video/mp4",
                startMs: Date.parse(recording.started_at),
                endMs: Date.parse(recording.ended_at!),
              }
            : null;
        }),
    )
  ).filter((segment): segment is ScreenSegment => segment !== null);

  // Each screen share plays alongside whichever audio segment it overlaps. A
  // share with no audio to sit beside (the audio recording failed, say) is
  // still shown on its own rather than lost.
  const overlaps = (screen: ScreenSegment, audio: (typeof audioPlayers)[number]) =>
    screen.startMs < (audio.endedAt ? Date.parse(audio.endedAt) : Infinity) && screen.endMs > Date.parse(audio.startedAt);
  const unpairedScreens = screenSegments.filter(
    (screen) => !audioPlayers.some((audio) => audio.url && !audio.path.endsWith(".mp4") && overlaps(screen, audio)),
  );
  const hasAnyRecording = audioPlayers.length > 0 || unpairedScreens.length > 0;

  // The audio recording is the transcript source, so its own rows (already
  // authorised above under RLS) say whether transcription is still pending —
  // still recording, or saved but not yet picked up by the transcribe cron
  // and still within its retry budget. Screen recordings are never transcribed.
  const transcriptPending =
    (recordings?.some((recording) => recording.kind === "audio" && isPending(recording)) ?? false) ||
    readyAudio.some(
      (recording) => !recording.transcribed_at && recording.transcribe_attempts < MAX_TRANSCRIBE_ATTEMPTS,
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
          {hasAnyRecording ? (
            <div className="space-y-5">
              {hasPendingRecordings && <p className="text-sm text-muted-foreground">The latest recording segment is still being finalized.</p>}
              {audioPlayers.map((recording, index) => (
                <div key={recording.id}>
                  <p className="mb-2 text-sm font-medium">{audioPlayers.length > 1 ? `Recording segment ${index + 1}` : recording.path.endsWith(".mp4") ? "Session video" : "Session recording"} · {new Date(recording.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  {/* Recordings made before audio-only recording are MP4 video and stay playable until they expire. */}
                  {!recording.url ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">This recording is not available right now.</p> : recording.path.endsWith(".mp4") ? <video controls playsInline preload="metadata" className="aspect-video w-full bg-black"><source src={recording.url} type="video/mp4" />Your browser does not support session video playback.</video> : <LessonPlayer audioSrc={recording.url} audioStartMs={Date.parse(recording.startedAt)} audioDurationMs={recording.endedAt ? Date.parse(recording.endedAt) - Date.parse(recording.startedAt) : undefined} screens={screenSegments.filter((screen) => overlaps(screen, recording))} />}
                </div>
              ))}
              {unpairedScreens.map((screen, index) => (
                <div key={screen.id}>
                  <p className="mb-2 text-sm font-medium">Screen share {index + 1} · {new Date(screen.startMs).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  <video controls playsInline preload="metadata" className="aspect-video w-full bg-black"><source src={screen.src} type={screen.type} />Your browser does not support session video playback.</video>
                </div>
              ))}
            </div>
          ) : hasPendingRecordings ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
              <Play className="size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">Recording is being finalized</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">The session audio will appear here once LiveKit has finished saving it. Refresh this page shortly.</p>
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
