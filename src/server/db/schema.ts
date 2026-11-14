// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import { index, primaryKey, sqliteTableCreator } from "drizzle-orm/sqlite-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = sqliteTableCreator(
	(name) => `.bootstrap-scaffold_${name}`,
);

export const posts = createTable(
	"post",
	(d) => ({
		id: d.integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		name: d.text({ length: 256 }),
		createdAt: d
			.integer({ mode: "timestamp" })
			.default(sql`(unixepoch())`)
			.notNull(),
		updatedAt: d.integer({ mode: "timestamp" }).$onUpdate(() => new Date()),
	}),
	(t) => [index("name_idx").on(t.name)],
);

/**
 * NextAuth / Auth.js Drizzle adapter tables (SQLite contract), plus a `role`
 * column on `users` for app-level authorization.
 *
 * @see https://authjs.dev/reference/adapter/drizzle
 */
export const users = createTable("user", (d) => ({
	id: d
		.text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: d.text("name"),
	email: d.text("email").unique(),
	emailVerified: d.integer("emailVerified", { mode: "timestamp_ms" }),
	image: d.text("image"),
	role: d
		.text("role", { enum: ["member", "admin"] })
		.notNull()
		.default("member"),
}));

export const accounts = createTable(
	"account",
	(d) => ({
		userId: d
			.text("userId")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		type: d.text("type").notNull(),
		provider: d.text("provider").notNull(),
		providerAccountId: d.text("providerAccountId").notNull(),
		refresh_token: d.text("refresh_token"),
		access_token: d.text("access_token"),
		expires_at: d.integer("expires_at"),
		token_type: d.text("token_type"),
		scope: d.text("scope"),
		id_token: d.text("id_token"),
		session_state: d.text("session_state"),
	}),
	(t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = createTable("session", (d) => ({
	sessionToken: d.text("sessionToken").primaryKey(),
	userId: d
		.text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	expires: d.integer("expires", { mode: "timestamp_ms" }).notNull(),
}));

export const verificationTokens = createTable(
	"verificationToken",
	(d) => ({
		identifier: d.text("identifier").notNull(),
		token: d.text("token").notNull(),
		expires: d.integer("expires", { mode: "timestamp_ms" }).notNull(),
	}),
	(t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const simulationRuns = createTable("simulation_run", (d) => ({
	id: d.integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
	userId: d
		.text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	seed: d.integer().notNull(),
	boidCount: d.integer().notNull(),
	separationWeight: d.real().notNull(),
	alignmentWeight: d.real().notNull(),
	cohesionWeight: d.real().notNull(),
	maxDurationSeconds: d.integer().notNull(),
	predatorCount: d.integer().notNull(),
	protectionThreshold: d.integer().notNull(),
	foodStockInitial: d.real().notNull(),
	foodRegenRate: d.real().notNull(),
	// Defaults match this phase's own chosen UI defaults (page.tsx/multi/page.tsx)
	// so `drizzle-kit push`/`migrate` can apply these NOT NULL columns against a
	// populated production table without an interactive default-value prompt —
	// every INSERT from `start` still always supplies a real value explicitly.
	flockCount: d.integer().notNull().default(2),
	crossbreedingEnabled: d.integer({ mode: "boolean" }).notNull().default(true),
	energyThreshold: d.real().notNull().default(50),
	mutationChance: d.real().notNull().default(0.1),
	mutationMagnitude: d.real().notNull().default(0.2),
	status: d
		.text({ enum: ["running", "stopped", "saved"] })
		.notNull()
		.default("running"),
	score: d.real(),
	startedAt: d
		.integer({ mode: "timestamp" })
		.default(sql`(unixepoch())`)
		.notNull(),
	stoppedAt: d.integer({ mode: "timestamp" }),
	// S-04 Phase 4 (FR-012): the full live-state snapshot for a
	// server-owned run paused via "Save & Pause" — null except while
	// `status: "saved"`. Shape matches `ServerRunSnapshot` in
	// server-run-registry.ts.
	savedState: d.text({ mode: "json" }),
}));

// S-04 (FR-002 full, FR-018 full): the one global, admin-editable config
// row. `id` is always `1` — a singleton enforced at the application layer
// (always upsert/read that fixed id), not a DB-level constraint, since
// SQLite has no native "exactly one row" check short of a trigger this
// project doesn't need.
export const adminSettings = createTable("admin_settings", (d) => ({
	id: d.integer({ mode: "number" }).primaryKey(),
	// JSON-mode TEXT column (Drizzle auto-serializes/deserializes) — see
	// `~/server/simulation/parameter-ranges.ts`'s `ParameterRanges` type for
	// the exact shape. One {min,max,default} triple per ranged simulation
	// parameter `start`/`startServer` validate against.
	parameterRanges: d.text({ mode: "json" }).notNull(),
	// FR-018's combined boid+predator object-count cap — previously
	// hardcoded to 500 in simulation.ts's zod schema.
	maxObjectCount: d.integer().notNull().default(500),
}));
