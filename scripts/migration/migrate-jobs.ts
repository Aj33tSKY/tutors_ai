import { migrateQueue } from "../../packages/jobs/src/queue.js";
const connection = process.env.APP_JOBS_MIGRATION_DATABASE_URL;
if (!connection) throw new Error("APP_JOBS_MIGRATION_DATABASE_URL is required");
await migrateQueue(connection);
console.info("Private job schema ready; runtime credentials must not own schema migrations.");
