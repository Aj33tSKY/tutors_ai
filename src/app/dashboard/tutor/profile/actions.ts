"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { EXAM_BOARDS, SUBJECTS } from "@/lib/subjects";
import type { ExamBoard, StemSubject } from "@/lib/types";

export type SaveState = { error?: string; success?: string };

const subjectValues = new Set(SUBJECTS.map((subject) => subject.value));
const boardValues = new Set(EXAM_BOARDS.map((board) => board.value));
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

async function tutorIdentity() {
  const { userId, profile } = await getCurrentProfile();
  return profile?.role === "tutor" ? userId : null;
}

function refreshProfile(userId: string) {
  revalidatePath("/dashboard/tutor/profile");
  revalidatePath("/dashboard", "layout");
  revalidatePath(`/tutors/${userId}`);
  updateTag("tutor-catalogue");
}

export async function saveAccountAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const userId = await tutorIdentity();
  if (!userId) return { error: "Your tutor account could not be verified." };
  const parsed = z.string().trim().min(2).max(100).safeParse(formData.get("full_name"));
  if (!parsed.success) return { error: "Enter your full name (2–100 characters)." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data }).eq("id", userId);
  if (error) return { error: "We couldn't save your name. Please try again." };
  refreshProfile(userId);
  return { success: "Name updated." };
}

export async function requestEmailChangeAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const userId = await tutorIdentity();
  if (!userId) return { error: "Your tutor account could not be verified." };
  const parsed = z.email().max(254).safeParse(String(formData.get("email") ?? "").trim());
  if (!parsed.success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== userId) return { error: "Please sign in again." };
  if (parsed.data.toLowerCase() === user.email?.toLowerCase()) return { error: "That is already your account email." };
  const { error } = await supabase.auth.updateUser({ email: parsed.data });
  if (error) return { error: error.message };
  return { success: "Check your inbox for the email change confirmation. Your current email stays active until the change is complete." };
}

export async function changePasswordAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const userId = await tutorIdentity();
  if (!userId) return { error: "Your tutor account could not be verified." };
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");
  if (newPassword.length < 8 || newPassword.length > 128) return { error: "Use a password between 8 and 128 characters." };
  if (newPassword !== confirmation) return { error: "The new passwords do not match." };
  if (newPassword === currentPassword) return { error: "Choose a different password." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== userId || !user.email) return { error: "Please sign in again." };
  const { error: verificationError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (verificationError) return { error: "Your current password is incorrect." };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { success: "Password updated." };
}

export async function saveTutorListingAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const userId = await tutorIdentity();
  if (!userId) return { error: "Your tutor account could not be verified." };
  const subjects = formData.getAll("subjects").filter((value): value is string => typeof value === "string");
  const boards = formData.getAll("boards").filter((value): value is string => typeof value === "string");
  const parsed = z.object({
    headline: z.string().trim().max(120),
    bio: z.string().trim().max(3000),
    hourlyRate: z.coerce.number().min(10).max(300),
    yearsExperience: z.union([z.literal(""), z.coerce.number().int().min(0).max(60)]),
  }).safeParse({
    headline: formData.get("headline"),
    bio: formData.get("bio"),
    hourlyRate: formData.get("hourly_rate"),
    yearsExperience: formData.get("years_experience"),
  });
  if (!parsed.success) return { error: "Check the headline, bio, experience and hourly rate (£10–£300)." };
  if (subjects.length === 0 || boards.length === 0 || subjects.some((value) => !subjectValues.has(value as StemSubject)) || boards.some((value) => !boardValues.has(value as ExamBoard))) {
    return { error: "Choose at least one subject and one exam board." };
  }
  const pence = Math.round(parsed.data.hourlyRate * 100);
  if (Math.abs(pence / 100 - parsed.data.hourlyRate) > 0.00001) return { error: "Use no more than two decimal places for your hourly rate." };
  const supabase = await createClient();
  const { error } = await supabase.from("tutor_profiles").update({
    headline: parsed.data.headline || null,
    bio: parsed.data.bio || null,
    hourly_rate: pence,
    years_experience: parsed.data.yearsExperience === "" ? null : parsed.data.yearsExperience,
    subjects: [...new Set(subjects)] as StemSubject[],
    boards: [...new Set(boards)] as ExamBoard[],
  }).eq("id", userId);
  if (error) return { error: "We couldn't save your tutor profile. Please try again." };
  refreshProfile(userId);
  return { success: "Tutor profile saved." };
}

export async function saveAvatarAction(url: string | null): Promise<SaveState> {
  const userId = await tutorIdentity();
  if (!userId) return { error: "Your tutor account could not be verified." };
  if (url !== null) {
    try {
      const candidate = new URL(url);
      const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
      const prefix = `/storage/v1/object/public/tutor-avatars/${userId}/`;
      if (candidate.origin !== project.origin || !candidate.pathname.startsWith(prefix) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(candidate.pathname.slice(prefix.length))) {
        return { error: "That profile photo could not be verified." };
      }
    } catch {
      return { error: "That profile photo could not be verified." };
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) return { error: "We couldn't save your profile photo." };
  refreshProfile(userId);
  return { success: url ? "Profile photo updated." : "Profile photo removed." };
}

export async function addAvailabilityAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const userId = await tutorIdentity();
  if (!userId) return { error: "Your tutor account could not be verified." };
  const day = Number(formData.get("day_of_week"));
  const start = String(formData.get("start_time") ?? "");
  const end = String(formData.get("end_time") ?? "");
  if (!Number.isInteger(day) || day < 0 || day > 6 || !timePattern.test(start) || !timePattern.test(end) || start >= end) {
    return { error: "Choose a valid day and a start time before the end time." };
  }
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (minutes(end) - minutes(start) < 60) return { error: "Make each availability window at least one hour long." };
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase.from("availability")
    .select("start_time, end_time").eq("tutor_id", userId).eq("day_of_week", day);
  if (readError) return { error: "We couldn't check your existing slots." };
  if ((existing ?? []).some((slot) => start < slot.end_time.slice(0, 5) && end > slot.start_time.slice(0, 5))) {
    return { error: "That time overlaps an existing slot." };
  }
  const { error } = await supabase.from("availability").insert({ tutor_id: userId, day_of_week: day, start_time: start, end_time: end });
  if (error) return { error: "We couldn't add that slot. Please try again." };
  revalidatePath("/dashboard/tutor/profile");
  revalidatePath(`/tutors/${userId}`);
  updateTag("tutor-catalogue");
  return { success: "Weekly slot added." };
}

export async function removeAvailabilityAction(formData: FormData): Promise<void> {
  const userId = await tutorIdentity();
  if (!userId) return;
  const parsed = z.uuid().safeParse(formData.get("id"));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.from("availability").delete().eq("id", parsed.data).eq("tutor_id", userId);
  if (error) throw new Error("Could not remove availability slot");
  revalidatePath("/dashboard/tutor/profile");
  revalidatePath(`/tutors/${userId}`);
  updateTag("tutor-catalogue");
}
