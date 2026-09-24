import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { addAvailabilityAction, removeAvailabilityAction } from "./actions";
import type { Availability } from "@/lib/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TutorAvailabilityPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: slots } = await supabase
    .from("availability")
    .select("*")
    .eq("tutor_id", userId)
    .order("day_of_week", { ascending: true })
    .returns<Availability[]>();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="display-md">Weekly availability</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recurring slots students can book you for, every week.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a slot</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addAvailabilityAction} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="day_of_week">Day</Label>
              <Select name="day_of_week" required defaultValue="1">
                <SelectTrigger id="day_of_week" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start_time">From</Label>
              <Input id="start_time" name="start_time" type="time" required defaultValue="16:00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_time">To</Label>
              <Input id="end_time" name="end_time" type="time" required defaultValue="19:00" />
            </div>
            <Button type="submit">
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your slots</CardTitle>
        </CardHeader>
        <CardContent>
          {!slots || slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No availability set yet.</p>
          ) : (
            <ul className="space-y-2">
              {slots.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
                >
                  <span className="text-sm font-medium">
                    {DAYS[s.day_of_week]} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                  </span>
                  <form action={removeAvailabilityAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      type="submit"
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="Remove slot"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
