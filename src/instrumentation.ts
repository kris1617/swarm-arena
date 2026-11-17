import type { Instrumentation } from "next";

/**
 * Starts the in-app-feedback-module's background retry worker, and
 * fix-default-start-failure's orphan-reconciliation sweep, once when the
 * server process starts (Next 16's stable "run once at boot" hook — no
 * feature flag needed). The dynamic import is deliberate: Next calls
 * `register()` once per runtime it starts, including edge, where
 * `~/server/db`'s real DB client would fail to initialize — importing it
 * only inside this function body keeps that server-only code out of any
 * edge-runtime module graph that merely imports this file.
 */
export async function register() {
	const { startFeedbackRetryWorker } = await import(
		"~/server/feedback/retry-worker"
	);
	startFeedbackRetryWorker();
	const { startOrphanSweep } = await import("~/server/simulation/orphan-sweep");
	startOrphanSweep();
}

/**
 * Catches RSC/Route Handler/middleware errors outside the tRPC path (see
 * src/server/api/trpc.ts's logTRPCError for that path — tRPC's
 * fetchRequestHandler always converts a thrown error into a Response
 * itself, so it never reaches this hook). Gives every such error a
 * structured, correlatable log line instead of relying only on Next's
 * unrelated default stdout logging.
 */
export const onRequestError: Instrumentation.onRequestError = async (
	error,
	request,
	context,
) => {
	console.error("[instrumentation]", {
		path: request.path,
		routePath: context.routePath,
		routeType: context.routeType,
		error,
	});
};
