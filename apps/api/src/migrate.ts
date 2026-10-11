import { connectFromEnv } from "./db/client";

const handle = connectFromEnv();
await handle.migrate();
await handle.close();
console.log("Migrations applied");
