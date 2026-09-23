import Link from "next/link";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { subjectLabel, boardLabel } from "@/lib/subjects";
import type { Booking, BookingStatus } from "@/lib/types";

const STATUS_VARIANT: Record<BookingStatus, "default" | "secondary" | "outline"> = {
  scheduled: "default",
  completed: "secondary",
  cancelled: "outline",
};

export default async function StudentBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("student_id", userId)
    .order("start_time", { ascending: false })
    .returns<Booking[]>();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="display-md">Your bookings</h2>
        <Button asChild size="sm">
          <Link href="/tutors">
            <CalendarPlus className="size-4" /> Book a session
          </Link>
        </Button>
      </div>

      {checkout === "success" && (
        <div className="flex items-center gap-2 rounded-sm border border-hairline bg-raised px-4 py-3 text-sm">
          <CheckCircle2 className="size-4 text-saffron" />
          Payment received — your booking will appear below within a few seconds.
        </div>
      )}
      {checkout === "cancelled" && (
        <div className="rounded-sm border border-hairline bg-raised px-4 py-3 text-sm text-muted-foreground">
          Checkout was cancelled — no payment was taken.
        </div>
      )}

      {!bookings || bookings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">No bookings yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Browse tutors and book your first session to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{subjectLabel(b.subject)}</p>
                    <Badge variant={STATUS_VARIANT[b.status]} className="capitalize">
                      {b.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(b.start_time).toLocaleString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {boardLabel(b.exam_board)}
                    {b.amount_gbp_pence != null && ` · £${(b.amount_gbp_pence / 100).toFixed(2)}`}
                  </p>
                </div>
                {b.status === "scheduled" && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/session/${b.id}`}>Join session</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
