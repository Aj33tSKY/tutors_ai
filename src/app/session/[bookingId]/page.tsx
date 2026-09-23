import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { subjectLabel } from "@/lib/subjects";
import { Button } from "@/components/ui/button";
import { createParticipantToken, livekitConfigured, roomNameForBooking } from "@/lib/livekit";
import { VideoRoom } from "./video-room";
import type { Booking, Profile } from "@/lib/types";

export default async function SessionRoomPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/session/${bookingId}`);

  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();

  if (!booking) notFound();

  // Only the two people on this booking ever get a token for its room —
  // not other students, other tutors, or (deliberately, for safeguarding)
  // a linked parent.
  const isStudent = booking.student_id === user.id;
  const isTutor = booking.tutor_id === user.id;
  if (!isStudent && !isTutor) notFound();

  if (booking.status === "cancelled") {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-5 text-center">
        <p className="eyebrow text-saffron">Cancelled</p>
        <h1 className="display-md mt-4">This session was cancelled</h1>
        <Button asChild className="mt-8">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  if (!livekitConfigured()) {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-5 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Video className="size-7" />
        </div>
        <p className="eyebrow mt-6">{subjectLabel(booking.subject)} session</p>
        <h1 className="display-md mt-4">Video isn&apos;t configured yet</h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          This deployment is missing its LiveKit credentials. Set{" "}
          <code>LIVEKIT_API_KEY</code>, <code>LIVEKIT_API_SECRET</code> and{" "}
          <code>NEXT_PUBLIC_LIVEKIT_URL</code> to enable live sessions.
        </p>
        <Button asChild variant="outline" className="mt-8">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" /> Back to dashboard
          </Link>
        </Button>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "full_name">>();

  const token = await createParticipantToken({
    bookingId: booking.id,
    identity: user.id,
    name: profile?.full_name ?? (isTutor ? "Tutor" : "Student"),
    role: isTutor ? "tutor" : "student",
  });

  return (
    <VideoRoom
      token={token}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
      roomName={roomNameForBooking(booking.id)}
      subject={subjectLabel(booking.subject)}
    />
  );
}
