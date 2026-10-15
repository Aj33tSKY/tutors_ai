"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveTutorAction, type ReviewState } from "./actions";

const initialState: ReviewState = {};

export function TutorReviewForm({ tutorId }: { tutorId: string }) {
  const [state, action, pending] = useActionState(approveTutorAction, initialState);
  return <form action={action} className="w-full space-y-3 border-t border-border pt-4">
    <input type="hidden" name="tutor_id" value={tutorId} />
    <div className="space-y-1.5"><Label htmlFor={`evidence-${tutorId}`}>Evidence checked</Label><Textarea id={`evidence-${tutorId}`} name="evidence_note" minLength={20} maxLength={1000} required placeholder="Record what you checked and when. Do not include document numbers or sensitive personal data." /></div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" required className="mt-1 size-4" /><span>I checked the tutor&apos;s identity and safeguarding evidence outside this form.</span></label>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.success ? <p role="status" className="text-sm text-brand-strong">Tutor approved and added to the public catalogue.</p> : <Button type="submit" size="sm" disabled={pending}>{pending ? "Approving…" : "Approve tutor"}</Button>}
  </form>;
}
