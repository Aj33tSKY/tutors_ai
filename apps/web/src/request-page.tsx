import { useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScheduleRequestView } from "../../../src/components/dashboard/schedule-request.js";
import { api, ApiFailure } from "./api.js";

export function RequestPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const commands = useRef(new Map<string, string>());
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const data = useQuery({ queryKey: ["request", id], queryFn: () => api.lessonRequest(id) });
  if (data.error instanceof ApiFailure && data.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (data.error) return <p role="alert">{data.error.message}</p>;
  if (!data.data) return <p role="status">Loading lesson request…</p>;
  if (data.data.request.status !== "pending") return <Navigate to="/dashboard/tutor" replace/>;
  const date = new Date(data.data.request.requested_start_time);
  const defaultDateTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return <main className="mx-auto max-w-4xl p-8"><ScheduleRequestView request={data.data.request} studentName={data.data.studentName} defaultDateTime={defaultDateTime}
    pending={pending} feedback={error && <p role="alert" className="text-sm text-destructive">{error}</p>} scheduleAction={async (form) => {
      setPending(true); setError(undefined);
      const commandId = commands.current.get(id) ?? crypto.randomUUID(); commands.current.set(id, commandId);
      try {
        await api.scheduleRequest(id, { startTime: new Date(String(form.get("start_time"))).toISOString(), count: Number(form.get("recurrence_count")), lessonName: String(form.get("lesson_name")), commandId });
        await Promise.all([client.invalidateQueries({ queryKey: ["sessions"] }), client.invalidateQueries({ queryKey: ["requests"] })]);
        await client.invalidateQueries({ queryKey: ["request", id], refetchType: "none" });
        void navigate("/dashboard/tutor");
      } catch (error) { setError(error instanceof Error ? error.message : "Could not schedule request"); }
      finally { setPending(false); }
    }}/></main>;
}
