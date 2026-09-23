import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

// Cost controls — tune these as usage data comes in. See docs/mvp_plan.md
// notes on chatbot economics for the reasoning behind each one.
const HISTORY_WINDOW = 12; // messages sent to the model per turn, not the whole thread
const DAILY_MESSAGE_LIMIT = 40; // user messages per student per UTC day
const MAX_OUTPUT_TOKENS = 600; // hard ceiling per reply, independent of the prompt

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { message, chatId }: { message: UIMessage; chatId: string } = await req.json();

  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select("id, student_id, title")
    .eq("id", chatId)
    .maybeSingle();

  if (!conversation || conversation.student_id !== user.id) {
    return new Response("Not found", { status: 404 });
  }

  // Hard daily cap, checked before any model call — an over-limit request
  // costs us nothing. Resets at UTC midnight.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count: usedToday } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id)
    .eq("role", "user")
    .gte("created_at", startOfDay.toISOString());

  if ((usedToday ?? 0) >= DAILY_MESSAGE_LIMIT) {
    return new Response("daily_limit_reached", { status: 429 });
  }

  const { data: stored } = await supabase
    .from("chat_messages")
    .select("message")
    .eq("conversation_id", chatId)
    .order("created_at", { ascending: true });

  const priorMessages = (stored ?? []).map((row) => row.message as UIMessage);
  const allMessages = [...priorMessages, message];

  // Persist the user's turn immediately, so it survives even if the model
  // call fails or the client disconnects mid-stream.
  await supabase.from("chat_messages").insert({
    id: message.id,
    conversation_id: chatId,
    student_id: user.id,
    role: "user",
    message,
  });

  if (!conversation.title) {
    const firstText =
      message.parts?.find((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        ?.text ?? "New conversation";
    await supabase
      .from("chat_conversations")
      .update({ title: firstText.slice(0, 60) })
      .eq("id", chatId);
  }

  const { data: embeddings } = await supabase
    .from("session_embeddings")
    .select("content, topic")
    .eq("student_id", user.id)
    .limit(12);

  const grounding = (embeddings ?? [])
    .map((e) => `[${e.topic ?? "session"}] ${e.content}`)
    .join("\n\n");

  const style = `You are Kindling's revision assistant, a UK A-Level STEM tutor talking with a student out loud, not writing them a document.

How you write:
- Talk like a real tutor would on a call: short sentences, plain words, contractions (it's, you'll, that's).
- Keep answers brief by default, a few sentences. Only go longer when you're walking through a worked example step by step, and even then keep each step to one short sentence.
- Never use markdown: no headers, no **bold**, no bullet or numbered list syntax, no code fences. If you're listing steps, just say "First... then... after that...".
- Never use em dashes. Use a comma, a period, or "so" / "but" instead.
- Don't open with filler like "Great question", "Certainly", "I'd be happy to help", "Let's dive in", or close with "Let me know if you have any other questions" or "In conclusion". Just answer.
- Sound like a person, not a search result.`;

  const instructions = grounding
    ? `${style}\n\nGround every answer in the session excerpts below, reusing the same methods, terminology and exam board conventions the student's tutor used. If the excerpts don't cover what's asked, say so plainly before giving general A-Level guidance.\n\nSession excerpts:\n${grounding}`
    : `${style}\n\nThis student has no completed tutoring sessions yet, so you have no transcript to ground answers in. Say that plainly and briefly, then still help with general A-Level exam-style guidance (mention the exam board when relevant), and nudge them to book a session so future answers can be grounded in their own tutor's explanations.`;

  // Bound the context sent to the model regardless of how long the thread
  // has grown — cost per turn stays flat instead of climbing with history.
  const windowed = allMessages.slice(-HISTORY_WINDOW);

  const result = streamText({
    model: "openai/gpt-5.4-nano",
    system: instructions,
    messages: await convertToModelMessages(windowed),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  // Keep generating even if the client disconnects, so onEnd still fires
  // and the reply gets saved.
  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: allMessages,
      generateMessageId: createIdGenerator({ prefix: "asst", size: 16 }),
      onEnd: async ({ messages }) => {
        const reply = messages[messages.length - 1];
        if (!reply || reply.role !== "assistant") return;

        await supabase.from("chat_messages").insert({
          id: reply.id,
          conversation_id: chatId,
          student_id: user.id,
          role: "assistant",
          message: reply,
        });
        await supabase
          .from("chat_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", chatId);
      },
    }),
  });
}
