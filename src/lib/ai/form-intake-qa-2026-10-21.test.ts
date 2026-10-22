import { describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRODUCTION QA, 21 OCTOBER 2026 — CAPITALS, POSSESSIVES, SALON NICKNAMES
 * ============================================================================
 *
 * Live testing after the 20 October fixes, every one reproduced here through
 * the real server path:
 *
 *   1. "COACHING FORM PAULYNE CAMACHO LATE 3 TIMES" asked who the form was for.
 *   2. "Paulyne Camacho's CA for no call no show 10/18" gave no card at all, and
 *      "Ellie Sendgraff's coaching form" asked "Did you mean Ellie Sendgraff?".
 *   3. "at lincoln 27th" named no salon, and "Brandi Algya, ASD, Lincoln O St"
 *      asked whether the form was for Brandi Algya or for Lincoln O St.
 *   4. "store 373" — KS Overland Park's Google store code — named no salon.
 *   5. "paulyne camacho" was printed in lower case on Demotion, Position
 *      Transfer and Policy Review cards.
 *   6. "brandi algya asd lincoln o st" named nobody, where the capitalised
 *      line worked.
 *   7. "coaching form for will turner" named nobody.
 *
 * The directory holds three people; everybody else is off the directory, so
 * the name on the card can only come from the manager's words.
 */

const fixtures = vi.hoisted(() => {
  const row = (first: string, last: string, salonIds: string[]) => ({
    id: `emp-${first}-${last}`.toLowerCase(),
    firstName: first,
    lastName: last,
    preferredFirstName: null,
    employmentStatus: "active",
    salonIds,
  });
  return {
    rows: [
      row("Paulyne", "Camacho", ["loc-0311"]),
      row("Ellie", "Sendgraff", ["loc-0311"]),
      row("Shannon", "McAllister", ["loc-0306"]),
    ],
  };
});

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("the proposal takes the library from its caller");
  },
  getTemplateByKey: async () => {
    throw new Error("the proposal must not read the library");
  },
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...original,
    readDirectoryRoster: async () => fixtures.rows,
    loadScopedRoster: async (scope: AccessScope | null) => original.scopeRoster(fixtures.rows, scope),
  };
});

const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** The real library, shaped as `listTemplateSummaries` returns it. */
const LIBRARY = TEMPLATE_SEEDS.map((seed) => ({
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
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

let counter = 0;
function id(): string {
  counter += 1;
  return `msg-${counter}`;
}

/** Sends each turn the way the chat screen does; returns the latest assistant turn. */
async function converse(...turns: string[]): Promise<ChatMessage> {
  const { proposeFormForTurn } = await import("./form-proposal");
  const thread: ChatMessage[] = [];
  for (const question of turns) {
    const history = [...thread];
    const user: ChatMessage = { id: id(), role: "user", content: question, createdAt: "2026-10-21T12:00:00Z" };
    thread.push(user);
    const answer = await proposeFormForTurn({
      history,
      question,
      questionMessageId: user.id,
      actor: { role: "admin" as never, scope: GLOBAL },
      continueTemplateKey: continuationFor(history)?.templateKey,
      summaries: LIBRARY as never,
      today: "2026-10-21",
    });
    thread.push({
      id: id(),
      role: "assistant",
      content: answer?.content ?? "(grounded advice answer)",
      createdAt: "2026-10-21T12:00:00Z",
      ...(answer?.formProposal ? { formProposal: answer.formProposal } : {}),
    });
  }
  return thread[thread.length - 1]!;
}

function expectCard(last: ChatMessage, templateKey: string, employee: string) {
  expect(last.formProposal, last.content).toBeDefined();
  expect(last.formProposal!.templateKey).toBe(templateKey);
  expect(last.formProposal!.employeeName, last.content).toBe(employee);
}

describe("1. an all-caps message reads the name like any other", () => {
  it("COACHING FORM PAULYNE CAMACHO LATE 3 TIMES", async () => {
    const last = await converse("COACHING FORM PAULYNE CAMACHO LATE 3 TIMES");
    // On the directory: the directory's spelling.
    expectCard(last, "coaching", "Paulyne Camacho");
    expect(last.formProposal!.status).toBe("ready");
  });

  // QA 22 Oct 2026 decision: off the directory the manager's spelling is kept as typed.
  it.each([["COACHING FORM JANE DOE LATE 3 TIMES", "JANE DOE"], ["coaching form jane doe late 3 times", "jane doe"]])("%s", async (question, employee) => {
    // Off the directory: as typed.
    expectCard(await converse(question), "coaching", employee);
  });

  it("one word before the topic is still not read as a name", async () => {
    const last = await converse("coaching form floor late 3 times");
    expect(last.formProposal?.employeeName ?? null).toBeNull();
  });
});

describe("2. a possessive names the person, and the 's is not part of the name", () => {
  it("Paulyne Camacho's CA for no call no show 10/18 is a Corrective Action Form", async () => {
    const last = await converse("Paulyne Camacho's CA for no call no show 10/18");
    expectCard(last, "dpoa", "Paulyne Camacho");
    expect(last.formProposal!.formDate).toBe("2026-10-18");
  });

  it.each([
    ["Ellie Sendgraff's coaching form", "coaching"],
    ["Ellie Sendgraff’s coaching form", "coaching"],
    ["start ellie sendgraff's coaching form", "coaching"],
    ["start Ellie Sendgraff's CA, she was late again", "dpoa"],
  ])("%s", async (question, templateKey) => {
    const last = await converse(question);
    expectCard(last, templateKey, "Ellie Sendgraff");
    expect(last.content).not.toMatch(/did you mean/i);
  });

  it.each(["Ellie's coaching form", "Ellie's CA - she was late 3 times this week"])(
    "%s confirms the first name against the directory",
    async (question) => {
      const last = await converse(question);
      expect(last.formProposal).toBeDefined();
      expect(last.content).toMatch(/^Did you mean \*\*Ellie Sendgraff\*\*\?/);
    },
  );

  it("a remark about somebody's CA is still not a request for one", async () => {
    const last = await converse("Ellie's CA was filed last week");
    expect(last.formProposal).toBeUndefined();
  });

  it("a contraction is not a possessive", async () => {
    expectCard(await converse("I need a coaching form", "It's Jane Doe"), "coaching", "Jane Doe");
  });
});

describe("3. salon nicknames", () => {
  it.each([
    ["coaching form for Jane Doe at lincoln 27th", "loc-0310"],
    ["coaching form for Jane Doe, lincoln 27th st", "loc-0310"],
    ["coaching form for Jane Doe at O St Lincoln", "loc-0311"],
    ["coaching form for Jane Doe at lincoln o st", "loc-0311"],
  ])("%s", async (question, salon) => {
    const last = await converse(question);
    expectCard(last, "coaching", "Jane Doe");
    expect(last.formProposal!.locationId).toBe(salon);
  });

  it("Lincoln O St after a name and a role is the salon, not a second person", async () => {
    const last = await converse("coaching form: Brandi Algya, ASD, Lincoln O St");
    expectCard(last, "coaching", "Brandi Algya");
    expect(last.formProposal!.employeeRole).toBe("ASD");
    expect(last.formProposal!.locationId).toBe("loc-0311");
    expect(last.content).not.toMatch(/Lincoln O St\*\*\?/);
  });

  it("a salon followed by what the form is about still names the salon", async () => {
    const last = await converse("coaching form for paulyne camacho at kearney about bed cleaning");
    expectCard(last, "coaching", "Paulyne Camacho");
    // Named in the message, so it wins over her directory salon (O Street).
    expect(last.formProposal!.locationId).toBe("loc-0309");
  });

  /* Ported from Ask Bubbles (c25e05c): a whole salon name set off in brackets reads like one set off by commas. */
  it.each([
    ["coaching form for Jane Doe, NE Kearney", "loc-0309"],
    ["coaching form for Jane Doe (NE Kearney)", "loc-0309"],
    ["coaching form for Jane Doe at kearney, she was late", "loc-0309"],
  ])("%s", async (question, salon) => {
    const last = await converse(question);
    expectCard(last, "coaching", "Jane Doe");
    expect(last.formProposal!.locationId).toBe(salon);
  });

  it("the salon's road on its own is still a road", async () => {
    const last = await converse("coaching form for Jane Doe, she parked on 27th street again");
    expect(last.formProposal!.locationId).toBeNull();
  });
});

describe("4. salon and store numbers", () => {
  it.each([
    // Google store code 373 is KS Overland Park; there is no salon 0373.
    ["coaching form for Jane Doe store 373", "loc-0476"],
    // QA F-05 (22 Oct): a bare number after "at" is not a salon (a price or time as often as a store code); "store 373" above still is.
    ["coaching form for Jane Doe at 373", null],
    // No store code 462; salon 0462 is KS Manhattan.
    ["coaching form for Jane Doe at store 462", "loc-0462"],
    // Zero-padded is a salon number, whatever store code shares the digits.
    ["coaching form for Jane Doe #0307", "loc-0307"],
    ["coaching form for Jane Doe salon 0307", "loc-0307"],
    ["coaching form for Jane Doe at 0307", "loc-0307"],
    // 0373 is no salon, and a zero-padded number is never a store code.
    ["coaching form for Jane Doe at 0373", null],
    /*
     * Each of these is one salon's number and ANOTHER salon's store code:
     * 306 = Wornall (0306) or KS Manhattan; 307 = Grand Island (0307) or KS
     * Shawnee Mission Pkwy; 314 = Omaha 144th and Center (0314) or KS Lawrence.
     * Never guessed.
     */
    ["coaching form for Jane Doe salon 306", null],
    ["coaching form for Jane Doe store 307", null],
    ["coaching form for Jane Doe #314", null],
    // A clock time.
    ["coaching form for Jane Doe, she was late at 310", null],
  ])("%s", async (question, salon) => {
    const last = await converse(question);
    expectCard(last, "coaching", "Jane Doe");
    expect(last.formProposal!.locationId).toBe(salon);
  });
});

describe("5. the employee's name is printed capitalised, on every form", () => {
  it.each([
    ["create a demotion form for paulyne camacho from SD to TC", "demotion", "Paulyne Camacho"],
    ["position transfer form for paulyne camacho to lincoln pine lake", "position-transfer", "Paulyne Camacho"],
    ["create a policy review for paulyne camacho", "policy-review", "Paulyne Camacho"],
    // The directory's own spelling, mid-word capital included.
    ["create a demotion form for shannon mcallister from SD to TC", "demotion", "Shannon McAllister"],
    ["create a policy review for shannon mcallister", "policy-review", "Shannon McAllister"],
  ])("on the directory: %s", async (question, templateKey, employee) => {
    expectCard(await converse(question), templateKey, employee);
  });

  // QA 22 Oct 2026 decision: off the directory the manager's spelling is kept as typed.
  it.each([
    ["create a demotion form for jane doe from SD to TC", "demotion", "jane doe"],
    ["position transfer form for mary-kate o'neil to lincoln pine lake", "position-transfer", "mary-kate o'neil"],
    ["create a policy review for jane doe", "policy-review", "jane doe"],
    ["exit form for jane doe", "stc-exit", "jane doe"],
    ["coaching form for jane doe", "coaching", "jane doe"],
    // Capitalised by the manager: theirs, as typed.
    ["create a policy review for Jane McDonald", "policy-review", "Jane McDonald"],
    ["create a policy review for DeShawn Smith", "policy-review", "DeShawn Smith"],
  ])("off the directory: %s", async (question, templateKey, employee) => {
    expectCard(await converse(question), templateKey, employee);
  });

  it("the note about a name the directory lacks uses the printed spelling", async () => {
    const last = await converse("create a policy review for jane doe");
    // QA 22 Oct 2026 decision: off the directory the manager's spelling is kept as typed.
    expect(last.content).toContain("I didn't find **jane doe** in the employee list");
  });
});

describe("6. name, role and salon typed in lower case", () => {
  it("brandi algya asd lincoln o st coaching form", async () => {
    const last = await converse("brandi algya asd lincoln o st coaching form");
    // QA 22 Oct 2026 decision: off the directory the manager's spelling is kept as typed.
    expectCard(last, "coaching", "brandi algya");
    expect(last.formProposal!.employeeRole).toBe("ASD");
    expect(last.formProposal!.locationId).toBe("loc-0311");
  });

  it("the replayed conversation: the form, a date, then the line on its own", async () => {
    const last = await converse(
      "can you create a coaching form for a manager on the onboarding process",
      "Oct 9",
      "brandi algya asd lincoln o st",
    );
    // QA 22 Oct 2026 decision: off the directory the manager's spelling is kept as typed.
    expectCard(last, "coaching", "brandi algya");
    expect(last.formProposal!.employeeRole).toBe("ASD");
    expect(last.formProposal!.locationId).toBe("loc-0311");
    expect(last.formProposal!.formDate).toBe("2026-10-09");
  });

  it("one name word before the role still names nobody", async () => {
    const last = await converse("I need a coaching form", "sarah sd lincoln o st");
    expect(last.formProposal?.employeeName ?? "").not.toMatch(/lincoln/i);
  });
});

describe("7. 'will' followed by a surname is a name", () => {
  it("coaching form for will turner", async () => {
    // QA 22 Oct 2026 decision: off the directory the manager's spelling is kept as typed.
    expectCard(await converse("coaching form for will turner"), "coaching", "will turner");
  });

  it.each(["coaching form for will", "the coaching form for will be done tomorrow"])(
    "%s names nobody",
    async (question) => {
      const last = await converse(question);
      expect(last.formProposal?.employeeName ?? null).toBeNull();
    },
  );
});
