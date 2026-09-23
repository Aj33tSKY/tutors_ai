import { redirect } from "next/navigation";

/** Legacy URL kept for existing checkout redirects and bookmarks. */
export default function StudentBookingsPage() {
  redirect("/dashboard/student");
}
