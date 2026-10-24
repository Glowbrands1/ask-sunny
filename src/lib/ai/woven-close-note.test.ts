import { afterEach, describe, expect, it, vi } from "vitest";

import { HR_TEMPLATE_SEEDS } from "@/lib/forms/library";
import { warningLevelFromTurns } from "@/lib/forms/warning-level";
import type { AccessScope, ChatMessage } from "@/types";

import { enrichFormCard } from "./form-card-slots";
import { holdFilledSlots } from "./keep-filled-slots";
import type { GroundedPerson } from "./grounded-entities";

/**
 * Pau, 24 Oct 2026: a typed name one spelling away from Woven stays as typed,
 * with "Woven has <name>" under the card. Same rule as Bubbles TYPED_NAME
 * for one close person. The action-plan line waits for the incident.
 * N1–N3 and Paisley's "Yes" never read as a Written Warning.
 */

const TODAY = "2026-10-24";
const TYPED = "Create a coaching form for Test Employe";
const BARE = "Create a corrective action form for Jane Smith";
const LATE = "create a corrective action for Jane Smith, she was late for her shift on 9-29-26";
const N1 = [
  "create a coaching form for Test Employee, Tanning Consultant at Manhattan",
  "name is Test Employee, Tanning Consultant at Manhattan",
  "Create a form from this conversation.",
];
const N2 = [
  "create a corrective action for Colene Shildt, tanning consultant at manhattan. she was late for her shift on 9-29-26. payroll deduct yes $25",
];
const N3 = ["name is TT and use todays date to create coaching form"];
const S25 = ["create a corrective action form for Pasiley Peklo", "Yes"];

const roster = vi.hoisted(() => ({
  people: [
    {
      id: "test-employee",
      firstName: "Test",
      lastName: "Employee",
      preferredFirstName: null,
      salonIds: ["loc-0462"],
      title: "Tanning Consultant",
      primaryLocationName: "KS Manhattan",
      primarySalonId: "loc-0462",
    },
  ] as GroundedPerson[],
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async () => roster.people,
    readDirectoryFacts: async () => roster.people,
  };
});

const { proposeFormForTurn } = await import("./form-proposal");

const SCOPE: AccessScope = { level: "salon", primaryAreaId: "loc-0462", alsoCoversAreaIds: [] };
const LIBRARY = HR_TEMPLATE_SEEDS.filter((seed) => seed.key === "coaching" || seed.key === "dpoa").map((seed) => ({
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
  currentVersion: { id: `v-${seed.key}`, status: "published" as const, document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

const PERSON: GroundedPerson = roster.people[0]!;

afterEach(() => {
  delete process.env.TYPED_NAME_PROCEEDS_ENABLED;
  delete process.env.ACTION_PLAN_SENTENCES_ENABLED;
  delete process.env.ACTION_PLAN_AFTER_INCIDENT_ENABLED;
  delete process.env.WARNING_LEVEL_EXPLICIT_ENABLED;
});

function turn(question: string, history: ChatMessage[] = [], continueTemplateKey?: string) {
  return {
    history,
    question,
    questionMessageId: "msg-current",
    actor: { role: "salon_director" as const, scope: SCOPE },
    summaries: LIBRARY as never,
    today: TODAY,
    ...(continueTemplateKey ? { continueTemplateKey } : {}),
  };
}

async function replay(questions: readonly string[], continueTemplateKey?: string) {
  const history: ChatMessage[] = [];
  const replies = [];
  for (const [index, question] of questions.entries()) {
    const response = await proposeFormForTurn(turn(question, history, index > 0 ? continueTemplateKey : undefined));
    replies.push(response);
    history.push({ id: `u${index}`, role: "user", content: question, createdAt: `${TODAY}T12:00:00.000Z` });
    if (response) {
      history.push({
        id: `a${index}`,
        role: "assistant",
        content: response.content,
        createdAt: `${TODAY}T12:00:01.000Z`,
      });
    }
  }
  return replies;
}

describe("a close typed name keeps its spelling and notes Woven", () => {
  it("asks which person while the flag is off", async () => {
    const response = await proposeFormForTurn(turn(TYPED));
    expect(response?.content).toContain("Did you mean **Test Employee**?");
    expect(response?.formProposal?.wovenCloseMatch ?? null).toBeNull();
    expect(response?.content).not.toContain("Woven has");
  });

  it("keeps Test Employe and shows Woven has Test Employee", async () => {
    process.env.TYPED_NAME_PROCEEDS_ENABLED = "on";
    const response = await proposeFormForTurn(turn(TYPED));
    expect(response?.formProposal?.employeeName).toBe("Test Employe");
    expect(response?.formProposal?.wovenCloseMatch).toBe("Woven has Test Employee");
    expect(response?.content).not.toMatch(/Woven has|Did you mean/);

    const card = enrichFormCard({
      response: response!,
      question: TYPED,
      today: TODAY,
      people: [PERSON],
      saved: null,
    });
    expect(card.formProposal?.employeeName).toBe("Test Employe");
    expect(card.formProposal?.wovenCloseMatch).toBe("Woven has Test Employee");
    expect(card.content).not.toMatch(/Woven has|Did you mean/);
  });

  it("attaches no note when the typed name is already the directory spelling", async () => {
    process.env.TYPED_NAME_PROCEEDS_ENABLED = "on";
    const response = await proposeFormForTurn(turn("Create a coaching form for Test Employee."));
    expect(response?.formProposal?.employeeName).toBe("Test Employee");
    expect(response?.formProposal?.wovenCloseMatch ?? null).toBeNull();
  });
});

describe("the action plan waits for the incident", () => {
  it("still writes the review line on a name-only turn while the flag is off", async () => {
    process.env.ACTION_PLAN_SENTENCES_ENABLED = "on";
    const proposed = await proposeFormForTurn(turn(BARE));
    const held = holdFilledSlots({
      response: proposed!,
      question: BARE,
      history: [],
      today: TODAY,
      people: [],
    });
    expect(held.formProposal?.awaitingIncident).toBe(true);
    expect(held.content).toContain("haven't told me what happened");
    expect(held.content).toContain("**Action Plan:**");
    expect(held.content).toContain("Management will review the applicable company policy with Jane.");
  });

  it("asks what happened and leaves the action plan blank until the details are given", async () => {
    process.env.ACTION_PLAN_SENTENCES_ENABLED = "on";
    process.env.ACTION_PLAN_AFTER_INCIDENT_ENABLED = "on";
    const proposed = await proposeFormForTurn(turn(BARE));
    const held = holdFilledSlots({
      response: proposed!,
      question: BARE,
      history: [],
      today: TODAY,
      people: [],
    });
    expect(held.formProposal?.awaitingIncident).toBe(true);
    expect(held.content).toContain("haven't told me what happened");
    expect(held.content).not.toContain("**Action Plan:**");
    expect(held.content).not.toContain("Management will review");

    const described = await proposeFormForTurn(turn(LATE));
    const planned = holdFilledSlots({
      response: described!,
      question: LATE,
      history: [],
      today: TODAY,
      people: [],
    });
    expect(planned.formProposal?.awaitingIncident).toBeUndefined();
    expect(planned.content).toContain("**Action Plan:**");
    expect(planned.content).toContain("Management will review");
    expect(planned.content).not.toContain("haven't told me what happened");
  });
});

describe("Yes is not a Written Warning on the N1–N3 replay", () => {
  it("leaves the level unset when the only added word is Yes", () => {
    expect(warningLevelFromTurns(["Yes"])).toBeNull();
    expect(warningLevelFromTurns(N1)).toBeNull();
    expect(warningLevelFromTurns(N2)).toBeNull();
    expect(warningLevelFromTurns(N3)).toBeNull();
    expect(warningLevelFromTurns(S25)).toBeNull();
    process.env.WARNING_LEVEL_EXPLICIT_ENABLED = "on";
    expect(warningLevelFromTurns(["Yes"])).toBeNull();
    expect(warningLevelFromTurns(N2)).toBeNull();
    expect(warningLevelFromTurns(S25)).toBeNull();
  });

  it("keeps Written Warning off N1, N2, N3, and a reply that is only Yes", async () => {
    process.env.WARNING_LEVEL_EXPLICIT_ENABLED = "on";
    process.env.TYPED_NAME_PROCEEDS_ENABLED = "on";
    for (const replies of [
      await replay(N1, "coaching"),
      await replay(N2, "dpoa"),
      await replay(N3, "coaching"),
      await replay(S25, "dpoa"),
    ]) {
      for (const response of replies) {
        expect(response?.content ?? "").not.toContain("Written Warning, as you said");
        expect(response?.formProposal?.warningLevel ?? null).not.toBe("written");
      }
    }

    const stated = await proposeFormForTurn(
      turn("create a written corrective action for Test Employee. she was late for her shift yesterday"),
    );
    expect(stated?.formProposal?.warningLevel).toBe("written");
    expect(stated?.content).toContain("Written Warning, as you said");
  });
});
