---
change_id: suggestion-quality-corpus-test
title: Suggestion-quality test against the parameter-sweep corpus
status: implementing
created: 2026-11-16
updated: 2026-11-16
archived_at: null
---

## Notes

Roadmap S-34: an automated test asserting the parameter-suggestion heuristic
produces a sensible, correlated suggestion against the persisted corpus
(now available at `context/archive/2026-11-15-parameter-sweep-corpus-generation/`'s
output, `context/fixtures/parameter-sweep-corpus/`, 20 gzip-compressed
run records + `index.csv`). Independent of S-35 (analytics-correctness-
corpus-tests) — both consume S-33's exported corpus but touch unrelated
code paths and can proceed in parallel.
