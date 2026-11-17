# Evidence: language in the documents

**Documents read in full:** `context/foundation/prd.md` (all sections, lines 1-272),
`context/foundation/shape-notes.md` (all, lines 1-178), `context/foundation/capacity-limits.md` (all),
`context/foundation/lessons.md` (all), `README.md` (all), AGENTS.md / CLAUDE.md (supplied in full
via system context — read as business-flow-describing reference per this skill's carve-out).

**Read partially (headings + relevant sections):** `context/foundation/roadmap.md` — read lines
1-383 of 856 (frontmatter, Milestone, Vision recap, North star, full "At a glance" table rows
F-01..S-38, Streams table, Baseline, Foundations F-01..F-08, Slices S-01..S-12 in detail). Did not
read lines 384-856 (Slices S-13 onward, full text) — truncated by context budget; the "At a glance"
table already captured every slice's outcome/PRD-refs/status at summary grain, so coverage of
slice vocabulary is near-complete even though full slice prose for S-13+ was not read.
`context/foundation/test-plan.md` — read lines 1-150 of a longer file: §1 Strategy, §2 Risk Map (all
9 risks + Risk Response Guidance), start of §3 Phased Rollout (10 phases), start of §4 Stack. Did not
read §5 Quality Gates in full detail beyond the gate table, nor §6 Cookbook beyond its first
sub-section header.

**Narrative sample (archive):** 65 archived change-ids exist (`ls context/archive/`). Read in full:
`context/archive/2026-11-13-genetic-inheritance-crossbreeding/change.md` (short identity note only —
research.md/plan.md not opened due to context budget). Attempted
`2026-11-14-phase-quality-per-cycle-scoring/research.md` — path did not exist under that exact name
(exit code 2; likely a different filename or the file wasn't retained); not retried further. Titled
only (not read) the remaining 63 archive directories — their names alone were used as corroborating
evidence that certain terms (spatial-hash, corpus generation, admin elevation, live-parameter
adjustment, genetic-diversity-trend, area-aware-population-insight) are real shipped vocabulary, cited
below as "change-id title" evidence, kind: *thesis-adjacent / weak* since no body text was read.

**Documents skipped:** `context/foundation/infrastructure.md`, `tech-stack.md`, `stack-assessment.md`,
`test-stack.md`, `health-check.md` — per brief, engineering-adjacent, skipped (no business vocabulary
expected); not opened. `context/changes/sim-engine-feature-analysis/` (active change) — not opened,
no time budget. 62 of 65 archive research.md/plan.md bodies — not opened (titles used as index only).

---

## 1. Terms

| Term (as written) | Variants | Kind | Definition (quoted) | Source |
|---|---|---|---|---|
| boid | boids (pl.); "Boidy" (PL) | entity | "boids + predator-prey dynamics" framing throughout; "Każdy boid ma własny, indywidualny zestaw genów" | prd.md:23, prd.md:120 |
| predator | predators (pl.); "predatory" (PL pl.) | entity | "predators hunt boid flocks"; genotyped lifespan like boids | roadmap.md:256-258 (S-02 outcome); prd.md:124 |
| flock | flocks; "stado"/"stada" (PL) | entity/value | "stado definiuje jedynie wartości średnie podane jako parametr wejściowy, od których startują osobniki" — a flock is a starting-average, not a rigid label | prd.md:120 |
| flockId | flock identity (per-boid field) | value | per-boid field "set once at birth ... and never re-derived per tick" (roadmap note on why `flockCount` can't be live-adjusted) | roadmap.md:132 |
| genes | "geny" (PL); BoidGenes / PredatorGenes (code-adjacent names appear in roadmap prose, not code itself) | value | "maks. prędkość, długość życia, wagi separacji/kohezji/wyrównania itd." — full set of individual traits, not just color | prd.md:120 |
| genetic diversity | "różnorodność genetyczna" (PL) | measure | one of the score factors; "final genetic-diversity value" shown in analysis view | prd.md:43, prd.md:227 |
| genetic-diversity trend / index | diversity-index trend; Shannon/Simpson-style diversity index (adapted) | measure | roadmap S-32 outcome: "sees ... how genetic diversity changed over the course of the run — not just the final value"; S-11 risk note: "diversity-index-style summary ... adapted from species-diversity to gene-value diversity" | roadmap.md:85 (S-32), roadmap.md:376 |
| crossbreeding | inter-flock crossbreeding; "krzyżowanie międzystadowe" (PL) | operation/policy | "Krzyżowanie między stadami jest możliwe, gdy włączone jest odpowiednim parametrem symulacji; kolor ... potomka ... jest blendem genów obu rodziców" | prd.md:122 |
| blend (color/gene blend) | blended-flock color | operation | "Potomek dziedziczy geny po obu rodzicach, łącznie z kolorem będącym blendem kolorów rodziców" | prd.md:120 |
| reproduction | rozmnażanie (PL) | operation | "Boidy i predatory rozmnażają się, gdy dostępne jest wystarczające jedzenie, do granicy maksymalnej liczby symulowanych obiektów" | prd.md:118 |
| death / die | umiera (PL) | event | "Boid lub predator umiera, gdy przekroczy swoją (zgenotypowaną) długość życia; brak dostępu do jedzenia przyspiesza śmierć" | prd.md:124 |
| hunger / starvation | głód (PL) | operation/policy | "głód skraca efektywną długość życia / zwiększa tempo jej wyczerpywania ... jeden mechanizm starzenia/wyczerpania, modyfikowany przez dostęp do jedzenia, nie dwa równoległe warunki śmierci" | prd.md:124-125 |
| protection threshold | flock protection threshold; próg ochronny (PL) | policy | "Predator nie może zaatakować stada, którego liczebność jest równa lub mniejsza od konfigurowalnego progu ochronnego" | prd.md:126 |
| object-count cap / limit | maksymalna liczba symulowanych obiektów; global maximum object count (FR-018) | policy/measure | "Admin konfiguruje globalny maksymalny limit liczby symulowanych obiektów (boidy + predatory), chroniąc płynność renderowania (guardrail)" | prd.md:161 |
| maxConcurrentObjectCount | aggregate-across-runs ceiling | measure/policy | "caps the *sum* of `boidCount + predatorCount` across every one of a user's currently-ticking server-owned runs at once" default 150 | capacity-limits.md:35 |
| score | punktacja (PL); run score | measure | "System oblicza punktację przebiegu symulacji jako iloczyn pięciu czynników" | prd.md:131 |
| score factor | czynnik punktacji (PL) | measure | five factors: cycle length (survival) × resource management × genetic diversity × phase quality × density-vs-area | prd.md:131,136, prd.md:227 |
| phase quality | jakość etapu cyklu życiowego (PL) | measure | fourth score factor; "nagradza zarówno osiąganie i utrzymywanie zdrowych etapów ... jak i odbudowę po załamaniu (odporność)" | prd.md:134-135 |
| density-vs-area factor | gęstość populacji względem obszaru (PL); area-aware population insight | measure | fifth score factor (FR-035, roadmap S-25): "uśredniony w czasie stosunek łącznej populacji ... w każdym ticku do gęstości startowej ... odniesiony do pełnej skonfigurowanej objętości 3D" | prd.md:136 |
| population lifecycle phase | etap cyklu życiowego (PL) | state (5-valued) | five named states, see Lifecycles below | prd.md:229-236 |
| resilience | odporność (PL); "resilience bonus" | measure/policy | bonus "specifically for completing a Crash → Recovery transition"; scales with "number of completed crash→recovery cycles" | prd.md:239; roadmap.md:343 (S-09 outcome) |
| run / simulation run | przebieg (symulacji) (PL) | entity (has lifecycle) | "a logged-in user can start a boids+predator simulation ... stop/save it, resume it later, and receive a score" | prd.md:40 |
| server-owned run / server run | real (non-staging) simulation; "serwerowa" (PL) | entity/role | "A real (non-staging) simulation executes on the server, independent of any client connection ... keeps running if the browser tab closes" | prd.md:41 |
| client-staged run / staging simulation | staging; client-side staging simulation | entity/role | "A single client-side simulation remains available for parameter-tuning staging, started and rendered entirely on the client, unchanged from the original MVP behavior" | prd.md:44 |
| watch / live view | server-pushed state; live view | operation | "the user can view exactly one server-run simulation at a time, rendered live from server-pushed state" | prd.md:41 |
| save / pause | zapisać (PL) | operation | "Użytkownik może zatrzymać symulację w dowolnym momencie i zapisać jej stan" | prd.md:141 |
| resume | wznowić (PL) | operation | "Użytkownik może wznowić zapisaną symulację" | prd.md:143 |
| dashboard | run dashboard | entity (view) | "a dashboard listing their own simulation runs (running, saved, completed) with standard run-dashboard conventions (status, start time, filters, a detail link)" | prd.md:42 |
| analysis view | run analysis | entity (view) | "the user opens an analysis view — population-over-time chart, phase/cycle breakdown, final genetic-diversity value" | prd.md:43 |
| leaderboard | — | entity (view) | "The user sees a leaderboard of their own highest-scoring runs" | prd.md:51 |
| parameter-suggestion heuristic | cross-run suggestion | operation/policy | "for each of 13 configurable parameters ... the system counts correlation between the parameter value and the final score; suggests changing the single one whose correlation is strongest" (paraphrase of FR-015 Socratic note) | prd.md:153 |
| run-specific optimization suggestion | post-run suggestion | operation | "a second, run-specific optimization suggestion ... derived from that single run's own phase/resource history" | prd.md:191 |
| export | eksportować (PL) | operation | "Użytkownik może wyeksportować przebieg/parametry/wynik symulacji poza aplikację, w formacie JSON ... oraz CSV" | prd.md:156 |
| role | rola (PL) | role (2-valued) | "`admin` i `member`" | prd.md:247 |
| admin | — | role | "defines the available parameter ranges and default values for simulations, plus the global maximum object count" | prd.md:249 |
| member | — | role | "configures and runs individual simulations within the ranges the admin has set" | prd.md:249 |
| temporary admin elevation | self-service toggle; time-boxed grant | operation/policy | "A user can temporarily elevate their own account ... to the `admin` role ... then the elevation is reversible (not a permanent role change)" | prd.md:202 |
| spatial partitioning / spatial-hash grid | grid-based neighbor search; "Siatka Haszu Przestrzennego" (external prior-art doc, PL) | policy (performance) | "uses spatial partitioning — a grid-based neighbor search — instead of a full pairwise scan ... reducing complexity from O(N²) to O(N) per tick" | prd.md:197 |
| area / xyArea / zDepth | simulation area; configurable area | value | "pełnej skonfigurowanej objętości 3D przebiegu (`xyArea * xyArea * zDepth`)" | prd.md:136 |
| camera (view) | camera-limited view | value/operation | "sees a camera-limited view into it, not the whole area at once" | roadmap.md:77 (S-24 outcome) |
| corpus | parameter-sweep corpus | entity (fixture) | "~20-run structured-parameter-sweep corpus (up to 4 runs ticking in parallel, each capped at 60 simulated minutes)" | roadmap.md:87 (S-33) |
| in-app feedback | — | entity/operation | "User reports a new functionality idea or a bug from within the app, persisted for future roadmap consideration" | roadmap.md:79 (S-26) |
| live parameter adjustment | live-tuning | operation | "the user can nudge flocking weights, food regen, and the protection threshold while a run is actively ticking, and watch the live view respond on the very next tick" | roadmap.md:35 |
| unwatched run / tick throttling | viewer-aware tick scheduling | policy (proposed) | "making unwatched (background) server-owned runs tick faster than real time, so they don't compete for CPU against the one run a user is actively watching" | capacity-limits.md:40 |
| guardrail | — | policy | recurring label for product-wide invariants, e.g. "chroniąc płynność renderowania (guardrail)" | prd.md:114, prd.md:161 |
| determinism / deterministic scoring | — | policy | "Scoring is deterministic/repeatable: the same parameters + seed produce the same score" | prd.md:60 |
| north star (roadmap term) | — | thesis | "the smallest end-to-end slice whose successful delivery proves the core product hypothesis" | roadmap.md:41 |
| vision / wedge | product wedge | thesis | "the one trait that, if removed, makes this just another flocking demo ... every run ends in a deterministic, repeatable score" | roadmap.md:35 |

## 2. Lifecycles

### Population lifecycle phases (entity: the boid population's aggregate state)

Quoted, prd.md:229-236 — classified "tick-by-tick," signal-based (population trend + food-availability ratio), using "the boom-bust/irruptive-growth model from population ecology":

1. **Establishment** — "early ticks, population still small, no clear trend yet."
2. **Growth** — "population rising, food availability high, reproduction outpacing deaths."
3. **Overshoot** — "population elevated while food availability is dropping — the lag between resource depletion and the death-rate response catching up."
4. **Crash** — "population declining sharply alongside low food availability (starvation and/or predation driving the die-off)."
5. **Recovery** — "population stabilizing or growing again after a Crash, as food availability recovers."

Transition driver: "combines the population's recent trend (rising/falling over a short rolling window) with the food-availability ratio (current food stock relative to the configured initial stock)" (prd.md:237). The document names a resilience-relevant transition explicitly — **Crash → Recovery** — and rewards it as a distinct, countable event ("premia skaluje się z liczbą zakończonych cykli", prd.md:178). No document states the reverse transition conditions in full detail (e.g. exact threshold from Growth → Overshoot) beyond "trend + food ratio" — missing: precise numeric thresholds (explicitly deferred to `/10x-plan`, prd.md:239).

### Simulation-run lifecycle (entity: a run)

Assembled from FR-003/011/012/020 and roadmap S-01/S-04/S-06/S-07:
- **start** (FR-003: "Użytkownik może uruchomić nową symulację z ustawionymi parametrami")
- **running / watched** — "watches it run in real time" (prd.md:68); server-run variant adds **watch** as a separate concern (exactly one viewer at a time, FR-023)
- **stop/save** (FR-011: "Użytkownik może zatrzymać symulację w dowolnym momencie i zapisać jej stan") — who: the user; precondition: none stated beyond being the owner (US-03 acceptance: "A user cannot open another user's run analysis view")
- **resume** (FR-012) — precondition: a prior save exists; must "reproduce the exact population/resource state at the moment of stop" (US-01 acceptance criterion, prd.md:74)
- **end/complete** — "until the run ends ... they see a score" (prd.md:68), either "automatically or by user stop" (prd.md:40)
- Post-completion: **analysis** (open the analysis view, FR-025), **export** (FR-017), **compare** (FR-016), appears on **leaderboard** (FR-026)

Missing/partial: no document states what happens to a run's live-view subscription when the owning user navigates away mid-run versus explicitly switching (FR-014 implies switching without stopping, but the exact state machine for "watching" as a sub-state is not spelled out beyond "exactly one viewer at a time").

### Role elevation lifecycle (entity: a user account's role)

member (default) → **elevated** (temporary, FR-030/prd.md:202) → **reverted**. "the elevation is reversible (not a permanent role change)." Exact trigger/expiry mechanism explicitly left unresolved at PRD level ("Owner: user... mechanism is deferred to `/10x-plan`", prd.md:270) — roadmap (S-38, roadmap.md:92) later confirms as closed: "already uses the time-boxed, self-service mechanism decided during S-22's planning" — but the *documents sampled here* do not show the mechanism's own definition text (S-22/S-38 plan/change bodies not read); flagged as **unknown in this evidence set**, confirmed-elsewhere per roadmap summary only.

## 3. Rules

| Rule (quoted) | Binds terms | Scope | Source |
|---|---|---|---|
| "a run with crossbreeding disabled must never produce a blended-flock-color offspring" | crossbreeding, blend, offspring | entity (per-run) | prd.md:72 (US-01 acceptance); echoed shape-notes.md:161 |
| "A flock at or below the protection threshold is never attacked by a predator during the run" | flock, protection threshold, predator | entity (per-flock) | prd.md:73 |
| "Stopping the simulation mid-run and resuming it later reproduces the exact population/resource state at the moment of stop" | run, save, resume | entity (per-run) | prd.md:74 |
| "Closing the browser tab mid-run does not stop or affect the server-owned simulation" | server-owned run | entity | prd.md:84 |
| "Only one server-run simulation can be actively viewed at a time" | watch, server-owned run | product-wide (policy) | prd.md:86 |
| "The dashboard shows only the logged-in user's own runs" | dashboard, run, user | product-wide (policy — access control) | prd.md:96 |
| "A user cannot open another user's run analysis view" | analysis view, run, user | product-wide (policy) | prd.md:98 |
| "Rozmnażanie respektuje globalny limit obiektów (FR-018); powyżej limitu rozmnażanie wstrzymane." (reproduction respects the global object limit; above the limit, reproduction is paused) | reproduction, object-count cap | product-wide (policy) | prd.md:119 |
| "Predator nie może zaatakować stada, którego liczebność jest równa lub mniejsza od konfigurowalnego progu ochronnego" | predator, flock, protection threshold | entity (per-flock) | prd.md:126 |
| "Boid lub predator umiera, gdy przekroczy swoją (zgenotypowaną) długość życia" | boid/predator, death, genes | entity | prd.md:124 |
| "nie przeliczamy wstecznie już ocenionych przebiegów (forward-only ...)" (we do not retroactively recompute already-scored runs) | run, score | product-wide (policy, forward-only versioning) | prd.md:133; echoed prd.md:268 (Open Question #4) |
| "Two runs started with identical parameters and the same random seed produce identical scores" | run, score, seed | product-wide (NFR/policy) | prd.md:219 |
| "A saved/paused simulation's state survives an app restart with no loss of population, genetic, or resource data" | run, save | entity | prd.md:220 |
| "FR-029 ... must produce identical scores/behavior to the pre-optimization pairwise scan for the same parameters and seed ... any deviation is a bug, not an accepted tradeoff" | spatial partitioning, score, determinism | product-wide (policy) | prd.md:222 |
| "FR-032's UI modernization must not regress this project's existing design-token discipline" | UI modernization | product-wide (policy, engineering-adjacent) | prd.md:223 |
| "No shared/collaborative simulations across users — `admin`/`member` are access roles, not co-editing roles; a simulation run belongs to the user who started it" | run, role, user | product-wide (Non-Goal / policy) | prd.md:257 |
| "admin`/`member` purely about parameter governance" status — "every FR added since stays within per-user data isolation" | role, access control | product-wide (policy) | prd.md:267 |
| (lessons.md, engineering-adjacent but domain-flavored) "a value that's successfully written but never read at decision time is a defect the write-path alone can't surface" — re: live-adjustment features where 3 of 5 "live" fields were actually per-boid genetic traits fixed at birth, never read from live params | genes, live parameter adjustment | product-wide (process rule, not a product invariant) | lessons.md:65 |
| "Flock 0 reused the existing BOID_FILL_COLOR ... flocks 1..N-1 were spread evenly starting from a fixed 0°" caused near-collision — rule: anchor color spread at the fixed color's actual position | flock, color | entity-adjacent (engineering, color-generation) | lessons.md:30 |

## 4. Multiple meanings

- **"parallel"** has two senses across time: (a) pre-2026-11-14 PRD/shape-notes meaning — client-driven parallel *rendering* of several simulations at once (shape-notes.md:59, "run several simulations in parallel and switch ... without losing the others' progress"); (b) post-extension meaning — several independent **server-owned** runs ticking concurrently, with the client watching only one (prd.md:146, FR-013 Socratic note: "'równoległość' to teraz kilka serwerowych przebiegów działających niezależnie od renderowania; klient obserwuje jeden naraz"). Both citations given; (b) is explicitly the newer, superseding statement (prd.md:41 Non-Goals: "No client-driven parallel rendering of multiple simulations at once ... retired in favor of server-owned execution").
- **"score" / scoring formula** has three stated versions over time: shape-notes.md (3-factor: survival × resource management × genetic diversity, shape-notes.md:79, weights TBD) → PRD v-early (4-factor, adding phase quality, FR-010/FR-019, prd.md:131-135) → PRD v5/roadmap S-25 (5-factor, adding density-vs-area, FR-035, prd.md:136). The PRD itself flags the versioning as a **conflicting-statement risk already handled**, not latent: "przebiegi ocenione przed i po tej zmianie mogą nie być bezpośrednio porównywalne ... forward-only" (prd.md:133) — i.e. old-scored runs and new-scored runs use genuinely different formulas and the product explicitly does not reconcile them.
- **"admin"** has a narrow, explicitly-bounded meaning in this PRD: only "parameter ranges, default values, and the global object-count cap" (prd.md:109, 161) plus later "the number of tribes/flocks" (prd.md:202) — the document is explicit that broader admin capability (managing other users' runs) was *considered and never added*: "no cross-user admin capability was added" (prd.md:267). Not a conflict, but worth flagging: "admin" here never means "superuser over other users' data," only "sets global/shared configuration ceilings."

## 5. Conflicting statements

- **Scoring formula factor count**: shape-notes.md:79/123 (3 factors, weights fully open) is the **older** statement; prd.md:131 (5 factors, FR-010 + FR-019 + FR-035, resolved 2026-11-14 and 2026-11-15) is the **newer**, authoritative one. The PRD itself documents the resolution history inline (Socratic notes at prd.md:132-137), so this is a tracked evolution, not an unnoticed contradiction.
- **FR-013/FR-014 meaning** (see Multiple meanings above) — shape-notes.md's original "client-driven parallel rendering" (older) was formally retired in prd.md's Non-Goals (newer) in favor of server-owned concurrent execution with single-viewer rendering.
- No other direct term-redefinition conflicts were found in the documents read; the PRD's own versioning discipline (dated Socratic notes, explicit "Resolved" markers, forward-only scoring policy) means most would-be conflicts are already self-resolved in-document rather than left as live contradictions.

## Unknowns

- Exact per-phase quality numeric weights and the resilience-bonus magnitude — explicitly deferred to `/10x-plan` (prd.md:135, 178, 239), not a product-level unknown but genuinely absent from any document read.
- Exact temporary-admin-elevation mechanism's own defining text — roadmap (S-22/S-38) asserts it's resolved and documents the *outcome* ("time-boxed, self-service"), but the mechanism's defining document (likely `archive/2026-11-14-temporary-admin-elevation/plan.md` or `archive/2026-11-17-confirm-admin-elevation-mechanism-resolved/*`) was not opened in this pass — scope searched: PRD, shape-notes, roadmap summary table/Baseline text only.
- Fine-grained role behavior beyond parameter/object-count governance (e.g., can admin view/manage other users' runs) — PRD states this "remains unspecified but is no longer blocking" (prd.md:267) — genuinely open per the documents read, not just unread by this agent.
- Whether "tribe" and "flock" are the same concept or different — FR-030/prd.md:202 says "the number of tribes/flocks (`flockCount`'s configurable range)" treating them as synonyms in a parenthetical; no document defines "tribe" independently — flagged as a possible loose/interchangeable-term usage, not a confirmed second meaning.
- S-13 through S-38's full slice prose (roadmap.md lines 384-856) — not read in this pass (budget-truncated); only the summary table row content for those slices was captured. A future pass should read that range directly if finer per-slice vocabulary (e.g. exact wording for S-13 parameter-suggestion-heuristic, S-24 configurable-area) is needed beyond what's already captured from PRD.
- 62 of 65 archive change-id bodies (research.md/plan.md) were not opened — only directory names used as a weak corroborating signal for which capabilities shipped. A genetics/scoring-focused follow-up read of `genetic-inheritance-crossbreeding/plan.md`, `phase-quality-per-cycle-scoring/{change,plan}.md`, and `area-aware-population-insight/{change,research,plan}.md` would likely surface more precise domain wording (the attempted `phase-quality-per-cycle-scoring/research.md` read failed with exit code 2 — file may not exist under that name; not re-investigated).

---

Commands run: `ls context/archive/`; `sed -n '1,100p' context/archive/2026-11-13-genetic-inheritance-crossbreeding/change.md`; `sed -n '1,150p' context/archive/2026-11-14-phase-quality-per-cycle-scoring/research.md` (exit 2, file not found under that path).
