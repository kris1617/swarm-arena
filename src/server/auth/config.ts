import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

import { env } from "~/env";
import { db } from "~/server/db";
import {
	accounts,
	sessions,
	users,
	verificationTokens,
} from "~/server/db/schema";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom
 * properties to the `session` object, so we can access them in our
 * Server Components / API routes without having to fetch the user again.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
	interface Session {
		user: {
			// `DefaultSession["user"]["id"]` is `string | undefined` — this
			// app's database session strategy always has an id, and
			// temporary-admin-elevation's self-mutations (user.ts) pass it
			// directly into Drizzle's `eq()`, which rejects `undefined`.
			id: string;
			role: (typeof users.$inferSelect)["role"];
			// Declared as the DB's Date type, but NextAuth serializes the
			// session through JSON before a consumer ever sees it, so at
			// runtime this is an ISO string (or null) — see elevation.ts.
			elevatedUntil: Date | string | null;
		} & DefaultSession["user"];
	}
}

const adminEmails = new Set(
	(env.ADMIN_EMAILS ?? "")
		.split(",")
		.map((email) => email.trim().toLowerCase())
		.filter((email) => email.length > 0),
);

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks,
 * etc.
 *
 * Sessions use the Drizzle adapter's **database** strategy explicitly (not
 * JWT): role changes must apply immediately, and Phase 4's middleware runs
 * under the Node.js runtime specifically to afford this DB-backed check.
 *
 * @see https://authjs.dev/reference/next-auth
 */
export const authConfig: NextAuthConfig = {
	adapter: DrizzleAdapter(db, {
		usersTable: users,
		accountsTable: accounts,
		sessionsTable: sessions,
		verificationTokensTable: verificationTokens,
	}),
	session: { strategy: "database" },
	secret: env.AUTH_SECRET,
	// Without this, next-auth rejects every request's session with
	// "UntrustedHost" whenever no AUTH_URL is configured — including a
	// correctly-adapter-backed session — so sign-in silently never sticks.
	// See env.js for why this can't just be process.env.AUTH_TRUST_HOST read
	// implicitly by next-auth: this project passes every Auth.js-recognized
	// var through the T3-validated `env` object explicitly, consistently.
	trustHost: env.AUTH_TRUST_HOST,
	providers: [
		GitHub({
			clientId: env.AUTH_GITHUB_ID,
			clientSecret: env.AUTH_GITHUB_SECRET,
		}),
	],
	pages: {
		signIn: "/login",
	},
	events: {
		// Fires once, when the adapter first persists a new user row —
		// never on subsequent sign-ins or session reads. This is where we
		// assign the admin role once, by checking the authenticating
		// email against ADMIN_EMAILS.
		async createUser({ user }) {
			if (!user.id || !user.email) return;
			if (adminEmails.has(user.email.toLowerCase())) {
				await db
					.update(users)
					.set({ role: "admin" })
					.where(eq(users.id, user.id));
			}
		},
	},
	callbacks: {
		// Database strategy: `user` is the row the adapter loaded for this
		// session. We only read `role` off it here — no writes.
		session: ({ session, user }) => {
			const rawElevatedUntil = (user as typeof users.$inferSelect)
				.elevatedUntil;
			return {
				...session,
				user: {
					...session.user,
					role: (user as typeof users.$inferSelect).role,
					// temporary-admin-elevation: the Auth.js adapter returns this
					// column as a raw number (Unix ms), not a Date, even though
					// Drizzle's own `mode: "timestamp"` type says `Date | null` —
					// confirmed by a live /admin/settings 500
					// ("elevatedUntil.getTime is not a function") during manual
					// verification. Normalize here, the one place this raw
					// adapter value enters the typed session, so every consumer
					// of `session.user.elevatedUntil` can trust it's a real Date.
					elevatedUntil: rawElevatedUntil ? new Date(rawElevatedUntil) : null,
				},
			};
		},
		// Without this, next-auth's bare `auth` middleware defaults
		// `authorized = true` for every request — it only attaches session
		// info, it does not gate anything on its own. This is what actually
		// enforces the redirect-to-/login behavior the middleware exists for.
		authorized: ({ auth }) => !!auth?.user,
	},
};
