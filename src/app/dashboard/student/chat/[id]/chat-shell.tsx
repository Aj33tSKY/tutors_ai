"use client";

import type { UIMessage } from "ai";
import { ChatShellView, type ConversationSummary } from "@/components/dashboard/chat-shell-view";
import { createConversationAction, deleteConversationAction } from "./actions";

export type { ConversationSummary };
/** Legacy Next host: server actions manage conversations and turns go to the legacy route. */
export function ChatShell(props: { conversationId: string; initialMessages: UIMessage[]; conversations: ConversationSummary[] }) {
  return <ChatShellView {...props} endpoint="/api/chat" createConversation={() => createConversationAction()}
    deleteConversation={(id) => { const form = new FormData(); form.set("id", id); return deleteConversationAction(form); }}/>;
}
