import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { ChatShell, type ConversationSummary } from "./chat-shell";

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select("id, student_id")
    .eq("id", id)
    .maybeSingle();

  if (!conversation || conversation.student_id !== userId) notFound();

  const [{ data: messageRows }, { data: conversations }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("message")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .eq("student_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50)
      .returns<ConversationSummary[]>(),
  ]);

  const initialMessages = (messageRows ?? []).map((row) => row.message as UIMessage);

  return (
    <ChatShell
      conversationId={id}
      initialMessages={initialMessages}
      conversations={conversations ?? []}
    />
  );
}
