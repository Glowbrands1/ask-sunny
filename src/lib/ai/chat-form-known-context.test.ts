import { describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * ASK ONLY FOR WHAT IS ACTUALLY MISSING
 * ============================================================================
 *
 * Every chat form flow reads what it already knows — the salon from the
 * authenticated account or from a salon the manager named inside it, and the
 * employee, date, account of what happened, job title and follow-up from the
 * manager's own words — and asks only about the rest. A salon outside the
 * manager's assignment is never filled in.
 */

const SALON: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0101",
  alsoCoversAreaIds: [],
};

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-coaching-id",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "The everyday documented coaching conversation.",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published" },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

function dpoa(overrides: Record<string, unknown> = {}) {
  return template({
    id: "tpl-dpoa-id",
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "DPOA",
    description: "The formal corrective step after coaching.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    ...overrides,
  });
}

function epp(overrides: Record<string, unknown> = {}) {
  return template({
    id: "tpl-sdit-epp-id",
    key: "sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 4,
    ...overrides,
  });
}

/**
 * The library snapshot the turn under test carries.
 *
 * `proposeFormForTurn` no longer reads the library itself — `answerQuestion`
 * reads it ONCE per turn and passes the same rows to the proposal, to the
 * inventory the prompt is given, and to any inventory answer. Two reads could
 * land either side of a publish, and then a proposal card would offer a form
 * the sentence beside it said did not exist.
 *
 * Held in a module-scoped variable so every existing `turn(...)` call keeps
 * working unchanged: `load()` sets it, `turn()` attaches it.
 */
let library: Record<string, unknown>[] = [];

async function load(summaries: Record<string, unknown>[]) {
  vi.resetModules();
  library = summaries;
  const calls: string[] = [];

  /*
   * BOTH READS THROW. This module is now a pure function of what it was given:
   * if it ever reaches for the library or starts writing, these are what say so
   * rather than a silently different answer.
   */
  vi.doMock("@/lib/forms/repository", () => ({
    listTemplateSummaries: async () => {
      calls.push("listTemplateSummaries");
      throw new Error("form-proposal must take the library from its caller, not read it");
    },
    getTemplateByKey: async () => {
      throw new Error("form-proposal must not read or write the library");
    },
  }));

  const proposals = await import("@/lib/ai/form-proposal");
  return { proposals, calls };
}

function turn(
  question: string,
  options: {
    role?: string | null;
    scope?: AccessScope | null;
    history?: ChatMessage[];
    continueTemplateKey?: string;
  } = {},
) {
  return {
    history: options.history ?? [],
    question,
    questionMessageId: "msg-current",
    actor: {
      role: (options.role === undefined ? "salon_director" : options.role) as never,
      scope: options.scope === undefined ? SALON : options.scope,
    },
    summaries: library as never,
    ...(options.continueTemplateKey ? { continueTemplateKey: options.continueTemplateKey } : {}),
  };
}


function policyReview(o: Record<string, unknown> = {}) {
  return template({ id: "tpl-pr-id", key: "policy-review", name: "Policy Review", shortName: "Policy Review",
    description: "Review of a policy.", layoutFamily: "policy", requiredPermission: "create_policy_review", displayOrder: 3, ...o });
}
function followUp(o: Record<string, unknown> = {}) {
  return template({ id: "tpl-fu-id", key: "follow-up-coaching", name: "Follow-up Coaching Form", shortName: "Follow-up",
    description: "Follow-up.", layoutFamily: "coaching", requiredPermission: "create_coaching_form", displayOrder: 5, ...o });
}
function tsd(o: Record<string, unknown> = {}) {
  return template({ id: "tpl-tsd-id", key: "tsd-epp", name: "TSD EPP", shortName: "TSD EPP",
    description: "TSD plan.", layoutFamily: "epp", requiredPermission: "create_epp", displayOrder: 6, ...o });
}
const LIBRARY = () => [template(), dpoa(), policyReview(), followUp(), epp(), tsd()];


function managerTurn(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-09-07T12:00:00Z" };
}

const WORNALL = "loc-0306";
const LIBERTY = "loc-0394";
const LINCOLN_O_STREET = "loc-0311";
const LAWRENCE = "loc-0468";

function salons(...ids: string[]): AccessScope {
  return { level: "salon", primaryAreaId: ids[0]!, alsoCoversAreaIds: ids.slice(1) };
}

async function ask(question: string, scope: AccessScope, role = "salon_director") {
  const { proposals } = await load(LIBRARY());
  return (await proposals.proposeFormForTurn(turn(question, { scope, role })))!;
}

describe("1. a manager with one salon is never asked for it", () => {
  it("fills the salon in and leaves it off the corrective-action questions", async () => {
    const response = await ask("Create a corrective action form", salons(WORNALL));

    expect(response.formProposal!.locationId).toBe(WORNALL);
    expect(response.formProposal!.locationResolution).toBe("resolved");
    expect(response.content).toMatch(/^1\. Employee's full name$/m);
    expect(response.content).not.toMatch(/Salon location/i);
  });

  it("leaves it off the coaching questions too", async () => {
    const response = await ask("Create a coaching form", salons(WORNALL));

    expect(response.content).toMatch(/employee's full name/i);
    expect(response.content).not.toMatch(/salon/i);
  });

  it("leaves it off the performance-plan questions", async () => {
    const response = await ask("Create a TSD EPP from this conversation.", salons(WORNALL), "district_manager");

    expect(response.content).toMatch(/employee's full name/i);
    expect(response.content).toMatch(/follow-up review should happen/i);
    expect(response.content).not.toMatch(/salon location/i);
  });

  it("goes straight to the draft once the employee is named", async () => {
    const response = await ask("Create a corrective action form for Jane Smith", salons(WORNALL));

    expect(response.formProposal!.status).toBe("ready");
    expect(response.formProposal!.supportsInlineDraft).toBe(true);
    expect(response.content).not.toMatch(/which salon|salon location/i);
  });
});

describe("2. a manager with several salons is asked only when it is genuinely open", () => {
  it("asks which salon when nothing in the conversation says", async () => {
    const response = await ask("Create a coaching form for Jane Smith", salons(WORNALL, LIBERTY));

    expect(response.formProposal!.status).toBe("needs_location");
    expect(response.formProposal!.supportsInlineDraft).toBe(false);
    expect(response.formProposal!.authorizedLocationIds).toEqual([WORNALL, LIBERTY]);
    expect(response.content).toMatch(/Which salon is this about\?/);
  });

  it("keeps the salon on the corrective-action questions while it is open", async () => {
    const response = await ask("Create a corrective action form", salons(WORNALL, LIBERTY));
    expect(response.content).toMatch(/^2\. Salon location$/m);
  });

  it("does not ask when the manager named one of them", async () => {
    const response = await ask(
      "Create a coaching form for Jane Smith, she was late at Liberty today",
      salons(WORNALL, LIBERTY),
    );

    expect(response.formProposal!.locationId).toBe(LIBERTY);
    expect(response.formProposal!.status).toBe("ready");
    expect(response.content).not.toMatch(/which salon/i);
  });

  it("asks, from only the salons that fit, when the name fits more than one", async () => {
    // Both Kansas City salons are this manager's: "Kansas City" does not say which.
    const response = await ask(
      "Create a coaching form for Jane Smith, she was late at Kansas City today",
      salons(WORNALL, LIBERTY, LAWRENCE),
    );

    expect(response.formProposal!.status).toBe("needs_location");
    expect(response.formProposal!.authorizedLocationIds).toEqual([WORNALL, LIBERTY]);
  });

  it("does not ask when only one of their salons is in the city named", async () => {
    const response = await ask(
      "Create a coaching form for Jane Smith, she was late at Lincoln today",
      salons(WORNALL, LINCOLN_O_STREET),
    );
    expect(response.formProposal!.locationId).toBe(LINCOLN_O_STREET);
  });
});

describe("3. a salon named in the chat is used when it is the manager's", () => {
  it.each([
    "at Wornall",
    "at KC Wornall",
    "at Kansas City Wornall",
    "at MO Kansas City Wornall",
    "at the wornall store",
    "at salon 306",
    "at store #0306",
  ])("reads %s through the roster's own normalization", async (where) => {
    const response = await ask(
      `Create a coaching form for Jane Smith, she was late ${where} today`,
      salons(LIBERTY, WORNALL),
    );

    expect(response.formProposal!.locationId, where).toBe(WORNALL);
    expect(response.formProposal!.status, where).toBe("ready");
  });

  it("does not read a person as a salon", async () => {
    // "Lawrence" is a salon and a first name; "for Lawrence" is the person.
    const response = await ask("Create a coaching form for Lawrence Diaz", salons(WORNALL, LIBERTY));
    expect(response.formProposal!.employeeName).toBe("Lawrence Diaz");
    expect(response.formProposal!.status).toBe("needs_location");
  });

  it("does not read a place the roster does not carry as a salon", async () => {
    const response = await ask(
      "Create a coaching form for Jane Smith, she works at Lincoln South",
      salons(WORNALL),
    );
    expect(response.formProposal!.locationId).toBe(WORNALL);
  });

  it("uses a named salon for an account that covers every salon", async () => {
    const global: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

    const named = await ask("Create a coaching form for Jane Smith at Wornall", global, "admin");
    expect(named.formProposal!.locationId).toBe(WORNALL);

    const unnamed = await ask("Create a coaching form for Jane Smith", global, "admin");
    expect(unnamed.formProposal!.locationResolution).toBe("not_applicable");
  });
});

describe("4. a salon outside the manager's assignment is never accepted", () => {
  it("asks rather than filing against it, and says why", async () => {
    const response = await ask(
      "Create a coaching form for Jane Smith, she was late at KS Lawrence today",
      salons(WORNALL),
    );

    expect(response.formProposal!.locationId).toBeNull();
    expect(response.formProposal!.status).toBe("needs_location");
    expect(response.formProposal!.supportsInlineDraft).toBe(false);
    // Their own salon is offered to confirm, never substituted silently.
    expect(response.formProposal!.authorizedLocationIds).toEqual([WORNALL]);
    expect(response.formProposal!.namedLocationOutOfScope).toBe("KS Lawrence");
    expect(response.content).toMatch(/\*\*KS Lawrence\*\* isn't a salon on your assignment/);
  });

  it("does the same for a manager with several salons", async () => {
    const response = await ask(
      "Create a corrective action form for Jane Smith. She was late at KS Lawrence today.",
      salons(WORNALL, LIBERTY),
    );

    expect(response.formProposal!.locationId).toBeNull();
    expect(response.formProposal!.authorizedLocationIds).toEqual([WORNALL, LIBERTY]);
  });

  it("still lets the server refuse it, whatever a client sends", async () => {
    const { authorizeLocation } = await import("@/lib/forms/location-scope");
    expect(authorizeLocation(salons(WORNALL), LAWRENCE).kind).toBe("refused");
    expect(authorizeLocation(salons(WORNALL), WORNALL).kind).toBe("authorized");
  });

  it("gives a district manager no salon from a name, since none can be verified", async () => {
    const district: AccessScope = { level: "district", primaryAreaId: "dist-x", alsoCoversAreaIds: [] };
    const response = await ask("Create a coaching form for Jane Smith at Wornall", district, "district_manager");
    expect(response.formProposal!.locationId).toBeNull();
    expect(response.formProposal!.locationResolution).toBe("unavailable");
  });
});

describe("the other details are not asked for once they are given", () => {
  it("drops the date and the account of what happened from the coaching questions", async () => {
    const response = await ask("Create a coaching form, she was late on 9/24", salons(WORNALL));

    expect(response.formProposal!.status).toBe("needs_employee");
    expect(response.content).toMatch(/employee's full name/i);
    expect(response.content).not.toMatch(/date for the form/i);
    expect(response.content).not.toMatch(/description of the performance concern/i);
  });

  it("drops the job title once it is stated", async () => {
    const response = await ask("Create a coaching form for my salon director", salons(WORNALL));
    expect(response.content).not.toMatch(/job title/i);
  });

  it("drops the date and the job title from the corrective-action walk-through", async () => {
    const response = await ask(
      "Corrective action form for Jane Smith, she is a tanning consultant, it happened today — walk me through it.",
      salons(WORNALL),
    );

    expect(response.content).not.toMatch(/Employee's full name|Salon location/);
    expect(response.content).not.toMatch(/Date for the form|job title/i);
    expect(response.content).toMatch(/What happened|verbal or written warning/);
  });

  it("drops a follow-up date already given from the performance-plan walk-through", async () => {
    const response = await ask(
      "SDIT EPP for Jane Smith, follow up in 30 days — walk me through it.",
      salons(WORNALL),
      "district_manager",
    );

    expect(response.content).not.toMatch(/follow-up review should happen/i);
    expect(response.content).not.toMatch(/employee's full name|salon location/i);
  });

  it("still drafts from a numbered reply to the shorter list", async () => {
    // Item 1 is the date now, not the employee: "today" must not become a name.
    const { proposals } = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn(["1. today", "2. she was late again", "3. verbal warning", "4. first time"].join("\n"), {
        scope: salons(WORNALL),
        continueTemplateKey: "dpoa",
        history: [
          managerTurn("m1", "Corrective action form for Jane Smith — walk me through it."),
          { id: "m2", role: "assistant", content: "1. Date for the form", createdAt: "2026-09-07T12:00:01Z" },
        ],
      }),
    );

    expect(response!.formProposal!.employeeName).toBe("Jane Smith");
    expect(response!.formProposal!.status).toBe("ready");
    expect(response!.formProposal!.locationId).toBe(WORNALL);
  });
});
