import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { buildRunExport } from "~/server/simulation/run-export";

// run-export Phase 1: authenticated download route. Gates exactly like
// `getRunAnalysis` (simulation.ts:500-552) — 400 if not found, 403 if not
// owned, 400 if not `status: "stopped"` — then delegates the actual
// formatting to the plain, unit-testable `buildRunExport`.
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ runId: string }> },
) {
	const { runId: runIdParam } = await params;
	const runId = Number(runIdParam);
	if (!Number.isInteger(runId)) {
		return new Response("Invalid runId", { status: 400 });
	}

	const formatParam = request.nextUrl.searchParams.get("format");
	const format = formatParam === "csv" ? "csv" : "json";

	const session = await auth();
	if (!session?.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const run = await db.query.simulationRuns.findFirst({
		where: (t, { eq }) => eq(t.id, runId),
	});

	if (!run) {
		return new Response("Not found", { status: 400 });
	}
	if (run.userId !== session.user.id) {
		return new Response("Forbidden", { status: 403 });
	}
	if (run.status !== "stopped") {
		return new Response("Run is not completed", { status: 400 });
	}

	const { body, contentType, filename } = buildRunExport(run, format);

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": contentType,
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	});
}
