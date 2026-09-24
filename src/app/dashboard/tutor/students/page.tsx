import { ContactsList, type Contact } from "@/components/dashboard/contacts-list";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { Booking, LessonRequest, Profile } from "@/lib/types";

export default async function MyStudentsPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("student_id")
    .eq("tutor_id", userId)
    .returns<Pick<Booking, "student_id">[]>();
  const { data: requests } = await supabase
    .from("lesson_requests")
    .select("student_id")
    .eq("tutor_id", userId)
    .returns<Pick<LessonRequest, "student_id">[]>();

  const counts = new Map<string, number>();
  for (const booking of bookings ?? []) counts.set(booking.student_id, (counts.get(booking.student_id) ?? 0) + 1);
  for (const request of requests ?? []) if (!counts.has(request.student_id)) counts.set(request.student_id, 0);
  const ids = [...counts.keys()];
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] as Pick<Profile, "id" | "full_name" | "email">[] };
  const contacts: Contact[] = (profiles ?? []).map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    sessionCount: counts.get(profile.id) ?? 0,
  }));

  return <ContactsList title="My students" singular="Student" contacts={contacts} />;
}
