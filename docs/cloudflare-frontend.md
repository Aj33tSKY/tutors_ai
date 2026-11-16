# Cloudflare frontend adapter

> **Superseded.** This relay design (a Worker forwarding `/v1/*` to a separate API container) is replaced by one Worker that
> serves the frontend and runs the API itself (`apps/edge`); see [cloudflare-migration-plan.md](cloudflare-migration-plan.md).

The portable frontend builds to `apps/web/dist`. Its small Worker forwards
`/v1/*` and `/health/*` to the Hono container; all other requests use Static
Assets. Business logic remains in the container. The same files and URL layout
can be hosted behind Nginx or another reverse proxy.

Set the Worker binding `APP_API_ORIGIN` to the backend's exact HTTPS origin,
without a trailing slash or path. Keep `VITE_API_ORIGIN` unset to use the relay.
The backend's `APP_WEB_ORIGIN` must match the public frontend origin exactly.
Cookies remain host-only, HttpOnly, Secure and SameSite=Lax. No access or refresh
tokens are passed to browser JavaScript.

Use separate staging and production origins and Workers. The default config is
`tutors-web-staging`; `--env production` selects `tutors-web`. Deployment must
provide the origin binding explicitly; an absent or invalid binding fails closed
with HTTP 503. The Worker never accepts an upstream URL supplied by a request.

```sh
npm run build:portable
npm run check:web-deploy
# A local compile/dry-run only. Nothing above uploads or switches traffic.
```

Cloudflare's [selective Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
ensures API URLs reach the relay before the SPA fallback. Responses preserve
streaming and chunked auth cookies, disable API caching and retain the original
Origin header for Hono's mutation protection. Upstream redirects are not followed
with session credentials.

The currently extracted routes cover auth, the booking read/rename journey,
availability, contacts, parent/admin screens, live-room entry and lesson reviews.
Public-page prerendering, the remaining application features, deployment adapters
and an observed staging acceptance are still required before replacing Vercel.
Do not publish the current static artifact as the full application.
