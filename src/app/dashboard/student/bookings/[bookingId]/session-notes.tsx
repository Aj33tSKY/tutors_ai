"use client";

import { SessionNotes as SharedSessionNotes } from "@/components/dashboard/session-notes";
import { updateSessionNotesAction } from "@/app/dashboard/session-actions";

export function SessionNotes(props: Omit<React.ComponentProps<typeof SharedSessionNotes>, "saveAction">) {
  return <SharedSessionNotes {...props} saveAction={updateSessionNotesAction} />;
}
