"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { APICallError, DefaultChatTransport, type UIMessage } from "ai";
import { Send, Sparkles, Loader2, Plus, Trash2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
  const [historyOpen, setHistoryOpen] = useState(false);

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
      <aside className="hidden w-60 shrink-0 flex-col lg:flex">
        <form action={createConversationAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2.5 text-sm font-medium shadow-sm transition-colors hover:border-saffron hover:text-saffron"
          >
            <Plus className="size-4" /> New chat
          </button>
        </form>

        <div className="mt-4 flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm transition-colors",
                c.id === conversationId
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
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
        <div className="flex items-center gap-3 border-b border-border/70 pb-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-saffron/15 text-saffron">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h2 className="font-heading text-xl font-semibold">Revision Assistant</h2>
            <p className="eyebrow mt-1">Grounded in your own session transcripts</p>
          </div>
          <div className="ml-auto flex items-center gap-1 lg:hidden">
            <form action={createConversationAction}>
              <Button type="submit" size="sm" variant="outline">
                <Plus className="size-3.5" /> New
              </Button>
            </form>
            <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
              <SheetTrigger asChild>
                <Button type="button" size="sm" variant="outline">
                  <MessagesSquare className="size-3.5" /> Chats
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 border-border/70 bg-background p-0">
                <SheetTitle className="border-b border-border/70 px-5 py-5 font-heading text-lg">Previous chats</SheetTitle>
                <div className="space-y-1 p-3">
                  {conversations.map((conversation) => (
                    <Link
                      key={conversation.id}
                      href={`/dashboard/student/chat/${conversation.id}`}
                      onClick={() => setHistoryOpen(false)}
                      className={cn(
                        "block rounded-xl px-3 py-3 text-sm transition-colors",
                        conversation.id === conversationId
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}
                    >
                      {conversation.title || "New conversation"}
                    </Link>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
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
                  className="rounded-full border border-border bg-card px-4 py-2.5 text-left text-sm shadow-sm transition-colors hover:border-saffron hover:text-saffron"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages
            .filter((m) => m.parts.some((part) => part.type === "text" && part.text))
            .map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground">
                    {m.parts.map((part, i) =>
                      part.type === "text" ? <span key={i}>{part.text}</span> : null,
                    )}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-saffron/15 text-saffron">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div className="max-w-[85%] pt-0.5 text-sm leading-relaxed text-foreground">
                    {m.parts.map((part, i) =>
                      part.type === "text" ? <span key={i}>{part.text}</span> : null,
                    )}
                  </div>
                </div>
              ),
            )}

          {status === "submitted" && (
            <div className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-saffron/15 text-saffron">
                <Sparkles className="size-3.5" />
              </span>
              <div className="flex items-center gap-2 pt-0.5 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
          {status === "error" && errorMessage && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2 border-t border-border/70 pt-5"
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
            className="min-h-12 flex-1 resize-none rounded-2xl py-3.5"
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
