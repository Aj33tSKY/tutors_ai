import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  // Set here rather than per project: `tutors-dev` was created through the CLI,
  // which does not detect a framework, and a repo-level setting keeps both
  // projects building the same way.
  framework: "nextjs",
  // GitHub Actions owns releases so migrations always land before the app that
  // needs them. Vercel must not auto-deploy these branches from Git in parallel,
  // or the app can go live against the old schema. Preview branches are unaffected.
  git: {
    deploymentEnabled: {
      main: false,
    },
  },
  crons: [
    { path: "/api/cron/transcribe-sessions", schedule: "*/5 * * * *" },
    { path: "/api/cron/summarize-sessions", schedule: "*/5 * * * *" },
    { path: "/api/cron/prune-session-recordings", schedule: "15 3 * * *" },
  ],
};
