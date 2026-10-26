import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { goalContext } from "@/lib/reviews/goal";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";
import type { LocationRollup } from "@/lib/reviews/types";

import { isGoogleReviewQuestion, storeCodesNamedIn } from "./google-reviews-chat";

/*
 * Each test starts with GOOGLE_REVIEWS_IN_CHAT_ENABLED unset, so the suite reads the same whether
 * or not the environment running it turns the flag on; the flag-on cases set it
 * themselves. The environment's own value is restored after the file.
 */
const ENV_FLAGS = ["GOOGLE_REVIEWS_IN_CHAT_ENABLED"];
const ENV_SAVED = Object.fromEntries(ENV_FLAGS.map((name) => [name, process.env[name]]));
beforeEach(() => {
  for (const name of ENV_FLAGS) delete process.env[name];
});
afterAll(() => {
  for (const name of ENV_FLAGS) {
    const value = ENV_SAVED[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/**
 * QA T11, 25 Oct 2026, a 1-star chat: "Ask Sunny denies data the app has."
 *
 * Sunny answered Google review questions with "I don't have review counts...
 * the reports in this app don't carry Google review data" while /reviews
 * showed October month to date (136 qualifying against a 150 target, per
 * salon). The three wordings QA tested on production are below, verbatim.
 * The first is s23 from the replay set.
 *
 * Flag off, no review figure reaches the model and the prompt says it has no
 * report figures (the production answer). Flag on, the model gets the page's
 * own snapshot: the salons /reviews shows (every salon, the caller's marked),
 * the last sync, and a pointer to the page. An Employee gets a decline.
 *
 * COULD THIS BREAK: general questions, a question that only contains the word
 * "review", report answers, and the CHAT_DATA_TOOLS_ENABLED path. Each is
 * pinned below: the model's input is identical with the flag off and on.
 */

const ORIGINAL = "How many google reviews do we have this far";
const THIS_MONTH = "google reviews this month";
const MANHATTAN =
  "Can you tell me how many Google reviews KS Manhattan has this month and whether we are on track for the goal of 10?";

/*
 * HOW MANAGERS ACTUALLY TYPE (Pau, 26 Oct 2026: "lowercase or first letter
 * capitalized, should be like human"). Each wording in its lowercase, no
 * punctuation form and in sentence case, plus a polite chatty one.
 */
const REGISTER: { question: string; salon: string | null }[] = [
  { question: "google reviews count", salon: null },
  { question: "Google reviews count", salon: null },
  { question: "how many google reviews do we have this far", salon: null },
  { question: "How many google reviews do we have this far", salon: null },
  { question: "reviews this month ks manhattan", salon: "306" },
  { question: "Reviews this month ks manhattan", salon: "306" },
  { question: "r we on track for reviews", salon: null },
  { question: "R we on track for reviews", salon: null },
  { question: "hi sunny can you tell me how many google reviews ks manhattan has this month and whether we are on track for the goal", salon: "306" },
  { question: "Hi Sunny, can you tell me how many Google reviews KS Manhattan has this month and whether we are on track for the goal?", salon: "306" },
];

const TODAY = "2026-10-25";

/** 136 qualifying across the fifteen, KS Manhattan on 9. */
const MONTH_TO_DATE: Record<string, number> = {
  "140": 8, "141": 10, "143": 7, "144": 12, "145": 9, "146": 6, "147": 11, "148": 10,
  "231": 5, "254": 9, "306": 9, "307": 8, "314": 7, "373": 13, "409": 12,
};

function location(storeCode: string): LocationRollup {
  const listing = GOOGLE_REVIEW_LOCATIONS.find((entry) => entry.storeCode === storeCode)!;
  return {
    storeCode,
    locationName: listing.googleLabel,
    district: null,
    salonNumber: listing.salonNumber,
    listingState: "verified",
    anchorReviewId: `anchor-${storeCode}`,
    anchorReviewer: null,
    historical: 0,
    reviewsThisWeek: 2,
    qualifyingThisWeek: 2,
    lastWeek: 3,
    qualifyingLastWeek: 3,
    qualifyingMonthToDate: MONTH_TO_DATE[storeCode],
    unanswered: 0,
    criticalOpen: 0,
    averageRating: 4.6,
    total: 40,
  };
}

const HOUR = 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  snapshotReads: 0,
  /** Hours since the last sync, relative to the real clock the reader uses. */
  syncedHoursAgo: 3,
  snapshotFails: false,
  briefing: false,
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  supabaseReadiness: () => ({ ready: true, missing: [] }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("@/lib/reviews/queries", () => ({
  loadReviewsSnapshot: async () => {
    state.snapshotReads += 1;
    if (state.snapshotFails) throw new Error("read failed");
    return {
      empty: false,
      lastSyncAt: new Date(Date.now() - state.syncedHoursAgo * HOUR).toISOString(),
      locations: GOOGLE_REVIEW_LOCATIONS.map((entry) => location(entry.storeCode)),
      goal: goalContext(TODAY, 10),
    };
  },
  loadRatingDistribution: async () => ({ total: 0, counts: [0, 0, 0, 0, 0] }),
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => null,
  suggestFormsForTurn: () => null,
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("no library in this test");
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return null;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () =>
    state.briefing
      ? { text: "REPORT DATA\n\nSales Totals, KS Lawrence, 2026-10-24: grand total 1,234.", present: ["sales-totals"], missing: [] }
      : null,
}));

vi.mock("@/lib/reporting/scope/server", () => ({
  resolveScopeFor: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("@/lib/forms/chat-form-records", async () => {
  const actual = await vi.importActual<typeof import("@/lib/forms/chat-form-records")>(
    "@/lib/forms/chat-form-records",
  );
  return { ...actual, loadFormRecords: async () => null };
});

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return "Answer.";
  },
}));

type Actor = {
  role: "owner" | "salon_director" | "employee" | "district_manager";
  scope: { level: "global" | "salon"; primaryAreaId: string | null; alsoCoversAreaIds: string[] };
  subject: string;
  verified: boolean;
};

const OWNER: Actor = {
  role: "owner",
  scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
  subject: "user-owner",
  verified: true,
};
const MANHATTAN_SD: Actor = {
  role: "salon_director",
  scope: { level: "salon", primaryAreaId: "loc-0462", alsoCoversAreaIds: [] },
  subject: "user-sd",
  verified: true,
};
const LAWRENCE_SD: Actor = { ...MANHATTAN_SD, scope: { ...MANHATTAN_SD.scope, primaryAreaId: "loc-0468" } };
const MANHATTAN_EMPLOYEE: Actor = { ...MANHATTAN_SD, role: "employee", subject: "user-employee" };

async function ask(question: string, actor: Actor) {
  const { answerQuestion } = await import("./server-ask");
  await answerQuestion(
    {
      question,
      mode: "standard" as const,
      history: [],
      scopeId: "stc-core",
      context: { userName: "Quill Varden", locationName: "KS Manhattan", todayIso: TODAY },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    actor,
  );
  return {
    reportData: (state.claudeInput?.reportData as string | null) ?? "",
    system: (state.claudeInput?.system as string) ?? "",
    input: state.claudeInput,
  };
}

/* The first import of the chat path is slow; it is not what is under test. */
beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

const DENIAL = "You have NO report figures for this question";

beforeEach(() => {
  state.claudeInput = null;
  state.snapshotReads = 0;
  state.syncedHoursAgo = 3;
  state.snapshotFails = false;
  state.briefing = false;
});

afterEach(() => {
  delete process.env.GOOGLE_REVIEWS_IN_CHAT_ENABLED;
  delete process.env.CHAT_DATA_TOOLS_ENABLED;
});

describe("QA T11: the three production wordings are Google review questions", () => {
  it.each([ORIGINAL, THIS_MONTH, MANHATTAN])("%s", (question) => {
    expect(isGoogleReviewQuestion(question)).toBe(true);
  });

  it("names KS Manhattan, and leaves other kinds of review alone", () => {
    expect(storeCodesNamedIn(MANHATTAN)).toEqual(["306"]);
    expect(storeCodesNamedIn(ORIGINAL)).toEqual([]);
    expect(isGoogleReviewQuestion("how many performance reviews are due this month")).toBe(false);
    expect(isGoogleReviewQuestion("can you review the attendance policy with me")).toBe(false);
  });
});

describe("QA T11, flag off: the production path, which denies the data", () => {
  it.each([ORIGINAL, THIS_MONTH, MANHATTAN])("%s", async (question) => {
    const { reportData, system } = await ask(question, OWNER);
    expect(state.snapshotReads).toBe(0);
    expect(reportData).not.toContain("GOOGLE REVIEWS");
    expect(system).toContain(DENIAL);
  });
});

describe("QA T11, flag on: the /reviews figures reach the answer", () => {
  beforeEach(() => {
    process.env.GOOGLE_REVIEWS_IN_CHAT_ENABLED = "true";
  });

  it("KS Manhattan this month against the goal of 10, for the Manhattan Salon Director", async () => {
    const { reportData, system } = await ask(MANHATTAN, MANHATTAN_SD);
    expect(state.snapshotReads).toBe(1);
    expect(reportData).toContain("GOOGLE REVIEWS — MONTH TO DATE");
    expect(reportData).toContain("Period: October 2026 month to date, Oct 1 – Oct 25 (Central time).");
    expect(reportData).toContain("Data as of: the last Google review sync,");
    expect(reportData).not.toContain("more than 2 days old");
    expect(reportData).toContain("Goal: 10 qualifying Google reviews");
    expect(reportData).toContain(
      "- KS Manhattan (store 306, this manager's salon): 9 qualifying reviews month to date of the 10 goal, 1 still needed. Status: On pace.",
    );
    expect(reportData).toContain("The manager can see the same figures on Google Reviews in the sidebar.");
    // Only the salon asked about.
    expect(reportData).not.toContain("KS Lawrence");
    expect(system).not.toContain(DENIAL);
  });

  it("the original wording (s23), for the owner, carries every salon and the 136 of 150 total", async () => {
    const { reportData, system } = await ask(ORIGINAL, OWNER);
    expect(reportData).toContain("KS Manhattan (store 306): 9 qualifying");
    expect(reportData).toContain("MO St Joseph (store 409): 12 qualifying");
    expect(reportData).toContain(
      "Total for the 15 counting salons above: 136 qualifying reviews month to date against a combined goal of 150.",
    );
    expect(system).not.toContain(DENIAL);
  });

  it("google reviews this month, for a Salon Director, is what the page shows them, their salon marked", async () => {
    const { reportData } = await ask(THIS_MONTH, MANHATTAN_SD);
    expect(reportData).toContain("KS Manhattan (store 306, this manager's salon): 9 qualifying");
    expect(reportData).toContain("KS Lawrence (store 314): 7 qualifying");
    expect(reportData).toContain("Total for the 15 counting salons above: 136");
  });

  it("another salon's figure, which /reviews shows them too, is given, not refused", async () => {
    const { reportData } = await ask(MANHATTAN, LAWRENCE_SD);
    expect(reportData).toContain("- KS Manhattan (store 306): 9 qualifying reviews month to date of the 10 goal");
    expect(reportData).not.toContain("this manager's salon");
  });

  it("a sync more than 2 days old is said first, with the page named", async () => {
    state.syncedHoursAgo = 72;
    const { reportData } = await ask(MANHATTAN, MANHATTAN_SD);
    expect(reportData).toContain("The last sync is more than 2 days old. Say so first");
    expect(reportData).toContain("the latest are on Google Reviews in the sidebar.");
  });

  it("a failed read gives no figure and points to the page", async () => {
    state.snapshotFails = true;
    const { reportData, system } = await ask(MANHATTAN, MANHATTAN_SD);
    expect(reportData).toContain("The Google review figures could not be read just now. No figure was estimated.");
    expect(reportData).toContain("point the manager to Google Reviews in the sidebar.");
    expect(reportData).not.toMatch(/\d+ qualifying/);
    expect(system).toContain(DENIAL);
  });

  it.each([ORIGINAL, THIS_MONTH, MANHATTAN])("an Employee is declined and nothing is read: %s", async (question) => {
    const { reportData, system } = await ask(question, MANHATTAN_EMPLOYEE);
    expect(state.snapshotReads).toBe(0);
    expect(reportData).toContain("This account's role does not include View Google reviews.");
    expect(reportData).not.toMatch(/\d+ qualifying/);
    // They cannot open the page, so it is not offered.
    expect(reportData).not.toContain("sidebar");
    // No figures attached, so the prompt keeps saying it has none.
    expect(system).toContain(DENIAL);
  });
});

describe("QA T11: the managers' register, lowercase and sentence case", () => {
  beforeEach(() => {
    process.env.GOOGLE_REVIEWS_IN_CHAT_ENABLED = "true";
  });

  it.each(REGISTER)("$question", async ({ question, salon }) => {
    expect(isGoogleReviewQuestion(question)).toBe(true);
    expect(storeCodesNamedIn(question)).toEqual(salon ? [salon] : []);
    const { reportData, system } = await ask(question, MANHATTAN_SD);
    expect(reportData).toContain("KS Manhattan (store 306, this manager's salon): 9 qualifying reviews month to date of the 10 goal");
    if (salon) expect(reportData).not.toContain("KS Lawrence");
    else expect(reportData).toContain("Total for the 15 counting salons above: 136");
    expect(system).not.toContain(DENIAL);
  });

  it.each(REGISTER)("an Employee is declined: $question", async ({ question }) => {
    const { reportData } = await ask(question, MANHATTAN_EMPLOYEE);
    expect(state.snapshotReads).toBe(0);
    expect(reportData).toContain("This account's role does not include View Google reviews.");
  });
});

describe("QA T11, could this break: other answers are unchanged by the flag", () => {
  const UNCHANGED: { question: string; actor: Actor; briefing: boolean }[] = [
    { question: "How do I run a performance review with my assistant salon director?", actor: MANHATTAN_SD, briefing: false },
    { question: "Can you review the attendance policy with me?", actor: MANHATTAN_SD, briefing: false },
    { question: "how do i do a performance review", actor: MANHATTAN_SD, briefing: false },
    { question: "review the attendance policy w me", actor: MANHATTAN_SD, briefing: false },
    { question: "What is the dress code policy?", actor: MANHATTAN_EMPLOYEE, briefing: false },
    { question: "whats the dress code", actor: MANHATTAN_EMPLOYEE, briefing: false },
    { question: "What was revenue yesterday at KS Lawrence?", actor: { ...MANHATTAN_SD, role: "district_manager" }, briefing: true },
    { question: "What was revenue yesterday at KS Lawrence?", actor: OWNER, briefing: true },
    { question: "revenue yesterday ks lawrence", actor: OWNER, briefing: true },
  ];

  for (const tools of [false, true]) {
    it.each(UNCHANGED)(`CHAT_DATA_TOOLS_ENABLED ${tools ? "on" : "off"}: $question ($actor.role)`, async ({ question, actor, briefing }) => {
      if (tools) process.env.CHAT_DATA_TOOLS_ENABLED = "true";
      state.briefing = briefing;
      const off = (await ask(question, actor)).input;
      process.env.GOOGLE_REVIEWS_IN_CHAT_ENABLED = "true";
      const on = (await ask(question, actor)).input;
      expect(off).not.toBeNull();
      if (briefing) expect(String(off?.reportData)).toContain("Sales Totals, KS Lawrence");
      expect(on).toEqual(off);
      expect(String(on?.reportData ?? "")).not.toContain("GOOGLE REVIEWS — MONTH TO DATE");
    });
  }
});

describe("QA T11: one review block per turn", () => {
  it("CHAT_DATA_TOOLS does not read reviews again once the month-to-date block is attached", async () => {
    const { loadChatDataBlock } = await import("./chat-data-tools");
    let reads = 0;
    const block = await loadChatDataBlock({
      enabled: true,
      question: MANHATTAN,
      role: "owner",
      scope: OWNER.scope,
      briefedFamilies: [],
      reviewsHandled: true,
      choose: async () => "reviews",
      readReviews: async () => {
        reads += 1;
        return "WEEKLY REVIEW BLOCK";
      },
    });
    expect(reads).toBe(0);
    expect(block.data).toBeNull();
  });
});
