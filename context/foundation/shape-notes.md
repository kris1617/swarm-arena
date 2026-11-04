---
project: "Swarm Arena"
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
created: 2026-11-02
updated: 2026-11-02
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "brak możliwości konfiguracji/porównania wariantów + paraliż decyzyjny (zbyt wiele parametrów) + tarcie workflow (ręczna edycja/restart)"
    - topic: "insight / why now"
      decision: "chęć nauki od podstaw (mechanika roju + agentowe IDE); dodatkowo: istniejące symulatory boids nie oferują ewaluacji punktowej + sugestii zmian parametrów"
    - topic: "access model"
      decision: "logowanie (email/OAuth) z rolami admin/member, mimo że to projekt jednoosobowy — decyzja świadoma użytkownika, nie wymuszona przez skalę"
    - topic: "mvp scope"
      decision: "pełny zakres zaakceptowany, w tym równoległe symulacje + przełączanie widoku; 5-7 tygodni pracy po godzinach, świadomie przyjęte"
    - topic: "scoring pillars"
      decision: "trzy niezależne filary: przeżycie, gospodarowanie zasobami, różnorodność genetyczna — ważone osobno (wagi TBD, open question #2)"
  frs_drafted: 18
  quality_check_status: accepted
---

# Shape Notes — Swarm Arena

## Vision & Problem Statement

A hobbyist experimenting with swarm algorithms (boids + predator-prey dynamics) has no tool that lets them configure a simulation, score the outcome against explicit evaluation criteria, and compare variants side by side. Today, trying a new parameter combination means manually editing code or config and restarting from scratch, with no quantified way to tell whether a change actually helped — too many parameters to tune by feel, and no persisted record of what was tried.

The person building this already knows the swarm mechanics they want to explore, but existing boids simulators stop at visualization — they don't score results or suggest parameter changes. The gap isn't swarm simulation itself; it's turning trial-and-error tuning into a measurable, resumable experimentation loop, built as a learning exercise in both the domain (swarm behavior) and in agentic development.

## User & Persona

**Primary persona**: the builder themselves — a self-learner experimenting with swarm/boids algorithms and predator-prey dynamics for personal exploration, not for an external audience.

- **Context**: runs simulations repeatedly, tweaking parameters between runs, trying to find configurations that produce "better" flocking/evasion behavior.
- **Moment they reach for this**: when they want to test a new parameter combination and need to know, objectively, whether it scored better than the last one — and want to pick up a long-running experiment later rather than losing it on close.

No secondary persona — single user, self-directed use.

## Access Control

Login (email/OAuth) with two roles: `admin` and `member`. Both roles exist from the MVP even though there is currently one real user; the role split is a deliberate choice, not forced by scale. Capability differences between `admin` and `member` are not yet defined — flagged below as an open question for `/10x-prd`.

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

## Timeline acknowledgment

Acknowledged on 2026-11-02: 6-week MVP (user estimate: 5–7 weeks) requires sustained after-hours dedication, including the parallel-simulations + view-switching scope; user accepted explicitly rather than scoping down.

## Business Logic

Each simulation run is scored by combining how long the population survived, how efficiently it managed available food, and how genetically diverse the surviving population remained — and that score history drives heuristic suggestions for parameter changes that improve population stability.

The rule consumes two kinds of user-facing input: the parameters the user configured for the run (population sizes, food amount and respawn rate, predator protection threshold, lifespans, crossbreeding on/off) and the run's observed outcome (how long it lasted, how food availability tracked consumption, and the genetic spread across survivors at the end). Its output is a single run score broken into the three measured dimensions, plus — when enough run history exists — a suggested next parameter change aimed at improving population stability.

The user encounters this at the end of a run (whether it ended naturally or was stopped): they see the score and its three-part breakdown. When they've run several variants, the score is what lets them say one configuration genuinely outperformed another, rather than guessing from watching the animation.

## Non-Functional Requirements

- A simulation with the maximum configured number of objects (FR-018) renders without visibly freezing or dropping below a usable frame rate for observation.
- Two runs started with identical parameters and the same random seed produce identical scores — comparison between variants is meaningless otherwise.
- A saved/paused simulation's state survives an app restart with no loss of population, genetic, or resource data.
- Switching which of several parallel simulations is being viewed does not interrupt or measurably slow the others.

## Functional Requirements

### Uwierzytelnianie i dostęp

- FR-001: Zalogowany użytkownik (member lub admin) ma dostęp do aplikacji. Priority: must-have
  > Socratic: Brak kontrargumentu. Rozstrzygnięcie: FR stoi bez zmian.

### Konfiguracja i uruchamianie symulacji

- FR-002: Admin definiuje dostępny zakres parametrów symulacji i ich wartości domyślne; member konfiguruje nową symulację wybierając wartości z tego zakresu (liczba boidów, liczba predatorów, ilość jedzenia, szybkość odnawiania jedzenia po zjedzeniu, próg ochronny liczebności stada przed atakiem predatora, długość życia boida, długość życia predatora, włączenie/wyłączenie krzyżowania międzystadowego). Priority: must-have
  > Socratic: Kontrargument rozważony: zbyt wiele swobodnych parametrów odtwarza paraliż decyzyjny w UI. Rozstrzygnięcie: podział ról — admin ustala zakres/domyślne, member wybiera w ramach zakresu. To jednocześnie daje realną treść różnicy admin/member (patrz Open Questions #1 — rozwiązane).
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
- FR-008: Boid lub predator umiera, gdy przekroczy swoją (zgenotypowaną) długość życia; brak dostępu do jedzenia przyspiesza śmierć (głód skraca efektywną długość życia / zwiększa tempo jej wyczerpywania), to nie są w pełni niezależne mechanizmy. Priority: must-have
  > Socratic: Kontrargument rozważony: śmierć z głodu i śmierć ze starości wydawały się dwoma osobnymi mechanizmami. Rozstrzygnięcie: głód przyspiesza śmierć — jeden mechanizm starzenia/wyczerpania, modyfikowany przez dostęp do jedzenia, nie dwa równoległe warunki śmierci.
- FR-009: Predator nie może zaatakować stada, którego liczebność jest równa lub mniejsza od konfigurowalnego progu ochronnego. Priority: must-have
  > Socratic: Brak kontrargumentu — zostaje jak jest.

### Ewaluacja i punktacja

- FR-010: System oblicza punktację przebiegu symulacji na podstawie długości trwania cyklu (przeżycia), gospodarowania zasobami oraz różnorodności genetycznej populacji. Priority: must-have
  > Socratic: Kontrargument rozważony: trzy składowe bez wag względnych nie dają jeszcze jednej porównywalnej liczby. Rozstrzygnięcie: FR stoi — reguła produktowa (co wpływa na wynik) jest ustalona; dokładna formuła/wagi to decyzja do rozstrzygnięcia w PRD lub implementacji, zapisana jako open question.

### Zapis, wznowienie i wielość symulacji

- FR-011: Użytkownik może zatrzymać symulację w dowolnym momencie i zapisać jej stan. Priority: must-have
  > Socratic: Brak kontrargumentu — zostaje jak jest.
- FR-012: Użytkownik może wznowić zapisaną symulację. Priority: must-have
  > Socratic: Brak kontrargumentu — zostaje jak jest.
- FR-013: Użytkownik może uruchomić kilka symulacji równolegle. Priority: must-have
  > Socratic: Brak kontrargumentu — to najdroższy element MVP, świadomie zaakceptowany w Kroku 3.
- FR-014: Użytkownik może przełączać, którą z równolegle działających symulacji aktualnie obserwuje, bez przerywania pozostałych. Priority: must-have
  > Socratic: Brak kontrargumentu — jak wyżej, zaakceptowane w Kroku 3.

### Sugestie i porównanie wyników

- FR-015: System sugeruje zmiany parametrów na podstawie obserwacji, jak dotychczasowe zmiany wpływały na stabilizację populacji (heurystyka, nie pełna optymalizacja). Priority: nice-to-have
  > Socratic: Kontrargument rozważony: przy sprzężonych parametrach proste "zwiększ X" może ignorować interakcje między zmiennymi. Rozstrzygnięcie: sugestia bazuje konkretnie na obserwowanym wpływie zmian na stabilizację populacji, nie na ogólnym "polepsz wynik" — zawęża i doprecyzowuje heurystykę.
- FR-016: Użytkownik może porównać wyniki (punktację) wielu przebiegów symulacji side-by-side. Priority: nice-to-have
  > Socratic: Kontrargument rozważony: porównanie wymaga tej samej jednoznacznej formuły punktacji co FR-010. Rozstrzygnięcie: FR stoi, ale zależy od rozstrzygnięcia formuły/wag punktacji (patrz Open Questions).
- FR-017: Użytkownik może wyeksportować przebieg/parametry/wynik symulacji poza aplikację. Priority: nice-to-have
  > Socratic: Kontrargument rozważony: format eksportu nieokreślony. Rozstrzygnięcie: FR stoi, format (CSV/JSON/obraz) zostaje jako open question dla downstream.

### Ograniczenia wydajnościowe

- FR-018: Admin konfiguruje globalny maksymalny limit liczby symulowanych obiektów (boidy + predatory), chroniąc płynność renderowania (guardrail). Priority: must-have
  > Socratic: Brak kontrargumentu — potwierdzone jako właściwe ujęcie (limit globalny, ustawiany przez admina).

## User Stories

### US-01: User runs a configured simulation to completion and gets a score

- **Given** a logged-in user on the simulation setup screen
- **When** they set parameters (population sizes, food amount/respawn rate, flock protection threshold, boid/predator lifespans, crossbreeding on/off) and start the simulation
- **Then** they see boids and predators moving and interacting in real time, flocks distinguished by color, population changing through reproduction and death, until the run ends and they see a score based on cycle length, resource management, and genetic diversity

#### Acceptance Criteria

- Starting a run with crossbreeding disabled never produces offspring with a blended-flock color
- A flock at or below the protection threshold is never attacked by a predator during the run
- Stopping the simulation mid-run and resuming it later reproduces the exact population/resource state at the moment of stop

## Non-Goals

- **No shared/collaborative simulations across users** — `admin`/`member` are access roles, not co-editing roles; a simulation run belongs to the user who started it, not to a team session. Rationale: scope stays personal-experimentation-sized, avoids building multi-user concurrency into the simulation engine itself.

## Quality cross-check

All elements present — Access Control, Business Logic, Project artifacts, Timeline-cost acknowledgment, Non-Goals. No gaps. `quality_check_status: accepted`.

## Open Questions (running)

1. ~~**What can `admin` do that `member` cannot?**~~ — **Resolved** during FR-002 Socratic round: admin defines the available parameter ranges and default values (and the FR-018 performance cap); member configures and runs individual simulations within that range.
2. **What are the relative weights/formula for the score (cycle length × resource management × genetic diversity)?** — Owner: user. Not yet resolved; FR-010 stands as a product rule, exact formula deferred. Blocks FR-016 (run comparison) from being meaningful until resolved.
3. **What export format(s) should FR-017 support (CSV / JSON / image / other)?** — Owner: user. Not yet resolved; nice-to-have, not MVP-blocking.
