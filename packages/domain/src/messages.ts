import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index.js";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, messageBody, type MessagePage, type Thread, type ThreadMessage } from "../../contracts/src/messaging.js";
import { AppError } from "./errors.js";
import { databaseResult, requireRole } from "./portal.js";

const BUCKET = "message-attachments";
const PAGE_SIZE = 50;
const columns = "id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_type,created_at";
type Row = { id: string; conversation_id: string; sender_id: string; body: string; attachment_path: string | null;
  attachment_name: string | null; attachment_type: string | null; created_at: string };

const signatures: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => [0x89, 0x50, 0x4e, 0x47].every((v, i) => b[i] === v),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => String.fromCharCode(...b.slice(0, 4)) === "GIF8",
  "image/webp": (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  "application/pdf": (b) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-",
  "application/msword": (b) => [0xd0, 0xcf, 0x11, 0xe0].every((v, i) => b[i] === v),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => b[0] === 0x50 && b[1] === 0x4b,
};
/** The declared type is client-controlled, so the leading bytes must agree with it. */
export function attachmentLooksValid(type: string, bytes: Uint8Array) {
  return (ATTACHMENT_TYPES as readonly string[]).includes(type) && bytes.length > 0 && bytes.length <= MAX_ATTACHMENT_BYTES && Boolean(signatures[type]?.(bytes));
}
export function safeAttachmentName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[.-]+/, "").slice(-100);
  return cleaned || "attachment";
}

async function withUrls(client: SupabaseClient, rows: Row[]): Promise<ThreadMessage[]> {
  const paths = rows.flatMap((row) => row.attachment_path ? [row.attachment_path] : []);
  const urls = new Map<string, string>();
  if (paths.length) {
    // One signing call per page. A signing failure must not hide the conversation.
    const signed = await client.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const item of signed.data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return rows.map(({ attachment_path, ...row }) => ({ ...row, attachmentUrl: attachment_path ? urls.get(attachment_path) ?? null : null }));
}

async function visibleConversation(client: SupabaseClient, id: string) {
  const result = await client.from("direct_conversations").select("id").eq("id", id).maybeSingle();
  databaseResult(result.error);
  if (!result.data) throw new AppError(404, "not_found", "Conversation not found");
}

export async function messagePage(client: SupabaseClient, conversationId: string, cursor: { after?: string; before?: string }): Promise<MessagePage> {
  let query = client.from("direct_messages").select(columns).eq("conversation_id", conversationId);
  query = cursor.after ? query.gt("created_at", cursor.after).order("created_at", { ascending: true }).order("id", { ascending: true })
    : (cursor.before ? query.lt("created_at", cursor.before) : query).order("created_at", { ascending: false }).order("id", { ascending: false });
  const result = await query.limit(PAGE_SIZE + 1).returns<Row[]>();
  databaseResult(result.error);
  const rows = result.data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  if (!cursor.after) page.reverse();
  return { messages: await withUrls(client, page), hasMore };
}

export async function conversationMessages(client: SupabaseClient, conversationId: string, cursor: { after?: string; before?: string }) {
  // RLS would return an empty page for a stranger. Distinguish it so polling stops.
  await visibleConversation(client, conversationId);
  return messagePage(client, conversationId, cursor);
}

export async function openThread(client: SupabaseClient, identity: Identity, counterpartId: string): Promise<Thread> {
  requireRole(identity, ["student", "tutor"]);
  if (counterpartId === identity.id) throw new AppError(404, "not_found", "Conversation not found");
  const studentId = identity.profile.role === "student" ? identity.id : counterpartId;
  const tutorId = identity.profile.role === "tutor" ? identity.id : counterpartId;
  // Sharing a booking is the relationship check; the insert policy repeats it.
  const [shared, counterpart] = await Promise.all([
    client.from("bookings").select("id").eq("student_id", studentId).eq("tutor_id", tutorId).limit(1).maybeSingle(),
    client.from("profiles").select("full_name").eq("id", counterpartId).maybeSingle(),
  ]);
  databaseResult(shared.error); databaseResult(counterpart.error);
  if (!shared.data || !counterpart.data) throw new AppError(404, "not_found", "Conversation not found");
  const find = () => client.from("direct_conversations").select("id").eq("student_id", studentId).eq("tutor_id", tutorId).maybeSingle();
  let conversation = await find();
  databaseResult(conversation.error);
  if (!conversation.data) {
    // Concurrent first opens race on the unique pair; ignoring the duplicate makes both succeed.
    const created = await client.from("direct_conversations").upsert({ student_id: studentId, tutor_id: tutorId }, { onConflict: "student_id,tutor_id", ignoreDuplicates: true });
    databaseResult(created.error);
    conversation = await find(); databaseResult(conversation.error);
  }
  if (!conversation.data) throw new AppError(503, "messaging_unavailable", "Messaging is temporarily unavailable");
  return { conversationId: conversation.data.id, counterpartName: counterpart.data.full_name, ...await messagePage(client, conversation.data.id, {}) };
}

export async function sendMessage(client: SupabaseClient, identity: Identity, conversationId: string, input: { body: string; file?: File | null }): Promise<ThreadMessage> {
  requireRole(identity, ["student", "tutor"]);
  const body = messageBody.safeParse(input.body);
  if (!body.success) throw new AppError(400, "invalid_message", "Messages can be at most 4000 characters");
  if (!body.data && !input.file) throw new AppError(400, "empty_message", "Write a message or attach a file");
  await visibleConversation(client, conversationId);
  let uploaded: string | null = null;
  let name: string | null = null;
  if (input.file) {
    if (input.file.size > MAX_ATTACHMENT_BYTES) throw new AppError(413, "attachment_too_large", "Attachments must be 10 MB or smaller");
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    if (!attachmentLooksValid(input.file.type, bytes)) throw new AppError(415, "attachment_type_unsupported", "Attach a PNG, JPEG, GIF, WebP, PDF or Word document");
    name = input.file.name.slice(0, 200) || "attachment";
    uploaded = `${conversationId}/${identity.id}/${crypto.randomUUID()}-${safeAttachmentName(input.file.name)}`;
    const upload = await client.storage.from(BUCKET).upload(uploaded, bytes, { contentType: input.file.type, upsert: false });
    if (upload.error) throw new AppError(503, "upload_failed", "Could not upload the attachment; please try again");
  }
  // The sender is always the authenticated caller; the client cannot choose it.
  const inserted = await client.from("direct_messages").insert({ conversation_id: conversationId, sender_id: identity.id, body: body.data,
    attachment_path: uploaded, attachment_name: name, attachment_type: uploaded ? input.file!.type : null }).select(columns).single<Row>();
  if (inserted.error || !inserted.data) {
    // Do not leave an unreferenced private file behind a failed send.
    if (uploaded) await client.storage.from(BUCKET).remove([uploaded]).catch(() => undefined);
    databaseResult(inserted.error ?? true);
  }
  return (await withUrls(client, [inserted.data!]))[0];
}
