// The whole application in one Cloudflare Worker: static frontend, Hono API and background jobs.
// Hosting adapter only: behaviour lives in apps/api and packages/jobs. Secrets and variables arrive as Worker bindings;
// `nodejs_compat` populates process.env from them, which is what the shared code reads.
import { createApp } from "../../api/src/app.js";
import { readConfig } from "../../api/src/config.js";
import { runQueueBatch, runScheduled, type JobsEnv, type QueueMessage } from "./jobs.js";

type ExecutionContextLike = Parameters<ReturnType<typeof createApp>["fetch"]>[2];
type Assets = { fetch(request: Request): Promise<Response> };
type Env = JobsEnv & { ASSETS: Assets };
// Configuration and plain objects may be cached per isolate; nothing holding a socket may be (see jobs.ts).
let app: ReturnType<typeof createApp> | undefined;

// The same response headers the Caddy server (infra/app/Caddyfile) sets, so the two hosts behave identically.
// Static files are served without running this Worker and get the same set from `_headers`.
function hardened(response: Response, pathname: string): Response {
  const result = new Response(response.body, response);
  result.headers.set("Strict-Transport-Security", "max-age=31536000");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.headers.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()");
  if (pathname.startsWith("/assets/") && response.status === 200) result.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  else if (!pathname.startsWith("/v1/") && !pathname.startsWith("/health/") && !pathname.startsWith("/images/")) result.headers.set("Cache-Control", "no-cache");
  return result;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const { pathname } = new URL(request.url);
    // Never let an unexpected failure escape as an uncaught exception: log it and answer with a clean 500.
    try { return hardened(await route(request, env, ctx, pathname), pathname); }
    catch (error) {
      console.error(JSON.stringify({ event: "unhandled_error", method: request.method, pathname, message: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
      return hardened(Response.json({ error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 }), pathname);
    }
  },
  async scheduled(controller: { cron: string }, env: Env) { await runScheduled(controller.cron, env); },
  async queue(batch: { messages: QueueMessage[] }) { await runQueueBatch(batch); },
};

async function route(request: Request, env: Env, ctx: ExecutionContextLike, pathname: string): Promise<Response> {
  if (!pathname.startsWith("/v1/") && !pathname.startsWith("/health/")) {
    // Static files only answer GET and HEAD. Scanners POST to made-up paths (GraphQL probes were seen within hours
    // of a hostname going live); without this guard the asset handler throws an uncaught exception.
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    const asset = await env.ASSETS.fetch(request);
    // Same rule as the Caddy server: a missing file is a real 404, any other unknown path gets the app shell.
    if (asset.status === 404 && !/\.[A-Za-z0-9]+$/.test(pathname)) return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    return asset;
  }
  // Built lazily on the first API request so a misconfiguration is a readable 503, not a failed deploy.
  try {
    app ??= createApp(readConfig(), {
      // A newly stored webhook is processed at once through the queue; the once-a-minute sweep is the safety net.
      onEventAccepted: async () => { if (env.JOBS) await env.JOBS.send({ kind: "events" }); },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "config_invalid", message: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
    return Response.json({ error: { code: "api_unavailable", message: "API is not configured" } }, { status: 503 });
  }
  return app.fetch(request, env, ctx);
}
