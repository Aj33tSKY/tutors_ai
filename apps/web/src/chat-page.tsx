import { useMemo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { ChatShellView } from "../../../src/components/dashboard/chat-shell-view.js";
import { api, ApiFailure, apiPath } from "./api.js";

/** /dashboard/student/chat resumes the newest conversation or starts one, so a refresh never loses history. */
export function ChatIndexPage() {
  const list = useQuery({ queryKey: ["chat-conversations"], queryFn: api.chatConversations, gcTime: 0 });
  const create = useMutation({ mutationFn: api.createChat });
  if (list.error instanceof ApiFailure && list.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (list.error) return <p role="alert">Could not open the revision assistant.</p>;
  if (!list.data) return <p role="status">Opening your chat…</p>;
  const newest = list.data.conversations[0];
  if (newest) return <Navigate to={`/dashboard/student/chat/${newest.id}`} replace/>;
  if (!create.isPending && !create.data && !create.isError) create.mutate();
  if (create.data) return <Navigate to={`/dashboard/student/chat/${create.data.id}`} replace/>;
  return create.isError ? <p role="alert">Could not start a conversation.</p> : <p role="status">Starting a chat…</p>;
}

export function ChatPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const transcript = useQuery({ queryKey: ["chat", id], queryFn: () => api.chat(id), gcTime: 0, staleTime: Infinity });
  const initial = useMemo(() => (transcript.data?.messages ?? []) as UIMessage[], [transcript.data]);
  if (transcript.error instanceof ApiFailure && transcript.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (transcript.error) return <main className="p-8"><p role="alert">This conversation is not available.</p></main>;
  if (!transcript.data) return <p role="status">Loading your chat…</p>;
  return <main className="mx-auto max-w-5xl p-8"><ChatShellView key={id} conversationId={id} initialMessages={initial} conversations={transcript.data.conversations}
    endpoint={apiPath("/v1/student/chat")}
    createConversation={async () => { const created = await api.createChat(); await client.invalidateQueries({ queryKey: ["chat-conversations"] }); navigate(`/dashboard/student/chat/${created.id}`); }}
    deleteConversation={async (target) => { await api.deleteChat(target); await client.invalidateQueries({ queryKey: ["chat-conversations"] }); navigate("/dashboard/student/chat"); }}/></main>;
}
