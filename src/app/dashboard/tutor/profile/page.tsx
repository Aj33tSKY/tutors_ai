import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, BadgeCheck, CalendarDays, CreditCard, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { Availability, TutorProfile } from "@/lib/types";
import { removeAvailabilityAction } from "./actions";
import { AccountForm, AddAvailabilityForm, AvatarEditor, EmailForm, PasswordForm, TutorListingForm } from "./profile-forms";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TutorMyProfilePage() {
  const { userId, email, profile } = await getCurrentProfile();
  if (profile?.role !== "tutor") redirect("/dashboard");
  const supabase = await createClient();
  const [{ data: tutor, error: tutorError }, { data: slots, error: slotsError }] = await Promise.all([
    supabase.from("tutor_profiles").select("*").eq("id", userId).maybeSingle<TutorProfile>(),
    supabase.from("availability").select("*").eq("tutor_id", userId)
      .order("day_of_week", { ascending: true }).order("start_time", { ascending: true }).returns<Availability[]>(),
  ]);

  if (tutorError || slotsError || !tutor) {
    return <div className="max-w-3xl rounded-lg border border-border bg-card p-6"><h1 className="display-md">My profile</h1><p className="mt-3 text-sm text-muted-foreground">We couldn&apos;t load your profile right now. Please refresh the page.</p></div>;
  }

  const isPublic = tutor.dbs_verified && !tutor.is_demo;
  const listingStatus = tutor.is_demo ? "Demo account" : isPublic ? "Approved" : "Awaiting approval";
  const listingDescription = tutor.is_demo
    ? "Demo accounts are hidden from tutor search, even when approved."
    : isPublic
      ? "Your profile is visible to students in tutor search."
      : "The Kindling team will review your account before it appears in tutor search.";

  return <div className="max-w-5xl space-y-8 pb-12">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow text-brand-strong">Tutor workspace</p>
        <h1 className="display-md mt-2">My profile</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Manage what students see, how they can book you and where your account updates go.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Badge variant={isPublic ? "secondary" : "outline"}>{listingStatus}</Badge>{isPublic && <Button asChild variant="outline" size="sm"><Link href={`/tutors/${userId}`} target="_blank" rel="noreferrer">View public profile <ArrowUpRight className="size-4" /></Link></Button>}</div>
    </header>

    <nav aria-label="Profile sections" className="flex flex-wrap gap-2 border-b border-border pb-4 text-sm">
      {[["#account", "Account"], ["#listing", "Tutor listing"], ["#availability", "Availability"], ["#payouts", "Payouts"]].map(([href, label]) => <a key={href} href={href} className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">{label}</a>)}
    </nav>

    <section id="account" className="scroll-mt-8 space-y-4">
      <div className="flex items-center gap-2"><UserRound className="size-5 text-brand-strong" /><h2 className="text-xl font-semibold">Account details</h2></div>
      <Card><CardContent className="space-y-7 pt-6"><AvatarEditor userId={userId} fullName={profile.full_name} avatarUrl={profile.avatar_url} /><div className="border-t border-border pt-6"><AccountForm fullName={profile.full_name} /></div><div className="border-t border-border pt-6"><EmailForm email={email || profile.email} /></div><div className="border-t border-border pt-6"><PasswordForm /></div></CardContent></Card>
    </section>

    <section id="listing" className="scroll-mt-8 space-y-4">
      <div className="flex items-center gap-2"><BadgeCheck className="size-5 text-brand-strong" /><h2 className="text-xl font-semibold">Tutor listing</h2></div>
      <Card>
        <CardHeader><CardTitle>Your public information</CardTitle><p className="text-sm text-muted-foreground">Students use this to decide whether you are the right fit. Changes to your rate apply to future lessons.</p></CardHeader>
        <CardContent className="space-y-6"><div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 px-4 py-3 text-sm"><Badge variant={isPublic ? "secondary" : "outline"}>{listingStatus}</Badge><span className="text-muted-foreground">{listingDescription}</span></div><TutorListingForm tutor={tutor} /></CardContent>
      </Card>
    </section>

    <section id="availability" className="scroll-mt-8 space-y-4">
      <div className="flex items-center gap-2"><CalendarDays className="size-5 text-brand-strong" /><h2 className="text-xl font-semibold">Weekly availability</h2></div>
      <Card>
        <CardHeader><CardTitle>When students can request a lesson</CardTitle><p className="text-sm text-muted-foreground">Add the recurring windows you usually teach. Students can request a one-hour lesson inside a window, and you confirm the final time.</p></CardHeader>
        <CardContent className="space-y-6"><AddAvailabilityForm />
          <div className="border-t border-border pt-5">
            <h3 className="mb-3 text-sm font-semibold">Your weekly slots</h3>
            {!slots?.length ? <p className="rounded-md border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">No availability set yet. Add a slot above to start receiving lesson requests.</p> : <ul className="grid gap-2 sm:grid-cols-2">{slots.map((slot) => <li key={slot.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3"><span className="text-sm"><strong className="font-semibold">{DAYS[slot.day_of_week]}</strong><span className="block text-muted-foreground">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span></span><form action={removeAvailabilityAction}><input type="hidden" name="id" value={slot.id} /><Button type="submit" size="icon-sm" variant="ghost" aria-label={`Remove ${DAYS[slot.day_of_week]} ${slot.start_time.slice(0, 5)} slot`}><X className="size-4" /></Button></form></li>)}</ul>}
          </div>
        </CardContent>
      </Card>
    </section>

    <section id="payouts" className="scroll-mt-8 space-y-4">
      <div className="flex items-center gap-2"><CreditCard className="size-5 text-brand-strong" /><h2 className="text-xl font-semibold">Payment settings</h2></div>
      <Card><CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6"><div><h3 className="font-semibold">Payout account</h3><p className="mt-1 max-w-xl text-sm text-muted-foreground">Connect or manage your Stripe account for lesson payments and payout details.</p></div><Button asChild variant="outline"><Link href="/dashboard/tutor/payouts">Manage payouts <ArrowUpRight className="size-4" /></Link></Button></CardContent></Card>
    </section>
  </div>;
}
