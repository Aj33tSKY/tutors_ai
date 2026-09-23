import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { subjectLabel } from "@/lib/subjects";
import { Button } from "@/components/ui/button";
import type { Booking } from "@/lib/types";

export default async function SessionRoomPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();

  if (!booking) notFound();

  return (
    <div className="shell flex min-h-screen flex-col py-10">
      <Link
        href="/dashboard"
        className="link-draw flex w-fit items-center gap-2 font-mono text-[0.6875rem] tracking-[0.1em] text-muted-foreground uppercase transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to dashboard
      </Link>

      <div className="flex flex-1 flex-col justify-center py-16">
        <p className="eyebrow">Session room</p>
        <h1 className="display-xl mt-6 max-w-[12ch]">{subjectLabel(booking.subject)} session</h1>
        <p className="mt-6 font-mono text-sm text-muted-foreground">
          {new Date(booking.start_time).toLocaleString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>

        <div className="mt-16 max-w-xl border border-hairline bg-raised p-9">
          <p className="eyebrow text-saffron">Not yet connected</p>
          <h2 className="display-md mt-5">Video room pending setup</h2>
          <p className="mt-5 leading-relaxed text-muted-foreground">
            This session will open a live WebRTC room here once a video provider (LiveKit or
            Daily.co) is configured on the server, with real-time transcription piped to Deepgram.
          </p>
          <Button disabled className="mt-8" size="lg">
            Join call
          </Button>
        </div>
      </div>
    </div>
  );
}
