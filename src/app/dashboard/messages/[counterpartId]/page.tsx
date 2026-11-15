import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DirectMessageThread, type DisplayMessage } from "@/components/dashboard/direct-message-thread";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { Booking, DirectConversation, Profile } from "@/lib/types";

const ATTACHMENTS_BUCKET = "message-attachments";
const PAGE_SIZE = 50;

export default async function DirectMessagesPage({
  params,
}: {
  params: Promise<{ counterpartId: string }>;
}) {
  const { counterpartId } = await params;
  const { userId, profile } = await getCurrentProfile();
  if (!profile || (profile.role !== "student" && profile.role !== "tutor")) redirect("/dashboard");

  const supabase = await createClient();
  const studentId = profile.role === "student" ? userId : counterpartId;
  const tutorId = profile.role === "tutor" ? userId : counterpartId;

  // Sharing a booking is the relationship check. The page never trusts the
  // counterpart id alone, and the database RLS repeats the same constraint.
  const { data: sharedBooking } = await supabase
    .from("bookings")
    .select("id")
    .eq("student_id", studentId)
    .eq("tutor_id", tutorId)
    .limit(1)
    .maybeSingle<Pick<Booking, "id">>();
  if (!sharedBooking) notFound();

  const { data: counterpart } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", counterpartId)
    .maybeSingle<Pick<Profile, "id" | "full_name">>();
  if (!counterpart) notFound();

  let { data: conversation, error: conversationError } = await supabase
    .from("direct_conversations")
    .select("*")
    .eq("student_id", studentId)
    .eq("tutor_id", tutorId)
    .maybeSingle<DirectConversation>();

  if (conversationError) return <MessagingUnavailable />;

  if (!conversation) {
    const { data: created, error: createError } = await supabase
      .from("direct_conversations")
      .insert({ student_id: studentId, tutor_id: tutorId })
      .select()
      .maybeSingle<DirectConversation>();
    if (createError?.code === "23505") {
      const { data: existing, error: existingError } = await supabase
        .from("direct_conversations")
        .select("*")
        .eq("student_id", studentId)
        .eq("tutor_id", tutorId)
        .maybeSingle<DirectConversation>();
      conversation = existing;
      conversationError = existingError;
    } else {
      conversation = created;
      conversationError = createError;
    }
  }
  if (conversationError || !conversation) return <MessagingUnavailable />;

  // Bounded history: the newest page only; older messages load on request.
  const { data: newest } = await supabase
    .from("direct_messages")
    .select("id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_type,created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);
  const rows = (newest ?? []).slice(0, PAGE_SIZE).reverse();
  const paths = rows.flatMap((row) => (row.attachment_path ? [row.attachment_path] : []));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrls(paths, 60 * 60);
    for (const item of signed ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  const initialMessages: DisplayMessage[] = rows.map(({ attachment_path, ...row }) => ({ ...row, attachmentUrl: attachment_path ? urls.get(attachment_path) ?? null : null }));

  const backHref = profile.role === "student" ? "/dashboard/student/tutors" : "/dashboard/tutor/students";
  return (
    <div className="max-w-4xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={backHref}><ArrowLeft className="size-4" /> Back</Link>
      </Button>
      <DirectMessageThread
        conversationId={conversation.id}
        currentUserId={userId}
        counterpartName={counterpart.full_name}
        initialMessages={initialMessages}
        initialHasMore={(newest?.length ?? 0) > PAGE_SIZE}
      />
    </div>
  );
}

function MessagingUnavailable() {
  return (
    <div className="max-w-xl py-12">
      <Card>
        <CardContent className="py-10 text-center">
          <p className="font-medium">Direct messages are still being set up</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Apply the direct-messages database migration, then refresh this page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
