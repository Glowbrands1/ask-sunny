import type { QuickAction } from "@/data/quick-actions";
import type {
  AnswerMode,
  ChatConversation,
  FormTemplate,
  GeneratedForm,
  Integration,
  KnowledgeChunk,
  KnowledgeDocument,
  Role,
  User,
  VideoResource,
} from "@/types";

/**
 * ============================================================================
 * THE SHAPE OF SEEDED CONTENT, WITHOUT ANY OF IT
 * ============================================================================
 *
 * Types only. This module is imported by the PRODUCTION side of the demo
 * boundary, so it must be able to describe a seeded answer bank without
 * containing one — and a type import is erased by the compiler, so nothing
 * here reaches a bundle at all.
 *
 * `DemoAnswer` in particular moved here from `data/demo/chat.ts`. It was the
 * last thread connecting a production module to that file: `mock-provider.ts`
 * took the shape with `import type`, which ships nothing, but left a reference
 * that every reviewer then had to re-verify as harmless. The boundary is
 * easier to trust when there is no line to explain.
 */

/** One seeded answer in the demo bank, in each of the three lengths. */
export interface DemoAnswer {
  id: string;
  /** Lowercase keywords matched against the manager's question. */
  matchers: string[];
  quick: string;
  standard: string;
  detailed: string;
  citationChunkIds: string[];
  videoIds: string[];
  followUps?: string[];
}

/** The collections the client store seeds itself from in demo mode. */
export interface DemoSeeds {
  readonly documents: readonly KnowledgeDocument[];
  readonly videos: readonly VideoResource[];
  readonly templates: readonly FormTemplate[];
  readonly forms: readonly GeneratedForm[];
  readonly conversations: readonly ChatConversation[];
}

/** What `MockAIProvider` answers from. */
export interface DemoAnswerBank {
  readonly answers: readonly DemoAnswer[];
  readonly fallback: Record<AnswerMode, string>;
  readonly videos: readonly VideoResource[];
}

/** What the seeded retriever searches. */
export interface DemoKnowledge {
  readonly documents: readonly KnowledgeDocument[];
  readonly chunks: readonly KnowledgeChunk[];
}

/**
 * The demo-only screens, as components or null.
 *
 * NULL IS THE PRODUCTION ANSWER, and it is why these live on the boundary
 * rather than behind `next/dynamic` at each call site. A dynamic import keeps
 * a module out of the initial download but still EMITS it — the seeded records
 * end up in a chunk on disk that nothing fetches. Holding the components here
 * means the production implementation simply does not name them, so they never
 * enter the compilation graph and are never emitted.
 */
export interface DemoScreenSet {
  readonly aiUsage: (() => React.ReactNode) | null;
  readonly integrationsRoadmap:
    | ((props: { onOpen: (integration: Integration) => void }) => React.ReactNode)
    | null;
  readonly overviewActivity: ((props: { role: Role }) => React.ReactNode) | null;
  readonly resources: (() => React.ReactNode) | null;
  readonly reviews: (() => React.ReactNode) | null;
  readonly videosActivity: (() => React.ReactNode) | null;
}

/**
 * Everything the app can ask the demo boundary for.
 *
 * ONE INTERFACE, TWO IMPLEMENTATIONS, SELECTED AT BUILD TIME. Production code
 * imports `@/lib/demo/runtime` and gets the production implementation unless
 * the build explicitly asks for the demo one.
 */
export interface DemoRuntime {
  /** Which implementation this build selected. Reported by the health route. */
  readonly kind: "production" | "demo";
  /**
   * Navigation tiles that exist only in a demo build.
   *
   * Empty in production. It holds the one destination nobody has verified —
   * a Lovable preview host — which a runtime filter could hide but not
   * un-ship.
   */
  readonly quickActions: readonly QuickAction[];
  loadSeeds(): Promise<DemoSeeds>;
  loadAnswerBank(): Promise<DemoAnswerBank>;
  loadKnowledge(): Promise<DemoKnowledge>;
  loadUsers(): Promise<readonly User[]>;
  userForRole(role: Role): Promise<User | null>;
  readonly screens: DemoScreenSet;
}
