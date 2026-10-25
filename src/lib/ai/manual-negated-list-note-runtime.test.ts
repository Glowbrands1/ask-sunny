import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";

/**
 * ============================================================================
 * p.19 "charging in the break room" — ported from Ask Bubbles, the live answer path
 * ============================================================================
 *
 * Ask Bubbles production, 25 Oct 2026 (QA run B9, conv_mvnoscyz200gtat). The
 * manager pasted part of the cell phone policy and asked what it means. The
 * reply said "the manual gives charging in the break room as an example of
 * where it belongs [p.19]".
 *
 * JBA Policy Manual p.19 (the same text in both apps' manuals): "Employees
 * should keep cell phones on silent and not on their person (this means not in
 * back pockets, charging in the break room, or sitting on top of a drawer
 * till)". The bracket lists three places the phone may NOT be. HR's ruling
 * (via QA, 25 Oct 2026): charging in the break room is not allowed.
 *
 * This app's answers read it right today (conv_mvnoy6lr2kpus3g, the whole
 * section pasted with "what does this mean?"; conv_mvnoyniz29tpyyq, "What is
 * the cell phone policy?"). The same mechanism is here, so the same note is:
 * with MANUAL_NEGATED_LIST_NOTE_ENABLED on, a reading note for that list goes
 * into the per-turn grounding block whenever the grounding the model reads
 * (the full manual in the system prompt, or retrieved chunks) holds the
 * sentence. The manual text and the system prompt are not changed. Off, the
 * prompt is byte-for-byte what it was.
 */

const state = vi.hoisted(() => ({
  system: "",
  grounding: "",
  fullManualBlock: undefined as string | null | undefined,
  manualBlock: undefined as string | null | undefined,
  reply: "",
  rows: [] as unknown[],
}));

vi.mock("./query-rewrite-claude", () => ({
  rewriteToManualTerms: async (input: { question: string }) => input.question,
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));
vi.mock("./form-proposal", () => ({ proposeFormForTurn: async () => null, suggestFormsForTurn: () => null }));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));

/* The production manual rows, read through the loader's own row mapping. */
vi.mock("./full-manual-load", async (importOriginal) => {
  const original = await importOriginal<typeof import("./full-manual-load")>();
  const { choosePolicyManuals } = await import("./full-manual-context");
  const fixture = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
  return {
    ...original,
    loadFullManualContext: async (input: { question: string }) =>
      choosePolicyManuals(input.question, [
        {
          id: fixture.document_ids["ask-sunny"],
          title: fixture.title,
          category: "policies_compliance",
          chunks: (fixture.chunks as import("./full-manual-load").ChunkRow[]).map(original.manualChunkFromRow),
        },
      ]),
  };
});

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      return state.rows;
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
    }
  },
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));
vi.mock("./call-claude", () => ({
  callClaude: async (input: {
    system: string;
    grounding: string;
    fullManualBlock?: string | null;
    manualBlock?: string | null;
  }) => {
    state.system = input.system;
    state.grounding = input.grounding;
    state.fullManualBlock = input.fullManualBlock;
    state.manualBlock = input.manualBlock;
    return state.reply;
  },
}));

const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } };

/** The Ask Bubbles B9 turn as sent: the pasted policy text is in both manuals. */
const B9_QUESTION =
  '"Personal cell phones are permitted in the workplace but must be kept out of sight. The only time a cell phone should be accessed while clocked in is in an emergency situation." what does this mean?';

/** conv_mvnoy6lr2kpus3g, the manager's turn as sent. */
const SECTION_PASTE = `Cell Phone/Smart Watch Policy
Personal Employee cell phones are permitted in the workplace but must be kept out of sight. It
is the Employee’s personal responsibility to protect the customer’s experience and doing things
such as texting, making phone calls or using social media jeopardizes the customer’s experience.
Employees should keep cell phones on silent and not on their person (this means not in back
pockets, charging in the break room, or sitting on top of a drawer till). The only time that a cell
phone should be accessed while clocked in is in emergency situations.
Smart Watches are allowed as long as they are not being used for social media or texting/phone
calls. We reserve the right to ask Employees to remove any smart watch if it starts to interfere
with the customer's experience.

what does this mean?`;

/** conv_mvnoyniz29tpyyq and the sibling app's P2/P3 runs. */
const POLICY_QUESTION = "What is the cell phone policy?";

/** conv_mvnoyniz29tpyyq, the reply production sent, word for word. */
const POLICY_REPLY = `Personal cell phones are allowed in the salon but must be kept out of sight — it's the employee's responsibility to protect the customer experience, and texting, calls or social media undercut that ("Cell Phone/Smart Watch Policy", JBA Policy Manual p.19 [p.19]).

- Phones stay on silent and off the person — not in a back pocket, not charging in the break room, not sitting on a drawer till ("Cell Phone/Smart Watch Policy", JBA Policy Manual p.19 [p.19]).
- The only time a phone should be accessed while clocked in is an emergency ("Cell Phone/Smart Watch Policy", JBA Policy Manual p.19 [p.19]).
- Smart watches are allowed as long as they aren't used for social media, texting or calls, and the company reserves the right to ask an employee to remove one if it interferes with the customer's experience ("Cell Phone/Smart Watch Policy", JBA Policy Manual p.19 [p.19]).

As a general approach, this is an easy one to set expectations on at a shift huddle rather than one-on-one — say where phones live during a shift and what counts as an emergency, so nobody's guessing. If you've already set the expectation with someone and it hasn't changed, ask me to create a coaching form for them.`;

/** conv_mvnoy6lr2kpus3g, the first line of the correct reply production sent. */
const SECTION_REPLY_LINE =
  "- **Phones are allowed in the building, but not on the floor with them.** Personal cell phones are permitted in the workplace but must be kept out of sight, on silent, and not on the employee's person — not in a back pocket, not charging in the break room, not sitting on top of a drawer till (\"Cell Phone/Smart Watch Policy\", JBA Policy Manual p.19 [p.19]).";

const NOTE =
  "Reading note (p.19): 'not in back pockets, charging in the break room, or sitting on top of a drawer till' lists three places the phone may NOT be; charging in the break room is not allowed.";

const NOTE_BLOCK = `MANUAL READING NOTES

These notes are not manual text and are not cited. Each one says how to read a sentence that is in the manual text above.

- ${NOTE}`;

const CELL_PHONE_CHUNK = rows.chunks.find((row) => row.chunk_index === 61)!;

function retrievedRow(content: string, section: string) {
  return {
    chunk_id: `chunk-${section}`,
    document_id: rows.document_ids["ask-sunny"],
    document_title: rows.title,
    category: "policies_compliance",
    locator: `Page 19 — ${section}`,
    page: 20,
    section,
    content,
    similarity: 0.93,
  };
}

async function ask(question: string) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-10-25" },
    } as never,
    ACTOR as never,
  );
}

interface Captured {
  system: string;
  grounding: string;
  fullManualBlock: string | null | undefined;
  manualBlock: string | null | undefined;
  content: string;
}

async function run(question: string, flag: string | undefined): Promise<Captured> {
  if (flag === undefined) delete process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED;
  else process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED = flag;
  const response = await ask(question);
  return {
    system: state.system,
    grounding: state.grounding,
    fullManualBlock: state.fullManualBlock,
    manualBlock: state.manualBlock,
    content: response.content,
  };
}

const saved = {
  note: process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED,
  manual: process.env.FULL_MANUAL_CONTEXT_ENABLED,
};

// The first import of server-ask is the slow part.
beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.system = "";
  state.grounding = "";
  state.fullManualBlock = undefined;
  state.manualBlock = undefined;
  state.reply = 'An answer ("Cell Phone/Smart Watch Policy", JBA Policy Manual p.19 [p.19]).';
  state.rows = [retrievedRow(CELL_PHONE_CHUNK.content, "Cell Phone/Smart Watch Policy")];
});

afterEach(() => {
  for (const [name, value] of [
    ["MANUAL_NEGATED_LIST_NOTE_ENABLED", saved.note],
    ["FULL_MANUAL_CONTEXT_ENABLED", saved.manual],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("p.19 reading note — the full manual is loaded (the live path)", () => {
  beforeEach(() => {
    process.env.FULL_MANUAL_CONTEXT_ENABLED = "1";
  });

  it("the B9 paste-and-ask turn gets the p.19 reading note in its grounding with the flag on", async () => {
    const on = await run(B9_QUESTION, "1");
    expect(on.fullManualBlock).toBeTruthy();
    // The manual the model reads holds the sentence, across the stored line break.
    expect(on.fullManualBlock!.replace(/\s+/g, " ")).toContain(
      "not in back pockets, charging in the break room, or sitting on top of a drawer till",
    );
    expect(on.grounding).toContain(NOTE);
    expect(on.grounding).toContain(NOTE_BLOCK);
    // The note is not manual text: the manual in the system prompt does not carry it.
    expect(on.fullManualBlock).not.toContain("Reading note");
    expect(on.system).not.toContain("Reading note");
  });

  it("with the flag off the prompt is byte-for-byte what it was, and on adds only the note", async () => {
    const unset = await run(B9_QUESTION, undefined);
    const off = await run(B9_QUESTION, "off");
    const on = await run(B9_QUESTION, "1");
    expect(unset.grounding).not.toContain("Reading note");
    expect(off.grounding).toBe(unset.grounding);
    expect(off.system).toBe(unset.system);
    expect(off.fullManualBlock).toBe(unset.fullManualBlock);
    expect(on.grounding).toBe(`${unset.grounding}\n\n${NOTE_BLOCK}`);
    // The manual block and the system prompt are the same either way: the cache key does not move.
    expect(on.fullManualBlock).toBe(unset.fullManualBlock);
    expect(on.manualBlock).toBe(unset.manualBlock);
    expect(on.system).toBe(unset.system);
  });

  it('"What is the cell phone policy?" (conv_mvnoyniz29tpyyq) gets the note, and nothing else in the answer changes', async () => {
    state.reply = POLICY_REPLY;
    const off = await run(POLICY_QUESTION, undefined);
    const on = await run(POLICY_QUESTION, "1");
    expect(on.grounding).toContain(NOTE);
    expect(off.grounding).not.toContain("Reading note");
    expect(on.content).toBe(off.content);
    expect(on.content).toContain("not charging in the break room");
  });

  it("control: conv_mvnoy6lr2kpus3g's correct answer is left as written", async () => {
    state.reply = SECTION_REPLY_LINE;
    const off = await run(SECTION_PASTE, undefined);
    const on = await run(SECTION_PASTE, "1");
    expect(on.grounding).toContain(NOTE);
    expect(on.content).toBe(off.content);
    expect(on.content).toContain("not charging in the break room");
  });

  it("a correct answer is left as written", async () => {
    state.reply = 'Phones may not be charging in the break room ("Cell Phone/Smart Watch Policy", JBA Policy Manual p.19 [p.19]).';
    const on = await run(B9_QUESTION, "1");
    expect(on.content).toContain("Phones may not be charging in the break room");
  });
});

describe("p.19 reading note — ordinary retrieval (full manual off)", () => {
  beforeEach(() => {
    delete process.env.FULL_MANUAL_CONTEXT_ENABLED;
  });

  it("a retrieved p.19 chunk gets the reading note beside it with the flag on", async () => {
    const off = await run(B9_QUESTION, undefined);
    const on = await run(B9_QUESTION, "1");
    expect(on.fullManualBlock ?? null).toBeNull();
    expect(off.grounding).toContain("charging in the break room");
    expect(off.grounding).not.toContain("Reading note");
    expect(on.grounding).toBe(`${off.grounding}\n\n${NOTE_BLOCK}`);
    expect(on.system).toBe(off.system);
  });

  it("grounding without the p.19 sentence gets no note, flag on or off", async () => {
    state.rows = [
      retrievedRow(
        "Company Email Account\nCompany email accounts are for authorized Employees only.",
        "Company Email Account",
      ),
    ];
    const off = await run(B9_QUESTION, undefined);
    const on = await run(B9_QUESTION, "1");
    expect(on.grounding).toBe(off.grounding);
    expect(on.grounding).not.toContain("Reading note");
  });
});
