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
	// S-11 (run-analysis-view): added alongside the other three sample arrays.
	populationCountSamples: [10],
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

		// F-05 (MS-08): the row's history is persisted alongside the score,
		// matching exactly what was sent over the wire.
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, runId),
		});
		expect(row?.history).toMatchObject({
			phaseHistory: VALID_STOP_EXTRAS.phaseHistory,
			foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
			survivorGenes: VALID_STOP_EXTRAS.survivingBoidGenes,
			// S-11 (MS-08): round-trips the same way as its three siblings.
			populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
			// compare-runs-side-by-side Phase 1: the client-staged path's
			// survival factor, sent over the wire as `elapsedTicks`.
			elapsedSeconds: 1,
		});
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

	// impl-review (full-score-save-resume, F1): `stop` must reject a
	// server-owned run (one with a live registry entry) instead of scoring
	// it while the registry keeps ticking it in the background.
	it("rejects with BAD_REQUEST when the run is server-owned (has a live registry entry)", async () => {
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
		const { runId } = await caller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(runId);

		await expect(
			caller.simulation.stop({
				runId,
				elapsedTicks: 1,
				cohesionSamples: [0.5],
				...VALID_STOP_EXTRAS,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);

		// Row is untouched — still "running", not scored by the rejected call.
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, runId),
		});
		expect(row?.status).toBe("running");
	});

	// impl-review (full-score-save-resume, F2): same unbounded-array bound
	// the sibling fields already enforce.
	it("rejects an unbounded survivingBoidGenes array", async () => {
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
				cohesionSamples: [0.5],
				...VALID_STOP_EXTRAS,
				survivingBoidGenes: new Array(50_001).fill(
					VALID_STOP_EXTRAS.survivingBoidGenes[0],
				),
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
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

describe("simulationRouter.listCompleted", () => {
	it("returns only the caller's own stopped rows, not another user's, with score and stoppedAt", async () => {
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
				status: "stopped",
				score: 0.42,
				stoppedAt: new Date(),
			})
			.returning({ id: simulationRuns.id });
		await db.insert(simulationRuns).values({
			userId: other.id,
			seed: 2,
			...VALID_START_INPUT,
			status: "stopped",
			score: 0.9,
			stoppedAt: new Date(),
		});
		// Also owner's own running row — must not appear here.
		await db.insert(simulationRuns).values({
			userId: owner.id,
			seed: 3,
			...VALID_START_INPUT,
			status: "running",
		});

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.listCompleted();
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(ownRun?.id);
		expect(result[0]?.score).toBe(0.42);
		expect(result[0]?.stoppedAt).not.toBeNull();
	});

	// plan-review F1: startServer's catch block can set status: "stopped"
	// with no score when a run fails to actually start.
	it("includes a stopped row with a null score", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		await db.insert(simulationRuns).values({
			userId: owner.id,
			seed: 1,
			...VALID_START_INPUT,
			status: "stopped",
			stoppedAt: new Date(),
		});

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.listCompleted();
		expect(result).toHaveLength(1);
		expect(result[0]?.score).toBeNull();
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(caller.simulation.listCompleted()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});
});

describe("simulationRouter.getParameterSuggestion", () => {
	it("computes the suggestion from only the caller's own stopped runs, excluding another user's", async () => {
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

		// Owner's own runs: boidCount perfectly correlated with score.
		const boidCounts = [10, 20, 30, 40, 50, 60];
		const scores = [1, 2, 3, 4, 5, 6];
		for (let i = 0; i < scores.length; i++) {
			await db.insert(simulationRuns).values({
				userId: owner.id,
				seed: i,
				...VALID_START_INPUT,
				boidCount: boidCounts[i] as number,
				status: "stopped",
				score: scores[i],
				stoppedAt: new Date(),
			});
		}

		// Another user's runs, with a parameter/score relationship that would
		// win if it leaked into the caller's computation — must be ignored.
		for (let i = 0; i < 6; i++) {
			await db.insert(simulationRuns).values({
				userId: other.id,
				seed: 100 + i,
				...VALID_START_INPUT,
				predatorCount: i,
				status: "stopped",
				score: 6 - i,
				stoppedAt: new Date(),
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

		const result = await caller.simulation.getParameterSuggestion();
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.parameter).toBe("boidCount");
			expect(result.sampleSize).toBe(6);
			expect(result.direction).toBe("increase");
		}
	});

	it("excludes non-stopped runs from the computation", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		// Only 2 stopped runs — below the minimum sample size on its own —
		// plus running/saved rows that must not be counted toward it.
		const boidCounts = [10, 20];
		const scores = [1, 2];
		for (let i = 0; i < scores.length; i++) {
			await db.insert(simulationRuns).values({
				userId: owner.id,
				seed: i,
				...VALID_START_INPUT,
				boidCount: boidCounts[i] as number,
				status: "stopped",
				score: scores[i],
				stoppedAt: new Date(),
			});
		}
		await db.insert(simulationRuns).values({
			userId: owner.id,
			seed: 50,
			...VALID_START_INPUT,
			boidCount: 30,
			status: "running",
		});
		await db.insert(simulationRuns).values({
			userId: owner.id,
			seed: 51,
			...VALID_START_INPUT,
			boidCount: 40,
			status: "saved",
		});

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.getParameterSuggestion();
		expect(result).toEqual({ status: "insufficient-data" });
	});

	it("excludes stopped rows with a null score", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const boidCounts = [10, 20];
		const scores = [1, 2];
		for (let i = 0; i < scores.length; i++) {
			await db.insert(simulationRuns).values({
				userId: owner.id,
				seed: i,
				...VALID_START_INPUT,
				boidCount: boidCounts[i] as number,
				status: "stopped",
				score: scores[i],
				stoppedAt: new Date(),
			});
		}
		// plan-review F1 precedent (listCompleted): a stopped row can have a
		// null score — must be excluded, not treated as a 3rd sample.
		await db.insert(simulationRuns).values({
			userId: owner.id,
			seed: 2,
			...VALID_START_INPUT,
			boidCount: 30,
			status: "stopped",
			stoppedAt: new Date(),
		});

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		// Only 2 non-null-score rows reach the heuristic — below the minimum
		// sample size, so it must report insufficient-data rather than
		// computing from 3 rows (one of which has no real score).
		const result = await caller.simulation.getParameterSuggestion();
		expect(result).toEqual({ status: "insufficient-data" });
	});

	it("returns insufficient-data for a caller with no completed runs", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		const result = await caller.simulation.getParameterSuggestion();
		expect(result).toEqual({ status: "insufficient-data" });
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(
			caller.simulation.getParameterSuggestion(),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});
});

describe("simulationRouter.getRunAnalysis", () => {
	it("rejects with FORBIDDEN when the caller does not own the run", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				seed: 1,
				...VALID_START_INPUT,
				status: "stopped",
				score: 0.5,
			})
			.returning({ id: simulationRuns.id });
		if (!run) throw new Error("failed to insert fixture run");

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: "attacker-user-id", role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.getRunAnalysis({ runId: run.id }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("rejects with BAD_REQUEST when the run is missing", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		await expect(
			caller.simulation.getRunAnalysis({ runId: 999_999 }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects with BAD_REQUEST when the run is not completed", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				seed: 1,
				...VALID_START_INPUT,
				status: "running",
			})
			.returning({ id: simulationRuns.id });
		if (!run) throw new Error("failed to insert fixture run");

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.getRunAnalysis({ runId: run.id }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("computes completedCycles and finalGeneticDiversity from a known fixture history", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		// Two non-overlapping crash->recovery cycles, matching
		// boids.test.ts's segmentCompletedCycles fixture exactly.
		const twoCycles = [
			"crash",
			"crash",
			"recovery",
			"recovery",
			"crash",
			"crash",
			"crash",
			"recovery",
			"recovery",
			"recovery",
		];

		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				seed: 1,
				...VALID_START_INPUT,
				status: "stopped",
				score: 0.5,
				history: {
					phaseHistory: twoCycles,
					foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
					// A single gene -> computeGeneticDiversity is 0 (no
					// variance across one sample) — same fact established in
					// full-score-save-resume's own "allows the owner's own
					// call to succeed" test.
					survivorGenes: VALID_STOP_EXTRAS.survivingBoidGenes,
					populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
				},
			})
			.returning({ id: simulationRuns.id });
		if (!run) throw new Error("failed to insert fixture run");

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.getRunAnalysis({ runId: run.id });
		expect(result.completedCycles).toEqual([
			{ startTick: 0, endTick: 2 },
			{ startTick: 4, endTick: 7 },
		]);
		expect(result.finalGeneticDiversity).toBe(0);
		expect(result.history).toMatchObject({
			phaseHistory: twoCycles,
		});
	});

	it("returns empty completedCycles and zero finalGeneticDiversity when history is null", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				seed: 1,
				...VALID_START_INPUT,
				status: "stopped",
				score: 0.5,
			})
			.returning({ id: simulationRuns.id });
		if (!run) throw new Error("failed to insert fixture run");

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.getRunAnalysis({ runId: run.id });
		expect(result.completedCycles).toEqual([]);
		expect(result.finalGeneticDiversity).toBe(0);
		expect(result.history).toBeNull();
	});

	// impl-review (run-analysis-view): history is a schema-less JSON
	// column — a malformed row (required fields not actually arrays) must
	// degrade to the same "no data" response as a null history, not throw.
	it("degrades to the null-history response for a malformed history row instead of throwing", async () => {
		const [owner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(owner.id);

		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				seed: 1,
				...VALID_START_INPUT,
				status: "stopped",
				score: 0.5,
				// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed to test the runtime guard.
				history: { phaseHistory: "not-an-array", survivorGenes: null } as any,
			})
			.returning({ id: simulationRuns.id });
		if (!run) throw new Error("failed to insert fixture run");

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: owner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.getRunAnalysis({ runId: run.id });
		expect(result.completedCycles).toEqual([]);
		expect(result.finalGeneticDiversity).toBe(0);
		expect(result.history).toBeNull();
	});
});

describe("simulationRouter.getRunsComparison", () => {
	async function insertOwnerAndCaller() {
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
		return { ownerId: owner.id, caller };
	}

	async function insertStoppedRun(
		ownerId: string,
		overrides: {
			score?: number | null;
			history?: unknown;
		} = {},
	) {
		const { score = 0.5, history = null } = overrides;
		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: ownerId,
				seed: 1,
				...VALID_START_INPUT,
				status: "stopped",
				score,
				stoppedAt: new Date(),
				history,
			})
			.returning({ id: simulationRuns.id });
		if (!run) throw new Error("failed to insert fixture run");
		return run.id;
	}

	it("rejects fewer than 2 runIds at the zod boundary", async () => {
		const { caller } = await insertOwnerAndCaller();

		await expect(
			caller.simulation.getRunsComparison({ runIds: [1] }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects more than 4 runIds at the zod boundary", async () => {
		const { caller } = await insertOwnerAndCaller();

		await expect(
			caller.simulation.getRunsComparison({ runIds: [1, 2, 3, 4, 5] }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("returns a full breakdown for a run with full persisted history", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();

		const twoCycles = ["crash", "crash", "recovery", "recovery"] as const;

		const runId = await insertStoppedRun(ownerId, {
			score: 0.7,
			history: {
				phaseHistory: twoCycles,
				foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
				survivorGenes: VALID_STOP_EXTRAS.survivingBoidGenes,
				populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
				elapsedSeconds: 42,
			},
		});
		const otherRunId = await insertStoppedRun(ownerId, {
			score: 0.3,
			history: {
				phaseHistory: twoCycles,
				foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
				survivorGenes: VALID_STOP_EXTRAS.survivingBoidGenes,
				populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
				elapsedSeconds: 10,
			},
		});

		const result = await caller.simulation.getRunsComparison({
			runIds: [runId, otherRunId],
		});

		expect(result).toHaveLength(2);
		const row = result.find((r) => r.runId === runId);
		expect(row).toMatchObject({
			runId,
			score: 0.7,
			parameters: {
				boidCount: VALID_START_INPUT.boidCount,
				predatorCount: VALID_START_INPUT.predatorCount,
				foodStockInitial: VALID_START_INPUT.foodStockInitial,
				foodRegenRate: VALID_START_INPUT.foodRegenRate,
				protectionThreshold: VALID_START_INPUT.protectionThreshold,
			},
			breakdown: {
				survival: 42,
				// single surviving gene sample -> no variance
				geneticDiversity: 0,
				resourceManagement: expect.any(Number),
				phaseQuality: expect.any(Number),
			},
		});
	});

	it("returns a null breakdown for a run whose history predates elapsedSeconds", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();

		const fullRunId = await insertStoppedRun(ownerId, {
			score: 0.6,
			history: {
				phaseHistory: ["crash", "recovery"],
				foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
				survivorGenes: VALID_STOP_EXTRAS.survivingBoidGenes,
				populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
				elapsedSeconds: 5,
			},
		});
		// Pre-this-change history: every field this plan's predecessors
		// added, but no `elapsedSeconds`.
		const legacyRunId = await insertStoppedRun(ownerId, {
			score: 0.4,
			history: {
				phaseHistory: ["crash", "recovery"],
				foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
				survivorGenes: VALID_STOP_EXTRAS.survivingBoidGenes,
				populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
			},
		});
		// Predates F-05 entirely: no history at all.
		const historylessRunId = await insertStoppedRun(ownerId, {
			score: 0.2,
			history: null,
		});

		const result = await caller.simulation.getRunsComparison({
			runIds: [fullRunId, legacyRunId, historylessRunId],
		});

		expect(result).toHaveLength(3);
		expect(result.find((r) => r.runId === legacyRunId)).toMatchObject({
			runId: legacyRunId,
			score: 0.4,
			breakdown: null,
		});
		expect(result.find((r) => r.runId === historylessRunId)).toMatchObject({
			runId: historylessRunId,
			score: 0.2,
			breakdown: null,
		});
		const fullRow = result.find((r) => r.runId === fullRunId);
		expect(
			fullRow && "breakdown" in fullRow ? fullRow.breakdown : null,
		).not.toBeNull();
	});

	it("returns a null breakdown instead of throwing for a malformed survivorGenes field", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();

		const malformedRunId = await insertStoppedRun(ownerId, {
			score: 0.3,
			history: {
				phaseHistory: ["crash", "recovery"],
				foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
				survivorGenes: "not-an-array",
				populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
				elapsedSeconds: 5,
			},
		});
		const fullRunId = await insertStoppedRun(ownerId, {
			score: 0.6,
			history: {
				phaseHistory: ["crash", "recovery"],
				foodRatioSamples: VALID_STOP_EXTRAS.foodRatioSamples,
				survivorGenes: VALID_STOP_EXTRAS.survivingBoidGenes,
				populationCountSamples: VALID_STOP_EXTRAS.populationCountSamples,
				elapsedSeconds: 5,
			},
		});

		const result = await caller.simulation.getRunsComparison({
			runIds: [malformedRunId, fullRunId],
		});

		expect(result.find((r) => r.runId === malformedRunId)).toMatchObject({
			runId: malformedRunId,
			score: 0.3,
			breakdown: null,
		});
		const fullRow = result.find((r) => r.runId === fullRunId);
		expect(
			fullRow && "breakdown" in fullRow ? fullRow.breakdown : null,
		).not.toBeNull();
	});

	it("drops a non-existent runId with a not-found error marker, without failing the whole query", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();
		const runId = await insertStoppedRun(ownerId);

		const result = await caller.simulation.getRunsComparison({
			runIds: [runId, 999_999],
		});

		expect(result).toHaveLength(2);
		expect(result.find((r) => r.runId === 999_999)).toMatchObject({
			runId: 999_999,
			error: "not-found",
		});
		expect(result.find((r) => r.runId === runId)).toMatchObject({ runId });
	});

	it("drops a run the caller doesn't own with a forbidden error marker", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();
		const { ownerId: otherOwnerId } = await insertOwnerAndCaller();
		const ownRunId = await insertStoppedRun(ownerId);
		const othersRunId = await insertStoppedRun(otherOwnerId);

		const result = await caller.simulation.getRunsComparison({
			runIds: [ownRunId, othersRunId],
		});

		expect(result).toHaveLength(2);
		expect(result.find((r) => r.runId === othersRunId)).toMatchObject({
			runId: othersRunId,
			error: "forbidden",
		});
		expect(result.find((r) => r.runId === ownRunId)).toMatchObject({
			runId: ownRunId,
		});
	});

	it("drops a non-completed run with a not-completed error marker", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();
		const completedRunId = await insertStoppedRun(ownerId);
		const [runningRun] = await db
			.insert(simulationRuns)
			.values({
				userId: ownerId,
				seed: 1,
				...VALID_START_INPUT,
				status: "running",
			})
			.returning({ id: simulationRuns.id });
		if (!runningRun) throw new Error("failed to insert fixture run");

		const result = await caller.simulation.getRunsComparison({
			runIds: [completedRunId, runningRun.id],
		});

		expect(result).toHaveLength(2);
		expect(result.find((r) => r.runId === runningRun.id)).toMatchObject({
			runId: runningRun.id,
			error: "not-completed",
		});
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

describe("simulationRouter.savePause / resume", () => {
	async function insertOwnerAndCaller() {
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
		return { ownerId: owner.id, caller };
	}

	it("pauses a running server run into a saved row, then resume continues ticking", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();

		const { runId } = await caller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(runId);

		await caller.simulation.savePause({ runId });

		expect(isServerRunActive(runId)).toBe(false);
		const savedRow = await db.query.simulationRuns.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, runId),
		});
		expect(savedRow?.status).toBe("saved");
		expect(savedRow?.savedState).not.toBeNull();

		await caller.simulation.resume({ runId });

		expect(isServerRunActive(runId)).toBe(true);
		const resumedRow = await db.query.simulationRuns.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, runId),
		});
		expect(resumedRow?.status).toBe("running");
		expect(resumedRow?.savedState).toBeNull();
		void ownerId;
	});

	it("rejects savePause with FORBIDDEN for a non-owner", async () => {
		const { caller } = await insertOwnerAndCaller();
		const { runId } = await caller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(runId);

		const attackerCaller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: "attacker-user-id", role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			attackerCaller.simulation.savePause({ runId }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("rejects savePause with BAD_REQUEST when the run has no live registry entry", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();
		// A plain inserted "running" row with no matching startServerRun call —
		// same shape watchServerRun's own "not an active server run" test uses.
		const [row] = await db
			.insert(simulationRuns)
			.values({
				userId: ownerId,
				seed: 1,
				...VALID_START_INPUT,
				status: "running",
			})
			.returning({ id: simulationRuns.id });
		if (!row) throw new Error("failed to insert fixture run");

		await expect(
			caller.simulation.savePause({ runId: row.id }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects resume with BAD_REQUEST when the run isn't saved", async () => {
		const { caller } = await insertOwnerAndCaller();
		const { runId } = await caller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(runId);

		await expect(caller.simulation.resume({ runId })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects resume with FORBIDDEN for a non-owner", async () => {
		const { caller } = await insertOwnerAndCaller();
		const { runId } = await caller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(runId);
		await caller.simulation.savePause({ runId });

		const attackerCaller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: "attacker-user-id", role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			attackerCaller.simulation.resume({ runId }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);

		// Clean up: this run is "saved" (no live interval), not "running" —
		// afterEach's trackedServerRunIds loop calls stopServerRun, a no-op
		// against the registry, so finish it explicitly via resume+stop.
		await caller.simulation.resume({ runId });
	});

	it("listSaved returns only the caller's own saved rows", async () => {
		const { ownerId, caller } = await insertOwnerAndCaller();
		const { runId } = await caller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(runId);
		await caller.simulation.savePause({ runId });

		const [otherOwner] = await db
			.insert(users)
			.values({ email: `owner-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!otherOwner) throw new Error("failed to insert fixture owner");
		trackedOwnerIds.push(otherOwner.id);
		const otherCaller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: otherOwner.id, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});
		const { runId: otherRunId } =
			await otherCaller.simulation.startServer(VALID_START_INPUT);
		trackedServerRunIds.push(otherRunId);
		await otherCaller.simulation.savePause({ runId: otherRunId });

		const result = await caller.simulation.listSaved();
		expect(result.map((r) => r.id)).toEqual([runId]);
		void ownerId;

		await caller.simulation.resume({ runId });
		await otherCaller.simulation.resume({ runId: otherRunId });
	});
});
