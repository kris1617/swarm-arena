// Keeps worst-case total simulated objects bounded across every start path
// (client-staged `start` and server-owned `startServer` alike) — see
// `simulation.ts`'s cap check.
export const MAX_PARALLEL_RUNS = 4;
