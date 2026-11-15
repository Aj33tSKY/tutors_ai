"use client";

import { useRouter } from "next/navigation";
import { SessionLobbyView } from "@/components/dashboard/session-lobby";
import { startLessonAction } from "./session-start-action";

export function SessionLobby(props: { bookingId: string; isTutor: boolean }) {
  const router = useRouter();
  return <SessionLobbyView {...props} startAction={startLessonAction} refreshAction={router.refresh} />;
}
