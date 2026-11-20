import { TRPCError } from "@trpc/server";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import { users } from "~/server/db/schema";

// A full day — generous enough for a real admin session, short enough that
// a forgotten revert doesn't become a de-facto permanent grant.
const MAX_DURATION_MINUTES = 1440;

const durationMinutesInput = z
	.number()
	.int()
	.positive()
	.max(MAX_DURATION_MINUTES);

function elevatedUntilFrom(durationMinutes: number): Date {
	return new Date(Date.now() + durationMinutes * 60_000);
}

// plan-review F2: users.email has no COLLATE NOCASE, so an exact match
// would miss a correctly-spelled but differently-cased email. Matches
// ADMIN_EMAILS's own lowercase-normalized comparison (auth/config.ts).
function emailMatches(email: string) {
	return sql`lower(${users.email}) = lower(${email})`;
}

export const userRouter = createTRPCRouter({
	// temporary-admin-elevation (FR-030): no admin prerequisite, by design,
	// so a user can never lock themselves out — but gated behind
	// ctx.allowSelfElevation (plan-review F1, sourced from env.ALLOW_SELF_ELEVATION
	// in createTRPCContext) since GitHub OAuth sign-in has no allowlist, and
	// without this flag any signed-up account could self-elevate.
	elevateSelf: protectedProcedure
		.input(z.object({ durationMinutes: durationMinutesInput }))
		.mutation(async ({ ctx, input }) => {
			if (!ctx.allowSelfElevation) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			await ctx.db
				.update(users)
				.set({
					role: "admin",
					elevatedUntil: elevatedUntilFrom(input.durationMinutes),
				})
				.where(eq(users.id, ctx.session.user.id));
			return { ok: true };
		}),

	revertSelf: protectedProcedure.mutation(async ({ ctx }) => {
		await ctx.db
			.update(users)
			.set({ role: "member", elevatedUntil: null })
			.where(eq(users.id, ctx.session.user.id));
		return { ok: true };
	}),

	// Elevating a *different* account requires the caller already be
	// effectively admin (adminProcedure) — self-elevation is the only
	// prerequisite-free path, to prevent arbitrary members granting admin
	// to themselves or others via someone else's account.
	elevateAccount: adminProcedure
		.input(
			z.object({
				email: z.string().email(),
				durationMinutes: durationMinutesInput,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const target = await ctx.db.query.users.findFirst({
				where: emailMatches(input.email),
			});
			if (!target) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No account with that email",
				});
			}
			await ctx.db
				.update(users)
				.set({
					role: "admin",
					elevatedUntil: elevatedUntilFrom(input.durationMinutes),
				})
				.where(eq(users.id, target.id));
			return { ok: true };
		}),

	revertAccount: adminProcedure
		.input(z.object({ email: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const target = await ctx.db.query.users.findFirst({
				where: emailMatches(input.email),
			});
			if (!target) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No account with that email",
				});
			}
			await ctx.db
				.update(users)
				.set({ role: "member", elevatedUntil: null })
				.where(eq(users.id, target.id));
			return { ok: true };
		}),

	// Only accounts currently time-boxed (elevatedUntil set and still in
	// the future) — permanent ADMIN_EMAILS admins (elevatedUntil null) are
	// intentionally excluded, since there's nothing to revoke for them
	// through this mechanism.
	listElevatedAccounts: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db.query.users.findMany({
			where: and(
				isNotNull(users.elevatedUntil),
				gt(users.elevatedUntil, new Date()),
			),
			columns: { id: true, email: true, elevatedUntil: true },
		});
		return rows;
	}),

	searchByEmail: protectedProcedure
		.input(z.object({ email: z.string() }))
		.query(async ({ ctx, input }) => {
			// DEMO: intentionally vulnerable to prove the AI reviewer catches it.
			const rows = await ctx.db.run(
				`SELECT * FROM users WHERE email = '${input.email}'`,
			);
			return rows;
		}),
});
