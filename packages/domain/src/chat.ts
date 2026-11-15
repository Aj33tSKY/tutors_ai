import { convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, streamText, toUIMessageStream, type LanguageModel, type UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index";
import type { ChatConversationSummary, ChatRequest, ChatTranscript } from "../../contracts/src/chat";
import { languageModel } from "../../jobs/src/ai-models";
import { AppError } from "./errors";
import { databaseResult, requireRole } from "./portal";

// Cost controls. See docs/mvp_plan.md on chatbot economics for the reasoning behind each.
export const HISTORY_WINDOW = 12; // messages sent to the model per turn, never the whole thread
export const DAILY_MESSAGE_LIMIT = 40; // model calls per student per UTC day, enforced atomically in the database
export const MAX_OUTPUT_TOKENS = 600; // hard ceiling per reply, independent of the prompt
const TRANSCRIPT_LIMIT = 100;

const style = `You are Kindling's revision assistant, a UK A-Level STEM tutor talking with a student out loud, not writing them a document.

How you write:
- Talk like a real tutor would on a call: short sentences, plain words, contractions (it's, you'll, that's).
- Keep answers brief by default, a few sentences. Only go longer when you're walking through a worked example step by step, and even then keep each step to one short sentence.
- Never use markdown: no headers, no **bold**, no bullet or numbered list syntax, no code fences. If you're listing steps, just say "First... then... after that...".
- Never use em dashes. Use a comma, a period, or "so" / "but" instead.
- Don't open with filler like "Great question", "Certainly", "I'd be happy to help", "Let's dive in", or close with "Let me know if you have any other questions" or "In conclusion". Just answer.
- Sound like a person, not a search result.`;

/** Instructions grounded in the student's own recent lessons. Reads are caller-scoped (RLS). */
export async function chatInstructions(client: SupabaseClient, studentId: string) {
  const [completed, recent] = await Promise.all([
    client.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "completed"),
    client.from("bookings").select("id, lesson_name, subject, exam_board, start_time").eq("student_id", studentId).eq("status", "completed")
      .order("start_time", { ascending: false }).limit(12),
  ]);
  databaseResult(completed.error); databaseResult(recent.error);
  const lessons = recent.data ?? [];
  const embeddings = lessons.length
    ? await client.from("session_embeddings").select("booking_id, content, topic").eq("student_id", studentId).in("booking_id", lessons.map((lesson) => lesson.id)).limit(24)
    : { data: [], error: null };
  databaseResult(embeddings.error);
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const grounding = (embeddings.data ?? []).map((excerpt) => {
    const lesson = lessonById.get(excerpt.booking_id);
    const source = lesson ? `${lesson.lesson_name || lesson.subject || "Lesson"}, ${new Date(lesson.start_time).toLocaleDateString("en-GB")}` : "Lesson";
    return `[Source: ${source}; topic: ${excerpt.topic ?? "general"}] ${excerpt.content}`;
  }).join("\n\n");
  const count = completed.count ?? 0;
  const lessonContext = `The student has ${count} completed lesson${count === 1 ? "" : "s"}. Only excerpts from up to 12 recent lessons are included below. Never invent a lesson, quote, source or progress measure.`;
  return grounding
    ? `${style}\n\n${lessonContext} For questions about their lesson history, use this count. Ground answers about past lessons in the excerpts below. Mention the source lesson name and date when using one. Reuse the tutor's methods and terminology. If the excerpts don't cover the question, say so plainly before giving general A-Level guidance.\n\nSession excerpts:\n${grounding}`
    : `${style}\n\n${lessonContext} No transcript excerpts are available in this context. Say so briefly if asked about a past lesson, then help with general A-Level exam-style guidance. If the student has no completed lessons, suggest booking one for future transcript-grounded answers.`;
}

/**
 * One chat turn. The allowance is spent atomically before any model call, so an over-limit
 * request costs nothing and concurrent requests cannot overshoot the cap. The student's turn is
 * stored first so it survives a model failure or a disconnect; generation continues after a
 * disconnect so the reply is still saved. Nothing is shared between processes: any replica
 * can serve any turn.
 */
export async function chatTurn(client: SupabaseClient, identity: Identity, request: ChatRequest, options: { model?: LanguageModel } = {}): Promise<Response> {
  requireRole(identity, ["student"]);
  const { chatId } = request;
  const message = request.message as unknown as UIMessage;
  const conversation = await client.from("chat_conversations").select("id,title").eq("id", chatId).eq("student_id", identity.id).maybeSingle();
  databaseResult(conversation.error);
  if (!conversation.data) throw new AppError(404, "not_found", "Conversation not found");

  const turn = await client.rpc("chat_begin_turn_v1", { p_conversation: chatId, p_message_id: message.id, p_message: message, p_limit: DAILY_MESSAGE_LIMIT });
  if (turn.error?.code === "P0002") throw new AppError(404, "not_found", "Conversation not found");
  databaseResult(turn.error);
  if (turn.data === "limit") throw new AppError(429, "daily_limit_reached", "That's today's limit for the revision assistant. It resets at midnight UTC.");

  const firstText = message.parts.find((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")?.text ?? "New conversation";
  if (!conversation.data.title) await client.rpc("chat_name_conversation_v1", { p_conversation: chatId, p_title: firstText });

  // Bounded at the source: only the newest turns are read, however long the thread has grown.
  const recent = await client.from("chat_messages").select("message").eq("conversation_id", chatId).order("created_at", { ascending: false }).limit(HISTORY_WINDOW);
  databaseResult(recent.error);
  const history = (recent.data ?? []).map((row) => row.message as UIMessage).reverse();
  if (history.at(-1)?.id !== message.id) history.push(message);
  const instructions = await chatInstructions(client, identity.id);

  const result = streamText({
    model: options.model ?? languageModel(),
    system: instructions,
    messages: await convertToModelMessages(history),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  result.consumeStream();
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: history,
      generateMessageId: createIdGenerator({ prefix: "asst", size: 16 }),
      onEnd: async ({ messages }) => {
        const reply = messages[messages.length - 1];
        if (!reply || reply.role !== "assistant") return;
        const saved = await client.rpc("chat_finish_turn_v1", { p_conversation: chatId, p_reply_id: reply.id, p_reply: reply, p_title: null });
        if (saved.error) console.error(JSON.stringify({ event: "chat_reply_not_saved", chatId }));
      },
    }),
  });
}

export async function chatConversations(client: SupabaseClient, identity: Identity): Promise<ChatConversationSummary[]> {
  requireRole(identity, ["student"]);
  const result = await client.from("chat_conversations").select("id, title, updated_at").eq("student_id", identity.id).order("updated_at", { ascending: false }).limit(50).returns<ChatConversationSummary[]>();
  databaseResult(result.error);
  return result.data ?? [];
}
export async function createChatConversation(client: SupabaseClient, identity: Identity): Promise<{ id: string }> {
  requireRole(identity, ["student"]);
  const result = await client.from("chat_conversations").insert({ student_id: identity.id }).select("id").single();
  databaseResult(result.error);
  return { id: result.data!.id as string };
}
/** The conversation, the newest messages in reading order, and the sidebar list. */
export async function chatTranscript(client: SupabaseClient, identity: Identity, id: string): Promise<ChatTranscript> {
  requireRole(identity, ["student"]);
  const [conversation, messages, conversations] = await Promise.all([
    client.from("chat_conversations").select("id").eq("id", id).eq("student_id", identity.id).maybeSingle(),
    client.from("chat_messages").select("message").eq("conversation_id", id).order("created_at", { ascending: false }).limit(TRANSCRIPT_LIMIT),
    chatConversations(client, identity),
  ]);
  databaseResult(conversation.error); databaseResult(messages.error);
  if (!conversation.data) throw new AppError(404, "not_found", "Conversation not found");
  return { conversation: { id }, messages: (messages.data ?? []).map((row) => row.message).reverse(), conversations };
}
export async function deleteChatConversation(client: SupabaseClient, identity: Identity, id: string) {
  requireRole(identity, ["student"]);
  databaseResult((await client.from("chat_conversations").delete().eq("id", id).eq("student_id", identity.id)).error);
}
