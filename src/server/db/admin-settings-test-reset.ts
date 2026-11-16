// Test-support helper shared by the default Vitest suite's 3 files that
// previously each ran their own `afterEach: await db.delete(adminSettings)`.
// Vitest runs test files concurrently as separate worker processes sharing
// one `db.sqlite`, so a delete in one file's `afterEach` created a window
// where the singleton `admin_settings` row was briefly absent while another
// file's `getOrSeedAdminSettingsRanges` (scripts/corpus/harness.ts) was
// mid check-then-insert against it — reproduced live as a race where the
// insert throws `SQLITE_CONSTRAINT_PRIMARYKEY`. Upserting back to known
// defaults instead of deleting removes the absence window entirely: the row
// can never not exist after this call.
import { adminSettings } from "~/server/db/schema";
import {
	DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
	DEFAULT_MAX_OBJECT_COUNT,
	DEFAULT_PARAMETER_RANGES,
} from "~/server/simulation/parameter-ranges";
import type { db as dbSingleton } from "./index";

export type DB = typeof dbSingleton;

// Singleton row id for `adminSettings` — matches the constant of the same
// name in `src/server/api/routers/simulation.ts` and
// `scripts/corpus/harness.ts`, this module's own deliberately-duplicated
// reference (neither file exports a constant this module could import
// instead).
const ADMIN_SETTINGS_ID = 1;

// Restores the `admin_settings` singleton row to its known defaults —
// insert-if-missing, update-if-present, same statement either way — instead
// of deleting it, so a concurrently-running test file can never observe the
// row as absent.
export async function resetAdminSettingsToDefaults(db: DB): Promise<void> {
	await db
		.insert(adminSettings)
		.values({
			id: ADMIN_SETTINGS_ID,
			parameterRanges: DEFAULT_PARAMETER_RANGES,
			maxObjectCount: DEFAULT_MAX_OBJECT_COUNT,
			maxConcurrentObjectCount: DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
		})
		.onConflictDoUpdate({
			target: adminSettings.id,
			set: {
				parameterRanges: DEFAULT_PARAMETER_RANGES,
				maxObjectCount: DEFAULT_MAX_OBJECT_COUNT,
				maxConcurrentObjectCount: DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
			},
		});
}
