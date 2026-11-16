---
change_id: analytics-correctness-corpus-tests
title: Analytics-correctness tests against the parameter-sweep corpus
status: archived
created: 2026-11-16
updated: 2026-11-16
archived_at: 2026-11-16T16:16:39Z
---

## Notes

Roadmap S-35: automated tests confirming every per-run analytics function
handles the real, persisted 20-run parameter-sweep corpus's full range of
parameter combinations without error. Independent of S-34
(suggestion-quality-corpus-test, already archived) — both consume S-33's
exported corpus but touch unrelated code paths; this is the last item
needed to close milestone M-8 (parameter-suggestion-analytics-corpus).
The shared loader `loadCorpusFixture()` (src/server/simulation/corpus-fixture.ts,
built during S-34) is available to reuse.
