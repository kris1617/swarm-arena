// fix-default-start-failure Phase 2: a standalone periodic job, conceptually
// separate from server-run-registry.ts's per-run tick lifecycle — own file,
// mirroring ~/server/feedback/retry-worker.ts's own standalone module rather
// than being bolted onto the already-large registry file.
//
// Marks any `simulationRuns` row stuck in `status: "running"` well past its
// own `startedAt + maxDurationSeconds` deadline (plus a grace window) as
// `stopped` — covering both client-staged and server-owned rows identically,
// since a process restart (every deploy) wipes `server-run-registry.ts`'s
// in-memory Map but leaves the DB row behind as a permanent orphan with
// nothing else tracking it.

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { simulationRuns } from "~/server/db/schema";
import { isServerRunActive } from "~/server/simulation/server-run-registry";

const GRACE_MS = 2 * 60 * 1000; // 2 minutes, per the "Grace" decision

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, per the "Sweep" decision

async function sweepOrphanedRuns(): Promise<void> {
	const now = Date.now();
	const staleRows = await db
		.select({
			id: simulationRuns.id,
			startedAt: simulationRuns.startedAt,
			maxDurationSeconds: simulationRuns.maxDurationSeconds,
		})
		.from(simulationRuns)
		.where(eq(simulationRuns.status, "running"));
	const toStop = staleRows.filter(
		(row) =>
			row.startedAt.getTime() + row.maxDurationSeconds * 1000 + GRACE_MS <
				now &&
			// plan-review F1: never sweep a row this process's own registry
			// still tracks as active — only rows with NO live registry entry
			// (true orphans — dead process or abandoned client tab) are
			// eligible, since a server-owned run's own finalization
			// (score/history computation) can legitimately run past the
			// grace window on a large population.
			!isServerRunActive(row.id),
	);
	for (const row of toStop) {
		await db
			.update(simulationRuns)
			.set({ status: "stopped", stoppedAt: new Date(), wasAutoStopped: true })
			.where(eq(simulationRuns.id, row.id));
	}
}

// Cached on globalThis, unconditional in every environment — this is a
// call-twice idempotency guard (dedup across repeated `register()`
// invocations), not the registry Map's dev-only HMR-survival caching, which
// solves a different problem and must not be copied here.
const globalForOrphanSweep = globalThis as unknown as {
	orphanSweepStarted?: boolean;
};

export function startOrphanSweep(): void {
	if (globalForOrphanSweep.orphanSweepStarted) {
		return;
	}
	globalForOrphanSweep.orphanSweepStarted = true;
	void sweepOrphanedRuns(); // also run once immediately at boot
	setInterval(() => {
		void sweepOrphanedRuns();
	}, SWEEP_INTERVAL_MS);
}
