import "server-only";

/** Vercel Cron sends the project's CRON_SECRET as a bearer token. */
export function verifyCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
