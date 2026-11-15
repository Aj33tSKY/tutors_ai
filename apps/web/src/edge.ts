// Hosting adapter only. Auth, authorization and business logic stay in Hono.
export type WebEnvironment = { APP_API_ORIGIN: string; ASSETS: { fetch(request: Request): Promise<Response> } };
export function edgeHandler(upstream: (request: Request) => Promise<Response> = fetch) {
  return async (request: Request, env: WebEnvironment): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/health/")) return env.ASSETS.fetch(request);
    let target: URL;
    try {
      target = new URL(env.APP_API_ORIGIN);
      if (target.protocol !== "https:" || target.origin !== env.APP_API_ORIGIN || target.username || target.password || target.origin === url.origin) throw new Error("Invalid API origin");
    } catch { return unavailable("API deployment is not configured"); }
    target.pathname = url.pathname;
    target.search = url.search;
    const forwarded = new Request(target, request);
    for (const name of ["host", "forwarded", "x-forwarded-host", "x-forwarded-for", "x-forwarded-proto"]) forwarded.headers.delete(name);
    // Public catalogue reads carry no credentials: they may be cached briefly, as the API declares.
    const isPublic = url.pathname.startsWith("/v1/public/") && request.method === "GET";
    if (isPublic) forwarded.headers.delete("cookie");
    forwarded.headers.set("Cache-Control", isPublic ? "no-cache" : "no-store");
    try {
      // Stream request/response bodies; preserve Origin, HttpOnly Set-Cookie and
      // client cancellation. Never follow a redirect carrying session cookies.
      const response = await upstream(new Request(forwarded, { redirect: "manual" }));
      const result = new Response(response.body, response);
      // Never let a credentialed or non-public response become shareable.
      if (!isPublic || !/^public\b/.test(response.headers.get("cache-control") ?? "") || response.headers.has("set-cookie")) result.headers.set("Cache-Control", "private, no-store");
      return result;
    } catch { return unavailable("API is temporarily unavailable"); }
  };
}
function unavailable(message: string) {
  return Response.json({ error: { code: "api_unavailable", message, requestId: crypto.randomUUID() } }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}
const worker = { fetch: edgeHandler() };
export default worker;
