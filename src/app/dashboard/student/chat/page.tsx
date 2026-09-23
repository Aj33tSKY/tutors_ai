import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";

// Landing on /chat always resumes the most recent conversation, or starts
// one — the actual UI lives at /chat/[id] so refreshing never loses history.
export default async function ChatIndexPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("student_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) redirect(`/dashboard/student/chat/${recent.id}`);

  const { data: created } = await supabase
    .from("chat_conversations")
    .insert({ student_id: userId })
    .select("id")
    .single();

  redirect(`/dashboard/student/chat/${created!.id}`);
}
