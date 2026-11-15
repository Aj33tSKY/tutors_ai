"use client";

import { SessionsView, SessionsOperationsProvider, type SessionsOperations } from "./sessions-view";
import { cancelSessionAction, markSessionCompleteAction, markSessionUpcomingAction, sendSessionInvoiceAction, updateSessionDetailsAction } from "@/app/dashboard/session-actions";
import { createTutorSessionAction } from "@/app/dashboard/tutor/create-session-action";
import { loadCalendarSessions } from "@/app/dashboard/calendar-data";

const operations: SessionsOperations = { cancelSessionAction, markSessionCompleteAction, markSessionUpcomingAction,
  sendSessionInvoiceAction, updateSessionDetailsAction, createTutorSessionAction, loadCalendarSessions };
export function SessionsPanel(props: React.ComponentProps<typeof SessionsView>) {
  return <SessionsOperationsProvider value={operations}><SessionsView {...props}/></SessionsOperationsProvider>;
}
