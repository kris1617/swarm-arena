import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// admin-ranges-and-hook-test-flakes (Phase 2): held for the full lifetime of
// any top-level `vitest` invocation (manual `npm test`, or
// .claude/hooks/end-of-turn.sh's own nested run) so a concurrently-starting
// vitest process elsewhere can detect it and skip racing against this one.
// Path matches end-of-turn.sh's existing REGISTRY convention
// (`${TMPDIR:-/tmp}/claude-hooks/...`).
//
// Vitest 5.1.0 has no separate `globalTeardown` config key — a single
// `globalSetup` file is expected to export `setup`/`teardown` (or a
// `default`), see vitest's loadGlobalSetupFile.
const LOCK_PATH = `${process.env.TMPDIR ?? "/tmp"}/claude-hooks/vitest.lock`;

export function setup() {
	mkdirSync(dirname(LOCK_PATH), { recursive: true });
	writeFileSync(LOCK_PATH, String(process.pid));
}

export function teardown() {
	// Unconditional: must run even after a failed test run, so a live-PID
	// lock is never left behind after a clean exit (stale locks past this
	// are only possible from a hard crash, which the hook's own kill -0
	// liveness check already treats as absent).
	try {
		unlinkSync(LOCK_PATH);
	} catch {
		// Already gone — nothing to clean up.
	}
}
