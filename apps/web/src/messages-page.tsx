import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DirectMessageThreadView, type MessageTransport } from "../../../src/components/dashboard/direct-message-thread-view.js";
import { api, ApiFailure } from "./api.js";

export function MessagesPage() {
  const { counterpartId = "" } = useParams();
  const identity = useQuery({ queryKey: ["identity"], queryFn: api.me });
  // Opening a thread may create the conversation, so it is fetched once and never refetched in the background.
  const thread = useQuery({ queryKey: ["thread", counterpartId], queryFn: () => api.thread(counterpartId), staleTime: Infinity, gcTime: 0 });
  const conversationId = thread.data?.conversationId;
  const transport = useMemo<MessageTransport | null>(() => conversationId ? {
    send: (input) => api.sendMessage(conversationId, input),
    newer: async (after) => (await api.messagesAfter(conversationId, after)).messages,
    older: (before) => api.messagesBefore(conversationId, before),
  } : null, [conversationId]);
  const failure = identity.error ?? thread.error;
  if (failure instanceof ApiFailure && failure.status === 401) return <Navigate to="/sign-in" replace/>;
  if (failure) return <main className="mx-auto max-w-4xl p-8"><p role="alert">{failure instanceof ApiFailure && failure.status === 404 ? "This conversation is not available." : "Could not load this conversation."}</p><Link to="/dashboard">Back to your dashboard</Link></main>;
  if (!identity.data || !thread.data || !transport) return <p role="status">Loading messages…</p>;
  const back = identity.data.identity.profile.role === "student" ? "/dashboard/student/tutors" : "/dashboard/tutor/students";
  return <main className="mx-auto max-w-4xl space-y-4 p-8"><Link to={back}>← Back</Link>
    <DirectMessageThreadView key={thread.data.conversationId} currentUserId={identity.data.identity.id} counterpartName={thread.data.counterpartName}
      initialMessages={thread.data.messages} initialHasMore={thread.data.hasMore} transport={transport}/></main>;
}
