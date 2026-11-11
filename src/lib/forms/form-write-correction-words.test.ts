import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceValueRow, LoadedInstance } from "./instances";

/**
 * ============================================================================
 * A CORRECTION REPLACES ONLY THE WORDS THE MANAGER NAMED (step 2b, QA)
 * ============================================================================
 *
 * FORM_EDIT_SINGLE_WRITER_ENABLED. In 2a the correction's preset skipped the
 * `drops_words` rule (the one deviation from the design); QA made it a
 * condition of the flip: a correction may replace only the words the manager
 * named, never rewrite the rest of the line. Ported from Ask Bubbles
 * (44856eb0), in this app's setting: a Corrective Action for Jane Doe whose
 * Observation reads "Jane Doe was late to open on 10-20-26.", and QA's three
 * wordings of the same correction. In each, "Jane" and the
 * rest of the sentence survive: a write that would drop a word she did not
 * name is refused, all or nothing, nothing is written, the reply never says
 * "Updated", and the turn goes on (handoff "refused").
 *
 * The one writer is run over the form held in memory; `instances.ts`
 * (protected) is stood in for by fakes that write rows the way it does. People
 * are invented.
 */

const rows = vi.hoisted(() => ({ list: [] as InstanceValueRow[], calls: [] as string[], employeeName: "Jane Doe" }));

function put(fieldKey: string, value: string | string[], filledBy: string) {
  const at = rows.list.findIndex((row) => row.fieldKey === fieldKey);
  const row = {
    fieldKey,
    value: typeof value === "string" ? value : null,
    checked: typeof value === "string" ? [] : value,
    filledBy,
    provenance: {},
  } as unknown as InstanceValueRow;
  if (at >= 0) rows.list[at] = row;
  else rows.list.push(row);
}

vi.mock("./instances", () => ({
  loadInstance: async () => form(),
  findOpenRevision: async () => null,
  recordChatCorrection: async () => {},
  saveInstanceValues: async (_id: string, submitted: { values: Record<string, string>; checked: Record<string, string[]> }) => {
    rows.calls.push(`saveInstanceValues:${Object.keys(submitted.values).join(",")}`);
    for (const [key, value] of Object.entries(submitted.values)) put(key, value, "manager");
    return { rejected: [], values: submitted.values };
  },
  applyAssistantDraft: async () => {
    rows.calls.push("applyAssistantDraft");
    return { accepted: { values: {}, checked: {} }, rejected: [], policyRefused: [] };
  },
  applyAssistantRevision: async () => {
    rows.calls.push("applyAssistantRevision");
    return { accepted: { values: {}, checked: {} }, cleared: [], rejected: [] };
  },
  applyStatedFacts: async () => {
    rows.calls.push("applyStatedFacts");
    return [];
  },
}));
vi.mock("./ca-action-plan-sync", () => ({ syncCorrectiveActionPlan: async () => [] }));
// This app's Corrective Action takes a new name from chat only as a roster-confirmed full name (`caNameFromChat`).
vi.mock("./person-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./person-guard")>()),
  rosterFullName: (typed: string) => (typed.trim().toLowerCase() === "jane doe-smith" ? "Jane Doe-Smith" : null),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) }),
}));
vi.mock("./instance-scope", () => ({
  authorizeInstance: async () => ({ actor: { id: "qa", role: "salon_director", verified: true, scope: null }, loaded: form() }),
}));

let caDocument: unknown = null;
let coachingDocument: unknown = null;
let template: "dpoa" | "coaching" = "dpoa";
function form(): LoadedInstance {
  return {
    instance: {
      id: "ca-1",
      status: "draft",
      variantKey: null,
      employeeName: rows.employeeName,
      employeeRole: "Tanning Consultant",
      locationName: "NE Kearney",
      formDate: "2026-10-20",
      templateKey: template,
      templateName: template === "dpoa" ? "Corrective Action Form" : "Coaching Form",
    },
    version: { document: template === "dpoa" ? caDocument : coachingDocument },
    values: rows.list.map((row) => ({ ...row, checked: [...row.checked] })),
    events: [],
  } as unknown as LoadedInstance;
}

const OBSERVATION = "Jane Doe was late to open on 10-20-26.";
const WORDINGS = ["fix her last name, it is Doe-Smith", "fix her last name, it is Jane Doe-Smith", "Doe-Smith"] as const;

beforeEach(async () => {
  const library = await import("./library");
  caDocument ??= library.correctiveActionDocument();
  coachingDocument ??= library.coachingDocument();
  template = "dpoa";
  rows.list = [];
  rows.calls = [];
  rows.employeeName = "Jane Doe";
  put("employee_name", "Jane Doe", "system");
  put("observation", OBSERVATION, "ai");
});

const observation = () => rows.list.find((row) => row.fieldKey === "observation")?.value;
const employeeLine = () => rows.list.find((row) => row.fieldKey === "employee_name")?.value;

async function correct(said: string, values: Record<string, string>) {
  const { correctionWrite } = await import("./form-write");
  return correctionWrite({
    instanceId: "ca-1",
    loaded: form(),
    stated: { values, checked: {} },
    actorId: "qa",
    said,
    today: "2026-10-21",
    readerValues: Object.values(values),
  });
}

describe.each(WORDINGS)('the correction "%s": only the words she named are replaced', (said) => {
  /*
   * Each write below drops a word of the line the manager did not name (or,
   * for "Jane", named only as part of the name she gives). Before 2b the
   * correction's preset had no `drops_words` rule and each was saved.
   */
  const dropping: readonly [string, Record<string, string>][] = [
    ["the Employee Name line becomes the bare last name (Jane dropped)", { employee_name: "Doe-Smith" }],
    ["the Observation loses 'to open' while the name is fixed", { observation: "Jane Doe-Smith was late on 10-20-26." }],
    ["the Observation keeps the name but loses the rest of the account", { observation: "Jane Doe-Smith was late." }],
  ];

  it.each(dropping)("refused, nothing written: %s", async (_case, values) => {
    const saved = await correct(said, values);
    expect(saved.result.handoff).toBe("refused");
    expect(saved.result.refused.map((refusal) => refusal.reason)).toContain("drops_words");
    expect(saved.result.changed).toEqual([]);
    expect(saved.nothingChanged).toBeUndefined();
    expect(saved.values).toEqual({});
    expect(rows.calls).toEqual([]);
    // "Jane" and the rest of the sentence survive.
    expect(observation()).toBe(OBSERVATION);
    expect(employeeLine()).toBe("Jane Doe");
  });

  it("refused with the Observation and the name together: one dropping write refuses both (all or nothing)", async () => {
    const saved = await correct(said, { employee_name: "Jane Doe-Smith", observation: "Doe-Smith was late on 10-20-26." });
    expect(saved.result.handoff).toBe("refused");
    expect(rows.calls).toEqual([]);
    expect(observation()).toBe(OBSERVATION);
    expect(employeeLine()).toBe("Jane Doe");
  });

  it('accepted: "Doe" becomes "Doe-Smith" and every other word stays', async () => {
    const saved = await correct(said, { employee_name: "Jane Doe-Smith", observation: "Jane Doe-Smith was late to open on 10-20-26." });
    expect(saved.result.handoff).toBeNull();
    expect(employeeLine()).toBe("Jane Doe-Smith");
    expect(observation()).toBe("Jane Doe-Smith was late to open on 10-20-26.");
  });
});

describe('"fix her last name, it is Jane Doe-Smith": naming Jane in the new name is not leave to drop her', () => {
  it("the live replace (the Observation as 'Doe-Smith was late to open on 10-20-26.') is refused", async () => {
    const saved = await correct(WORDINGS[1], { observation: "Doe-Smith was late to open on 10-20-26." });
    expect(saved.result.refused).toEqual([{ key: "observation", reason: "drops_words" }]);
    expect(observation()).toBe(OBSERVATION);
  });
});

/*
 * Through the chat, in this app: the Corrective Action's name line takes a new
 * name only as a roster-confirmed full name (CA_NAME_FROM_CHAT_ENABLED,
 * `caNameFromChat`), so no chat wording here reaches a header write that drops
 * a word — "change her name to Doe-Smith" names one word and is not read as a
 * correction at all. The roster rename keeps every other line, flag on and off.
 */
describe("through correctActiveForm (this app): the roster rename writes the name line and nothing else", () => {
  const ask = async (question: string) => {
    const { correctActiveForm } = await import("./chat-correction");
    return correctActiveForm({
      request: new Request("http://localhost/api/chat"),
      instanceId: "ca-1",
      question,
      today: "2026-10-21",
    });
  };

  for (const flag of ["true", ""]) {
    it(`flag ${flag ? "on" : "off"}: "change her name to Jane Doe-Smith" — the name line, the Observation untouched`, async () => {
      vi.stubEnv("FORM_EDIT_SINGLE_WRITER_ENABLED", flag);
      vi.stubEnv("CA_NAME_FROM_CHAT_ENABLED", "true");
      try {
        const reply = await ask("change her name to Jane Doe-Smith");
        expect(reply?.content).toMatch(/^Updated the \*\*Corrective Action Form\*\*/);
        expect(rows.calls).toEqual(["saveInstanceValues:employee_name"]);
        expect(employeeLine()).toBe("Jane Doe-Smith");
        expect(observation()).toBe(OBSERVATION);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  }

  it('"change her name to Doe-Smith" names one word: not a correction, nothing written', async () => {
    vi.stubEnv("FORM_EDIT_SINGLE_WRITER_ENABLED", "true");
    vi.stubEnv("CA_NAME_FROM_CHAT_ENABLED", "true");
    try {
      const reply = await ask("change her name to Doe-Smith");
      expect(reply?.formUpdate).toBeUndefined();
      expect(rows.calls).toEqual([]);
      expect(employeeLine()).toBe("Jane Doe");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
