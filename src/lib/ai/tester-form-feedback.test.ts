import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE TESTERS' OWN CONVERSATIONS, TURN BY TURN
 * ============================================================================
 *
 * District managers rated these one star between 23 and 29 September 2026:
 *
 *   "provided sunny the following information twice and sunny still did not
 *    create coaching form: employees name, lisa smith, location was lawrence
 *    and lisa's title is tanning consultant. told sunny to use today's date
 *    twice."
 *
 *   "did not create CA form, told sunny twice the employee name, job title and
 *    location and sunny still asked for that info after it was provided"
 *
 *   "did not create ca form even though i went back twice and added 'missing
 *    information'"
 *
 * Each conversation is replayed the way the browser sends it: the whole
 * history, plus the continuation hint `continuationFor` reads off the last
 * assistant turn. The model is mocked, so a turn that falls through to the
 * grounded path is visible as a turn with no proposal — which is exactly what
 * a tester saw as "Sunny asked again".
 *
 * The accounts are global-scope district managers, as the testers' are on the
 * live project.
 */

const state = vi.hoisted(() => ({
  claudeCalls: 0,
  templates: [] as unknown[],
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => state.templates,
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return null;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async () => {
    state.claudeCalls += 1;
    return "Please give me the employee's name, job title and location.";
  },
}));

function realLibrary() {
  return TEMPLATE_SEEDS.map((seed) => ({
    id: `tpl-${seed.key}`,
    key: seed.key,
    name: seed.name,
    shortName: seed.shortName,
    description: seed.description,
    category: seed.category,
    layoutFamily: seed.layoutFamily,
    requiredPermission: seed.requiredPermission,
    active: true,
    displayOrder: seed.displayOrder,
    currentVersion: {
      id: `v-${seed.key}`,
      status: "published",
      document: seed.document,
      variants: seed.variants,
    },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
  }));
}

const TODAY = "2026-09-23";

/**
 * Plays manager turns in order, as the browser would, and returns every
 * assistant answer. The history each turn carries is the real one so far, and
 * the continuation hint is read with the browser's own `continuationFor`.
 */
async function converse(turns: string[]) {
  const { answerQuestion } = await import("./server-ask");
  const history: ChatMessage[] = [];
  const answers = [];
  for (const [index, question] of turns.entries()) {
    const answer = await answerQuestion(
      {
        question,
        mode: "standard",
        history: history as never,
        scopeId: "sun-tan-city",
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Colene", todayIso: TODAY },
      } as never,
      { role: "district_manager" as never, scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as never },
    );
    answers.push(answer);
    history.push(
      { id: `u${index}`, role: "user", content: question, createdAt: "" } as ChatMessage,
      {
        id: `a${index}`,
        role: "assistant",
        content: answer.content,
        createdAt: "",
        ...(answer.formProposal ? { formProposal: answer.formProposal } : {}),
      } as ChatMessage,
    );
  }
  return answers;
}

beforeEach(() => {
  vi.resetModules();
  state.claudeCalls = 0;
  state.templates = realLibrary();
});

describe("Coaching Form — the details given after the intake", () => {
  it("reads the tester's sentence and keeps the form open", async () => {
    const answers = await converse([
      "I need a coaching form",
      "employees name lisa smith, location was lawrence and lisa's title is tanning consultant. use today's date",
    ]);
    const last = answers.at(-1)!;
    expect(last.formProposal?.templateKey).toBe("coaching");
    expect(last.formProposal?.employeeName?.toLowerCase()).toBe("lisa smith");
    expect(last.formProposal?.employeeRole).toBe("Tanning Consultant");
    expect(last.formProposal?.locationId).toBe("loc-0468");
    expect(last.formProposal?.formDate).toBe(TODAY);
    expect(last.formProposal?.status).toBe("ready");
    expect(last.formProposal?.supportsInlineDraft).toBe(true);
  });

  it("combines the details across turns", async () => {
    const answers = await converse([
      "Coaching form for Lisa Smith",
      "Lawrence, Tanning Consultant, use today's date",
    ]);
    const last = answers.at(-1)!;
    expect(last.formProposal?.templateKey).toBe("coaching");
    expect(last.formProposal?.employeeName).toBe("Lisa Smith");
    expect(last.formProposal?.employeeRole).toBe("Tanning Consultant");
    expect(last.formProposal?.locationId).toBe("loc-0468");
    expect(last.formProposal?.formDate).toBe(TODAY);
  });

  it("reads everything in one sentence", async () => {
    const [answer] = await converse([
      "Create a coaching form for Lisa Smith. She is a Tanning Consultant at Lawrence. Use today's date.",
    ]);
    expect(answer!.formProposal?.templateKey).toBe("coaching");
    expect(answer!.formProposal?.employeeName).toBe("Lisa Smith");
    expect(answer!.formProposal?.employeeRole).toBe("Tanning Consultant");
    expect(answer!.formProposal?.locationId).toBe("loc-0468");
    expect(answer!.formProposal?.formDate).toBe(TODAY);
    expect(answer!.formProposal?.status).toBe("ready");
  });
});

describe("Corrective Action Form — name, title and location given after the intake", () => {
  it("does not ask for them again", async () => {
    const answers = await converse([
      "create a CA",
      "employee name is maria lopez, job title is tanning consultant, location is lawrence",
    ]);
    const last = answers.at(-1)!;
    expect(last.formProposal?.templateKey).toBe("dpoa");
    expect(last.formProposal?.employeeName?.toLowerCase()).toBe("maria lopez");
    expect(last.formProposal?.locationId).toBe("loc-0468");
    expect(last.content).not.toMatch(/Who is this/i);
  });

  it("an incident description after the name stays on the form", async () => {
    const answers = await converse([
      "CA for maria lopez",
      "she did not call in for her shift on saturday and did not show up",
    ]);
    const last = answers.at(-1)!;
    expect(last.formProposal?.templateKey).toBe("dpoa");
    expect(last.formProposal?.employeeName?.toLowerCase()).toBe("maria lopez");
  });
});

describe("the answer a manager gives stays on the form they opened", () => {
  it("a salon on its own is the salon, never the employee", async () => {
    const answers = await converse(["Coaching form for Lisa Smith", "Lawrence"]);
    const last = answers.at(-1)!;
    expect(last.formProposal?.employeeName).toBe("Lisa Smith");
    expect(last.formProposal?.locationId).toBe("loc-0468");
  });

  it("\"verbal warning\" inside the incident does not switch a Coaching Form to a Corrective Action", async () => {
    const answers = await converse([
      "Coaching form for Lisa Smith",
      "she was late again today, she already got a verbal warning last week",
    ]);
    expect(answers.at(-1)!.formProposal?.templateKey).toBe("coaching");
  });

  it("the exit paperwork mentioned in passing does not switch it to the Exit Form", async () => {
    const answers = await converse([
      "Coaching form for Lisa Smith",
      "she was 30 minutes late and said she'd rather do the exit paperwork than come in on time",
    ]);
    expect(answers.at(-1)!.formProposal?.templateKey).toBe("coaching");
  });

  it("\"corrective action\" named in the history does not drop the open form for the ladder", async () => {
    const answers = await converse([
      "Coaching form for Lisa Smith",
      "she received corrective action last year for the same thing",
    ]);
    expect(answers.at(-1)!.formProposal?.templateKey).toBe("coaching");
  });

  it("asking for a different form does switch", async () => {
    const answers = await converse(["Coaching form for Lisa Smith", "actually let's do a CA instead"]);
    expect(answers.at(-1)!.formProposal?.templateKey).toBe("dpoa");
    expect(answers.at(-1)!.formProposal?.employeeName).toBe("Lisa Smith");
  });

  it("a question asked while a form is open is still answered as a question", async () => {
    const answers = await converse([
      "Coaching form for Lisa Smith",
      "what is the policy on no call no shows?",
    ]);
    expect(answers.at(-1)!.formProposal).toBeUndefined();
    expect(state.claudeCalls).toBe(1);
  });

  it("a statement with nothing for the form is still a new subject", async () => {
    const answers = await converse(["Coaching form for Lisa Smith", "thanks, show me this week's PPTA"]);
    expect(answers.at(-1)!.formProposal).toBeUndefined();
  });
});

describe("Coaching or Corrective Action — what the model is told", () => {
  it("the chat rules and the drafting rules both say an acknowledged policy is not a knowledge gap", async () => {
    const { EMPLOYEE_PERFORMANCE_RULES } = await import("./prompts");
    const { PERFORMANCE_MANAGEMENT_DRAFT_RULES } = await import("@/lib/forms/escalation-guard");
    expect(EMPLOYEE_PERFORMANCE_RULES).toMatch(/Do not default to coaching for an attendance/);
    expect(EMPLOYEE_PERFORMANCE_RULES).toMatch(/completed the relevant training \(for example TC Training\)/);
    expect(EMPLOYEE_PERFORMANCE_RULES).toMatch(/ask the one question that settles it, rather than defaulting to coaching/);
    expect(PERFORMANCE_MANAGEMENT_DRAFT_RULES.join(" ")).toMatch(/A POLICY THE EMPLOYEE ALREADY KNEW IS NOT A KNOWLEDGE GAP/);
  });
});
