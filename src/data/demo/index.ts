/**
 * Every piece of seeded demo content lives under `src/data/demo/`.
 * Nothing mock is ever inlined inside a component — swapping demo data for
 * live data is a change here, not a hunt through the UI.
 *
 * THE SALON ROSTER IS NOT HERE. It is production configuration and lives in
 * `src/data/salons.ts`, because authorization resolves through it and a file
 * that decides who may read whose figures must not sit behind a barrel named
 * `demo`. What remains below is seeded content ABOUT those salons — review
 * counts, revenue, coaching forms, employee names — all of it invented.
 */
export * from "./users";
export * from "./knowledge";
export * from "./videos";
export * from "./templates";
export * from "./forms";
export * from "./reviews";
export * from "./reports";
export * from "./resources";
export * from "./integrations";
export * from "./chat";
export * from "./dashboard";
