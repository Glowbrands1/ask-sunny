import {
  DEMO_CONVERSATIONS,
  DEMO_QUICK_ACTIONS,
  DEMO_FORM_TEMPLATES,
  DEMO_GENERATED_FORMS,
  DEMO_KNOWLEDGE_CHUNKS,
  DEMO_KNOWLEDGE_DOCUMENTS,
  DEMO_USERS,
  DEMO_VIDEOS,
  FALLBACK_ANSWER,
  DEMO_ANSWERS,
  userForRole as seededUserForRole,
} from "@/data/demo";
import type { Role } from "@/types";

import { AIUsageDemoScreen } from "@/features/admin/ai-usage-demo-screen";
import { IntegrationsRoadmapDemo } from "@/features/admin/integrations-roadmap-demo";
import { OverviewActivityDemo } from "@/features/dashboard/overview-activity-demo";
import { ResourcesDemoScreen } from "@/features/resources/resources-demo-screen";
import { ReviewsDemoScreen } from "@/features/reviews/reviews-demo-screen";
import { VideosActivityDemo } from "@/features/videos/videos-activity-demo";

import type { DemoRuntime } from "./types";

/**
 * ============================================================================
 * THE DEMO BOUNDARY — DEMO SIDE
 * ============================================================================
 *
 * The ONLY module in the repository that may import `data/demo/*` or a
 * demo-only screen. Everything else in the app talks to `runtime.ts`, whose
 * production implementation returns empty collections and absent screens, and
 * `next.config.ts` substitutes this file for that one when a build explicitly
 * asks for the demo.
 *
 * SO THE SEEDED DATASETS ARE REACHABLE FROM EXACTLY ONE PLACE, and a
 * production build does not import that place. The datasets are not tree-shaken
 * or lazily fetched; they are never named, so the bundler never emits them.
 *
 * WHY THE SCREENS ARE HERE TOO. They were dynamically imported at their call
 * sites, which kept them out of the initial download and still emitted them as
 * chunks carrying the seeded records. Naming them here instead moves them
 * behind the same boundary as the data they render: present in a demo build,
 * absent from a production one.
 *
 * EVERYTHING IS EAGERLY IMPORTED, deliberately. This module only exists in a
 * demo build, where the seeded content IS the product and a code-splitting
 * strategy for it would buy nothing.
 *
 * `runtime.ts` carries the full argument for this design; it is the file
 * somebody reads first.
 */
export const demoRuntime: DemoRuntime = {
  kind: "demo",
  quickActions: DEMO_QUICK_ACTIONS,

  async loadSeeds() {
    return {
      documents: DEMO_KNOWLEDGE_DOCUMENTS,
      videos: DEMO_VIDEOS,
      templates: DEMO_FORM_TEMPLATES,
      forms: DEMO_GENERATED_FORMS,
      conversations: DEMO_CONVERSATIONS,
    };
  },

  async loadAnswerBank() {
    return {
      answers: DEMO_ANSWERS,
      fallback: FALLBACK_ANSWER,
      videos: DEMO_VIDEOS,
    };
  },

  async loadKnowledge() {
    return { documents: DEMO_KNOWLEDGE_DOCUMENTS, chunks: DEMO_KNOWLEDGE_CHUNKS };
  },

  async loadUsers() {
    return DEMO_USERS;
  },

  async userForRole(role: Role) {
    return seededUserForRole(role);
  },

  screens: {
    aiUsage: AIUsageDemoScreen,
    integrationsRoadmap: IntegrationsRoadmapDemo,
    overviewActivity: OverviewActivityDemo,
    resources: ResourcesDemoScreen,
    reviews: ReviewsDemoScreen,
    videosActivity: VideosActivityDemo,
  },
};

export type {
  DemoAnswer,
  DemoAnswerBank,
  DemoKnowledge,
  DemoRuntime,
  DemoScreenSet,
  DemoSeeds,
} from "./types";
