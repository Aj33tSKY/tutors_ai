import { ContactsList, type Contact } from "@/components/dashboard/contacts-list";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { Booking, Profile } from "@/lib/types";

export default async function MyTutorsPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("tutor_id")
    .eq("student_id", userId)
    .returns<Pick<Booking, "tutor_id">[]>();

  const counts = new Map<string, number>();
  for (const booking of bookings ?? []) counts.set(booking.tutor_id, (counts.get(booking.tutor_id) ?? 0) + 1);
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

  return <ContactsList title="My tutors" singular="Tutor" contacts={contacts} />;
}
