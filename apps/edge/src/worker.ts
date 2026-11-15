// SPIKE: the whole app (static frontend + Hono API) in one Cloudflare Worker, so no relay hop and no server.
// Hosting adapter only: all behaviour stays in apps/api. Secrets and variables arrive as Worker bindings;
// `nodejs_compat` populates process.env from them, which is what the API reads.
import { createApp } from "../../api/src/app.js";
import { readConfig } from "../../api/src/config.js";

type Assets = { fetch(request: Request): Promise<Response> };
type Env = { ASSETS: Assets; SPIKE?: string };
let app: ReturnType<typeof createApp> | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
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
  },
};
