"use client";

import { useEffect, useState } from "react";
import { FileText, ImageIcon, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import type { DirectMessage } from "@/lib/types";

const ATTACHMENTS_BUCKET = "message-attachments";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type DisplayMessage = DirectMessage & { attachmentUrl: string | null };

export function DirectMessageThread({
  conversationId,
  currentUserId,
  counterpartName,
  initialMessages,
}: {
  conversationId: string;
  currentUserId: string;
  counterpartName: string;
  initialMessages: DisplayMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`direct-messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `conversation_id=eq.${conversationId}` },
        () => window.location.reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed && !file) return;
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      setError("Attachments must be 10 MB or smaller.");
      return;
    }
    if (file && !file.type.startsWith("image/") && !ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
      setError("Attach an image, PDF, Word document, or a supported homework file.");
      return;
    }

    setError("");
    setSending(true);
    const supabase = createClient();
    let attachmentPath: string | null = null;
    let attachmentUrl: string | null = null;
    try {
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        attachmentPath = `${conversationId}/${currentUserId}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .upload(attachmentPath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { data: signed, error: signedError } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .createSignedUrl(attachmentPath, 60 * 60);
        if (signedError) throw signedError;
        attachmentUrl = signed.signedUrl;
      }

      const { data: message, error: messageError } = await supabase
        .from("direct_messages")
        .insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          body: trimmed,
          attachment_path: attachmentPath,
          attachment_name: file?.name ?? null,
          attachment_type: file?.type ?? null,
        })
        .select()
        .single<DirectMessage>();
      if (messageError) throw messageError;

      await supabase
        .from("direct_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      setMessages((current) => [...current, { ...message, attachmentUrl }]);
      setBody("");
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send this message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-12rem)] flex-col rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="border-b border-border/70 px-5 py-4">
        <p className="font-medium">{counterpartName}</p>
        <p className="text-xs text-muted-foreground">Direct messages and homework</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Start the conversation or share homework.</p>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === currentUserId;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] text-sm ${mine ? "text-right" : "text-left"}`}>
                  <div className={mine ? "inline-block rounded-2xl bg-secondary px-3.5 py-2.5 text-left" : ""}>
                    {message.body && <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>}
                    {message.attachmentUrl && message.attachment_type?.startsWith("image/") ? (
                      <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={message.attachmentUrl} alt={message.attachment_name ?? "Attached image"} className="max-h-72 rounded-xl" />
                      </a>
                    ) : message.attachmentUrl ? (
                      <a
                        href={message.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 flex items-center gap-2 underline underline-offset-2"
                      >
                        <FileText className="size-4" /> {message.attachment_name ?? "Attachment"}
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">
                    {new Date(message.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={sendMessage} className="border-t border-border/70 p-4">
        {file && (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-secondary px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 truncate"><ImageIcon className="size-4" /> {file.name}</span>
            <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment"><X className="size-4" /></button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="flex shrink-0 cursor-pointer items-center justify-center rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <Paperclip className="size-4" />
            <span className="sr-only">Attach homework</span>
            <input
              type="file"
              className="sr-only"
              accept="image/*,.pdf,.doc,.docx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={`Message ${counterpartName}`} className="min-h-10 rounded-2xl py-2.5" maxLength={4000} />
          <Button type="submit" size="icon" className="rounded-full" disabled={sending || (!body.trim() && !file)} aria-label="Send message">
            <Send className="size-4" />
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}
