import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const { data: embeddings } = await supabase
    .from("session_embeddings")
    .select("content, topic")
    .eq("student_id", user.id)
    .limit(12);

  const grounding = (embeddings ?? [])
    .map((e) => `[${e.topic ?? "session"}] ${e.content}`)
    .join("\n\n");

  const instructions = grounding
    ? `You are Kindling's revision assistant for a UK A-Level STEM student. Ground every answer in the session excerpts below — reuse the same methods, terminology and exam board conventions your tutor used. If the excerpts don't cover the question, say so plainly before giving general A-Level guidance.\n\nSession excerpts:\n${grounding}`
    : `You are Kindling's revision assistant for a UK A-Level STEM student. This student has no completed tutoring sessions yet, so you have no transcript to ground answers in — say that plainly, then still help with general A-Level exam-style guidance (mention the exam board when relevant) and encourage them to book a session so future answers can be grounded in their own tutor's explanations.`;

  const result = streamText({
    model: "openai/gpt-5.4-mini",
    system: instructions,
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
