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
  const overview = summary.overview?.trim() || "No overview was generated for this session.";

  const topics = summary.covered_topics ?? [];
  const topicsList = topics.length
    ? topics.map((topic) => `- ${topic.spec_point ? `**${topic.spec_point}** — ${topic.title}` : topic.title}`).join("\n")
    : "_No specific specification topics were identified._";

  const misconceptions = summary.misconceptions ?? [];
  const misconceptionsList = misconceptions.length
    ? misconceptions.map((item) => `- ${item}`).join("\n")
    : "_No misconceptions were evidenced in the transcript._";

  const homework = summary.homework ?? [];
  const homeworkList = homework.length
    ? homework.map((item) => `- ${item}`).join("\n")
    : "_No follow-up actions were assigned in this session._";

  return [
    `## Overview\n\n${overview}`,
    `## Topics covered\n\n${topicsList}`,
    `## Things to revisit\n\n${misconceptionsList}`,
    `## Action points\n\n${homeworkList}`,
  ].join("\n\n");
}
