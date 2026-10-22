import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";
import type { InstanceListFilter, InstanceRow } from "./instances";

/**
 * "Does employee Wren Halvorsen have previous coachings?" — production
 * feedback: Sunny said it could not look that up and sent the manager to Form
 * Monitoring. These prove the gate fires on that class of question, that the
 * read uses the forms visibility rule (and nothing wider), and that the block
 * reports only what the record holds.
 */

const state = vi.hoisted(() => ({
  visibility: null as AccessScope | null,
  visibilityCalls: 0,
  listCalls: [] as { view: string; limit: number; filter: InstanceListFilter | undefined }[],
  rows: [] as InstanceRow[],
  fail: false,
}));

vi.mock("./forms-visibility", () => ({
  resolveFormsVisibility: async () => {
    state.visibilityCalls += 1;
    return state.visibility;
  },
}));

vi.mock("./instances", () => ({
  listInstances: async (view: string, limit: number, filter?: InstanceListFilter) => {
    state.listCalls.push({ view, limit, filter });
    if (state.fail) throw new Error("db down");
    const words = filter?.employeeNameWords;
    return words
      ? state.rows.filter((row) => words.some((word) => row.employeeName.toLowerCase().includes(word)))
      : state.rows;
  },
  loadInstance: async () => null,
}));

vi.mock("./repository", () => ({ getTemplateByKey: async () => null }));

const {
  isFormRecordsQuestion,
  candidateNameWords,
  loadFormRecords,
  FORM_RECORDS_HEADING,
} = await import("./chat-form-records");

function row(overrides: Partial<InstanceRow>): InstanceRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    templateId: "t",
    templateKey: "coaching",
    templateName: "Coaching Form",
    templateShortName: "Coaching",
    layoutFamily: "coaching",
    templateVersionId: "v",
    templateVersion: 1,
    variantKey: null,
    employeeName: "Wren Halvorsen",
    employeeRole: "Tanning Consultant",
    locationId: "loc-101",
    locationName: "Salon 101",
    createdBy: "someone",
    createdByRole: "salon_director",
    source: "ask_sunny",
    status: "finalized",
    formDate: "2026-09-12",
    followUpDate: null,
    followedUpAt: null,
    followedUpBy: null,
    finalizedAt: null,
    exportedAt: null,
    archivedAt: null,
    revisesInstanceId: null,
    createdAt: "2026-09-12T15:00:00Z",
    updatedAt: "2026-09-12T15:00:00Z",
    ...overrides,
  } as InstanceRow;
}

const SALON_DIRECTOR = {
  subject: "user-1",
  verified: true,
  role: "salon_director" as const,
  scope: { level: "salon" as const, primaryAreaId: "loc-101", alsoCoversAreaIds: [] },
};

beforeEach(() => {
  state.visibility = { level: "salon", primaryAreaId: "loc-101", alsoCoversAreaIds: [] };
  state.visibilityCalls = 0;
  state.listCalls = [];
  state.rows = [];
  state.fail = false;
});

describe("isFormRecordsQuestion", () => {
  it.each([
    "does employee wren halvorsen have previous coachings",
    "Has Dana been written up before?",
    "Was she ever coached?",
    "what is Dana Moss's coaching history",
    "any open follow-ups at my salon?",
    "Is there anything on file for Marcus?",
    "how many coaching forms have I filed this month",
    "show me the write-ups for Jordan",
    "Any prior corrective action for Wren?",
    "past coaching file for wren halvorsen",
    "does wren have a past coaching file",
    "past ca for wren halvorsen",
    "any past CAs for Dana?",
    "does dana have a previous CA form",
    "past corrective action form for Marcus",
  ])("fires on %s", (question) => {
    expect(isFormRecordsQuestion(question)).toBe(true);
  });

  it.each([
    "create a coaching form for Wren Halvorsen",
    "do we have a coaching form?",
    "what is our corrective action process?",
    "what should I focus on today?",
    "how do I coach someone on spa conversion?",
  ])("stays quiet on %s", (question) => {
    expect(isFormRecordsQuestion(question)).toBe(false);
  });
});

describe("candidateNameWords", () => {
  it("keeps the name and drops the question's vocabulary", () => {
    expect(candidateNameWords("does employee wren halvorsen have previous coachings")).toEqual([
      "wren",
      "halvorsen",
    ]);
    expect(candidateNameWords("What is Dana Moss's coaching history?")).toEqual(["dana", "moss"]);
    expect(candidateNameWords("past ca for wren halvorsen")).toEqual(["wren", "halvorsen"]);
    expect(candidateNameWords("past coaching file for Wren Halvorsen")).toEqual(["wren", "halvorsen"]);
  });
});

describe("loadFormRecords", () => {
  const question = "does employee wren halvorsen have previous coachings";

  it("reads Form Monitoring under the forms visibility and lists that person's forms", async () => {
    state.rows = [
      row({ formDate: "2026-09-12", followUpDate: "2026-09-26", followedUpAt: "2026-09-25T00:00:00Z" }),
      row({ formDate: "2026-10-02", status: "draft" }),
      // Another salon's coaching record for the same name: never visible.
      row({ formDate: "2026-08-01", locationId: "loc-999", locationName: "Salon 999" }),
      row({ employeeName: "Wren Park", formDate: "2026-07-01" }),
    ];

    const result = await loadFormRecords({ actor: SALON_DIRECTOR, question, today: "2026-10-20" });

    expect(state.visibilityCalls).toBe(1);
    expect(state.listCalls[0]?.filter).toEqual({
      locationIds: ["loc-101"],
      ownNullLocationCreatedBy: "user-1",
      // Their own forms at other salons, re-checked by `visibleInstances`.
      ownCreatedBy: "user-1",
      employeeNameWords: ["wren", "halvorsen"],
    });

    const block = result!.block;
    expect(block.startsWith(FORM_RECORDS_HEADING)).toBe(true);
    expect(block).toContain("Forms naming the person in the question (2)");
    expect(block).toContain("2026-09-12 — Coaching Form");
    expect(block).toContain("follow-up: Followed up");
    expect(block).toContain("2026-10-02 — Coaching Form");
    expect(block).toContain("draft — not finalized");
    expect(block).not.toContain("Salon 999");
    // A first-name-only match is offered as a question, not as theirs.
    expect(block).toMatch(/Possible matches[\s\S]*Wren Park/);
    expect(block).toContain("only the salons this user may see");
  });

  it("says nothing is on file when the named person has no forms, without listing anybody else's", async () => {
    state.rows = [row({ employeeName: "Dana Moss" })];

    const result = await loadFormRecords({ actor: SALON_DIRECTOR, question, today: "2026-10-20" });

    expect(result!.block).toContain("No form on file names the person in the question");
    expect(result!.block).not.toContain("Dana Moss");
  });

  it("finds the name in the previous turn when the question names nobody", async () => {
    state.rows = [row({})];

    const result = await loadFormRecords({
      actor: SALON_DIRECTOR,
      question: "has she been written up before?",
      previousQuestion: "tell me about wren halvorsen",
      today: "2026-10-20",
    });

    expect(state.listCalls[0]?.filter?.employeeNameWords).toEqual(["wren", "halvorsen"]);
    expect(result!.block).toContain("Forms naming the person in the question (1)");
  });

  it("covers every salon for an administrator, with no salon filter", async () => {
    state.visibility = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
    state.rows = [row({ locationId: "loc-999", locationName: "Salon 999" })];

    const result = await loadFormRecords({
      actor: { ...SALON_DIRECTOR, role: "admin", scope: state.visibility },
      question,
      today: "2026-10-20",
    });

    expect(state.listCalls[0]?.filter).toEqual({ employeeNameWords: ["wren", "halvorsen"] });
    expect(result!.block).toContain("Salon 999");
    expect(result!.block).toContain("every salon");
  });

  it("reads nothing for an unverified caller or a role without Form Monitoring", async () => {
    expect(
      await loadFormRecords({ actor: { ...SALON_DIRECTOR, verified: false }, question }),
    ).toBeNull();
    expect(
      await loadFormRecords({ actor: { ...SALON_DIRECTOR, role: "employee" }, question }),
    ).toBeNull();
    expect(await loadFormRecords({ actor: { role: "admin", scope: null }, question })).toBeNull();
    expect(state.listCalls).toHaveLength(0);
  });

  it("says it could not check, rather than implying nothing is on file, when the read fails", async () => {
    state.fail = true;

    const result = await loadFormRecords({ actor: SALON_DIRECTOR, question, today: "2026-10-20" });

    expect(result!.block).toContain("could not be read");
  });
});
