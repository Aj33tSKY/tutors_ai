import type { BookingDetail, BookingSummary, Identity } from "../../contracts/src/index.js";
import { AppError } from "./errors.js";

export interface BookingRepository {
  find(id: string): Promise<BookingSummary | null>;
  name(id: string): Promise<string | null>;
  rename(id: string, name: string): Promise<BookingSummary | null>;
}

/** The repository uses the caller's JWT; this explicit check is additional to RLS. */
export async function getBooking(repository: BookingRepository, identity: Identity, id: string): Promise<BookingDetail> {
  const booking = await repository.find(id);
  if (!booking) throw new AppError(404, "not_found", "Booking not found");
  const participant = booking.student_id === identity.id || booking.tutor_id === identity.id;
  // Linked parents may read through RLS but never acquire participant privileges.
  if (!participant && identity.profile.role !== "parent" && identity.profile.role !== "admin") {
    throw new AppError(404, "not_found", "Booking not found");
  }
  const counterpart = booking.student_id === identity.id ? booking.tutor_id : booking.student_id;
  return { booking, counterpartName: await repository.name(counterpart) ?? "Lesson participant", canRename: participant && booking.status !== "cancelled" };
}

export async function renameLesson(repository: BookingRepository, identity: Identity, id: string, name: string) {
  const detail = await getBooking(repository, identity, id);
  if (!detail.canRename) throw new AppError(403, "forbidden", "Only a lesson participant can rename it");
  const booking = await repository.rename(id, name);
  if (!booking) throw new AppError(409, "conflict", "The lesson could not be updated");
  return booking;
}
