import type { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { adminSettings, simulationRuns, users } from "~/server/db/schema";
import { MAX_PARALLEL_RUNS } from "~/server/simulation/run-slots";
import * as serverRunRegistry from "~/server/simulation/server-run-registry";
import {
	isServerRunActive,
	stopServerRun,
} from "~/server/simulation/server-run-registry";

const VALID_START_INPUT = {
	boidCount: 10,
	separationWeight: 1,
	alignmentWeight: 1,
	cohesionWeight: 1,
	maxDurationSeconds: 60,
	predatorCount: 2,
	protectionThreshold: 3,
	foodStockInitial: 100,
	foodRegenRate: 1,
	flockCount: 2,
	crossbreedingEnabled: true,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
};

// S-04 (FR-010 full, FR-019): the stop input's new required fields —
// minimal valid values shared by every pre-existing stop() test below, none
// of which assert on resource-management/phase-classifier/genetic-diversity
// scoring.
const VALID_STOP_EXTRAS = {
	foodRatioSamples: [0.5],
	phaseHistory: ["establishment"] satisfies (
		| "establishment"
		| "growth"
		| "overshoot"
		| "crash"
		| "recovery"
	)[],
	survivingBoidGenes: [
		{
			color: { r: 0, g: 0, b: 0 },
			flockId: 0,
			separationWeight: 1,
			alignmentWeight: 1,
			cohesionWeight: 1,
			maxSpeed: 40,
			minSpeed: 15,
			maxLifespan: 100,
			matePreference: 0,
		},
	],
};

// A minimal but type-correct session (see the `declare module "next-auth"`
// augmentation in ~/server/auth/config.ts) — just enough for
// `protectedProcedure`'s middleware to pass. The FR-018 combined-cap check
// (S-04: now a runtime check against `adminSettings.maxObjectCount`
// inside `insertRunningSimulation`, not a static zod `.refine()`) does
// read the DB to fetch/seed `adminSettings` — but never reaches a FK on
// this fabricated session's userId, since `adminSettings` has no such
// reference.
const SESSION = {
	user: { id: "test-user-id", role: "member" as const },
	expires: new Date(Date.now() + 60_000).toISOString(),
};

// Owner ids from fixtures inserted by `insertOwnedRunningRun()` in this test
// run, so `afterEach` can clean each one up via cascade delete.
const trackedOwnerIds: string[] = [];

// Run ids started via `startServer` in this test run, so `afterEach` can
// stop them before the owner cleanup — otherwise a failed assertion could
// leak a live interval into a later test file in this worker, same
// discipline `server-run-registry.test.ts` already follows.
const trackedServerRunIds: number[] = [];

// `@libsql/client` enforces foreign keys by default, so `simulation.stop`'s
// ownership check (which reads an existing `simulationRuns` row) needs a
// real `users` row and a real `simulationRuns` row pointing at it — a
// fabricated session alone isn't enough for this resolver, unlike `start`'s
// UNAUTHORIZED case below which never reads the DB.
async function insertOwnedRunningRun() {
	const [owner] = await db
		.insert(users)
		.values({
			email: `owner-${crypto.randomUUID()}@example.com`,
		})
		.returning({ id: users.id });

	if (!owner) {
		throw new Error("failed to insert fixture owner");
	}

	trackedOwnerIds.push(owner.id);

	const [run] = await db
		.insert(simulationRuns)
		.values({
			userId: owner.id,
			seed: 1,
			boidCount: VALID_START_INPUT.boidCount,
			separationWeight: VALID_START_INPUT.separationWeight,
			alignmentWeight: VALID_START_INPUT.alignmentWeight,
			cohesionWeight: VALID_START_INPUT.cohesionWeight,
			maxDurationSeconds: VALID_START_INPUT.maxDurationSeconds,
			predatorCount: VALID_START_INPUT.predatorCount,
			protectionThreshold: VALID_START_INPUT.protectionThreshold,
			foodStockInitial: VALID_START_INPUT.foodStockInitial,
			foodRegenRate: VALID_START_INPUT.foodRegenRate,
			flockCount: VALID_START_INPUT.flockCount,
			crossbreedingEnabled: VALID_START_INPUT.crossbreedingEnabled,
			energyThreshold: VALID_START_INPUT.energyThreshold,
			mutationChance: VALID_START_INPUT.mutationChance,
			mutationMagnitude: VALID_START_INPUT.mutationMagnitude,
			status: "running",
		})
		.returning({ id: simulationRuns.id });

	if (!run) {
		throw new Error("failed to insert fixture run");
	}

	return { ownerId: owner.id, runId: run.id };
}

afterEach(async () => {
	// Reset the admin-settings singleton so a test that edits ranges can't
	// leak state into a later test — `getOrSeedAdminSettings` reseeds the
	// default row on next read.
	await db.delete(adminSettings);

	for (const runId of trackedServerRunIds) {
		await stopServerRun(runId);
	}
	trackedServerRunIds.length = 0;

	// Deleting the `users` row cascade-deletes the matching `simulationRuns`
	// row (see `simulationRuns.userId`'s `onDelete: "cascade"` reference).
	for (const ownerId of trackedOwnerIds) {
		await db.delete(users).where(eq(users.id, ownerId));
	}
	trackedOwnerIds.length = 0;
});

describe("simulationRouter.start", () => {
	it("rejects when boidCount + predatorCount exceeds the combined FR-018 cap of 500", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		// Asserts specifically on a BAD_REQUEST (input-validation) rejection,
		// not just "something threw" — a downstream DB error (e.g. a missing
		// FK for this fabricated session's userId) also throws and would make
		// a bare `.rejects.toThrow()` pass vacuously even if the combined-cap
		// `.refine()` were removed entirely.
		await expect(
			caller.simulation.start({
				...VALID_START_INPUT,
				boidCount: 400,
				predatorCount: 200,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(
			caller.simulation.start(VALID_START_INPUT),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});

	it("rejects an unbounded maxDurationSeconds", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		await expect(
			caller.simulation.start({
				...VALID_START_INPUT,
				maxDurationSeconds: 100_000,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects flockCount outside [2,4]", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		await expect(
			caller.simulation.start({ ...VALID_START_INPUT, flockCount: 1 }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);

		await expect(
			caller.simulation.start({ ...VALID_START_INPUT, flockCount: 5 }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects mutationChance/mutationMagnitude outside [0,1]", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		await expect(
			caller.simulation.start({ ...VALID_START_INPUT, mutationChance: -0.1 }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);

		await expect(
			caller.simulation.start({ ...VALID_START_INPUT, mutationChance: 1.1 }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);

		await expect(
			caller.simulation.start({
				...VALID_START_INPUT,
				mutationMagnitude: -0.1,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);

		await expect(
			caller.simulation.start({
				...VALID_START_INPUT,
				mutationMagnitude: 1.1,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("persists the five new genetics fields and round-trips them on read", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const submitted = {
			...VALID_START_INPUT,
			flockCount: 3,
			crossbreedingEnabled: false,
			energyThreshold: 75,
			mutationChance: 0.25,
			mutationMagnitude: 0.4,
		};

		const { runId } = await caller.simulation.start(submitted);

		const stored = await db.query.simulationRuns.findFirst({
			where: (simulationRuns, { eq }) => eq(simulationRuns.id, runId),
		});

		expect(stored).toMatchObject({
			flockCount: submitted.flockCount,
			crossbreedingEnabled: submitted.crossbreedingEnabled,
			energyThreshold: submitted.energyThreshold,
			mutationChance: submitted.mutationChance,
			mutationMagnitude: submitted.mutationMagnitude,
		});
	});
});

describe("simulationRouter.stop authorization", () => {
	it("rejects with FORBIDDEN when the caller does not own the run", async () => {
		const { runId } = await insertOwnedRunningRun();

		// No real `users` row is needed for this caller — `stop`'s resolver
		// never writes anything keyed to it, so a fabricated session with a
		// different id is enough to exercise the ownership check.
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: "attacker-user-id", role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.stop({
				runId,
				elapsedTicks: 1,
				cohesionSamples: [0.5],
				...VALID_STOP_EXTRAS,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("allows the owner's own call to succeed (contrast case)", async () => {
		const { ownerId, runId } = await insertOwnedRunningRun();

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: ownerId, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.stop({
			runId,
			elapsedTicks: 1,
			cohesionSamples: [0.5],
			...VALID_STOP_EXTRAS,
		});

		// S-04: score is now a 4-factor product (survival x resourceManagement
		// x geneticDiversity x phaseQuality) — a single surviving boid's
		// genetic diversity is 0 (no variance across one sample), so the
		// product is 0 regardless of the other factors. This test is about
		// ownership succeeding, not the formula's value — formula behavior is
		// covered by boids.test.ts's computeScore/computeGeneticDiversity
		// suites.
		expect(result).toMatchObject({ score: 0 });
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(
			caller.simulation.stop({
				runId: 1,
				elapsedTicks: 1,
				cohesionSamples: [0.5],
				...VALID_STOP_EXTRAS,
			}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});

	it("rejects an unbounded cohesionSamples array", async () => {
		const { ownerId, runId } = await insertOwnedRunningRun();

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: ownerId, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.stop({
				runId,
				elapsedTicks: 1,
				cohesionSamples: new Array(100_000).fill(0.5),
				...VALID_STOP_EXTRAS,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects the losing caller of a stop race instead of silently overwriting the score", async () => {
		const { ownerId, runId } = await insertOwnedRunningRun();

		// Simulate a second stop call's write landing between this call's read
		// (the early `run.status !== "running"` check, which still sees
		// "running" when it runs) and this call's own write — a thin proxy
		// over `db` whose `update` matches exactly the one call shape `stop`'s
		// resolver uses, performing the sabotage write and *awaiting* it
		// before letting the real update run. A true two-concurrent-callers
		// race can't be reproduced deterministically in Vitest's
		// single-threaded model; this reproduces the exact DB state the race
		// would leave behind, at the exact point it would leave it, with no
		// timing ambiguity (the sabotage is awaited, not fired-and-forgotten).
		const sabotagingDb = new Proxy(db, {
			get(target, prop, receiver) {
				if (prop === "update") {
					return (...updateArgs: Parameters<typeof db.update>) => ({
						set: (...setArgs: unknown[]) => ({
							where: (...whereArgs: unknown[]) => ({
								returning: async (...returningArgs: unknown[]) => {
									await db
										.update(simulationRuns)
										.set({
											status: "stopped",
											score: 0.1,
											stoppedAt: new Date(),
										})
										.where(eq(simulationRuns.id, runId));
									// biome-ignore lint/suspicious/noExplicitAny: re-threading a dynamically captured chain through the real builder's exact call shape.
									return (target.update(...updateArgs) as any)
										.set(...setArgs)
										.where(...whereArgs)
										.returning(...returningArgs);
								},
							}),
						}),
					});
				}
				return Reflect.get(target, prop, receiver);
			},
		});

		const caller = createCaller({
			// biome-ignore lint/suspicious/noExplicitAny: proxy narrows `update`'s return shape to only what this one test calls.
			db: sabotagingDb as any,
			headers: new Headers(),
			session: {
				user: { id: ownerId, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.stop({
				runId,
				elapsedTicks: 1,
				cohesionSamples: [0.5],
				...VALID_STOP_EXTRAS,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Run already stopped",
		} satisfies Partial<TRPCError>);

		// The sabotage write's score (0.1) must survive untouched — proving
		// the losing caller's update genuinely did not run, not just that it
		// returned an error while still mutating the row.
		const finalRun = await db.query.simulationRuns.findFirst({
			where: (simulationRuns, { eq }) => eq(simulationRuns.id, runId),
		});
		expect(finalRun?.score).toBe(0.1);
	});
});

describe("simulationRouter.start — parallel-run cap race", () => {
	it("invalidates the losing caller's row instead of letting the cap be bypassed", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		async function runningCountFor(userId: string) {
			const [row] = await db
				.select({ runningCount: count() })
				.from(simulationRuns)
				.where(
					and(
						eq(simulationRuns.userId, userId),
						eq(simulationRuns.status, "running"),
					),
				);
			return row?.runningCount ?? 0;
		}

		// Pre-seed one under the cap, so `start`'s pre-insert check (which
		// reads this same count) passes.
		for (let i = 0; i < MAX_PARALLEL_RUNS - 1; i++) {
			await db.insert(simulationRuns).values({
				userId: owner.id,
				seed: i,
				...VALID_START_INPUT,
				status: "running",
			});
		}
		expect(await runningCountFor(owner.id)).toBe(MAX_PARALLEL_RUNS - 1);

		// Simulate a second concurrent `start` call's insert landing between
		// this call's pre-insert count (already read as under-cap above) and
		// its own post-insert re-check — a thin proxy over `db` whose
		// `select` matches the resolver's exact call shape, counting calls
		// and, on the second (the re-check), *awaiting* a sabotage insert
		// before letting the real select run. Same rationale as the
		// stop-race test above: reproduces the exact DB state a real race
		// would leave, at the exact point it would leave it, with no timing
		// ambiguity.
		let selectCallCount = 0;
		const sabotagingDb = new Proxy(db, {
			get(target, prop, receiver) {
				if (prop === "select") {
					return (...selectArgs: unknown[]) => ({
						from: (...fromArgs: unknown[]) => ({
							where: async (...whereArgs: unknown[]) => {
								selectCallCount++;
								if (selectCallCount === 2) {
									await db.insert(simulationRuns).values({
										userId: owner.id,
										seed: 999,
										...VALID_START_INPUT,
										status: "running",
									});
								}
								// biome-ignore lint/suspicious/noExplicitAny: re-threading a dynamically captured chain through the real builder's exact call shape.
								return (target as any)
									.select(...selectArgs)
									.from(...fromArgs)
									.where(...whereArgs);
							},
						}),
					});
				}
				return Reflect.get(target, prop, receiver);
			},
		});

		const caller = createCaller({
			// biome-ignore lint/suspicious/noExplicitAny: proxy narrows `select`'s return shape to only what this one test calls.
			db: sabotagingDb as any,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.start(VALID_START_INPUT),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);

		// Back down to exactly the cap: the sabotage row (inserted directly,
		// not by `start`) stays running, but `start`'s own just-inserted row
		// was invalidated — proving the re-check's invalidation actually ran,
		// not just that an error was thrown while the bypass stood.
		expect(await runningCountFor(owner.id)).toBe(MAX_PARALLEL_RUNS);
	});
});

describe("simulationRouter.startServer", () => {
	it("enforces the same MAX_PARALLEL_RUNS cap as start", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		for (let i = 0; i < MAX_PARALLEL_RUNS; i++) {
			await db.insert(simulationRuns).values({
				userId: owner.id,
				seed: i,
				...VALID_START_INPUT,
				status: "running",
			});
		}

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.startServer(VALID_START_INPUT),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("inserts a running row and makes it an active server run", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(result.runId);

		expect(isServerRunActive(result.runId)).toBe(true);

		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, result.runId),
		});
		expect(row?.status).toBe("running");
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(
			caller.simulation.startServer(VALID_START_INPUT),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});

	it("marks the row stopped and surfaces an error when startServerRun throws", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const startServerRunSpy = vi
			.spyOn(serverRunRegistry, "startServerRun")
			.mockImplementationOnce(() => {
				throw new Error("boom");
			});
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.startServer(VALID_START_INPUT),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		} satisfies Partial<TRPCError>);

		const [row] = await db
			.select()
			.from(simulationRuns)
			.where(eq(simulationRuns.userId, owner.id));
		expect(row?.status).toBe("stopped");
		expect(consoleErrorSpy).toHaveBeenCalled();

		startServerRunSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});
});

describe("simulationRouter.listRunning", () => {
	it("returns only the caller's own running rows, not another user's", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const [other] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!other) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(other.id);

		const [ownRun] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				seed: 1,
				...VALID_START_INPUT,
				status: "running",
			})
			.returning({ id: simulationRuns.id });
		await db.insert(simulationRuns).values({
			userId: other.id,
			seed: 2,
			...VALID_START_INPUT,
			status: "running",
		});
		// Also owner's own stopped row — must not appear either.
		await db.insert(simulationRuns).values({
			userId: owner.id,
			seed: 3,
			...VALID_START_INPUT,
			status: "stopped",
		});

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.listRunning();
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(ownRun?.id);
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(caller.simulation.listRunning()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});
});

describe("simulationRouter.getParameterRanges / updateParameterRanges", () => {
	it("seeds and returns the default ranges on first read", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		const result = await caller.simulation.getParameterRanges();
		expect(result.maxObjectCount).toBe(500);
		expect(result.parameterRanges.boidCount).toEqual({
			min: 1,
			max: 500,
			default: 100,
		});
	});

	it("rejects updateParameterRanges from a non-admin member", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		await expect(
			caller.simulation.updateParameterRanges({
				parameterRanges: (await caller.simulation.getParameterRanges())
					.parameterRanges,
				maxObjectCount: 500,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("lets an admin update ranges, and start enforces the new bound", async () => {
		const adminSession = {
			user: { id: "test-admin-id", role: "admin" as const },
			expires: new Date(Date.now() + 60_000).toISOString(),
		};
		const adminCaller = createCaller({
			db,
			headers: new Headers(),
			session: adminSession,
		});

		const current = await adminCaller.simulation.getParameterRanges();
		await adminCaller.simulation.updateParameterRanges({
			parameterRanges: {
				...current.parameterRanges,
				boidCount: { min: 1, max: 20, default: 10 },
			},
			maxObjectCount: current.maxObjectCount,
		});

		const memberCaller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});
		await expect(
			memberCaller.simulation.start({ ...VALID_START_INPUT, boidCount: 50 }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects an update where a range violates min <= default <= max", async () => {
		const adminSession = {
			user: { id: "test-admin-id-2", role: "admin" as const },
			expires: new Date(Date.now() + 60_000).toISOString(),
		};
		const adminCaller = createCaller({
			db,
			headers: new Headers(),
			session: adminSession,
		});
		const current = await adminCaller.simulation.getParameterRanges();

		await expect(
			adminCaller.simulation.updateParameterRanges({
				parameterRanges: {
					...current.parameterRanges,
					boidCount: { min: 100, max: 50, default: 10 },
				},
				maxObjectCount: current.maxObjectCount,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});
});
