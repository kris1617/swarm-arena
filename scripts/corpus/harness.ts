// corpus-generation-harness Phase 1: the single-run primitive a later slice
// (S-33) calls repeatedly, batched, to build the full parameter-sweep
// corpus. Drives one server-owned simulation run end-to-end through the
// real app's `createCaller`-based execution path (not a bypass of the
// engine) — see context/changes/corpus-generation-harness/plan.md.
import { eq } from "drizzle-orm";
import { vi } from "vitest";

import { createCaller } from "~/server/api/root";
import type { db as dbSingleton } from "~/server/db";
import { adminSettings, users } from "~/server/db/schema";
import type { PredatorTribeConfig } from "~/server/simulation/boids";
import {
	DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
	DEFAULT_MAX_OBJECT_COUNT,
	DEFAULT_PARAMETER_RANGES,
	type ParameterRanges,
	RANGED_PARAMETER_NAMES,
	type RangedParameterName,
} from "~/server/simulation/parameter-ranges";
import type { ServerRunParams } from "~/server/simulation/server-run-registry";

export type DB = typeof dbSingleton;

// `startServer`'s accepted input shape is `ServerRunParams` minus the two
// fields the router itself derives (`runId` on insert, `seed` randomly) —
// `simulation.ts`'s own `startInputSchema` is a private, non-exported
// module-local const this module cannot import, so this type is derived
// from the exported `ServerRunParams` instead, which the router already
// keeps in lockstep with that schema (see `startServerRun({ runId, seed,
// ...input })` in simulation.ts).
//
// predator-tribe-concept Phase 1: `ServerRunParams` itself does NOT yet
// declare `predatorFlockCount`/`predatorTribeConfigs` (that type is owned by
// server-run-registry.ts, whose own engine wiring is out of this phase's
// scope — "zero engine-behavior change yet") but `startInputSchema` (the
// real `startServer` input this harness drives through the real tRPC path)
// now requires both, so this type adds them on top of the `ServerRunParams`
// omission rather than waiting for a later phase to widen `ServerRunParams`
// itself.
export type StartCorpusRunParams = Omit<ServerRunParams, "runId" | "seed"> & {
	predatorFlockCount: number;
	predatorTribeConfigs: PredatorTribeConfig[];
};

// Singleton row id for `adminSettings` — matches the constant of the same
// name in `src/server/api/routers/simulation.ts`, this module's
// deliberately-duplicated reference (that file has no exported constant
// this module could import instead).
const ADMIN_SETTINGS_ID = 1;

// Mirrors exactly what `getRunAnalysis` returns (simulation.ts:794-868) —
// `params` is the subset of that payload describing the run's own
// configuration (not derived score/analysis fields); `getRunAnalysis`
// itself only returns these 5 configured values, not the full
// `StartCorpusRunParams` shape the run was started with.
export type CorpusRunRecord = {
	params: {
		boidCount: number;
		predatorCount: number;
		foodStockInitial: number;
		foodRegenRate: number;
		protectionThreshold: number;
	};
	score: number | null;
	history: unknown;
	completedCycles: unknown;
	finalGeneticDiversity: number;
	runOptimizationSuggestion: unknown;
};

// Deliberately duplicating `getOrSeedAdminSettings`'s seed-if-absent shape
// (`src/server/api/routers/simulation.ts`) — that function is a private,
// non-exported module-local helper this module cannot import. A known,
// acknowledged duplication: a future change to the real seeding logic needs
// updating in both places.
async function getOrSeedAdminSettingsRanges(db: DB): Promise<ParameterRanges> {
	const existing = await db.query.adminSettings.findFirst({
		where: (t, { eq: eqFn }) => eqFn(t.id, ADMIN_SETTINGS_ID),
	});
	if (existing) {
		return existing.parameterRanges as ParameterRanges;
	}
	await db.insert(adminSettings).values({
		id: ADMIN_SETTINGS_ID,
		parameterRanges: DEFAULT_PARAMETER_RANGES,
		maxObjectCount: DEFAULT_MAX_OBJECT_COUNT,
		maxConcurrentObjectCount: DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
	});
	return DEFAULT_PARAMETER_RANGES;
}

// Widens the admin-configured range for every ranged field present in
// `params` just enough to admit the value the caller wants to start a run
// with, writes the widened ranges back, and returns the pre-widen snapshot
// so the caller can restore it later. Generic over whatever fields are
// present — not hardcoded to `maxDurationSeconds` — matching this project's
// "generic coercion, not field-name-specific branching" convention (see
// `updateRunParams`'s boolean-coercion in simulation.ts).
export async function ensureAdminRangesAdmit(
	db: DB,
	params: Partial<Record<RangedParameterName, number | boolean>>,
): Promise<ParameterRanges> {
	const original = await getOrSeedAdminSettingsRanges(db);
	const widened: ParameterRanges = { ...original };

	for (const name of RANGED_PARAMETER_NAMES) {
		if (!(name in params)) {
			continue;
		}
		const rawValue = params[name];
		if (rawValue === undefined) {
			continue;
		}
		// Same generic coercion `updateRunParams` already uses — not
		// field-name-specific.
		const value = typeof rawValue === "boolean" ? Number(rawValue) : rawValue;
		const range = original[name];
		widened[name] = {
			...range,
			min: Math.min(range.min, value),
			max: Math.max(range.max, value),
		};
	}

	await db
		.update(adminSettings)
		.set({ parameterRanges: widened })
		.where(eq(adminSettings.id, ADMIN_SETTINGS_ID));

	return original;
}

// Batch-scoped sibling of `ensureAdminRangesAdmit`: folds the same
// per-field min/max-widen rule across every param set in `paramsList`
// instead of a single `params` object, and writes the union to
// `adminSettings` exactly once. Lets a caller starting several runs as one
// batch widen the shared row once up front (via `startCorpusRun`'s
// `opts.skipRangeWiden`) instead of each concurrent `startCorpusRun` call
// racing its own widen/restore against the others.
export async function ensureAdminRangesAdmitForBatch(
	db: DB,
	paramsList: Array<Partial<Record<RangedParameterName, number | boolean>>>,
): Promise<ParameterRanges> {
	const original = await getOrSeedAdminSettingsRanges(db);
	const widened: ParameterRanges = { ...original };

	for (const params of paramsList) {
		for (const name of RANGED_PARAMETER_NAMES) {
			if (!(name in params)) {
				continue;
			}
			const rawValue = params[name];
			if (rawValue === undefined) {
				continue;
			}
			// Same generic coercion `ensureAdminRangesAdmit` uses — not
			// field-name-specific.
			const value = typeof rawValue === "boolean" ? Number(rawValue) : rawValue;
			// Widen from the running `widened` value (not `original`) so a
			// later entry in the batch keeps the widening an earlier entry
			// already needed instead of clobbering it back to the default.
			const range = widened[name];
			widened[name] = {
				...range,
				min: Math.min(range.min, value),
				max: Math.max(range.max, value),
			};
		}
	}

	await db
		.update(adminSettings)
		.set({ parameterRanges: widened })
		.where(eq(adminSettings.id, ADMIN_SETTINGS_ID));

	return original;
}

// pre-existing-admin-settings-flakes Phase 4: a minimal, dependency-free
// async mutex serializing the admin-ranges widen/restore critical section.
// Confirmed this session (~25% failure rate in isolation) that two
// concurrent callers of `ensureAdminRangesAdmit`/`ensureAdminRangesAdmitForBatch`
// can interleave their widen/restore writes against the shared
// `admin_settings.parameterRanges` row — an already-accepted risk from
// `context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md`.
// Today only a deliberately-constructed test exercises two concurrent
// callers, but this lock serializes any two callers wanting exclusive
// access to the critical section, not just that one test.
let adminRangesLock: Promise<void> = Promise.resolve();

export async function withAdminRangesLock<T>(fn: () => Promise<T>): Promise<T> {
	const previous = adminRangesLock;
	let release!: () => void;
	adminRangesLock = new Promise((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		return await fn();
	} finally {
		release();
	}
}

function callerFor(db: DB, ownerId: string) {
	return createCaller({
		db,
		headers: new Headers(),
		allowSelfElevation: false,
		session: {
			user: { id: ownerId, role: "member" as const, elevatedUntil: null },
			expires: new Date(Date.now() + 60_000).toISOString(),
		},
	});
}

// T3's own `timingMiddleware` (src/server/api/trpc.ts) adds a random
// 100-500ms artificial delay via `setTimeout` whenever `NODE_ENV !==
// "production"` — true during Vitest runs (`NODE_ENV: "test"`). Under
// `vi.useFakeTimers()` that `setTimeout` never fires on its own, so any
// `createCaller`-issued procedure call hangs forever unless fake time is
// explicitly advanced past it. `vi.advanceTimersByTimeAsync` itself throws
// ("timers APIs are not mocked") when fake timers aren't installed, so this
// only advances when `vi.isFakeTimers()` confirms they are — letting this
// same harness work under both the real-timer-only callers and the
// fake-timer round-trip tests.
async function callProcedure<T>(promise: Promise<T>): Promise<T> {
	if (vi.isFakeTimers()) {
		await vi.advanceTimersByTimeAsync(500);
	}
	return promise;
}

// Starts a single server-owned run with the given parameters, widening (and
// immediately restoring) the admin ranges around the `startServer` call as
// needed. Returns the new run's identifiers for the caller to hold onto
// until it has advanced the shared fake-timer clock.
export async function startCorpusRun(
	db: DB,
	params: StartCorpusRunParams,
	opts?: { skipRangeWiden?: boolean },
): Promise<{ runId: number; ownerId: string }> {
	const [owner] = await db
		.insert(users)
		.values({ email: `corpus-${crypto.randomUUID()}@example.com` })
		.returning({ id: users.id });
	if (!owner) {
		throw new Error("startCorpusRun: failed to insert fixture owner");
	}

	// Batch callers have already widened (and own restoring) the shared row
	// via `ensureAdminRangesAdmitForBatch` — running this call's own
	// widen/restore on top would race its restore against the other calls
	// in the batch, each stomping on the others' still-in-progress runs.
	// pre-existing-admin-settings-flakes Phase 4: the full widen -> start ->
	// restore cycle, extracted so it can run either directly (batch callers,
	// which already hold the lock around their own wider cycle) or wrapped in
	// `withAdminRangesLock` (standalone callers) below.
	const widenStartRestoreCycle = async (): Promise<{
		runId: number;
		ownerId: string;
	}> => {
		const restoreRanges = opts?.skipRangeWiden
			? null
			: await ensureAdminRangesAdmit(db, params);

		try {
			const caller = callerFor(db, owner.id);
			const { runId } = await callProcedure(
				caller.simulation.startServer(params),
			);
			return { runId, ownerId: owner.id };
		} catch (err) {
			// `startServer` never got to register a run — the fixture owner is
			// the harness's own resource, so it cleans it up on this path too.
			await db.delete(users).where(eq(users.id, owner.id));
			throw err;
		} finally {
			// `checkAgainstAdminRanges` only runs at start time, never mid-tick,
			// so restoring the admin ranges as soon as `startServer` settles —
			// success or throw — cannot affect a run already in progress, and
			// must happen either way: this row is shared with real traffic.
			// Skipped entirely when the caller owns the batch-scoped
			// widen/restore instead.
			if (restoreRanges !== null) {
				await db
					.update(adminSettings)
					.set({ parameterRanges: restoreRanges })
					.where(eq(adminSettings.id, ADMIN_SETTINGS_ID));
			}
		}
	};

	// Only a standalone call (one that does its own widen/restore) needs the
	// lock here — a batch call already runs inside its caller's own
	// `withAdminRangesLock` (see `runBatch` in generate-sweep.ts), and nesting
	// the lock again here would deadlock (the outer `fn` would await its own
	// still-pending lock).
	return opts?.skipRangeWiden
		? widenStartRestoreCycle()
		: withAdminRangesLock(widenStartRestoreCycle);
}

// Reads back a completed run's full analysis payload via the real
// `getRunAnalysis` procedure (exercising the same ownership/status gates a
// production client hits), then deletes the fixture owner — cascade-
// cleaning the run row. Throws (propagating `getRunAnalysis`'s own
// BAD_REQUEST "Run is not completed" TRPCError) if the run hasn't actually
// stopped yet; the caller is responsible for having advanced fake time past
// `maxDurationSeconds` first.
export async function collectAndCleanupCorpusRun(
	db: DB,
	ownerId: string,
	runId: number,
): Promise<CorpusRunRecord> {
	try {
		const caller = callerFor(db, ownerId);
		const analysis = await callProcedure(
			caller.simulation.getRunAnalysis({ runId }),
		);

		return {
			params: {
				boidCount: analysis.boidCount,
				predatorCount: analysis.predatorCount,
				foodStockInitial: analysis.foodStockInitial,
				foodRegenRate: analysis.foodRegenRate,
				protectionThreshold: analysis.protectionThreshold,
			},
			score: analysis.score,
			history: analysis.history,
			completedCycles: analysis.completedCycles,
			finalGeneticDiversity: analysis.finalGeneticDiversity,
			runOptimizationSuggestion: analysis.runOptimizationSuggestion,
		};
	} finally {
		// Fixture owner is this harness's own resource — clean it up
		// whether `getRunAnalysis` succeeded or threw (e.g. the documented
		// "run not stopped yet" case), so a caller's thrown precondition
		// violation never leaks a row.
		await db.delete(users).where(eq(users.id, ownerId));
	}
}
