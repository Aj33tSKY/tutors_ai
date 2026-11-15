import { test } from "node:test";
import assert from "node:assert/strict";
import { getBooking, renameLesson, type BookingRepository } from "../../packages/domain/src/bookings.js";
import type { Identity, BookingSummary } from "../../packages/contracts/src/index.js";

const identity: Identity = { id: "student", email: "student@example.test", profile: { id: "student", full_name: "Student", role: "student" } };
const booking: BookingSummary = { id: "booking", student_id: "student", tutor_id: "tutor", lesson_name: "Maths", subject: "Mathematics", start_time: "2026-12-01T10:00:00Z", end_time: "2026-12-01T11:00:00Z", status: "scheduled", payment_status: "pending", is_trial: false, started_at: null };
test("a missing RLS-visible booking is not found", async () => {
  const repo: BookingRepository = { find: async () => null, name: async () => null, rename: async () => { throw Error("must not write"); } };
  await assert.rejects(getBooking(repo, identity, "booking"), { status: 404 });
});
test("a nonparticipant cannot rename, even if a repository returns a row", async () => {
  const repo: BookingRepository = { find: async () => booking, name: async () => "Tutor", rename: async () => { throw Error("must not write"); } };
  await assert.rejects(renameLesson(repo, { ...identity, id: "stranger" }, "booking", "Forged"), { status: 404 });
  await assert.rejects(renameLesson(repo, { ...identity, id: "parent", profile: { ...identity.profile, role: "parent" } }, "booking", "Forged"), { status: 403 });
});
test("cancelled lessons cannot be renamed", async () => {
  const repo: BookingRepository = { find: async () => ({ ...booking, status: "cancelled" }), name: async () => "Tutor", rename: async () => { throw Error("must not write"); } };
  await assert.rejects(renameLesson(repo, identity, "booking", "New"), { status: 403 });
});
