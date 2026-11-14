---
project: "Swarm Arena"
version: 2
status: draft
created: 2026-11-02
updated: 2026-11-14
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 6
  hard_deadline: null
  after_hours_only: true
---

# Swarm Arena — PRD

## Vision & Problem Statement

A hobbyist experimenting with swarm algorithms (boids + predator-prey dynamics) has no tool that lets them configure a simulation, score the outcome against explicit evaluation criteria, and compare variants side by side. Today, trying a new parameter combination means manually editing code or config and restarting from scratch, with no quantified way to tell whether a change actually helped — too many parameters to tune by feel, and no persisted record of what was tried.

The person building this already knows the swarm mechanics they want to explore, but existing boids simulators stop at visualization — they don't score results or suggest parameter changes. The gap isn't swarm simulation itself; it's turning trial-and-error tuning into a measurable, resumable experimentation loop, built as a learning exercise in both the domain (swarm behavior) and in agentic development.

## User & Persona

**Primary persona**: the builder themselves — a self-learner experimenting with swarm/boids algorithms and predator-prey dynamics for personal exploration, not for an external audience.

- **Context**: runs simulations repeatedly, tweaking parameters between runs, trying to find configurations that produce "better" flocking/evasion behavior.
- **Moment they reach for this**: when they want to test a new parameter combination and need to know, objectively, whether it scored better than the last one — and want to pick up a long-running experiment later rather than losing it on close.

No secondary persona — single user, self-directed use.

## Success Criteria

### Primary

- A logged-in user can start a boids+predator simulation, configure its parameters, watch it run, stop/save it, resume it later, and receive a score once it ends (automatically or by user stop).
- A user can run several simulations in parallel and switch which one they're actively viewing, without losing the others' progress.

### Secondary

- The system suggests parameter changes likely to improve the score (heuristic, not full optimization).
- The user can compare scores across multiple simulation runs side by side.
- The user can export a simulation's run/parameters/score outside the app.

### Guardrails

- A saved/paused simulation reloads faithfully — no state loss on save/resume.
- Rendering stays usable (no freezing) while observing a simulation with many agents.
- Scoring is deterministic/repeatable: the same parameters + seed produce the same score, so variant comparison is meaningful.

## User Stories

### US-01: User runs a configured simulation to completion and gets a score

- **Given** a logged-in user on the simulation setup screen
- **When** they set parameters (population sizes, food amount/respawn rate, flock protection threshold, boid/predator lifespans, crossbreeding on/off) and start the simulation
- **Then** they see boids and predators moving and interacting in real time, flocks distinguished by color, population changing through reproduction and death, until the run ends and they see a score based on cycle length, resource management, and genetic diversity

#### Acceptance Criteria

- Starting a run with crossbreeding disabled never produces offspring with a blended-flock color
- A flock at or below the protection threshold is never attacked by a predator during the run
- Stopping the simulation mid-run and resuming it later reproduces the exact population/resource state at the moment of stop

## Functional Requirements

### Uwierzytelnianie i dostęp

- FR-001: Zalogowany użytkownik (member lub admin) ma dostęp do aplikacji. Priority: must-have
  > Socratic: Brak kontrargumentu. Rozstrzygnięcie: FR stoi bez zmian.

### Konfiguracja i uruchamianie symulacji

- FR-002: Admin definiuje dostępny zakres parametrów symulacji i ich wartości domyślne; member konfiguruje nową symulację wybierając wartości z tego zakresu (liczba boidów, liczba predatorów, ilość jedzenia, szybkość odnawiania jedzenia po zjedzeniu, próg ochronny liczebności stada przed atakiem predatora, długość życia boida, długość życia predatora, włączenie/wyłączenie krzyżowania międzystadowego). Priority: must-have
  > Socratic: Kontrargument rozważony: zbyt wiele swobodnych parametrów odtwarza paraliż decyzyjny w UI. Rozstrzygnięcie: podział ról — admin ustala zakres/domyślne, member wybiera w ramach zakresu. To jednocześnie daje realną treść różnicy admin/member.
- FR-003: Użytkownik może uruchomić nową symulację z ustawionymi parametrami. Priority: must-have
  > Socratic: Brak kontrargumentu — to jest cel symulacji (sprawdzanie scenariuszy). Rozstrzygnięcie: FR stoi bez zmian.
- FR-004: Użytkownik może obserwować symulację w czasie rzeczywistym, z boidami wizualnie oznaczonymi kolorem przynależności do stada. Priority: must-have
  > Socratic: Kontrargument rozważony: renderowanie zbyt wielu obiektów zagraża płynności (guardrail). Rozstrzygnięcie: wprowadzono FR-018 (maksymalna liczba symulowanych obiektów, konfigurowalna przez admina) jako wsparcie tego guardrail.

### Dynamika populacji

- FR-005: Boidy i predatory rozmnażają się, gdy dostępne jest wystarczające jedzenie, do granicy maksymalnej liczby symulowanych obiektów (FR-018). Priority: must-have
  > Socratic: Kontrargument rozważony: bez górnego limitu populacja eksplodowałaby ponad możliwości renderowania. Rozstrzygnięcie: rozmnażanie respektuje globalny limit obiektów (FR-018); powyżej limitu rozmnażanie wstrzymane.
- FR-006: Każdy boid ma własny, indywidualny zestaw genów (maks. prędkość, długość życia, wagi separacji/kohezji/wyrównania itd.); stado definiuje jedynie wartości średnie podane jako parametr wejściowy, od których startują osobniki. Potomek dziedziczy geny po obu rodzicach, łącznie z kolorem będącym blendem kolorów rodziców. Priority: must-have
  > Socratic: Kontrargument rozważony: dziedziczenie "tylko koloru" nie wystarczyłoby do mierzenia różnorodności genetycznej (FR-010). Rozstrzygnięcie: geny to pełny zestaw indywidualnych cech, nie tylko kolor; stado = wartość średnia startowa, nie sztywna etykieta.
- FR-007: Krzyżowanie między stadami jest możliwe, gdy włączone jest odpowiednim parametrem symulacji; kolor (i inne geny) potomka z krzyżowania międzystadowego jest blendem genów obu rodziców (zgodnie z FR-006). Priority: must-have
  > Socratic: Kontrargument rozważony: potrzebna reguła koloru potomka przy krzyżowaniu międzystadowym. Rozstrzygnięcie: rozwiązane przez ogólną regułę dziedziczenia genów z FR-006 (blend rodziców) — nie potrzebna osobna reguła.
- FR-008: Boid lub predator umiera, gdy przekroczy swoją (zgenotypowaną) długość życia; brak dostępu do jedzenia przyspiesza śmierć (głód skraca efektywną długość życia / zwiększa tempo jej wyczerpywania) — to nie są w pełni niezależne mechanizmy. Priority: must-have
  > Socratic: Kontrargument rozważony: śmierć z głodu i śmierć ze starości wydawały się dwoma osobnymi mechanizmami. Rozstrzygnięcie: głód przyspiesza śmierć — jeden mechanizm starzenia/wyczerpania, modyfikowany przez dostęp do jedzenia, nie dwa równoległe warunki śmierci.
- FR-009: Predator nie może zaatakować stada, którego liczebność jest równa lub mniejsza od konfigurowalnego progu ochronnego. Priority: must-have
  > Socratic: Brak kontrargumentu — zostaje jak jest.

### Ewaluacja i punktacja

- FR-010: System oblicza punktację przebiegu symulacji jako iloczyn czterech czynników: długości trwania cyklu (przeżycia), gospodarowania zasobami, różnorodności genetycznej populacji oraz jakości etapu cyklu życiowego populacji (FR-019). Priority: must-have
  > Socratic: Kontrargument rozważony: cztery składowe bez wag względnych nie dają jeszcze jednej porównywalnej liczby. Rozstrzygnięcie (2026-11-14, Open Question #1 zamknięte): iloczyn czterech równoważnych czynników — każdy słaby czynnik proporcjonalnie obniża cały wynik, zamiast wagi addytywne wymagające arbitralnego podziału punktów. Dokładne wagi jakości poszczególnych etapów cyklu życiowego (FR-019) to decyzja planistyczna (`/10x-plan`), nie produktowa — produktowa reguła (iloczyn czterech czynników, czynnik etapu nagradza zarówno zdrowe etapy, jak i odbudowę po załamaniu) jest ustalona tutaj.
- FR-019: Jakość etapu cyklu życiowego populacji boidów (ustanowienie / wzrost / przekroczenie / załamanie / odbudowa — sklasyfikowany na podstawie trendu liczebności i dostępności jedzenia w czasie) jest czwartym czynnikiem punktacji (FR-010): nagradza zarówno osiąganie i utrzymywanie zdrowych etapów (wzrost, odbudowa), jak i odbudowę po załamaniu (odporność) — nie tylko unikanie załamania. Priority: must-have
  > Socratic: Kontrargument rozważony: samo unikanie załamania nagradzałoby stagnację ponad aktywny, zdrowy wzrost; samo nagradzanie wzrostu nie doceniłoby odporności (powrotu po załamaniu). Rozstrzygnięcie: oba efekty połączone — jakość etapu to średnia ważona czasem + premia za rzeczywiste przejście załamanie→odbudowa.

### Zapis, wznowienie i wielość symulacji

- FR-011: Użytkownik może zatrzymać symulację w dowolnym momencie i zapisać jej stan. Priority: must-have
  > Socratic: Brak kontrargumentu — zostaje jak jest.
- FR-012: Użytkownik może wznowić zapisaną symulację. Priority: must-have
  > Socratic: Brak kontrargumentu — zostaje jak jest.
- FR-013: Użytkownik może uruchomić kilka symulacji równolegle. Priority: must-have
  > Socratic: Brak kontrargumentu — to najdroższy element MVP, świadomie zaakceptowany podczas doprecyzowania zakresu (patrz Timeline acknowledgment w shape-notes).
- FR-014: Użytkownik może przełączać, którą z równolegle działających symulacji aktualnie obserwuje, bez przerywania pozostałych. Priority: must-have
  > Socratic: Brak kontrargumentu — jak wyżej.

### Sugestie i porównanie wyników

- FR-015: System sugeruje zmiany parametrów na podstawie obserwacji, jak dotychczasowe zmiany wpływały na stabilizację populacji (heurystyka, nie pełna optymalizacja). Priority: nice-to-have
  > Socratic: Kontrargument rozważony: przy sprzężonych parametrach proste "zwiększ X" może ignorować interakcje między zmiennymi. Rozstrzygnięcie: sugestia bazuje konkretnie na obserwowanym wpływie zmian na stabilizację populacji, nie na ogólnym "polepsz wynik".
- FR-016: Użytkownik może porównać wyniki (punktację) wielu przebiegów symulacji side-by-side. Priority: nice-to-have
  > Socratic: Kontrargument rozważony: porównanie wymaga tej samej jednoznacznej formuły punktacji co FR-010. Rozstrzygnięcie: FR stoi, ale zależy od rozstrzygnięcia formuły/wag punktacji (patrz Open Questions).
- FR-017: Użytkownik może wyeksportować przebieg/parametry/wynik symulacji poza aplikację. Priority: nice-to-have
  > Socratic: Kontrargument rozważony: format eksportu nieokreślony. Rozstrzygnięcie: FR stoi, format (CSV/JSON/obraz) zostaje jako open question.

### Ograniczenia wydajnościowe

- FR-018: Admin konfiguruje globalny maksymalny limit liczby symulowanych obiektów (boidy + predatory), chroniąc płynność renderowania (guardrail). Priority: must-have
  > Socratic: Brak kontrargumentu — potwierdzone jako właściwe ujęcie (limit globalny, ustawiany przez admina).

## Non-Functional Requirements

- A simulation with the maximum configured number of objects (FR-018) renders without visibly freezing or dropping below a usable frame rate for observation.
- Two runs started with identical parameters and the same random seed produce identical scores — comparison between variants is meaningless otherwise.
- A saved/paused simulation's state survives an app restart with no loss of population, genetic, or resource data.
- Switching which of several parallel simulations is being viewed does not interrupt or measurably slow the others.

## Business Logic

Each simulation run is scored as the **product of four factors**: how long the population survived, how efficiently it managed available food, how genetically diverse the surviving population remained, and the quality of the population's lifecycle-phase history over the run — and that score history drives heuristic suggestions for parameter changes that improve population stability.

**Population lifecycle phases (resolved 2026-11-14, closing Open Question #1).** The boid population's state is classified tick-by-tick into one of five phases, using the boom-bust/irruptive-growth model from population ecology (chosen over the simpler logistic-growth-curve model because logistic growth has no crash phase, and this simulation's finite food + starvation + predation can genuinely crash a population):

- **Establishment** — early ticks, population still small, no clear trend yet.
- **Growth** — population rising, food availability high, reproduction outpacing deaths.
- **Overshoot** — population elevated while food availability is dropping — the lag between resource depletion and the death-rate response catching up.
- **Crash** — population declining sharply alongside low food availability (starvation and/or predation driving the die-off).
- **Recovery** — population stabilizing or growing again after a Crash, as food availability recovers.

Classification is signal-based, not population-size-based alone: it combines the population's recent trend (rising/falling over a short rolling window) with the food-availability ratio (current food stock relative to the configured initial stock) — matching how population ecology sources classify these phases (via birth/death-rate balance and resource-relative population, not raw headcount).

The fourth score factor — **phase quality** — rewards two distinct things, combined: (1) a time-weighted average of per-phase quality, so a run that spends more of its duration in healthy phases (Growth, Recovery) scores higher than one that spends most of it in Crash; and (2) a resilience bonus specifically for completing a Crash → Recovery transition — a run that crashes but genuinely bounces back scores better than one that either never crashes (and so never demonstrates resilience) or crashes and stays crashed. The exact per-phase quality values and the resilience bonus's magnitude are a planning-level decision (`/10x-plan`), not a product-level one — the product rule fixed here is which two things the factor rewards and that it covers the whole run's phase history, not just the end state.

The rule consumes two kinds of user-facing input: the parameters the user configured for the run (population sizes, food amount and respawn rate, predator protection threshold, lifespans, crossbreeding on/off) and the run's observed outcome (how long it lasted, how food availability tracked consumption, the genetic spread across survivors at the end, and the population's lifecycle-phase history over the run). Its output is a single run score broken into the four measured dimensions, plus — when enough run history exists — a suggested next parameter change aimed at improving population stability.

The user encounters this at the end of a run (whether it ended naturally or was stopped): they see the score and its four-part breakdown. When they've run several variants, the score is what lets them say one configuration genuinely outperformed another, rather than guessing from watching the animation.

## Access Control

Login (email/OAuth) with two roles: `admin` and `member`. Both roles exist from the MVP even though there is currently one real user; the role split is a deliberate choice, not forced by scale.

Role → capability split: `admin` defines the available parameter ranges and default values for simulations, plus the global maximum object count (FR-018). `member` configures and runs individual simulations within the ranges the admin has set (FR-002). This is the full capability difference defined so far; finer-grained role behavior (e.g. whether an admin can also act as a member, or view/manage other users' runs) is not yet specified — see Open Questions.

## Non-Goals

- **No shared/collaborative simulations across users** — `admin`/`member` are access roles, not co-editing roles; a simulation run belongs to the user who started it, not to a team session. Rationale: scope stays personal-experimentation-sized, avoids building multi-user concurrency into the simulation engine itself.

## Open Questions

1. ~~What are the relative weights/formula for the score (cycle length × resource management × genetic diversity)?~~ — **Resolved 2026-11-14.** Formula: equal product of four factors — cycle length (survival) × resource management × genetic diversity × population-lifecycle-phase quality (FR-010, FR-019; see Business Logic for the phase model and what the fourth factor rewards). The exact per-phase quality values and resilience-bonus magnitude are deferred to `/10x-plan` as planning-level tuning, not a product open question — the product rule (equal multiplicative product; phase factor rewards both sustained health and Crash→Recovery resilience) is fixed. Unblocks FR-016 (run comparison).
2. **What export format(s) should FR-017 support (CSV / JSON / image / other)?** — Owner: user. Not yet resolved; nice-to-have, not MVP-blocking.
3. **Beyond defining parameter ranges and the object-count cap, does `admin` have any other capability — e.g. managing other users' simulations — or is the role split purely about parameter governance?** — Owner: user. Not yet resolved; affects whether multi-user data isolation needs to be designed now or can stay implicit.
