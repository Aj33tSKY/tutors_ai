// SPIKE: the whole app (static frontend + Hono API) in one Cloudflare Worker, so no relay hop and no server.
// Hosting adapter only: all behaviour stays in apps/api. Secrets and variables arrive as Worker bindings;
// `nodejs_compat` populates process.env from them, which is what the API reads.
import { createApp } from "../../api/src/app.js";
import { readConfig } from "../../api/src/config.js";

type Assets = { fetch(request: Request): Promise<Response> };
type Env = { ASSETS: Assets; SPIKE?: string };
let app: ReturnType<typeof createApp> | undefined;

// The same response headers the Caddy server (infra/app/Caddyfile) sets, so the two hosts behave identically.
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    // Never let an unexpected failure escape as an uncaught exception: log it and answer with a clean 500.
    try { return hardened(await route(request, env, pathname), pathname); }
    catch (error) {
      console.error(JSON.stringify({ event: "unhandled_error", method: request.method, pathname, message: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
      return hardened(Response.json({ error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 }), pathname);
    }
  },
};

async function route(request: Request, env: Env, pathname: string): Promise<Response> {
    // SPIKE ONLY: a slow stream, to prove incremental delivery and to see what the Worker observes on client disconnect.
    if (pathname === "/spike/stream" && env.SPIKE === "1") {
      const encoder = new TextEncoder();
      let sent = 0;
      const body = new ReadableStream({
        async pull(controller) {
          if (sent >= 20) { controller.close(); console.info(JSON.stringify({ event: "stream_complete", sent })); return; }
          await new Promise((resolve) => setTimeout(resolve, 250));
          controller.enqueue(encoder.encode(`data: chunk ${++sent}\n\n`));
        },
        cancel() { console.info(JSON.stringify({ event: "stream_cancelled_by_client", sent })); },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    }
    // SPIKE ONLY (removed before any real use): proves Postgres over TCP works in this runtime. Read-only.
    if (pathname === "/spike/pg" && env.SPIKE === "1") {
      const started = Date.now();
      try {
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: process.env.APP_EVENTS_DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
        const { rows } = await pool.query("select current_user as who, 1 as ok");
        await pool.end();
        return Response.json({ ok: true, ...rows[0], ms: Date.now() - started });
      } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "unknown", ms: Date.now() - started }, { status: 500 }); }
    }
    if (!pathname.startsWith("/v1/") && !pathname.startsWith("/health/")) {
      // Static files only answer GET and HEAD. Scanners POST to made-up paths (GraphQL probes were seen within hours
      // of the hostname going live); without this guard the asset handler throws an uncaught exception.
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      const asset = await env.ASSETS.fetch(request);
      // Same rule as the Caddy server: a missing file is a real 404, any other unknown path gets the app shell.
      if (asset.status === 404 && !/\.[A-Za-z0-9]+$/.test(pathname)) return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
      return asset;
    }
    // Built lazily on the first API request so a misconfiguration is a readable 503, not a failed deploy.
    try { app ??= createApp(readConfig()); }
    catch (error) {
      console.error(JSON.stringify({ event: "config_invalid", message: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
      return Response.json({ error: { code: "api_unavailable", message: "API is not configured" } }, { status: 503 });
    }
    return app.fetch(request);
}
