"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarPlus, Pencil, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { subjectLabel } from "@/lib/subjects";
import type { Booking } from "@/lib/types";
import { updateLessonNameAction } from "@/app/dashboard/session-actions";

type SessionRow = Pick<Booking, "id" | "subject" | "start_time" | "status" | "lesson_name"> & {
  counterpartName: string;
};

type Filter = "all" | "upcoming" | "completed";

export function SessionsPanel({
  sessions,
  title = "Sessions",
  counterpartLabel = "Tutor",
}: {
  sessions: SessionRow[];
  title?: string;
  counterpartLabel?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const visible = sessions.filter((session) => {
    const matchesTutor = session.counterpartName.toLowerCase().includes(query.trim().toLowerCase());
    const isUpcoming = session.status === "scheduled";
    const matchesFilter = filter === "all" || (filter === "upcoming" ? isUpcoming : session.status === "completed");
    return matchesTutor && matchesFilter;
  });

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-hairline p-0.5">
            {(["all", "upcoming", "completed"] as Filter[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`rounded-sm px-3 py-1 text-xs capitalize transition-colors ${
                  filter === option ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${counterpartLabel.toLowerCase()}`}
              aria-label={`Search by ${counterpartLabel.toLowerCase()} name`}
              className="w-44 pl-8"
            />
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <div className="rounded-sm border border-dashed border-hairline p-8 text-center">
            <p className="font-medium">
              {filter === "upcoming" ? "No upcoming sessions" : filter === "completed" ? "No completed sessions" : "No sessions found"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {query ? "Try a different tutor name." : "Book a tutor to get started."}
            </p>
            {!query && filter === "all" && (
              <Button asChild size="sm" className="mt-4">
                <Link href="/tutors">
                  <CalendarPlus className="size-4" /> Browse tutors
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,1fr)_10rem_7rem_9rem] gap-4 border-b border-hairline px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Lesson</span><span>Lesson ID</span><span>Date &amp; time</span><span>Status</span><span>{counterpartLabel}</span>
              </div>
              {visible.map((session) => (
                <SessionItem key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionItem({ session }: { session: SessionRow }) {
  const [editing, setEditing] = useState(false);
  const defaultName = subjectLabel(session.subject);
  const isCompleted = session.status === "completed";

  return (
    <div className="grid grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,1fr)_10rem_7rem_9rem] items-center gap-4 border-b border-hairline px-3 py-3 last:border-0">
      <div className="min-w-0">
        {editing ? (
          <form action={updateLessonNameAction} className="flex items-center gap-2">
            <input type="hidden" name="booking_id" value={session.id} />
            <Input name="lesson_name" defaultValue={session.lesson_name ?? ""} placeholder={defaultName} autoFocus />
            <Button type="submit" size="xs" onClick={() => setEditing(false)}>Save</Button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5">
            <p className="truncate font-medium">{session.lesson_name || defaultName}</p>
            <button type="button" onClick={() => setEditing(true)} aria-label="Rename lesson" className="text-muted-foreground hover:text-foreground">
              <Pencil className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <code className="truncate text-xs text-muted-foreground">{session.id}</code>
      <time className="text-sm text-muted-foreground">
        {new Date(session.start_time).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
      </time>
      <Badge variant={isCompleted ? "secondary" : session.status === "cancelled" ? "outline" : "default"} className="w-fit capitalize">{session.status}</Badge>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm">{session.counterpartName}</span>
        <Button asChild size="xs" variant="outline">
          <Link href={isCompleted ? `/dashboard/student/bookings/${session.id}` : `/session/${session.id}`}>View session</Link>
        </Button>
      </div>
    </div>
  );
}
