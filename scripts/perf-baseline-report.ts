// Output-writing entry point for the wall-clock performance benchmark
// (rollout Phase 8, test-plan.md Risk #8 — see
// context/changes/testing-perf-baseline/{research,plan}.md).
//
// Deliberately a separate file from `scripts/perf-baseline.ts`: that file
// only constructs the grid and measures it (`runBenchmarkGrid`, no file
// I/O), per its own header comment's "Phase 2 wires the committed
// JSON/markdown output artifacts and the npm script around this function"
// — i.e. *around*, separately. This file is that wiring: it imports
// `runBenchmarkGrid`, runs the real 54-configuration default grid, and
// appends/updates the two committed output artifacts.
//
// Runner choice: this project's installed Node (v22.22.1, confirmed via
// `node --version` while implementing this phase) is not compiled with
// TypeScript support — `node --experimental-strip-types` on this exact
// binary throws `ERR_NO_TYPESCRIPT` ("Node.js is not compiled with
// TypeScript support"), confirmed by actually running it against this
// repo's code before deciding. Native stripping is therefore not a safe
// choice for whoever runs `npm run perf:baseline` next (their Node build
// may share this limitation). `tsx` is added as a devDependency instead —
// broadly compatible regardless of how the local Node binary was built —
// and the npm script invokes it directly.
//
// `gitCommit` uses the full SHA (`git rev-parse HEAD`), not the short form,
// for unambiguous cross-referencing against `git show <sha>` later.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type GridResult, runBenchmarkGrid } from "./perf-baseline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

export const JSON_RESULTS_PATH = join(
	REPO_ROOT,
	"context/foundation/perf-baseline.json",
);
export const MARKDOWN_SUMMARY_PATH = join(
	REPO_ROOT,
	"context/foundation/capacity-limits.md",
);

export interface BenchmarkRunEntry {
	date: string;
	gitCommit: string;
	nodeVersion: string;
	results: GridResult[];
}

function getGitCommit(): string {
	return execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	}).trim();
}

async function readExistingEntries(
	jsonPath: string,
): Promise<BenchmarkRunEntry[]> {
	try {
		const raw = await readFile(jsonPath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new Error(
				`${jsonPath} does not contain a JSON array at its top level`,
			);
		}
		return parsed as BenchmarkRunEntry[];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

// Appends one new entry — never overwrites or mutates prior entries — per
// this phase's "append-only, structured record" contract. Writes to a
// temp file and renames into place (atomic on the same filesystem on
// POSIX) rather than writing jsonPath directly, so a process killed
// mid-write can never leave perf-baseline.json truncated/corrupt. This
// narrows, but does not eliminate, the read-then-write window between two
// concurrent `npm run perf:baseline` invocations — this remains a manual,
// non-CI-gating dev tool per the plan's single-process-precondition
// discipline (see test-plan.md §6.8), not a tool that needs full locking.
export async function appendJsonResults(
	entry: BenchmarkRunEntry,
	jsonPath: string = JSON_RESULTS_PATH,
): Promise<void> {
	const existing = await readExistingEntries(jsonPath);
	existing.push(entry);
	await mkdir(dirname(jsonPath), { recursive: true });
	const tmpPath = `${jsonPath}.tmp-${process.pid}`;
	await writeFile(tmpPath, `${JSON.stringify(existing, null, "\t")}\n`);
	await rename(tmpPath, jsonPath);
}

const SECTION_HEADING = "## Reproducible Benchmark Results";

function formatMarkdownTable(results: GridResult[]): string {
	const header =
		"| Object count | Area | Concurrent runs | Mean tick-set time (ms) | Std dev (ms) | Samples |\n" +
		"|---|---|---|---|---|---|";
	const rows = results.map(
		(r) =>
			`| ${r.objectCount} | ${r.area} | ${r.concurrentRuns} | ${r.meanMs.toFixed(2)} | ${r.stdDevMs.toFixed(2)} | ${r.samples} |`,
	);
	return [header, ...rows].join("\n");
}

function buildSectionContent(entry: BenchmarkRunEntry): string {
	return (
		`${SECTION_HEADING}\n\n` +
		`Latest reproducible run (\`npm run perf:baseline\`, rollout Phase 8): ` +
		`**${entry.date}**, commit \`${entry.gitCommit}\`, Node \`${entry.nodeVersion}\`.\n\n` +
		`Each row measures ${entry.results[0]?.samples ?? 8} tinybench samples of ` +
		`\`computeSingleRunTick\` driven across a fixed tick budget, at the given ` +
		`object count / world area / single-process-interleaved concurrent-run count. ` +
		`See \`scripts/perf-baseline.ts\` for the exact grid and methodology.\n\n` +
		`${formatMarkdownTable(entry.results)}\n\n` +
		`Full historical data (every run, not just the latest) is in ` +
		`\`context/foundation/perf-baseline.json\`.\n`
	);
}

// Replaces this section if it already exists (so re-running always reflects
// only the *latest* run in the human-readable summary — full history lives
// in the JSON file), otherwise appends it as a new section at the end of
// the file.
export async function updateMarkdownSummary(
	entry: BenchmarkRunEntry,
	markdownPath: string = MARKDOWN_SUMMARY_PATH,
): Promise<void> {
	let existing = "";
	try {
		existing = await readFile(markdownPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	const sectionContent = buildSectionContent(entry);
	const headingIndex = existing.indexOf(SECTION_HEADING);

	let next: string;
	if (headingIndex === -1) {
		// Trim all trailing newlines before re-adding exactly one blank line,
		// so this always produces a single blank line regardless of how many
		// trailing newlines `existing` already has.
		const trimmed = existing.replace(/\n+$/, "");
		const separator = trimmed.length > 0 ? "\n\n" : "";
		next = `${trimmed}${separator}${sectionContent}`;
	} else {
		// Replace from this heading up to (but not including) the next `## `
		// heading, or end of file if this is the last section.
		const afterHeading = existing.slice(headingIndex + SECTION_HEADING.length);
		const nextHeadingOffset = afterHeading.indexOf("\n## ");
		const sectionEnd =
			nextHeadingOffset === -1
				? existing.length
				: headingIndex + SECTION_HEADING.length + nextHeadingOffset + 1;
		next = `${existing.slice(0, headingIndex)}${sectionContent}${existing.slice(sectionEnd)}`;
	}

	await mkdir(dirname(markdownPath), { recursive: true });
	await writeFile(markdownPath, next);
}

export async function runAndRecordBenchmark(
	jsonPath: string = JSON_RESULTS_PATH,
	markdownPath: string = MARKDOWN_SUMMARY_PATH,
): Promise<BenchmarkRunEntry> {
	const results = await runBenchmarkGrid();
	const entry: BenchmarkRunEntry = {
		date: new Date().toISOString(),
		gitCommit: getGitCommit(),
		nodeVersion: process.version,
		results,
	};
	await appendJsonResults(entry, jsonPath);
	await updateMarkdownSummary(entry, markdownPath);
	return entry;
}

const isMainModule = process.argv[1]
	? import.meta.url === new URL(process.argv[1], "file://").href
	: false;
if (isMainModule) {
	runAndRecordBenchmark()
		.then((entry) => {
			console.table(entry.results);
			console.log(
				`Wrote ${entry.results.length} rows to ${JSON_RESULTS_PATH} and updated ${MARKDOWN_SUMMARY_PATH}.`,
			);
		})
		.catch((error: unknown) => {
			console.error(error);
			process.exitCode = 1;
		});
}
