"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createConversationAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data } = await supabase
    .from("chat_conversations")
    .insert({ student_id: user.id })
    .select("id")
    .single();

  redirect(`/dashboard/student/chat/${data!.id}`);
}

export async function deleteConversationAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = String(formData.get("id"));
  await supabase.from("chat_conversations").delete().eq("id", id).eq("student_id", user.id);

  revalidatePath("/dashboard/student/chat");
  redirect("/dashboard/student/chat");
}
