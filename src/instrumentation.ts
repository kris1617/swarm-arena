import type { Instrumentation } from "next";

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
