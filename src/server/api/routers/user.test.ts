import type { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";

const MEMBER_SESSION = {
	user: { id: "test-member-id", role: "member" as const, elevatedUntil: null },
	expires: new Date(Date.now() + 60_000).toISOString(),
};

const ADMIN_SESSION = {
	user: { id: "test-admin-id", role: "admin" as const, elevatedUntil: null },
	expires: new Date(Date.now() + 60_000).toISOString(),
};

// `lapsedUntil` in the past but `role` still "admin" — exercises
// `isEffectivelyAdmin`'s expiry check through `adminProcedure`, not just
// the plain unit test for the helper itself.
const LAPSED_ADMIN_SESSION = {
	user: {
		id: "test-lapsed-admin-id",
		role: "admin" as const,
		elevatedUntil: new Date(Date.now() - 60_000),
	},
	expires: new Date(Date.now() + 60_000).toISOString(),
};

const trackedUserIds: string[] = [];

async function insertUser(email: string) {
	const [user] = await db.insert(users).values({ email }).returning({
		id: users.id,
	});
	if (!user) {
		throw new Error("failed to insert fixture user");
	}
	trackedUserIds.push(user.id);
	return user;
}

afterEach(async () => {
	for (const userId of trackedUserIds) {
		await db.delete(users).where(eq(users.id, userId));
	}
	trackedUserIds.length = 0;
});

describe("userRouter.elevateSelf / revertSelf", () => {
	it("rejects elevateSelf when allowSelfElevation is false", async () => {
		const target = await insertUser(`self-${crypto.randomUUID()}@example.com`);
		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: false,
			session: {
				user: { id: target.id, role: "member", elevatedUntil: null },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.user.elevateSelf({ durationMinutes: 10 }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("lets any logged-in user elevate and revert themselves when allowSelfElevation is true", async () => {
		const target = await insertUser(`self-${crypto.randomUUID()}@example.com`);
		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: true,
			session: {
				user: { id: target.id, role: "member", elevatedUntil: null },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await caller.user.elevateSelf({ durationMinutes: 10 });
		const elevated = await db.query.users.findFirst({
			where: eq(users.id, target.id),
		});
		expect(elevated?.role).toBe("admin");
		expect(elevated?.elevatedUntil).not.toBeNull();

		await caller.user.revertSelf();
		const reverted = await db.query.users.findFirst({
			where: eq(users.id, target.id),
		});
		expect(reverted?.role).toBe("member");
		expect(reverted?.elevatedUntil).toBeNull();
	});
});

describe("userRouter.elevateAccount / revertAccount", () => {
	it("rejects a non-admin caller", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: false,
			session: MEMBER_SESSION,
		});

		await expect(
			caller.user.elevateAccount({
				email: "nobody@example.com",
				durationMinutes: 10,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("rejects a caller whose elevation has lapsed, even though role still says admin", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: false,
			session: LAPSED_ADMIN_SESSION,
		});

		await expect(
			caller.user.elevateAccount({
				email: "nobody@example.com",
				durationMinutes: 10,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("throws BAD_REQUEST for an unknown email", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: false,
			session: ADMIN_SESSION,
		});

		await expect(
			caller.user.elevateAccount({
				email: `unknown-${crypto.randomUUID()}@example.com`,
				durationMinutes: 10,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("elevates and reverts a target account by email, case-insensitively", async () => {
		const email = `target-${crypto.randomUUID()}@example.com`;
		const target = await insertUser(email);
		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: false,
			session: ADMIN_SESSION,
		});

		await caller.user.elevateAccount({
			email: email.toUpperCase(),
			durationMinutes: 10,
		});
		const elevated = await db.query.users.findFirst({
			where: eq(users.id, target.id),
		});
		expect(elevated?.role).toBe("admin");
		expect(elevated?.elevatedUntil).not.toBeNull();

		await caller.user.revertAccount({ email: email.toUpperCase() });
		const reverted = await db.query.users.findFirst({
			where: eq(users.id, target.id),
		});
		expect(reverted?.role).toBe("member");
		expect(reverted?.elevatedUntil).toBeNull();
	});
});

describe("userRouter.listElevatedAccounts", () => {
	it("lists only currently time-boxed accounts, excluding permanent admins", async () => {
		const elevatedTarget = await insertUser(
			`elevated-${crypto.randomUUID()}@example.com`,
		);
		const permanentAdmin = await insertUser(
			`permanent-${crypto.randomUUID()}@example.com`,
		);
		const lapsedTarget = await insertUser(
			`lapsed-${crypto.randomUUID()}@example.com`,
		);

		await db
			.update(users)
			.set({ role: "admin", elevatedUntil: new Date(Date.now() + 60_000) })
			.where(eq(users.id, elevatedTarget.id));
		await db
			.update(users)
			.set({ role: "admin", elevatedUntil: null })
			.where(eq(users.id, permanentAdmin.id));
		await db
			.update(users)
			.set({ role: "admin", elevatedUntil: new Date(Date.now() - 60_000) })
			.where(eq(users.id, lapsedTarget.id));

		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: false,
			session: ADMIN_SESSION,
		});
		const rows = await caller.user.listElevatedAccounts();
		const ids = rows.map((row) => row.id);

		expect(ids).toContain(elevatedTarget.id);
		expect(ids).not.toContain(permanentAdmin.id);
		expect(ids).not.toContain(lapsedTarget.id);
	});
});
