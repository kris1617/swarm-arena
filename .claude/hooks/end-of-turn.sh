#!/usr/bin/env bash
# Stop: sweep everything this turn changed before the agent finishes, one retry.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook end-of-turn.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)

# Already sent back once by this hook: let it finish. The commit gate catches the rest.
# (loop_count covers Cursor, which imports this hook from .claude/settings.json.)
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
LOOPS=$(printf '%s' "$INPUT" | jq -r '.loop_count // 0' 2>/dev/null)
if [ "$ACTIVE" = "true" ] || [ "${LOOPS:-0}" != "0" ]; then
  exit 0
fi

# Checkouts to sweep: the session's (payload cwd follows EnterWorktree, $CLAUDE_PROJECT_DIR
# does not) plus every checkout lint-edited-file.sh registered for this session.
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
REGISTRY="${TMPDIR:-/tmp}/claude-hooks/${SID:-none}.roots"
ROOTS=()
while IFS= read -r r; do
  [ -n "$r" ] && [ -d "$r" ] && ROOTS+=("$r")
done <<EOF
$({ git -C "${CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null; [ -n "$SID" ] && cat "$REGISTRY" 2>/dev/null; } | sort -u)
EOF
if [ "${#ROOTS[@]}" -eq 0 ]; then
  # Not silent: the user sees why nothing was checked.
  jq -cn --arg m "end-of-turn.sh: no git checkout at ${CWD:-$PWD}, nothing checked." '{systemMessage: $m}'
  exit 0
fi

REPORT=""
NOTES=""
for ROOT in "${ROOTS[@]}"; do
  cd "$ROOT" || continue

  # Changed and new files. Nothing changed (a Q&A turn): nothing to check here.
  CHANGED=$({ git diff --name-only HEAD; git ls-files -o --exclude-standard; } 2>/dev/null | sort -u)
  [ -n "$CHANGED" ] || continue

  # Changed files Biome covers in this repo that still exist. This also catches files
  # rewritten through a shell command, which never reach the per-edit hook.
  FILES=()
  while IFS= read -r f; do
    case "$f" in *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css) [ -f "$f" ] && FILES+=("$f") ;; esac
  done <<EOF
$CHANGED
EOF

  if [ "${#FILES[@]}" -gt 0 ]; then
    # --no-errors-on-unmatched: a changed file Biome's own config excludes (biome.jsonc's
    # `!context`, `!.claude`, etc.) must report "nothing to check", not a false block.
    OUT=$(npx --no-install biome check --no-errors-on-unmatched "${FILES[@]}" 2>&1 </dev/null) || REPORT="$REPORT
Biome errors in changed files ($ROOT):
$OUT
"
  fi

  # vitest.global-setup.ts holds this lock for the full lifetime of any
  # top-level vitest invocation (manual `npm test`, or this hook's own
  # nested run below). A live PID here means some OTHER vitest process is
  # already running — this check runs strictly before the nested `npx
  # vitest run` below starts, so it can never see this invocation's own
  # not-yet-created lock. A dead PID is a stale lock from a crashed run
  # (no globalTeardown): treat it as absent and proceed.
  VITEST_LOCK="${TMPDIR:-/tmp}/claude-hooks/vitest.lock"
  LOCK_PID=""
  [ -f "$VITEST_LOCK" ] && LOCK_PID=$(cat "$VITEST_LOCK" 2>/dev/null)
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    NOTES="$NOTES
Tests skipped at $ROOT: another vitest process (pid $LOCK_PID) is already running.
"
  # Whole unit suite runs in ~14s here (12 files, 76 tests) — fast enough to run in full
  # at end of turn, which also catches a red test in a module this turn only imported.
  # --passWithNoTests: vitest exits 1 on zero test files found, which would otherwise
  # falsely block every turn in a checkout that has none.
  elif ! OUT=$(npx --no-install vitest run --passWithNoTests 2>&1 </dev/null); then
    REPORT="$REPORT
Test suite fails ($ROOT):
$OUT
"
  fi

  if ! OUT=$(npx --no-install tsc --noEmit --pretty false 2>&1 </dev/null); then
    REPORT="$REPORT
Typecheck fails ($ROOT):
$OUT
"
  fi
done

if [ -n "$REPORT" ]; then
  echo "Fix these before you finish:$REPORT" >&2
  exit 2
fi
# Green: the registered checkouts are clean, start the next turn with an empty registry.
[ -n "$SID" ] && : >"$REGISTRY" 2>/dev/null
# Informational only (skipped, not failed) — never affects the exit code.
[ -n "$NOTES" ] && jq -cn --arg m "$NOTES" '{systemMessage: $m}'
exit 0
