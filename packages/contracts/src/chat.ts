import { z } from "zod";

export const MAX_CHAT_CHARACTERS = 4000;
/** Text only: tool, file and reasoning parts have no place in a student's turn. */
export const chatRequest = z.object({
  chatId: z.uuid(),
  message: z.object({
    id: z.string().min(1).max(128), role: z.literal("user"),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string().min(1).max(MAX_CHAT_CHARACTERS) }).strict()).min(1).max(4),
  }).strict(),
}).strict();
export type ChatRequest = z.infer<typeof chatRequest>;
export type ChatConversationSummary = { id: string; title: string | null; updated_at: string };
export type ChatTranscript = { conversation: { id: string }; messages: unknown[]; conversations: ChatConversationSummary[] };
