import { Play, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import { formatSessionNotesMarkdown } from "@/lib/session-notes";
import { LessonPlayer } from "./lesson-player";
import { RecordingCard } from "./recording-card";
import { SessionNotes } from "./session-notes";
import type { SessionReview, ScreenSegment, AudioPlayer } from "../../../packages/contracts/src/reviews";

export function SessionReviewView({ review, notesAction }: { review: SessionReview; notesAction: (previous: { error?: string; success?: boolean }, data: FormData) => Promise<{ error?: string; success?: boolean }> }) {
  const { booking, analytics, analyticsError, audioPlayers, screenSegments, hasPendingRecordings, transcriptPending, canEditNotes } = review;
  const overlaps = (screen: ScreenSegment, audio: AudioPlayer) => screen.startMs < (audio.endedAt ? Date.parse(audio.endedAt) : Infinity) && screen.endMs > Date.parse(audio.startedAt);
  const unpairedScreens = screenSegments.filter((screen) => !audioPlayers.some((audio) => audio.url && !audio.path.endsWith(".mp4") && overlaps(screen, audio)));
  const hasAnyRecording = audioPlayers.length > 0 || unpairedScreens.length > 0;
  const summary = analytics?.summary_notes;
  const originalMarkdown = summary ? formatSessionNotesMarkdown(summary) : "";
  const notesMarkdown = analytics?.notes_markdown ?? originalMarkdown;
  const startedAt = new Date(booking.start_time).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="space-y-6">
      {/* The back-link and title read best at a capped width, same as the
          calendar's own header; the recording/notes row below is left
          unconstrained so it uses the full page, same as the calendar. */}
      <div className="max-w-6xl space-y-6">
        <a href="/dashboard" className="text-sm text-muted-foreground">← All sessions</a>

        <header>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display-md">{booking.lesson_name || subjectLabel(booking.subject)}</h2>
            <Badge variant="secondary">Completed</Badge>
            <PaymentBadge booking={booking} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {booking.exam_board ? `${startedAt} · ${boardLabel(booking.exam_board)}` : startedAt}
          </p>
        </header>
      </div>

      {/* The recording sits beside its notes on desktop, each in its own
          bounded, independently scrollable container. On mobile the notes
          drop below instead. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <RecordingCard title="Session recording" icon={<Video className="size-4 text-brand-strong" />}>
            {hasAnyRecording ? (
              <div className="space-y-5">
                {hasPendingRecordings && <p className="text-sm text-muted-foreground">The latest recording segment is still being finalized.</p>}
                {audioPlayers.map((recording, index) => (
                  <div key={recording.id}>
                    {/* A lone recording needs no label — the card title
                        already says "Session recording". Multiple segments
                        (a tutor who left and rejoined) still need telling apart. */}
                    {audioPlayers.length > 1 && (
                      <p className="mb-2 text-sm font-medium">
                        Recording segment {index + 1} · {new Date(recording.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
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
          </RecordingCard>
        </div>

        <div className="lg:w-[26rem] lg:shrink-0">
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
            <SessionNotes
              bookingId={booking.id}
              initialMarkdown={notesMarkdown}
              originalMarkdown={originalMarkdown}
              canEdit={canEditNotes}
              saveAction={notesAction}
            />
          )}
        </div>
      </div>

      {!analyticsError && analytics?.full_transcript && summary && (
        <details className="rounded-2xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer px-6 py-5 font-heading text-lg font-semibold">Full transcript</summary>
          <div className="border-t border-border px-6 py-5">
            {/* The box itself can be full width, but a transcript read as
                one long unbroken line gets harder to follow, not easier. */}
            <p className="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {analytics.full_transcript}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}

/** A trial session was never charged, so its payment status is irrelevant here. */
function PaymentBadge({ booking }: { booking: SessionReview["booking"] }) {
  if (booking.is_trial) return <Badge variant="outline">Free trial</Badge>;
  switch (booking.payment_status) {
    case "paid":
      return <Badge variant="secondary">Paid</Badge>;
    case "refunded":
      return <Badge variant="outline">Refunded</Badge>;
    case "failed":
      return <Badge variant="destructive">Payment failed</Badge>;
    case "pending":
    default:
      return <Badge variant="outline">Payment pending</Badge>;
  }
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
