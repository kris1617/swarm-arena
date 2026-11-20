# Evidence: language in the documents

Read fully: `context/foundation/prd.md` (272 lines, complete). Read substantially: `context/foundation/roadmap.md` (lines 1-370 of 1138 — frontmatter, Milestone M-13, Vision recap, At-a-glance table S-01..S-53, Streams A-U, Baseline, Foundations F-01..F-10, Slices S-01..S-07; remainder of Slices S-08+ not read — truncated by size, titles/outcomes for all 53 slices were visible in the At-a-glance table). Read: `context/foundation/test-plan.md` §2 Risk Map + Risk Response Guidance (lines 32-69, full). Read fully: `context/foundation/lessons.md` (144 lines). Spot-checked archive plans: `2026-11-17-per-tribe-behavior-weights/plan.md` (Overview + Current State + Phase 1, ~85 lines) and `2026-11-18-predator-tribe-concept/plan.md` (Overview + Current State, ~85 lines) — both read in part, not full. Did not open `2026-11-13-genetic-inheritance-crossbreeding`, `2026-11-14-full-score-save-resume`, `2026-11-14-temporary-admin-elevation` plan.md files — their terms are already fully covered by PRD FR-006/FR-007/FR-010/FR-019/FR-030 quotes below, so skipped under time budget; flagged as unknown/unverified for any plan-only refinement not in the PRD.

## Terms

| Term (variants) | Kind | Definition (quoted) | Source |
|---|---|---|---|
| boid | entity | "boidy i predatory rozmnażają się" / genes incl. "maks. prędkość, długość życia, wagi separacji/kohezji/wyrównania" | prd.md:118,120 |
| predator | entity | "Predator nie może zaatakować stada, którego liczebność jest równa lub mniejsza od konfigurowalnego progu ochronnego" | prd.md:126 |
| tribe / flock / stado (PL variant) | entity | "stado definiuje jedynie wartości średnie podane jako parametr wejściowy, od których startują osobniki" | prd.md:120; roadmap.md:94 ("F-09... per-tribe boid behavior") |
| flockId | value | boid's tribe-membership identifier, per per-tribe-behavior-weights plan: "flockId assignment is a contiguous block split via `splitCountAcrossFlocks`" | archive/2026-11-18-predator-tribe-concept/plan.md |
| predator tribe | entity | "(foundation) Predators can belong to a tribe (mirroring boids' existing `flockId`), with each predator tribe carrying its own independently-evolving genetics" | roadmap.md:279 (F-10) |
| crossbreeding (krzyżowanie międzystadowe) | policy/operation | "Krzyżowanie między stadami jest możliwe, gdy włączone jest odpowiednim parametrem symulacji; kolor (i inne geny) potomka z krzyżowania międzystadowego jest blendem genów obu rodziców" | prd.md:122 (FR-007) |
| genes (geny) | value | "Każdy boid ma własny, indywidualny zestaw genów (maks. prędkość, długość życia, wagi separacji/kohezji/wyrównania itd.)... Potomek dziedziczy geny po obu rodzicach, łącznie z kolorem będącym blendem kolorów rodziców" | prd.md:120 (FR-006) |
| genetic diversity (różnorodność genetyczna) | measure | one of the 5 score factors; "final genetic-diversity value" shown in analysis view | prd.md:43,68,131 |
| protection threshold (próg ochronny) | policy | "Predator nie może zaatakować stada, którego liczebność jest równa lub mniejsza od konfigurowalnego progu ochronnego" | prd.md:126 (FR-009) |
| prey target | value/policy | "User adds a second predator tribe to a run and chooses its prey target — boids only, or boids and predators" | roadmap.md:99 (S-43) |
| mate preference (matePreference) | value | gene field; per plan "exists as a gene but is never read by the mate-match loop ... purely decorative today" prior to F-09 | archive/2026-11-17-per-tribe-behavior-weights/plan.md |
| food / food stock (jedzenie) | value | "ilość jedzenia, szybkość odnawiania jedzenia po zjedzeniu" is a configurable parameter; starvation accelerates death | prd.md:109,124 |
| food regen rate (szybkość odnawiania jedzenia) | value | parameter name, see FR-002; also live-adjustable field name "foodRegenRate" | prd.md:109; roadmap.md:80 (S-27) |
| energy threshold (energyThreshold) | value | live-adjustable field for client-staged runs | roadmap.md:81 (S-28) |
| mutation chance / magnitude (mutationChance/mutationMagnitude) | value | live-adjustable fields, client-staged parity | roadmap.md:81 (S-28) |
| score / punktacja | measure | "System oblicza punktację przebiegu symulacji jako iloczyn pięciu czynników" | prd.md:131 (FR-010) |
| cycle length / survival (długość trwania cyklu) | measure | 1st score factor | prd.md:131,227 |
| resource management (gospodarowanie zasobami) | measure | 2nd score factor | prd.md:131,227 |
| phase quality (jakość etapu cyklu życiowego) | measure | 4th score factor, FR-019 | prd.md:131,134,239 |
| population density vs. area (gęstość populacji względem obszaru) | measure | 5th score factor, FR-035, "uśredniony w czasie stosunek łącznej populacji... do gęstości startowej" | prd.md:136 |
| population lifecycle phase | state (enum, 5 values) | "Establishment / Growth / Overshoot / Crash / Recovery" — defined per-phase in Business Logic | prd.md:231-236 |
| Establishment | state | "early ticks, population still small, no clear trend yet" | prd.md:231 |
| Growth | state | "population rising, food availability high, reproduction outpacing deaths" | prd.md:232 |
| Overshoot | state | "population elevated while food availability is dropping — the lag between resource depletion and the death-rate response catching up" | prd.md:233 |
| Crash | state | "population declining sharply alongside low food availability (starvation and/or predation driving the die-off)" | prd.md:234 |
| Recovery | state | "population stabilizing or growing again after a Crash, as food availability recovers" | prd.md:235 |
| resilience bonus | policy/measure | "a resilience bonus specifically for completing a Crash → Recovery transition" | prd.md:239 |
| run (przebieg symulacji) | entity (identity+lifecycle) | "symulacja" with states running/saved/completed; dashboard lists "jego własne przebiegi symulacji (działające, zapisane, zakończone)" | prd.md:182 (FR-024) |
| running / saved / completed (działające/zapisane/zakończone) | state | run statuses | prd.md:182 |
| server-run / real (non-staging) simulation | entity | "Rzeczywista (nie-stagingowa) symulacja jest wykonywana przez proces po stronie serwera, niezależny od połączenia klienta" | prd.md:166 (FR-020) |
| staging simulation (symulacja kliencka/stagingowa) | entity | "Jedna symulacja kliencka (stagingowa, do dopasowywania parametrów) pozostaje dostępna, uruchamiana i renderowana w całości po stronie klienta" | prd.md:170 (FR-022) |
| admin / member | role | "Login (email/OAuth) with two roles: `admin` and `member`" | prd.md:247 |
| temporary admin elevation | operation/policy | "A user can temporarily elevate their own account... to the `admin` role... then the elevation is reversible (not a permanent role change)" | prd.md:202 (FR-030) |
| object-count cap / max object count (limit liczby symulowanych obiektów) | policy/value | "Admin konfiguruje globalny maksymalny limit liczby symulowanych obiektów (boidy + predatory)" | prd.md:161 (FR-018) |
| leaderboard | entity/value | "The user sees a leaderboard of their own completed runs ranked by score, highest first" | prd.md:189 (FR-026) |
| parameter-suggestion heuristic | operation | "System sugeruje zmiany parametrów na podstawie obserwacji, jak dotychczasowe zmiany wpływały na końcowy wynik (heurystyka, nie pełna optymalizacja)" | prd.md:152-153 (FR-015) |
| post-run optimization suggestion | operation | "a second, run-specific optimization suggestion — distinct from FR-015's cross-run heuristic — derived from that single run's own phase/resource history" | prd.md:191 (FR-027) |
| spatial partitioning / spatial hash | operation (perf) | "uses spatial partitioning — a grid-based neighbor search — instead of a full pairwise scan... reducing complexity from O(N²) to O(N) per tick" | prd.md:197 (FR-029) |
| imbalance | — | **not found** in prd.md, roadmap.md (pages read), test-plan.md §2, or lessons.md; searched for literal string "imbalance" | n/a |
| throttle (unwatched-run tick throttling) | policy | "User runs multiple server-owned simulations and the one they're actively watching stays responsive, because unwatched runs no longer compete equally for CPU" | roadmap.md:90 (S-36) |

## Lifecycles

- **Run lifecycle**: running → saved (via stop/save) → resumed (→ running again) → completed (natural end or user stop) → score produced. "Użytkownik może zatrzymać symulację w dowolnym momencie i zapisać jej stan" (prd.md:141, FR-011); "Użytkownik może wznowić zapisaną symulację" (prd.md:143, FR-012). Transition to scored/completed: "aż symulacja się zakończy i [użytkownik] zobaczy wynik oparty na..." (prd.md:68, US-01). Missing: exact state-machine names beyond running/saved/completed; "paused" vs "saved" terminology not disambiguated in PRD.
- **Boid/predator lifecycle**: spawn (via reproduction, inheriting genes) → live (aging, hunger) → death (lifespan exceeded or starvation-accelerated). "Boid lub predator umiera, gdy przekroczy swoją (zgenotypowaną) długość życia; brak dostępu do jedzenia przyspiesza śmierć" (prd.md:124-125, FR-008). Reproduction gated: "Boidy i predatory rozmnażają się, gdy dostępne jest wystarczające jedzenie, do granicy maksymalnej liczby symulowanych obiektów" (prd.md:118, FR-005).
- **Population lifecycle phase transitions** (tick-by-tick classification, not an explicit user-driven transition): Establishment → Growth → Overshoot → Crash → Recovery (→ possibly back to Growth/Overshoot). "Classification is signal-based... combines the population's recent trend... with the food-availability ratio" (prd.md:237). Explicit resilience path called out: "a run that crashes but genuinely bounces back" (prd.md:239) — Crash→Recovery is the one transition the business explicitly names and rewards.
- **Admin elevation lifecycle**: member → (self-elevate) → admin (temporary) → (revert) → member. "the elevation is reversible (not a permanent role change)" (prd.md:203); exact mechanism (self-service toggle vs time-boxed grant) explicitly deferred to planning (prd.md:270, Open Question 6) — resolved later per roadmap S-38 "time-boxed, self-service mechanism" (roadmap.md:92), not re-confirmed by reading that plan directly (unknown/inference).

## Rules

| Rule (quoted) | Binds terms | Entity/Policy | Source |
|---|---|---|---|
| "Starting a run with crossbreeding disabled never produces offspring with a blended-flock color" | run, crossbreeding, genes/color | entity (run) invariant | prd.md:72 |
| "A flock at or below the protection threshold is never attacked by a predator during the run" | flock, protection threshold, predator | policy | prd.md:73, 126 (FR-009) |
| "Stopping the simulation mid-run and resuming it later reproduces the exact population/resource state at the moment of stop" | run, save/resume | entity invariant | prd.md:74 |
| "Closing the browser tab mid-run does not stop or affect the server-owned simulation" | server-run | policy | prd.md:84 |
| "Only one server-run simulation can be actively viewed at a time" | server-run, view | policy | prd.md:86 |
| "The dashboard shows only the logged-in user's own runs" | run, dashboard, user | policy (access control) | prd.md:96 |
| "A user cannot open another user's run analysis view" | run, user | policy (access control) | prd.md:98 |
| "rozmnażanie respektuje globalny limit obiektów (FR-018); powyżej limitu rozmnażanie wstrzymane" | boid/predator, object-count cap | policy | prd.md:119 |
| "Krzyżowanie między stadami jest możliwe, gdy włączone jest odpowiednim parametrem symulacji" | crossbreeding | policy (one entity: run config) | prd.md:122 |
| "Two runs started with identical parameters and the same random seed produce identical scores" | run, score, seed | policy (NFR, product-wide) | prd.md:219 |
| "A saved/paused simulation's state survives an app restart with no loss of population, genetic, or resource data" | run | entity invariant (NFR) | prd.md:220 |
| "nie przeliczamy wstecznie już ocenionych przebiegów (forward-only, jak w S-09)" — score formula changes are not retroactively applied | run, score | policy | prd.md:133 |
| "No shared/collaborative simulations across users — a simulation run belongs to the user who started it" | run, user | policy (access control) | prd.md:257 |
| "every FR added since stays within per-user data isolation (dashboard and analysis view both reject access to another user's runs)" | run, user, dashboard, analysis | policy | prd.md:267 |

## Multiple meanings

- **"flock"/"stado"** — used both as the *tribe identity* concept (a set of boids sharing `flockId`, with per-tribe behavior config since F-09) and, in the original PRD FR-006 wording, as merely "wartości średnie podane jako parametr wejściowy" (an averaged starting-value label, not a rigid identity) — PRD itself calls out this exact ambiguity was resolved: "stado = wartość średnia startowa, nie sztywna etykieta" (prd.md:121). The roadmap's F-09/S-40 later treats tribe as a much richer, persistent per-individual identity (full weight/perception/burst config) — a definitional shift from "starting average" to "full behavioral identity," not flagged by the PRD as revised (PRD is older/v5 2026-11-14; F-09 work is 2026-11-17, newer).
- **"admin"** — in Access Control section, admin's capabilities are described as bounded to parameter ranges/object-count cap/tribe-count ranges (prd.md:249), but roadmap F-10/S-42 give admin-adjacent config (predator tribe count) a second, later-added meaning not present in the original Access Control text — not a conflict, just an extension (noted here per the agent-docs brief's "multiple meanings" category since the capability surface grew beyond the original text's enumeration).

## Conflicting statements

- **Score factor count**: PRD Business Logic section header-era text says "Each simulation run is scored as the **product of five factors**" (prd.md:227, current/newer), but FR-010's original resolution-note text (prd.md:132) describes "iloczyn czterech równoważnych czynników" before a later annotation (2026-11-15, roadmap S-25) adds the fifth (density-vs-area, FR-035, prd.md:133,136). Older: four-factor product (2026-11-14 resolution). Newer: five-factor product (2026-11-15 FR-035 addition). Both cited inline in the same FR-010 entry; PRD explicitly flags old vs. new scored runs are not comparable ("widok porównania przebiegów oznacza wprost, które przebiegi zostały ocenione starą (czterech czynników), a które nową (pięciu czynników) formułą").
- **FR-019's resilience-bonus scope**: original FR-019 text (prd.md:134) + a later "(uszczegółowienie, 2026-11-14)" annotation (prd.md:177) changing it from "a one-time flag" to "scales with the number of completed crash→recovery cycles." Older: one-time boolean reward. Newer (same date, later in doc): scaled-by-count reward. Both quoted; PRD marks the newer as the resolution ("premia skaluje się z liczbą zakończonych cykli").

## Unknowns

- Exact DB/schema field names for `tribeConfigs`, `PredatorTribeConfig`, etc. — seen only in archived plan.md excerpts (implementation detail, out of this agent's docs-only scope per the brief; code-language/code-rules agents should confirm).
- Whether "imbalance" is product vocabulary anywhere else in the repo (e.g., deeper roadmap pages S-08+ not read, or other archive/*/research.md files) — not found in the sources actually read; scope searched: prd.md (full), roadmap.md lines 1-370, test-plan.md §2, lessons.md (full).
- "flock" vs. "tribe" — whether the documents ever use one term exclusively and the other only informally, or whether current (2026-11-20) vocabulary has fully shifted to "tribe" in product docs vs. "flock" in code identifiers (`flockId`, `flockCount`) — PRD (Polish, "stado") predates the English "tribe" roadmap language; no single document reconciles the two explicitly.
- Exact self-service/time-boxed admin-elevation mechanism wording — PRD defers it (Open Question 6); roadmap S-38 claims it's "already" the time-boxed self-service mechanism but this agent did not read S-38's own archived plan.md to confirm the exact business rule as stated there (out of reading budget).
- `2026-11-13-genetic-inheritance-crossbreeding`, `2026-11-14-full-score-save-resume`, `2026-11-14-temporary-admin-elevation` archived plan.md files were not opened — any plan-level refinement of PRD terms (e.g., exact elevation UX wording) beyond what the PRD itself states is unverified by this agent.

## Commands run

- Read: `.claude/skills/10x-domain-distillation/references/agent-docs-language.md`, `context/domain/evidence/0-sources.md`, `context/domain/evidence/0-documents.md`, `context/foundation/prd.md` (full), `context/foundation/roadmap.md` (offset 0, limit 370 of 1138), `context/foundation/lessons.md` (full), `context/foundation/test-plan.md` (offset 32, limit 38 — §2 Risk Map).
- Bash: `grep -n "^## " context/foundation/test-plan.md`; `ls context/archive/ | grep -iE "per-tribe-behavior-weights|predator-tribe-concept|genetic-inheritance-crossbreeding|full-score-save-resume|temporary-admin-elevation"`; `sed -n '1,80p'` on `2026-11-17-per-tribe-behavior-weights/plan.md` and `2026-11-18-predator-tribe-concept/plan.md`.
