"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { EXAM_BOARDS, SUBJECTS } from "@/lib/subjects";
import type { TutorProfile } from "@/lib/types";
import {
  addAvailabilityAction,
  changePasswordAction,
  requestEmailChangeAction,
  saveAccountAction,
  saveAvatarAction,
  saveTutorListingAction,
  type SaveState,
} from "./actions";

const initialState: SaveState = {};
const AVATAR_BUCKET = "tutor-avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

function FormFeedback({ state }: { state: SaveState }) {
  return <>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.success && <p role="status" className="flex items-center gap-1.5 text-sm text-brand-strong"><Check className="size-4" />{state.success}</p>}
  </>;
}

export function AccountForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(saveAccountAction, initialState);
  return <form action={action} className="space-y-4">
    <div className="space-y-1.5">
      <Label htmlFor="profile-full-name">Full name</Label>
      <Input id="profile-full-name" name="full_name" defaultValue={fullName} minLength={2} maxLength={100} autoComplete="name" required />
      <p className="text-xs text-muted-foreground">Shown on your public tutor profile and in lesson messages.</p>
    </div>
    <FormFeedback state={state} />
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save name"}</Button>
  </form>;
}

export function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(requestEmailChangeAction, initialState);
  return <form action={action} className="space-y-4">
    <div className="space-y-1.5">
      <Label htmlFor="profile-email">Account email</Label>
      <Input id="profile-email" name="email" type="email" defaultValue={email} maxLength={254} autoComplete="email" required />
      <p className="text-xs text-muted-foreground">Changing your sign-in email requires confirmation. Your current address stays active until then.</p>
    </div>
    <FormFeedback state={state} />
    <Button type="submit" variant="outline" disabled={pending}>{pending ? "Sending…" : "Change email"}</Button>
  </form>;
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  return <form action={action} className="space-y-4">
    <h3 className="text-sm font-semibold">Password</h3>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" name="current_password" type="password" autoComplete="current-password" required /></div>
      <div className="space-y-1.5"><Label htmlFor="new-password">New password</Label><Input id="new-password" name="new_password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></div>
      <div className="space-y-1.5"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" name="confirm_password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></div>
    </div>
    <FormFeedback state={state} />
    <Button type="submit" variant="outline" disabled={pending}>{pending ? "Updating…" : "Update password"}</Button>
  </form>;
}

function ownAvatarPath(url: string | null, userId: string) {
  if (!url) return null;
  try {
    const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const candidate = new URL(url);
    const prefix = `/storage/v1/object/public/${AVATAR_BUCKET}/${userId}/`;
    if (candidate.origin !== project.origin || !candidate.pathname.startsWith(prefix)) return null;
    return `${userId}/${candidate.pathname.slice(prefix.length)}`;
  } catch { return null; }
}

export function AvatarEditor({ userId, fullName, avatarUrl }: { userId: string; fullName: string; avatarUrl: string | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [currentUrl, setCurrentUrl] = useState(avatarUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SaveState>({});

  async function upload() {
    if (!file) return;
    const extension = IMAGE_EXTENSIONS[file.type];
    if (!extension || file.size > MAX_AVATAR_BYTES) {
      setMessage({ error: "Choose a JPG, PNG or WebP image smaller than 5 MB." });
      return;
    }
    setBusy(true);
    setMessage({});
    let uploadedPath: string | null = null;
    try {
      const supabase = createClient();
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setMessage({ error: "We couldn't upload that photo. Please try again." });
        return;
      }
      uploadedPath = path;
      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const result = await saveAvatarAction(data.publicUrl);
      if (result.error) {
        await supabase.storage.from(AVATAR_BUCKET).remove([path]);
        uploadedPath = null;
        setMessage(result);
      } else {
        uploadedPath = null;
        const previousPath = ownAvatarPath(currentUrl, userId);
        setCurrentUrl(data.publicUrl);
        setFile(null);
        setMessage(result);
        if (previousPath) await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
        router.refresh();
      }
    } catch {
      if (uploadedPath) await createClient().storage.from(AVATAR_BUCKET).remove([uploadedPath]);
      setMessage({ error: "We couldn't save your photo. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage({});
    try {
      const result = await saveAvatarAction(null);
      if (result.error) setMessage(result);
      else {
        const previousPath = ownAvatarPath(currentUrl, userId);
        setCurrentUrl(null);
        setFile(null);
        setMessage(result);
        if (previousPath) await createClient().storage.from(AVATAR_BUCKET).remove([previousPath]);
        router.refresh();
      }
    } catch {
      setMessage({ error: "We couldn't remove your photo. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-wrap items-center gap-5">
    {currentUrl ? (
      // Public Storage URLs are scoped to the tutor's own avatar bucket.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={currentUrl} alt={`${fullName}'s profile photo`} className="size-20 rounded-full border border-border object-cover" />
    ) : <span aria-hidden className="flex size-20 items-center justify-center rounded-full bg-secondary text-2xl font-semibold">{fullName.charAt(0).toUpperCase() || "T"}</span>}
    <div className="min-w-0 flex-1 space-y-2">
      <Label htmlFor="profile-photo">Profile photo</Label>
      <Input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={busy} />
      <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 5 MB. Your photo is public when your tutor profile is approved.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={upload} disabled={!file || busy}><Camera className="size-4" />{busy ? "Saving…" : "Upload photo"}</Button>
        {currentUrl && <Button type="button" size="sm" variant="outline" onClick={remove} disabled={busy}><Trash2 className="size-4" />Remove</Button>}
      </div>
      <FormFeedback state={message} />
    </div>
  </div>;
}

export function TutorListingForm({ tutor }: { tutor: TutorProfile }) {
  const [state, action, pending] = useActionState(saveTutorListingAction, initialState);
  return <form action={action} className="space-y-7">
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="tutor-headline">Profile headline</Label>
        <Input id="tutor-headline" name="headline" defaultValue={tutor.headline ?? ""} maxLength={120} placeholder="e.g. Physics specialist who makes hard topics click" />
        <p className="text-xs text-muted-foreground">A short introduction shown beside your name.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tutor-rate">Hourly rate (£)</Label>
        <Input id="tutor-rate" name="hourly_rate" type="number" min="10" max="300" step="0.01" defaultValue={(tutor.hourly_rate / 100).toFixed(2)} required />
        <p className="text-xs text-muted-foreground">Used for future paid lessons. Your first lesson with each student is free.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tutor-experience">Years of tutoring experience</Label>
        <Input id="tutor-experience" name="years_experience" type="number" min="0" max="60" step="1" defaultValue={tutor.years_experience ?? ""} placeholder="Optional" />
      </div>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="tutor-bio">About your teaching</Label>
      <Textarea id="tutor-bio" name="bio" defaultValue={tutor.bio ?? ""} maxLength={3000} rows={6} placeholder="Describe your teaching approach, experience and the students you help." />
      <p className="text-xs text-muted-foreground">Mention relevant qualifications in your own words. Do not include personal contact details.</p>
    </div>
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Subjects you teach</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {SUBJECTS.map((subject) => <label key={subject.value} className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm"><input type="checkbox" name="subjects" value={subject.value} defaultChecked={tutor.subjects.includes(subject.value)} className="size-4 accent-foreground" />{subject.label}</label>)}
      </div>
    </fieldset>
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Exam boards you support</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {EXAM_BOARDS.map((board) => <label key={board.value} className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm"><input type="checkbox" name="boards" value={board.value} defaultChecked={tutor.boards.includes(board.value)} className="size-4 accent-foreground" />{board.label}</label>)}
      </div>
    </fieldset>
    <FormFeedback state={state} />
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save tutor profile"}</Button>
  </form>;
}

export function AddAvailabilityForm() {
  const [state, action, pending] = useActionState(addAvailabilityAction, initialState);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return <form action={action} className="grid gap-4 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
    <div className="space-y-1.5"><Label htmlFor="availability-day">Day</Label><select id="availability-day" name="day_of_week" defaultValue="1" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="" disabled>Choose a day</option>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></div>
    <div className="space-y-1.5"><Label htmlFor="availability-start">From</Label><Input id="availability-start" name="start_time" type="time" defaultValue="16:00" required /></div>
    <div className="space-y-1.5"><Label htmlFor="availability-end">To</Label><Input id="availability-end" name="end_time" type="time" defaultValue="19:00" required /></div>
    <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add slot"}</Button>
    <div className="sm:col-span-4"><FormFeedback state={state} /></div>
  </form>;
}
