import type { AIUsageRecord, Integration } from "@/types";
import { isoHoursFromAnchor } from "@/lib/utils/date";

/**
 * Integration catalogue — deliberately honest.
 *
 * Exactly one entry is "Connected": the browser-local prototype storage that
 * genuinely works. Everything else reports "Not connected", because it is.
 * Nothing here calls an external service.
 */
export const DEMO_INTEGRATIONS: Integration[] = [
  {
    id: "int-anthropic",
    name: "Claude",
    vendor: "Anthropic",
    description:
      "The language model behind Ask Sunny's answers, form drafting, and video matching.",
    status: "not_connected",
    unlocks:
      "Live answers grounded in your knowledge base instead of the seeded demo responses.",
    category: "ai",
    iconKey: "sparkles",
    notes:
      "Add ANTHROPIC_API_KEY to switch from MockAIProvider to ClaudeProvider. No key is stored in this prototype.",
  },
  {
    id: "int-sharepoint",
    name: "Microsoft SharePoint",
    vendor: "Microsoft",
    description: "Sync approved company documents into Ask Sunny's knowledge library.",
    status: "not_connected",
    unlocks:
      "Documents stay current automatically — no re-uploading when a policy changes.",
    category: "documents",
    iconKey: "folder-sync",
    notes: "Requires a Microsoft Entra app registration and Graph API permissions.",
  },
  {
    id: "int-powerbi",
    name: "Microsoft Power BI",
    vendor: "Microsoft",
    description: "Embed existing Power BI dashboards directly inside Reports & Analytics.",
    status: "not_connected",
    unlocks: "Managers stop leaving Ask Sunny to read their numbers.",
    category: "reporting",
    iconKey: "bar-chart-3",
    notes:
      "Reports arrive as Excel files today. Embedding needs a Power BI workspace and Microsoft access.",
  },
  {
    id: "int-google",
    name: "Google Business Profile",
    vendor: "Google",
    description: "Pull review counts and ratings for every location automatically.",
    status: "not_connected",
    unlocks:
      "Replaces the manual weekly review count — reviews gained is calculated, not counted by hand.",
    category: "reviews",
    iconKey: "star",
    notes:
      "Requires Google Business Profile API access and location ownership verification. Nothing is scraped.",
  },
  {
    id: "int-woven",
    name: "Woven",
    vendor: "Woven",
    description: "Where company documents live today.",
    status: "not_connected",
    unlocks: "An approved subset of the Woven library flows into the knowledge base.",
    category: "documents",
    iconKey: "library",
    notes:
      "No confirmed bulk export or public API yet — webhooks may exist. Their support contact will confirm. The full library is 600+ documents; only a focused subset should ever be ingested.",
  },
  {
    id: "int-m365",
    name: "Email / Microsoft 365",
    vendor: "Microsoft",
    description: "Send follow-up reminders and share generated forms by email.",
    status: "not_connected",
    unlocks: "Follow-up reminders reach managers without them opening the platform.",
    category: "communication",
    iconKey: "mail",
  },
  {
    id: "int-local-storage",
    name: "Local prototype storage",
    vendor: "Browser (IndexedDB)",
    description:
      "Stores uploaded documents, generated forms, and settings in this browser so the demo survives a refresh.",
    status: "connected",
    unlocks: "Working uploads and persistence with no server, database, or account.",
    category: "storage",
    iconKey: "hard-drive",
    notes:
      "Prototype only. Replaced by Supabase (or the selected database) in production.",
  },
];

/**
 * AI usage demo figures. Shaped so owners can confirm there is enough credit
 * balance before it runs out — the reason the client asked for this screen.
 */
export const DEMO_AI_USAGE = {
  provider: "Claude (Anthropic)",
  connected: false,
  monthLabel: "August 2026",
  requestsThisMonth: 1284,
  requestsLast30Days: 1362,
  inputTokensThisMonth: 8_942_100,
  outputTokensThisMonth: 1_486_300,
  estimatedCostThisMonth: 214.62,
  estimatedCostLast30Days: 228.15,
  remainingCreditUsd: 785.38,
  creditPurchasedUsd: 1000,
  lastRefreshedAt: isoHoursFromAnchor(-1),
};

export const AI_USAGE_BY_MODEL = [
  { model: "claude-opus-5", requests: 214, costUsd: 118.4 },
  { model: "claude-sonnet-5", requests: 902, costUsd: 82.7 },
  { model: "claude-haiku-4-5", requests: 168, costUsd: 13.52 },
];

export const AI_USAGE_BY_KEY = [
  { key: "ask-sunny-production", requests: 1104, costUsd: 186.3, status: "Planned" },
  { key: "ask-sunny-staging", requests: 180, costUsd: 28.32, status: "Planned" },
];

export const AI_USAGE_SERIES = [
  { label: "Wk 1", requests: 246, cost: 41.2 },
  { label: "Wk 2", requests: 288, cost: 48.6 },
  { label: "Wk 3", requests: 312, cost: 52.1 },
  { label: "Wk 4", requests: 438, cost: 72.72 },
];

export const DEMO_AI_USAGE_RECORDS: AIUsageRecord[] = [
  {
    id: "usage-01",
    at: isoHoursFromAnchor(-2),
    feature: "Ask Sunny — chat answer",
    model: "claude-sonnet-5",
    requests: 1,
    inputTokens: 6420,
    outputTokens: 812,
    estimatedCostUsd: 0.032,
    status: "succeeded",
  },
  {
    id: "usage-02",
    at: isoHoursFromAnchor(-3),
    feature: "Create a Form — coaching draft",
    model: "claude-opus-5",
    requests: 1,
    inputTokens: 9180,
    outputTokens: 1440,
    estimatedCostUsd: 0.186,
    status: "succeeded",
  },
  {
    id: "usage-03",
    at: isoHoursFromAnchor(-5),
    feature: "Ask Sunny — chat answer",
    model: "claude-sonnet-5",
    requests: 1,
    inputTokens: 5210,
    outputTokens: 604,
    estimatedCostUsd: 0.026,
    status: "succeeded",
  },
  {
    id: "usage-04",
    at: isoHoursFromAnchor(-7),
    feature: "Video recommendation match",
    model: "claude-haiku-4-5",
    requests: 1,
    inputTokens: 2140,
    outputTokens: 186,
    estimatedCostUsd: 0.004,
    status: "succeeded",
  },
  {
    id: "usage-05",
    at: isoHoursFromAnchor(-9),
    feature: "Knowledge search",
    model: "claude-haiku-4-5",
    requests: 1,
    inputTokens: 1860,
    outputTokens: 142,
    estimatedCostUsd: 0.003,
    status: "succeeded",
  },
  {
    id: "usage-06",
    at: isoHoursFromAnchor(-11),
    feature: "Create a Form — policy review draft",
    model: "claude-sonnet-5",
    requests: 1,
    inputTokens: 7340,
    outputTokens: 1102,
    estimatedCostUsd: 0.041,
    status: "succeeded",
  },
  {
    id: "usage-07",
    at: isoHoursFromAnchor(-14),
    feature: "Ask Sunny — chat answer",
    model: "claude-sonnet-5",
    requests: 1,
    inputTokens: 4980,
    outputTokens: 720,
    estimatedCostUsd: 0.028,
    status: "failed",
  },
  {
    id: "usage-08",
    at: isoHoursFromAnchor(-19),
    feature: "Ask Sunny — chat answer",
    model: "claude-opus-5",
    requests: 1,
    inputTokens: 11240,
    outputTokens: 1980,
    estimatedCostUsd: 0.241,
    status: "succeeded",
  },
];
