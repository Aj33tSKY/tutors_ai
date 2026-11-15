import { z } from "zod";
import type { LessonRequest } from "./models.js";
export const scheduleInput = z.object({ studentId: z.uuid(), startTime: z.iso.datetime(), durationHours: z.number().int().min(1).max(3),
  count: z.number().int().min(1).max(12), lessonName: z.string().trim().min(1).max(120), requestId: z.uuid().optional(), commandId: z.uuid() }).strict();
export const requestScheduleInput = scheduleInput.omit({ studentId: true, requestId: true, durationHours: true }).extend({ lessonName: z.string().trim().max(120) });
export const rescheduleInput = z.object({ lessonName: z.string().trim().min(1).max(120), startTime: z.iso.datetime() }).strict();
export const cancelInput = z.object({ series: z.boolean().default(false) }).strict();
export type ScheduledLessons = { bookingIds: string[] };
export const requestsQuery = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0) });
export type RequestInbox = { requests: LessonRequest[]; studentNames: Record<string, string>; total: number; page: number; pageSize: number };
export type RequestDetail = { request: LessonRequest; studentName: string };
