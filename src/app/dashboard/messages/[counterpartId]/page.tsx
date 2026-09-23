import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DirectMessageThread, type DisplayMessage } from "@/components/dashboard/direct-message-thread";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { Booking, DirectConversation, DirectMessage, Profile } from "@/lib/types";

const ATTACHMENTS_BUCKET = "message-attachments";

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

  const { data: messages } = await supabase
    .from("direct_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .returns<DirectMessage[]>();

  const initialMessages: DisplayMessage[] = await Promise.all(
    (messages ?? []).map(async (message) => {
      if (!message.attachment_path) return { ...message, attachmentUrl: null };
      const { data } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(message.attachment_path, 60 * 60);
      return { ...message, attachmentUrl: data?.signedUrl ?? null };
    }),
  );

  const backHref = profile.role === "student" ? "/dashboard/student/tutors" : "/dashboard/tutor/students";
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={backHref}><ArrowLeft className="size-4" /> Back</Link>
      </Button>
      <DirectMessageThread
        conversationId={conversation.id}
        currentUserId={userId}
        counterpartName={counterpart.full_name}
        initialMessages={initialMessages}
      />
    </div>
  );
}

function MessagingUnavailable() {
  return (
    <div className="mx-auto max-w-xl py-12">
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
