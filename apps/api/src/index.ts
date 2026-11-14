import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const app = createApp(readConfig());
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.info(JSON.stringify({ event: "api_started", port }));
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  setTimeout(() => { if ("closeAllConnections" in server) server.closeAllConnections(); process.exit(1); }, 30000).unref();
});
