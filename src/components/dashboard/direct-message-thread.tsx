"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { DirectMessageThreadView, type DisplayMessage, type MessageTransport } from "./direct-message-thread-view";
import type { MessagePage } from "../../../packages/contracts/src/messaging";

export type { DisplayMessage };
const BUCKET = "message-attachments";
const PAGE = 50;
type Row = Omit<DisplayMessage, "attachmentUrl"> & { attachment_path: string | null };
const columns = "id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_type,created_at";

/** Legacy Next transport. Removed once the Next runtime is retired; the portable app uses its API instead. */
function supabaseTransport(conversationId: string, currentUserId: string): MessageTransport {
  const supabase = createClient();
  async function withUrls(rows: Row[]): Promise<DisplayMessage[]> {
    const paths = rows.flatMap((row) => row.attachment_path ? [row.attachment_path] : []);
    const urls = new Map<string, string>();
    if (paths.length) for (const item of (await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)).data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
    return rows.map(({ attachment_path, ...row }) => ({ ...row, attachmentUrl: attachment_path ? urls.get(attachment_path) ?? null : null }));
  }
  return {
    async send({ body, file }) {
      let path: string | null = null;
      if (file) {
        path = `${conversationId}/${currentUserId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
      }
      const { data, error } = await supabase.from("direct_messages").insert({ conversation_id: conversationId, sender_id: currentUserId, body,
        attachment_path: path, attachment_name: file?.name ?? null, attachment_type: file?.type ?? null }).select(columns).single<Row>();
      if (error) { if (path) await supabase.storage.from(BUCKET).remove([path]); throw error; }
      return (await withUrls([data]))[0];
    },
    async newer(after) {
      let query = supabase.from("direct_messages").select(columns).eq("conversation_id", conversationId);
      if (after) query = query.gt("created_at", after);
      const { data, error } = await query.order("created_at", { ascending: true }).limit(100).returns<Row[]>();
      if (error) throw error;
      return withUrls(data ?? []);
    },
    async older(before): Promise<MessagePage> {
      const { data, error } = await supabase.from("direct_messages").select(columns).eq("conversation_id", conversationId)
        .lt("created_at", before).order("created_at", { ascending: false }).limit(PAGE + 1).returns<Row[]>();
      if (error) throw error;
      const rows = data ?? [];
      return { messages: await withUrls(rows.slice(0, PAGE).reverse()), hasMore: rows.length > PAGE };
    },
  };
}

export function DirectMessageThread({ conversationId, currentUserId, counterpartName, initialMessages, initialHasMore }: {
  conversationId: string; currentUserId: string; counterpartName: string; initialMessages: DisplayMessage[]; initialHasMore: boolean;
}) {
  const transport = useMemo(() => supabaseTransport(conversationId, currentUserId), [conversationId, currentUserId]);
  return <DirectMessageThreadView currentUserId={currentUserId} counterpartName={counterpartName} initialMessages={initialMessages} initialHasMore={initialHasMore} transport={transport}/>;
}
