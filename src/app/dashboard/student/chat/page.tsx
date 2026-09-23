"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Explain centripetal force the way my tutor did",
  "Set me a 6-mark exam-style question on my weakest topic",
  "What did I get wrong in my last session?",
];

export default function RevisionChatPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");

  const submit = (text: string) => {
    if (!text.trim() || status !== "ready") return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
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
                className="border border-hairline px-4 py-2.5 text-left text-sm transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:border-saffron hover:text-saffron"
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
                m.role === "user"
                  ? "bg-saffron text-ink"
                  : "border border-hairline bg-raised",
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
        {status === "error" && (
          <p role="alert" className="border border-destructive/40 px-4 py-3 text-sm text-destructive">
            The revision assistant isn&apos;t reachable right now — it needs an AI Gateway key
            configured on the server. Ask your admin to set one up.
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
  );
}
