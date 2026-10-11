import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface DatabaseHandle {
  db: Db;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** PostgreSQL via node-postgres. Used in production. */
export function connectPostgres(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({ connectionString });
  const db = drizzleNodePg({ client: pool, schema });
  return {
    db,
    migrate: () => migrateNodePg(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  };
}

/**
 * Embedded Postgres (PGlite). Used for tests and for running the API locally without a database
 * server. dataDir undefined = in-memory.
 */
export function connectPglite(dataDir?: string): DatabaseHandle {
  const client = new PGlite(dataDir);
  const db = drizzlePglite({ client, schema });
  return {
    db,
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.close(),
  };
}

export function connectFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseHandle {
  return env.DATABASE_URL ? connectPostgres(env.DATABASE_URL) : connectPglite(env.PGLITE_DATA_DIR || undefined);
}
