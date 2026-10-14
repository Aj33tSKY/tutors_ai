import type { SessionAnalytics } from "@/lib/types";

/**
 * Builds the markdown seed for a session's editable notes from the
 * structured summary the summarize-sessions cron generates. Called once,
 * right when that summary is (re)generated — see summarize-sessions and
 * markSessionUpcomingAction, which resets both together. After that, the
 * tutor's saved edits to session_analytics.notes_markdown are the source of
 * truth; nothing server-side calls this again for the same session.
 *
 * Also used as a read-time fallback for sessions summarized before this
 * column existed, so older reviews still render nicely without a backfill.
 */
export function formatSessionNotesMarkdown(summary: NonNullable<SessionAnalytics["summary_notes"]>): string {
  const section = (heading: string, text: string | undefined) =>
    `## ${heading}\n\n${text?.trim() || "_Not noted for this session._"}`;

  return [
    section("Session Goals", summary.sessionGoals),
    section("What We Covered", summary.whatWeCovered),
    section("What Went Well", summary.whatWentWell),
    section("Areas for Improvement", summary.areasForImprovement),
    section("Learning Insights", summary.learningInsights),
    section("Key Breakthrough", summary.keyBreakthrough),
    section("Next Steps", summary.nextSteps),
  ].join("\n\n");
}
