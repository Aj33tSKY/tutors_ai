"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ATTACHMENT_ACCEPT, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_MESSAGE_CHARACTERS, type MessagePage, type ThreadMessage } from "../../../packages/contracts/src/messaging";

export type DisplayMessage = ThreadMessage;
/** How a host application sends and fetches messages. The view never talks to a backend itself. */
export type MessageTransport = {
  send(input: { body: string; file: File | null }): Promise<DisplayMessage>;
  newer(after: string | null): Promise<DisplayMessage[]>;
  older(before: string): Promise<MessagePage>;
};
const POLL_MS = 5000;
const allowedTypes = new Set<string>(ATTACHMENT_TYPES);

function merge(current: DisplayMessage[], incoming: DisplayMessage[]) {
  const known = new Set(current.map((message) => message.id));
  const added = incoming.filter((message) => !known.has(message.id));
  if (!added.length) return current;
  return [...current, ...added].sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);
}

export function DirectMessageThreadView({
  currentUserId,
  counterpartName,
  initialMessages,
  initialHasMore = false,
  transport,
}: {
  currentUserId: string;
  counterpartName: string;
  initialMessages: DisplayMessage[];
  initialHasMore?: boolean;
  transport: MessageTransport;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const latest = useRef<string | null>(initialMessages.at(-1)?.created_at ?? null);
  useEffect(() => { latest.current = messages.at(-1)?.created_at ?? null; }, [messages]);

  const refresh = useCallback(async () => {
    try { const incoming = await transport.newer(latest.current); if (incoming.length) setMessages((current) => merge(current, incoming)); }
    catch { /* A missed poll is retried on the next tick; the thread stays usable. */ }
  }, [transport]);
  useEffect(() => {
    // Hidden tabs stop polling and catch up as soon as they are visible again.
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  async function loadOlder() {
    const oldest = messages[0]?.created_at;
    if (!oldest) return;
    try { const page = await transport.older(oldest); setMessages((current) => merge(current, page.messages)); setHasMore(page.hasMore); }
    catch { setError("Could not load earlier messages."); }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed && !file) return;
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      setError("Attachments must be 10 MB or smaller.");
      return;
    }
    if (file && !allowedTypes.has(file.type)) {
      setError("Attach a PNG, JPEG, GIF, WebP, PDF or Word document.");
      return;
    }
    setError("");
    setSending(true);
    try {
      const message = await transport.send({ body: trimmed, file });
      setMessages((current) => merge(current, [message]));
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
        {hasMore && <div className="text-center"><Button type="button" variant="ghost" size="sm" onClick={loadOlder}>Load earlier messages</Button></div>}
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
              accept={ATTACHMENT_ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={`Message ${counterpartName}`} className="min-h-10 rounded-2xl py-2.5" maxLength={MAX_MESSAGE_CHARACTERS} />
          <Button type="submit" size="icon" className="rounded-full" disabled={sending || (!body.trim() && !file)} aria-label="Send message">
            <Send className="size-4" />
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}
