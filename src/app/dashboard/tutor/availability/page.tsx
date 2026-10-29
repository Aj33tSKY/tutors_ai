import { redirect } from "next/navigation";

export default function AvailabilityRedirect() {
  redirect("/dashboard/tutor/profile#availability");
}
