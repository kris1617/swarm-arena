---
project: "Swarm Arena"
version: 4
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
- A real (non-staging) simulation executes on the server, independent of any client connection, and keeps running if the browser tab closes; the user can view exactly one server-run simulation at a time, rendered live from server-pushed state. (Resolved 2026-11-14: replaces the original client-driven "run several in parallel" model — see Non-Goals.)
- Right after logging in, the user lands on a dashboard listing their own simulation runs (running, saved, completed) with standard run-dashboard conventions (status, start time, filters, a detail link).
- From a completed run, the user opens an analysis view — population-over-time chart, phase/cycle breakdown, final genetic-diversity value — to decide what to change in the next run.
- A single client-side simulation remains available for parameter-tuning staging, started and rendered entirely on the client, unchanged from the original MVP behavior.

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

### US-02: User starts a real simulation that keeps running server-side and watches it live

- **Given** a logged-in user who has configured a simulation
- **When** they start it as a real (non-staging) run
- **Then** the simulation executes on the server, independent of any client connection — it keeps running if the browser tab is closed — and the user can open a live view that renders exactly one server-run simulation at a time from state the server pushes (not polls)

#### Acceptance Criteria

- Closing the browser tab mid-run does not stop or affect the server-owned simulation
- The live view reflects server-pushed state, not a client-side re-simulation
- Only one server-run simulation can be actively viewed at a time; the user can switch which one without stopping any of them

### US-03: User reviews a dashboard of their runs and analyzes a completed one

- **Given** a logged-in user with at least one simulation run (running, saved, or completed)
- **When** they log in or navigate to their dashboard
- **Then** they see their own runs listed with status, start time, and a filter, with a link into each run's detail; opening a completed run's analysis view shows a population-over-time chart (phase-colored), a phase/cycle time breakdown, and a final genetic-diversity value

#### Acceptance Criteria

- The dashboard shows only the logged-in user's own runs, filterable by status (running/saved/completed)
- A completed run's analysis view renders population, phase-breakdown, and diversity sections consistently for runs with persisted history, and degrades gracefully (no crash) for older runs that predate history persistence
- A user cannot open another user's run analysis view

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
- FR-013: Użytkownik widzi wszystkie swoje aktualnie działające symulacje serwerowe i przełącza, którą aktywnie obserwuje, bez przerywania pozostałych. Priority: must-have
  > Socratic (2026-11-14, zamknięcie Open Question #3): pierwotnie FR-013 zakładał kilka symulacji renderowanych równolegle po stronie klienta — najdroższy element pierwotnego MVP. Rozstrzygnięcie: zastąpione modelem serwerowym (FR-020–FR-022) — "równoległość" to teraz kilka serwerowych przebiegów działających niezależnie od renderowania; klient obserwuje jeden naraz.
- FR-014: Użytkownik może przełączać, którą z działających symulacji serwerowych aktualnie obserwuje, bez przerywania pozostałych. Priority: must-have
  > Socratic: jak FR-013 — przełączanie działa teraz na liście symulacji serwerowych, nie na kilku równolegle renderowanych widokach klienckich.

### Sugestie i porównanie wyników

- FR-015: System sugeruje zmiany parametrów na podstawie obserwacji, jak dotychczasowe zmiany wpływały na końcowy wynik (heurystyka, nie pełna optymalizacja). Priority: nice-to-have
  > Socratic: Kontrargument rozważony: przy sprzężonych parametrach proste "zwiększ X" może ignorować interakcje między zmiennymi; wcześniejsze rozstrzygnięcie zawężało sygnał do czynnika jakości etapu cyklu (FR-019) jako bezpośredniej miary "stabilizacji populacji". Rozstrzygnięcie (2026-11-14, zamknięcie): użytkownik wybrał korelację z końcowym wynikiem (FR-010), nie z jednym czynnikiem — to jest liczba, którą użytkownik faktycznie widzi i chce poprawić. Mechanizm: dla każdego z 13 parametrów konfigurowalnych (zakres admina, FR-002) o różnych wartościach w ostatnich przebiegach użytkownika, system liczy korelację między wartością parametru a końcowym wynikiem; sugeruje zmianę tego jednego parametru, którego korelacja jest najsilniejsza, z jednolinijkowym uzasadnieniem i kwalifikatorem pewności (liczba przebiegów, w których ten parametr się różnił). Wymaga co najmniej 3 przebiegów z różnymi wartościami danego parametru — inaczej system informuje, że danych jest za mało, nie zgaduje.
- FR-016: Użytkownik może porównać wyniki (punktację) wielu przebiegów symulacji side-by-side. Priority: nice-to-have
  > Socratic: Kontrargument rozważony: porównanie wymaga tej samej jednoznacznej formuły punktacji co FR-010. Rozstrzygnięcie: FR stoi, ale zależy od rozstrzygnięcia formuły/wag punktacji (patrz Open Questions).
- FR-017: Użytkownik może wyeksportować przebieg/parametry/wynik symulacji poza aplikację, w formacie JSON (pełna wierność — surowa historia przebiegu bez spłaszczania) oraz CSV (parametry + wynik w jednym wierszu, do porównań w arkuszu kalkulacyjnym; zagnieżdżone pola historii, takie jak phaseHistory czy survivorGenes, nie są częścią eksportu CSV). Priority: nice-to-have
  > Socratic: Kontrargument rozważony: format eksportu nieokreślony; dwa formaty podwajają zakres implementacji dla funkcji nice-to-have. Rozstrzygnięcie (2026-11-14, zamknięcie Open Question #2): użytkownik wybrał oba formaty — JSON dla pełnej, nieutraconej historii (do analizy skryptowej), CSV dla szybkiego porównania parametrów/wyniku w arkuszu. Zagnieżdżone tablice historii nie trafiają do CSV — to jest ograniczenie formatu, nie niedopatrzenie.

### Ograniczenia wydajnościowe

- FR-018: Admin konfiguruje globalny maksymalny limit liczby symulowanych obiektów (boidy + predatory), chroniąc płynność renderowania (guardrail). Priority: must-have
  > Socratic: Brak kontrargumentu — potwierdzone jako właściwe ujęcie (limit globalny, ustawiany przez admina).

### Serwerowe wykonanie symulacji (2026-11-14 extension — MS-01, MS-02, MS-03, MS-04, MS-05)

- FR-020: Rzeczywista (nie-stagingowa) symulacja jest wykonywana przez proces po stronie serwera, niezależny od połączenia klienta — działa dalej, jeśli użytkownik zamknie kartę przeglądarki. Priority: must-have
  > Socratic: Kontrargument rozważony: wykonanie po stronie klienta ogranicza liczbę/rozmiar symulacji do możliwości renderowania. Rozstrzygnięcie: przeniesienie wykonania na serwer usuwa to ograniczenie; renderowanie zostaje osobnym, opcjonalnym krokiem (FR-021).
- FR-021: Symulacje serwerowe działają bez etapu renderowania — renderowanie jest odrębną, opcjonalną operacją podglądu, nie częścią samego wykonania. Priority: must-have
  > Socratic: Brak kontrargumentu — konsekwencja FR-020.
- FR-022: Jedna symulacja kliencka (stagingowa, do dopasowywania parametrów) pozostaje dostępna, uruchamiana i renderowana w całości po stronie klienta, bez zmian względem oryginalnego MVP. Priority: must-have
  > Socratic: Brak kontrargumentu — staging nie wymaga trwałości po zamknięciu karty, więc zostaje bez zmian.
- FR-023: Użytkownik może obserwować dokładnie jedną symulację serwerową naraz, renderowaną w przeglądarce na podstawie stanu wypychanego przez serwer (push, nie polling). Priority: must-have
  > Socratic: Kontrargument rozważony: polling byłby prostszy, ale wprowadza zauważalne opóźnienie i niepotrzebny ruch sieciowy przy wielu działających symulacjach. Rozstrzygnięcie: SSE/WebSocket push, potwierdzone przez użytkownika.

### Ewaluacja etapu cyklu życiowego per cykl (2026-11-14 extension — MS-06)

- FR-019 (uszczegółowienie, 2026-11-14): Czwarty czynnik punktacji liczy premię za odporność proporcjonalnie do liczby zakończonych cykli załamanie→odbudowa w całym przebiegu, nie jako jednorazową flagę tak/nie za cały przebieg. Priority: must-have
  > Socratic: Kontrargument rozważony: jednorazowa flaga nie odróżniała przebiegu z jednym cyklem odbudowy od przebiegu z kilkoma — a te drugie demonstrują realną odporność silniej. Rozstrzygnięcie: premia skaluje się z liczbą zakończonych cykli (z rozsądnym pułapem), ustalonym na poziomie planu (`/10x-plan`), nie tutaj.

### Dashboard i analiza przebiegów (2026-11-14 extension — MS-07, MS-08)

- FR-024: Zaraz po zalogowaniu użytkownik trafia na dashboard listujący jego własne przebiegi symulacji (działające, zapisane, zakończone), ze statusem, czasem startu, filtrem i linkiem do szczegółu każdego przebiegu — zgodnie ze standardowymi konwencjami dashboardów przebiegów, nie wymyślonymi od nowa. Priority: must-have
  > Socratic: Kontrargument rozważony: dashboard mógłby być bespoke. Rozstrzygnięcie: użytkownik poprosił o zbadanie standardowych konwencji (Databricks, dbt, Control-M, Sauce Labs) i ich zastosowanie, nie wymyślanie własnych od zera.
- FR-025: Z dashboardu, dla zakończonego przebiegu, użytkownik otwiera widok analizy pokazujący wykres liczebności populacji w czasie (kolorowany etapami cyklu życiowego), rozkład czasu wg etapu/cyklu (zgodny z korektą z FR-019) oraz końcową wartość różnorodności genetycznej. Priority: must-have
  > Socratic: Kontrargument rozważony: trend różnorodności genetycznej w czasie wydawał się częścią zakresu, ale dane historyczne to tylko jedna migawka końcowa (geny ocalałych w momencie zakończenia), nie seria. Rozstrzygnięcie: v1 pokazuje jedną końcową wartość różnorodności, nie trend; trend wymagałby nowego śledzenia danych w czasie, poza zakresem tego rozszerzenia.

## Non-Functional Requirements

- A simulation with the maximum configured number of objects (FR-018) renders without visibly freezing or dropping below a usable frame rate for observation.
- Two runs started with identical parameters and the same random seed produce identical scores — comparison between variants is meaningless otherwise.
- A saved/paused simulation's state survives an app restart with no loss of population, genetic, or resource data.
- Switching which of several parallel simulations is being viewed does not interrupt or measurably slow the others.

## Business Logic

Each simulation run is scored as the **product of four factors**: how long the population survived, how efficiently it managed available food, how genetically diverse the surviving population remained, and the quality of the population's lifecycle-phase history over the run — and that score history drives heuristic suggestions for the single parameter change most correlated with improving the final score across the user's own past runs (resolved 2026-11-14; see FR-015).

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
- **No client-driven parallel rendering of multiple simulations at once** (2026-11-14 extension) — retired in favor of server-owned execution (FR-020–FR-023): the client renders at most one server-run simulation live at a time, switching between them (FR-013/FR-014) rather than rendering several simultaneously. Rationale: rendering was the actual scaling bottleneck, not execution; removing it from the critical path removes the limit on how many simulations can run or how large they can be.
- **No diversity-index trend over time in the analysis view (v1)** (2026-11-14 extension) — only a single final genetic-diversity value is shown (FR-025); a trend would require persisting a per-tick diversity series, which nothing downstream currently needs beyond this view. Rationale: avoid adding tracked state solely for a nice-to-have chart; revisit if a future slice needs the same series.

## Open Questions

1. ~~What are the relative weights/formula for the score (cycle length × resource management × genetic diversity)?~~ — **Resolved 2026-11-14.** Formula: equal product of four factors — cycle length (survival) × resource management × genetic diversity × population-lifecycle-phase quality (FR-010, FR-019; see Business Logic for the phase model and what the fourth factor rewards). The exact per-phase quality values and resilience-bonus magnitude are deferred to `/10x-plan` as planning-level tuning, not a product open question — the product rule (equal multiplicative product; phase factor rewards both sustained health and Crash→Recovery resilience) is fixed. Unblocks FR-016 (run comparison).
2. ~~What export format(s) should FR-017 support (CSV / JSON / image / other)?~~ — **Resolved 2026-11-14.** Both JSON (full-fidelity, unflattened history) and CSV (parameters + score, one row per run, no nested history fields). See FR-017. Unblocks S-14.
3. ~~Beyond defining parameter ranges and the object-count cap, does `admin` have any other capability — e.g. managing other users' simulations — or is the role split purely about parameter governance?~~ — **Resolved 2026-11-14 (by extension, not by direct answer).** The 2026-11-14 extensions (server-side execution, dashboard, analysis view) were all scoped to each user's own runs only — no cross-user admin capability was added. The role split beyond parameter/object-count governance (FR-002, FR-018) remains unspecified but is no longer blocking: every FR added since stays within per-user data isolation (dashboard and analysis view both reject access to another user's runs).
4. **Should F-05's per-run history persistence apply retroactively to already-archived runs, or only to runs that complete after it ships?** — Owner: user. Not blocking. Resolved by default during implementation: forward-only — pre-existing runs show only their final score; the analysis view (FR-025) degrades gracefully for runs without persisted history instead of crashing.
5. ~~What should the parameter-suggestion heuristic (FR-015) actually optimize toward, and what shape should its suggestion take?~~ — **Resolved 2026-11-14.** Optimizes toward the final combined score (FR-010), not an isolated factor; correlates each of the 13 admin-ranged parameters (FR-002) against the user's own past-run scores and suggests changing the single most-correlated one, with a one-line rationale and a confidence qualifier based on sample size (minimum 3 runs with that parameter varied). See FR-015. Unblocks S-13.
