import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "~/env";
import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
	client: Client | undefined;
};

const isNewClient = !globalForDb.client;
export const client =
	globalForDb.client ?? createClient({ url: env.DATABASE_URL });
if (env.NODE_ENV !== "production") globalForDb.client = client;

// SQLite's default busy handler fails immediately with SQLITE_BUSY instead
// of waiting when a concurrent writer holds the file lock — observed as
// intermittent "database is locked" test failures once enough test files
// write to the same file-based db.sqlite under Vitest's parallel workers.
// A busy_timeout makes SQLite retry for up to 5s before giving up, which is
// the standard fix for this failure mode. Only set once per client (new
// client only — the cached dev/test singleton already has it from its
// first creation).
if (isNewClient) {
	await client.execute("PRAGMA busy_timeout = 5000");
}

export const db = drizzle(client, { schema });
