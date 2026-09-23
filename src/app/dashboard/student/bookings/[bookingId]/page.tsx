import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  CircleAlert,
  ClipboardCheck,
  FileText,
  Play,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import { createClient } from "@/lib/supabase/server";
import type { Booking, SessionAnalytics } from "@/lib/types";

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

  const { data: analytics } = await supabase
    .from("session_analytics")
    .select("*")
    .eq("booking_id", booking.id)
    .maybeSingle<SessionAnalytics>();

  // recording_path is an opaque object key, not a durable URL. Storage RLS
  // verifies the session relationship before issuing this one-hour playback URL.
  let recordingUrl: string | null = null;
  if (analytics?.recording_path) {
    const { data } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(analytics.recording_path, 60 * 60);
    recordingUrl = data?.signedUrl ?? null;
  }

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
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard/student">
          <ArrowLeft className="size-4" /> All sessions
        </Link>
      </Button>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-saffron">Session review</p>
          <h2 className="display-md mt-2">{subjectLabel(booking.subject)}</h2>
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
          {recordingUrl ? (
            <video controls playsInline preload="metadata" className="aspect-video w-full bg-black">
              <source src={recordingUrl} type="video/mp4" />
              Your browser does not support session video playback.
            </video>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-sm border border-dashed border-hairline px-6 text-center">
              <Play className="size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">No recording is available</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Recordings appear here when recording was enabled for this session.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!analytics?.full_transcript ? (
        <ProcessingState />
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

          <details className="rounded-sm border border-hairline bg-card">
            <summary className="cursor-pointer px-6 py-5 font-heading text-lg">Full transcript</summary>
            <div className="border-t border-hairline px-6 py-5">
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

function ProcessingState() {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="font-medium">Your session notes are still processing</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          The transcript and action points usually appear within a few minutes of the session ending.
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
              <li key={item} className="rounded-sm border border-hairline px-3 py-2 text-sm">
                {item}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
