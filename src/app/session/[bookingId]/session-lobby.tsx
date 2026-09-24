"use client";

import { useActionState, useEffect } from "react";
import { LoaderCircle, Play, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startLessonAction } from "./session-start-action";

export function SessionLobby({ bookingId, isTutor }: { bookingId: string; isTutor: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(startLessonAction, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  useEffect(() => {
    if (isTutor) return;
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [isTutor, router]);

  return <div className="mx-auto flex h-[calc(100dvh-6.5rem)] w-full flex-col items-center justify-center rounded-2xl border border-hairline bg-muted/30 px-6 text-center sm:aspect-video sm:h-auto sm:w-[85%] sm:max-w-none"><div className="flex size-14 items-center justify-center rounded-full bg-saffron/15 text-saffron"><Video className="size-6" /></div>{isTutor ? <><h2 className="mt-5 font-heading text-xl font-semibold">Ready to begin?</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Starting opens the lesson room for you and your student.</p><form action={action} className="mt-6"><input type="hidden" name="booking_id" value={bookingId} /><Button type="submit" size="lg" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}{pending ? "Starting…" : "Start session"}</Button></form>{state.error && <p role="alert" className="mt-3 text-sm text-destructive">{state.error}</p>}</> : <><h2 className="mt-5 font-heading text-xl font-semibold">Waiting for your tutor</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Your lesson room will open here as soon as your tutor starts the session.</p><div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Checking for your tutor…</div><Button type="button" size="sm" variant="outline" className="mt-5" onClick={() => router.refresh()}>Check now</Button></>}</div>;
}
