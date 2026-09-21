import type {
  DemoAnswerBank,
  DemoKnowledge,
  DemoRuntime,
  DemoScreenSet,
  DemoSeeds,
} from "./types";

/**
 * ============================================================================
 * THE DEMO BOUNDARY — PRODUCTION SIDE
 * ============================================================================
 *
 * This file is the one every production-reachable module imports, and it
 * contains no seeded content and no import of `data/demo/*`. Its answers are
 * empty collections and absent screens.
 *
 * `next.config.ts` swaps this module for `runtime.demo.ts` when — and only
 * when — a build explicitly asks for the demo. So in an ordinary production
 * build the seeded datasets are not merely unreachable at runtime: they are
 * never named by anything in the compilation graph, and the bundler never
 * emits them.
 *
 * ============================================================================
 * WHY A BUILD-TIME SWAP AND NOT A DYNAMIC IMPORT
 * ============================================================================
 *
 * The previous design reached the seeds through `await import("@/data/demo")`
 * and `dynamic(() => import(...))` inside demo-only branches. That was a real
 * improvement — no production PAGE downloaded seeded records, and the build
 * guard proved it — but it did not meet the requirement as written, because a
 * dynamic import still EMITS its module. Eleven chunks sat in `.next/static`
 * carrying Jane Kowalski, `example.com/policies` and a fabricated $214.62,
 * fetched by nobody and present nonetheless.
 *
 * A module that is not imported is not emitted. That is the only mechanism
 * that gets the datasets out of the output entirely, and it is what this
 * boundary buys.
 *
 * ============================================================================
 * ONE BOUNDARY, NOT TEN ALIASES
 * ============================================================================
 *
 * The obvious alternative was to alias each of the ten `data/demo/*` modules
 * to a stub. It was rejected for a specific reason rather than on taste: those
 * modules export about twenty-five names between them, a bundler FAILS on an
 * import of a name a module does not export, and the list cannot be derived
 * reliably by reading source — a name reached as `chat.FALLBACK_ANSWER` after
 * a destructured `import()` does not look like an import at all. A stub that
 * missed one would break the build, and a stub that drifted would break it
 * later, in a deploy.
 *
 * One module with one hand-written interface has neither failure mode:
 * TypeScript checks both implementations against `DemoRuntime`, so a missing
 * member is a compile error in the repository rather than a surprise in CI.
 *
 * ============================================================================
 * IT IS A BUILD CONFIGURATION, NEVER A RUNTIME TOGGLE
 * ============================================================================
 *
 * Nothing here reads an environment variable. A production build cannot become
 * a demo build by setting something at runtime, because the demo code is not
 * in the bundle to switch to. `isDemoMode()` still gates what RENDERS — the
 * two work together — but this decides what EXISTS, and it is decided once,
 * when the build runs.
 */

const EMPTY_SEEDS: DemoSeeds = {
  documents: [],
  videos: [],
  templates: [],
  forms: [],
  conversations: [],
};

/**
 * The fallback text, per answer length.
 *
 * Empty strings rather than a sentence, because nothing in production reaches
 * this: `MockAIProvider` is only constructed in demo mode. A plausible message
 * here would be a fabricated assistant answer waiting for a bug to surface it.
 */
const EMPTY_ANSWER_BANK: DemoAnswerBank = {
  answers: [],
  fallback: { quick: "", standard: "", detailed: "" },
  videos: [],
};

const EMPTY_KNOWLEDGE: DemoKnowledge = { documents: [], chunks: [] };

/** No demo screen exists in a production build. */
const NO_SCREENS: DemoScreenSet = {
  aiUsage: null,
  integrationsRoadmap: null,
  overviewActivity: null,
  resources: null,
  reviews: null,
  videosActivity: null,
};

export const demoRuntime: DemoRuntime = {
  kind: "production",
  quickActions: [],
  async loadSeeds() {
    return EMPTY_SEEDS;
  },
  async loadAnswerBank() {
    return EMPTY_ANSWER_BANK;
  },
  async loadKnowledge() {
    return EMPTY_KNOWLEDGE;
  },
  async loadUsers() {
    return [];
  },
  async userForRole() {
    return null;
  },
  screens: NO_SCREENS,
};

export type {
  DemoAnswer,
  DemoAnswerBank,
  DemoKnowledge,
  DemoRuntime,
  DemoScreenSet,
  DemoSeeds,
} from "./types";
