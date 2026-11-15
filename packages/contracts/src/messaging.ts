import { z } from "zod";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_CHARACTERS = 4000;
/** Raster images and documents only. SVG can carry script and is opened from a signed URL. */
export const ATTACHMENT_TYPES = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx";
export const messageBody = z.string().trim().max(MAX_MESSAGE_CHARACTERS);
export const messagesQuery = z.object({ after: z.iso.datetime({ offset: true }).optional(), before: z.iso.datetime({ offset: true }).optional() })
  .refine((query) => !(query.after && query.before), "Choose either after or before");
export type ThreadMessage = {
  id: string; conversation_id: string; sender_id: string; body: string;
  attachment_name: string | null; attachment_type: string | null; created_at: string; attachmentUrl: string | null;
};
export type MessagePage = { messages: ThreadMessage[]; hasMore: boolean };
export type Thread = MessagePage & { conversationId: string; counterpartName: string };
