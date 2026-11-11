import type { AIUsageRecord, Integration } from "@/types";

/*
 * THE AI USAGE FIGURES SIT ON TODAY, not on the old August demo clock, so the
 * screen reads like a deployment in use this month. Anchored to the start of
 * the current hour so the server render and the browser agree.
 */
function isoHoursFromNow(hours: number): string {
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  return new Date(hour + hours * 3_600_000).toISOString();
}

const THIS_MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "America/Chicago",
}).format(new Date());

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
    status: "connected",
    unlocks:
      "Live answers grounded in your knowledge base instead of the seeded demo responses.",
    category: "ai",
    iconKey: "sparkles",
    notes:
      "Demo deployment: answers come from the seeded demo corpus and no key is stored here. A live deployment sets ANTHROPIC_API_KEY.",
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
    notes:
      "Optional. Requires a Microsoft Entra app registration and Graph API permissions. " +
      "The knowledge base does not depend on it — retrieval runs on documents uploaded to Ask Sunny.",
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
    id: "int-apify",
    name: "Google Reviews via Apify",
    vendor: "Apify",
    description:
      "Server-side sync of Google reviews for all fifteen salons, with no browser open.",
    status: "connected",
    unlocks: "Reviews gained each week are counted automatically against every salon's goal.",
    category: "reviews",
    iconKey: "star",
    notes:
      "Demo deployment: the Google Review Source screen shows an invented, healthy source. Nothing contacts Apify.",
  },
  {
    id: "int-woven",
    name: "Woven",
    vendor: "Woven",
    description:
      "Employee directory and the policy, handbook and training library, synced on a schedule.",
    status: "connected",
    unlocks:
      "Who works where stays current, and an approved subset of the Woven library flows into the knowledge base.",
    category: "documents",
    iconKey: "library",
    notes:
      "Demo deployment: the Woven Employee Sync and Woven Knowledge Sync screens show a labelled sample set.",
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
  connected: true,
  monthLabel: THIS_MONTH,
  requestsThisMonth: 1284,
  requestsLast30Days: 1362,
  inputTokensThisMonth: 8_942_100,
  outputTokensThisMonth: 1_486_300,
  estimatedCostThisMonth: 214.62,
  estimatedCostLast30Days: 228.15,
  remainingCreditUsd: 785.38,
  creditPurchasedUsd: 1000,
  lastRefreshedAt: isoHoursFromNow(-1),
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
    at: isoHoursFromNow(-2),
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
    at: isoHoursFromNow(-3),
    feature: "Ask Sunny form — coaching draft",
    model: "claude-opus-5",
    requests: 1,
    inputTokens: 9180,
    outputTokens: 1440,
    estimatedCostUsd: 0.186,
    status: "succeeded",
  },
  {
    id: "usage-03",
    at: isoHoursFromNow(-5),
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
    at: isoHoursFromNow(-7),
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
    at: isoHoursFromNow(-9),
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
    at: isoHoursFromNow(-11),
    feature: "Ask Sunny form — policy review draft",
    model: "claude-sonnet-5",
    requests: 1,
    inputTokens: 7340,
    outputTokens: 1102,
    estimatedCostUsd: 0.041,
    status: "succeeded",
  },
  {
    id: "usage-07",
    at: isoHoursFromNow(-14),
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
    at: isoHoursFromNow(-19),
    feature: "Ask Sunny — chat answer",
    model: "claude-opus-5",
    requests: 1,
    inputTokens: 11240,
    outputTokens: 1980,
    estimatedCostUsd: 0.241,
    status: "succeeded",
  },
];
