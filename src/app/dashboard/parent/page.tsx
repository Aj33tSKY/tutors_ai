import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Profile } from "@/lib/types";

export default async function ParentDashboardPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: children } = await supabase
    .from("student_profiles")
    .select("id, profiles!student_profiles_id_fkey(full_name, email)")
    .eq("parent_id", userId);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h2 className="display-md">Family overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Track sessions, transcripts and progress for every linked child.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-saffron" /> Linked children
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!children || children.length === 0 ? (
            <div className="rounded-sm border border-dashed border-hairline p-8 text-center">
              <p className="font-medium">No children linked yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Ask your child to add your email as their parent when they set up their profile,
                or contact support to link an existing account.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {children.map((c) => {
                const student = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-sm border border-hairline p-4"
                  >
                    <div>
                      <p className="font-medium">{(student as Profile | undefined)?.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(student as Profile | undefined)?.email}
                      </p>
                    </div>
                    <span className="eyebrow shrink-0">Linked</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
