import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// A PATH that has everything the script needs except jq, for the "missing tool"
// case. Filtering PATH by directory doesn't work here (jq and bash both live in
// /usr/bin on this host), so build a decoy bin/ with symlinks to everything but jq.
function pathWithoutJq(): string {
	const decoyBin = mkdtempSync(join(tmpdir(), "agent-hooks-no-jq-bin-"));
	for (const bin of [
		"bash",
		"sh",
		"env",
		"git",
		"cat",
		"printf",
		"mkdir",
		"sort",
		"tr",
		"dirname",
		"basename",
		"node",
		"npx",
		"npm",
		"corepack",
	]) {
		const real = execFileSync("which", [bin], { encoding: "utf8" }).trim();
		symlinkSync(real, join(decoyBin, bin));
	}
	return decoyBin;
}

// Proof for .claude/hooks/lint-edited-file.sh and .claude/hooks/end-of-turn.sh
// (configured via .claude/settings.json, PostToolUse(Write|Edit) and Stop).
// Each case pipes a real payload into the real scripts and asserts exit code
// + output channel, against a throwaway git repo — never against files in
// this developer's tree. See context/foundation/test-plan.md "Quality Gates"
// (post-edit hook) and CLAUDE.md "Module 3, Lesson 3" for the contract.

const REPO_ROOT = join(__dirname, "..", "..");
const LINT_SCRIPT = join(REPO_ROOT, ".claude/hooks/lint-edited-file.sh");
const EOT_SCRIPT = join(REPO_ROOT, ".claude/hooks/end-of-turn.sh");

type Run = { status: number; stdout: string; stderr: string };

function run(script: string, payload: string, opts?: { cwd?: string }): Run {
	try {
		const stdout = execFileSync(script, [], {
			input: payload,
			cwd: opts?.cwd ?? REPO_ROOT,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { status: 0, stdout, stderr: "" };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return {
			status: e.status ?? 1,
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
		};
	}
}

let fixture: string;

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), "agent-hooks-fixture-"));
	execFileSync("git", ["init", "-q"], { cwd: fixture });
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: fixture,
	});
	execFileSync("git", ["config", "user.name", "test"], { cwd: fixture });
	// Minimal config that still flags lint/suspicious/noDebugger as an error
	// (confirmed against this repo's own Biome install, which the fixture
	// borrows via a node_modules symlink rather than a slow fresh install).
	writeFileSync(
		join(fixture, "biome.jsonc"),
		'{"linter":{"enabled":true,"rules":{"preset":"recommended"}}}',
	);
	writeFileSync(
		join(fixture, "package.json"),
		'{"name":"fixture","private":true}',
	);
	// tsc refuses to run at all (prints its own help, nonzero exit) with no
	// tsconfig.json in cwd — this real repo always has one; the fixture needs
	// its own minimal one for the typecheck step of end-of-turn.sh to run.
	writeFileSync(
		join(fixture, "tsconfig.json"),
		'{"compilerOptions":{"strict":false,"skipLibCheck":true}}',
	);
	symlinkSync(join(REPO_ROOT, "node_modules"), join(fixture, "node_modules"));
	writeFileSync(join(fixture, "clean.ts"), "export const x = 1;\n");
	writeFileSync(join(fixture, "README.md"), "# fixture\n");
	execFileSync("git", ["add", "-A"], { cwd: fixture });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: fixture });
});

afterEach(() => {
	rmSync(fixture, { recursive: true, force: true });
});

function editPayload(file: string, cwd = fixture) {
	return JSON.stringify({
		tool_name: "Edit",
		cwd,
		tool_input: { file_path: file },
	});
}

describe("lint-edited-file.sh (per-edit, PostToolUse Write|Edit)", () => {
	it("blocks (exit 2) on a file with a real Biome error, naming the file and problem", () => {
		const file = join(fixture, "broken.ts");
		writeFileSync(file, "function f() {\n\tdebugger;\n\treturn 1;\n}\n");
		const result = run(LINT_SCRIPT, editPayload(file));
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("broken.ts");
		expect(result.stderr).toContain("noDebugger");
	});

	it("passes (exit 0) on a clean file", () => {
		const result = run(LINT_SCRIPT, editPayload(join(fixture, "clean.ts")));
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
	});

	it("passes on a file type Biome does not cover here (README.md)", () => {
		const result = run(LINT_SCRIPT, editPayload(join(fixture, "README.md")));
		expect(result.status).toBe(0);
	});

	it("passes on a nonexistent file path", () => {
		const result = run(LINT_SCRIPT, editPayload(join(fixture, "nope.ts")));
		expect(result.status).toBe(0);
	});

	it("passes on an empty payload ({})", () => {
		const result = run(LINT_SCRIPT, "{}");
		expect(result.status).toBe(0);
	});

	it("passes on an unparseable payload", () => {
		const result = run(LINT_SCRIPT, "not json");
		expect(result.status).toBe(0);
	});

	it("skips a file whose own checkout differs from the session's (other repo)", () => {
		const otherRepo = mkdtempSync(join(tmpdir(), "agent-hooks-other-repo-"));
		try {
			execFileSync("git", ["init", "-q"], { cwd: otherRepo });
			const otherFile = join(otherRepo, "broken.ts");
			writeFileSync(otherFile, "function f() {\n\tdebugger;\n\treturn 1;\n}\n");
			// Session cwd is the fixture repo; the edited file belongs to a
			// different repo entirely — the checkout guard must skip it.
			const result = run(LINT_SCRIPT, editPayload(otherFile, fixture));
			expect(result.status).toBe(0);
		} finally {
			rmSync(otherRepo, { recursive: true, force: true });
		}
	});

	it("does not silently pass when a required tool is missing (no jq on PATH)", () => {
		const file = join(fixture, "clean.ts");
		const decoyBin = pathWithoutJq();
		try {
			let status = 0;
			try {
				execFileSync(LINT_SCRIPT, [], {
					input: editPayload(file),
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: { ...process.env, PATH: decoyBin },
				});
			} catch (err) {
				status = (err as { status?: number }).status ?? 1;
			}
			expect(status).toBe(2);
		} finally {
			rmSync(decoyBin, { recursive: true, force: true });
		}
	});
});

describe("end-of-turn.sh (Stop)", () => {
	it("passes (exit 0) when nothing changed since HEAD", () => {
		const result = run(
			EOT_SCRIPT,
			JSON.stringify({ cwd: fixture, stop_hook_active: false }),
		);
		expect(result.status).toBe(0);
	});

	it("blocks (exit 2) on a lint error written directly to disk — no per-edit payload involved", () => {
		writeFileSync(
			join(fixture, "broken.ts"),
			"function f() {\n\tdebugger;\n\treturn 1;\n}\n",
		);
		const result = run(
			EOT_SCRIPT,
			JSON.stringify({ cwd: fixture, stop_hook_active: false }),
		);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("broken.ts");
	}, 15_000);

	it("passes (exit 0) even while the error is present, when stop_hook_active is true (retry guard)", () => {
		writeFileSync(
			join(fixture, "broken.ts"),
			"function f() {\n\tdebugger;\n\treturn 1;\n}\n",
		);
		const result = run(
			EOT_SCRIPT,
			JSON.stringify({ cwd: fixture, stop_hook_active: true }),
		);
		expect(result.status).toBe(0);
	});

	it("passes (exit 0) on an untracked new clean file", () => {
		writeFileSync(join(fixture, "new-clean.ts"), "export const y = 2;\n");
		const result = run(
			EOT_SCRIPT,
			JSON.stringify({ cwd: fixture, stop_hook_active: false }),
		);
		expect(result.status).toBe(0);
	});

	it("reports 'nothing checked' instead of silently succeeding when cwd has no git checkout", () => {
		const bare = mkdtempSync(join(tmpdir(), "agent-hooks-no-git-"));
		try {
			const result = run(
				EOT_SCRIPT,
				JSON.stringify({ cwd: bare, stop_hook_active: false }),
			);
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("nothing checked");
		} finally {
			rmSync(bare, { recursive: true, force: true });
		}
	});
});
