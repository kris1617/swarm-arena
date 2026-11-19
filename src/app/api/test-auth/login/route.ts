import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { db } from "~/server/db";
import { sessions, users } from "~/server/db/schema";

// Database-session bypass for local Playwright E2E runs only. This app has no
// credentials provider — auth is GitHub OAuth, which a test run cannot drive
// without a real OAuth round-trip — so this route creates a `sessions` row
// and sets the same cookie next-auth's database strategy reads, the same way
// a real sign-in would, without going through next-auth itself.
//
// Gated, closed by default:
// 1. 404s whenever E2E_TEST_AUTH_SECRET is unset — the route does not exist
//    unless someone deliberately configures it.
// 2. Requires the caller to present that exact secret.
//
// There is no NODE_ENV check: the E2E run's webServer deliberately tests the
// production build (`next build && next start`), which always runs with
// NODE_ENV=production, so a NODE_ENV guard would also block legitimate local
// runs — this project's deploy also points DATABASE_URL at a local sqlite
// file, so NODE_ENV/DATABASE_URL give no reliable signal either way. The only
// real boundary is operational: never set E2E_TEST_AUTH_SECRET outside your
// local, gitignored .env. The deploy workflow's env (.github/workflows/deploy.yml,
// the VPS's own env file) must never define it.

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // matches next-auth's default

function secretMatches(secret: unknown, expected: string): boolean {
	if (typeof secret !== "string") return false;
	const a = createHash("sha256").update(secret).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
	if (!env.E2E_TEST_AUTH_SECRET) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const body = (await request.json().catch(() => null)) as {
		email?: unknown;
		secret?: unknown;
	} | null;

	if (!secretMatches(body?.secret, env.E2E_TEST_AUTH_SECRET)) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const email = typeof body?.email === "string" ? body.email.trim() : "";
	if (!email) {
		return NextResponse.json({ error: "email is required" }, { status: 400 });
	}

	const [existingUser] = await db
		.select()
		.from(users)
		.where(eq(users.email, email))
		.limit(1);

	const user =
		existingUser ??
		(
			await db
				.insert(users)
				.values({ email, name: email, emailVerified: new Date() })
				.returning()
		)[0];

	if (!user) {
		return NextResponse.json(
			{ error: "failed to create test user" },
			{ status: 500 },
		);
	}

	// Each E2E run calls this once (the `setup` project) and never signs out,
	// so without this the table would grow one row per run forever.
	await db.delete(sessions).where(eq(sessions.userId, user.id));

	const sessionToken = randomBytes(32).toString("hex");
	const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

	await db.insert(sessions).values({
		sessionToken,
		userId: user.id,
		expires,
	});

	const response = NextResponse.json({ ok: true });
	response.cookies.set("authjs.session-token", sessionToken, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		// impl-review F5: this only round-trips in local E2E because
		// playwright.config.ts's webServer runs the production build
		// (NODE_ENV=production) against plain http://localhost, and only
		// configures a `chromium` project — Chromium treats localhost as
		// a secure context and still sends a `Secure` cookie there.
		// Firefox/WebKit don't extend that exception the same way; adding
		// either as a Playwright project would silently break this cookie
		// in E2E with a confusing symptom (set, never sent back).
		secure: env.NODE_ENV === "production",
		expires,
	});
	return response;
}
