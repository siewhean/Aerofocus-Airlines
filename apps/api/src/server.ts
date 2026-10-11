import { serve } from "@hono/node-server";
import { SampleScheduleProvider } from "@aerofocus/data";
import { createApp } from "./app";
import { buildDeps } from "./context";
import { connectFromEnv } from "./db/client";

const port = Number(process.env.PORT ?? 8787);
const handle = connectFromEnv();
await handle.migrate();

if (!process.env.SIGNING_SECRET) {
  console.warn("SIGNING_SECRET is not set: Random Flight draws will not survive a restart.");
}

const deps = await buildDeps({
  db: handle.db,
  provider: new SampleScheduleProvider(),
  ...(process.env.SIGNING_SECRET ? { signingSecret: process.env.SIGNING_SECRET } : {}),
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
});

const server = serve({ fetch: createApp(deps).fetch, port });
console.log(`Aerofocus API listening on http://localhost:${port} (${process.env.DATABASE_URL ? "PostgreSQL" : "embedded PGlite"})`);

const shutdown = async () => {
  server.close();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
