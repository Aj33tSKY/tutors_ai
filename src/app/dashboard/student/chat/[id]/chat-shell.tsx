"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { APICallError, DefaultChatTransport, type UIMessage } from "ai";
import { Send, Sparkles, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createConversationAction, deleteConversationAction } from "./actions";

export interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

const SUGGESTIONS = [
  "Explain centripetal force the way my tutor did",
  "Set me a 6-mark exam-style question on my weakest topic",
  "What did I get wrong in my last session?",
];

const DAILY_LIMIT_MESSAGE =
  "That's today's limit for the revision assistant. It resets at midnight, or book a session with your tutor in the meantime.";
const GENERIC_ERROR_MESSAGE =
  "The revision assistant isn't reachable right now — it needs an AI Gateway key configured on the server. Ask your admin to set one up.";

export function ChatShell({
  conversationId,
  initialMessages,
  conversations,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
  conversations: ConversationSummary[];
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { messages, sendMessage, status } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest({ messages, id }) {
        return { body: { message: messages[messages.length - 1], chatId: id } };
      },
    }),
    onError: (error) => {
      setErrorMessage(
        APICallError.isInstance(error) && error.statusCode === 429
          ? DAILY_LIMIT_MESSAGE
          : GENERIC_ERROR_MESSAGE,
      );
    },
    onFinish: () => {
      // picks up the auto-generated title and reordered sidebar without a
      // full reload
      router.refresh();
    },
  });
  const [input, setInput] = useState("");

  const submit = (text: string) => {
    if (!text.trim() || status !== "ready") return;
    setErrorMessage(null);
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-5xl gap-8">
      <aside className="hidden w-56 shrink-0 flex-col lg:flex">
        <form action={createConversationAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 border border-hairline px-3 py-2.5 text-sm transition-colors duration-500 ease-[var(--ease-expo)] hover:border-saffron hover:text-saffron"
          >
            <Plus className="size-4" /> New chat
          </button>
        </form>

        <div className="mt-4 flex-1 space-y-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 px-3 py-2.5 text-sm transition-colors duration-500 ease-[var(--ease-expo)]",
                c.id === conversationId
                  ? "bg-raised text-foreground"
                  : "text-muted-foreground hover:bg-raised hover:text-foreground",
              )}
            >
              <Link href={`/dashboard/student/chat/${c.id}`} className="min-w-0 flex-1 truncate">
                {c.title || "New conversation"}
              </Link>
              <form action={deleteConversationAction}>
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </form>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-hairline pb-5">
          <Sparkles className="size-4 shrink-0 text-saffron" />
          <div>
            <h2 className="font-heading text-xl">Revision Assistant</h2>
            <p className="eyebrow mt-1.5">Grounded in your own session transcripts</p>
          </div>
        </div>

        <div aria-live="polite" className="flex-1 space-y-4 overflow-y-auto py-8">
          {messages.length === 0 && (
            <div className="flex flex-col items-start gap-2 pt-4">
              <p className="eyebrow">Try asking</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="border border-hairline px-4 py-2.5 text-left text-sm transition-colors duration-500 ease-[var(--ease-expo)] hover:border-saffron hover:text-saffron"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] px-4 py-3 text-sm leading-relaxed",
                  m.role === "user" ? "bg-saffron text-ink" : "border border-hairline bg-raised",
                )}
              >
                {m.parts.map((part, i) =>
                  part.type === "text" ? <span key={i}>{part.text}</span> : null,
                )}
              </div>
            </div>
          ))}

          {status === "submitted" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          )}
          {status === "error" && errorMessage && (
            <p role="alert" className="border border-destructive/40 px-4 py-3 text-sm text-destructive">
              {errorMessage}
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-end gap-2 border-t border-hairline pt-5"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder="Ask anything about your sessions..."
            className="min-h-12 flex-1 resize-none rounded-sm"
          />
          <Button
            type="submit"
            size="icon"
            disabled={status !== "ready" || !input.trim()}
            className="size-12 shrink-0 rounded-full"
          >
            <Send className="size-4" />
            <span className="sr-only">Send message</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
