/**
 * The bounded-window limits, in a module with no `server-only` and no imports.
 *
 * `proposal.ts` owns the ALGORITHM and is server-only, because a proposal
 * depends on the authenticated scope. The two NUMBERS are needed on both sides
 * — the browser assembles the same bounded notes from the same conversation —
 * so they live here rather than being written down twice and drifting.
 */

/** How many manager turns the bounded window may hold, including the current one. */
export const MANAGER_CONTEXT_TURNS = 6;

/** Characters the bounded window may hold in total. */
export const MANAGER_CONTEXT_CHARS = 4_000;
