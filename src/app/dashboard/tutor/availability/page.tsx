import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { AvailabilityView } from "@/components/dashboard/availability-view";
import { addAvailabilityAction, removeAvailabilityAction } from "./actions";
import type { Availability } from "@/lib/types";

export default async function TutorAvailabilityPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: slots } = await supabase
    .from("availability")
    .select("*")
    .eq("tutor_id", userId)
    .order("day_of_week", { ascending: true })
    .returns<Availability[]>();

  return <AvailabilityView slots={slots ?? []} addAvailabilityAction={addAvailabilityAction} removeAvailabilityAction={removeAvailabilityAction} />;
}
