import { afterEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { AccessScope, ChatMessage } from "@/types";

import { EMPTY_FORM_STATE } from "./form-state";
import { decideIntentTurn } from "./intent-slots";
import { enrichFormCard } from "./form-card-slots";
import { holdFilledSlots } from "./keep-filled-slots";

/**
 * Live replays, 24 Oct 2026. A manager types the incident date and the draft
 * is dated today. A later "verbal", "written", "yes", or "Monday" is saved
 * as Job Title. Intent extraction and slot retention are on in production;
 * these tests turn them on too.
 *
 * Today in these tests is Saturday 24 Oct 2026.
 */

vi.setConfig({ testTimeout: 30_000 });

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
    readDirectoryRoster: async () => [],
    loadScopedRoster: async () => [],
  };
});

const TODAY = "2026-10-24";
const MANAGER: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
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

const TEMPLATES = [{ key: "dpoa", name: "Corrective Action Form" }] as const;
const FLAGS = ["FORM_INPUT_FIDELITY_ENABLED", "INTENT_EXTRACTION_ENABLED", "SLOT_RETENTION_ENABLED"] as const;

afterEach(() => {
  for (const name of FLAGS) delete process.env[name];
});

function flags(fidelity: boolean) {
  process.env.INTENT_EXTRACTION_ENABLED = "1";
  process.env.SLOT_RETENTION_ENABLED = "1";
  if (fidelity) process.env.FORM_INPUT_FIDELITY_ENABLED = "1";
  else delete process.env.FORM_INPUT_FIDELITY_ENABLED;
}

async function propose(question: string, history: ChatMessage[] = []) {
  const { proposeFormForTurn } = await import("./form-proposal");
  return proposeFormForTurn({
    history,
    question,
    questionMessageId: "q-now",
    actor: { role: "salon_director" as never, scope: MANAGER },
    ...(history.length > 0 ? { continueTemplateKey: "dpoa" } : {}),
    summaries: LIBRARY as never,
    today: TODAY,
  });
}

const OPEN: ChatMessage[] = [
  {
    id: "h1",
    role: "user",
    content: "Create a Corrective Action Form for Sarah Test. She wore slippers.",
    createdAt: "2026-10-24T12:00:00Z",
  },
  {
    id: "h2",
    role: "assistant",
    content: "What is the date of the incident?",
    createdAt: "2026-10-24T12:00:01Z",
  },
];

describe("the draft date follows what the manager typed", () => {
  it.each([
    ["Oct 20", "2026-10-20"],
    ["10/20", "2026-10-20"],
  ] as const)("flag off already keeps %s and still drops a relative day", async (typed, iso) => {
    flags(false);
    const inline = await propose(`Create a Corrective Action form for Sarah Test. She wore slippers on ${typed}.`);
    expect(inline?.formProposal?.formDate).toBe(iso);
    const follow = await propose(typed, OPEN);
    expect(follow?.formProposal?.formDate).toBe(iso);

    const relative = await propose("Create a Corrective Action form for Sarah Test. She wore slippers yesterday.");
    expect(relative?.formProposal?.formDate ?? null).toBeNull();
    const lastTuesday = await propose(typed === "Oct 20" ? "yesterday" : "last Tuesday", OPEN);
    expect(lastTuesday?.formProposal?.formDate ?? null).toBeNull();
  });

  it.each([
    ["Oct 20", "2026-10-20"],
    ["10/20", "2026-10-20"],
    ["yesterday", "2026-10-23"],
    ["last Tuesday", "2026-10-20"],
  ] as const)("flag on keeps %s on the form", async (typed, iso) => {
    flags(true);
    const inline = await propose(
      `Create a Corrective Action form for Sarah Test. She wore slippers on ${typed}.`,
    );
    expect(inline?.formProposal, typed).toBeDefined();
    expect(inline?.formProposal?.formDate, typed).toBe(iso);

    const follow = await propose(typed, OPEN);
    expect(follow?.formProposal?.formDate, typed).toBe(iso);

    const decision = decideIntentTurn({
      question: typed,
      history: OPEN.map((turn) => ({ role: turn.role, content: turn.content })),
      today: TODAY,
      saved: { ...EMPTY_FORM_STATE, templateKey: "dpoa", employeeName: "Sarah Test" },
      raw: { incidentDate: typed, title: typed, formTurn: true, formType: "Corrective Action Form", employee: "Sarah Test" },
      people: [],
      salons: [],
      headings: [],
      templates: TEMPLATES,
      formInProgress: true,
    });
    expect(decision.state.formDate, typed).toBe(iso);
    expect(decision.state.title, typed).toBeNull();
    expect(decision.question, typed).not.toMatch(/job title/i);
  });

  it("still leaves the form undated when the manager said only today", async () => {
    flags(true);
    const answer = await propose("Create a Corrective Action form for Sarah Test. She wore slippers today.");
    expect(answer?.formProposal?.formDate ?? null).toBeNull();
  });
});

describe("a short follow-up is not the job title", () => {
  const saved = { ...EMPTY_FORM_STATE, templateKey: "dpoa", employeeName: "Sarah Test" };

  function turn(question: string, assistant: string, rawTitle: string) {
    return decideIntentTurn({
      question,
      history: [
        { role: "user", content: "Create a Corrective Action Form for Sarah Test. She was late." },
        { role: "assistant", content: assistant },
      ],
      today: TODAY,
      saved,
      raw: { title: rawTitle, formTurn: true, formType: "Corrective Action Form", employee: "Sarah Test" },
      people: [],
      salons: [],
      headings: [],
      templates: TEMPLATES,
      formInProgress: true,
    });
  }

  async function card(question: string, assistant: string, stateTitle: string | null) {
    const history: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "Create a Corrective Action Form for Sarah Test. She was late." },
      { role: "assistant", content: assistant },
    ];
    const proposed = await propose(question, [
      { ...history[0]!, id: "u1", createdAt: "2026-10-24T12:00:00Z" },
      { ...history[1]!, id: "a1", createdAt: "2026-10-24T12:00:01Z" },
    ]);
    expect(proposed?.formProposal).toBeDefined();
    const enriched = enrichFormCard({
      response: proposed!,
      question,
      today: TODAY,
      people: [],
      saved: { ...saved, title: stateTitle },
    });
    return holdFilledSlots({
      response: enriched,
      question,
      history,
      today: TODAY,
      people: [],
    });
  }

  it.each(["verbal", "written", "yes", "Monday"])(
    "flag off stores %s on the title while intent extraction and slot retention are on",
    async (reply) => {
      flags(false);
      const assistant =
        reply === "yes"
          ? "Is payroll deduct applicable? (Yes or No)"
          : reply === "Monday"
            ? "What is the date of the incident?"
            : "Whether this is a verbal or written warning";
      const decision = turn(reply, assistant, reply);
      expect(decision.state.title).toBe(reply);
      expect(decision.question).toMatch(new RegExp(`job title:\\s*${reply}`, "i"));
      const held = await card(decision.question, assistant, decision.state.title);
      expect(held.formProposal?.employeeRole?.toLowerCase()).toContain(reply.toLowerCase());
    },
  );

  it("flag on routes verbal and written to the warning, not the title", async () => {
    flags(true);
    for (const reply of ["verbal", "written"] as const) {
      const assistant = "Whether this is a verbal or written warning";
      const decision = turn(reply, assistant, reply);
      expect(decision.state.title, reply).toBeNull();
      expect(decision.state.warningLevel, reply).toBe(reply);
      expect(decision.question, reply).not.toMatch(/job title/i);

      const held = await card(decision.question, assistant, decision.state.title);
      expect(held.formProposal?.employeeRole ?? null, reply).toBeNull();
      expect(held.formProposal?.warningLevel, reply).toBe(reply);
    }
  });

  it("flag on routes yes to payroll and Monday to the date", async () => {
    flags(true);
    const yes = turn("yes", "Is payroll deduct applicable? (Yes or No)", "yes");
    expect(yes.state.title).toBeNull();
    expect(yes.question).not.toMatch(/job title/i);
    const yesCard = await card(yes.question, "Is payroll deduct applicable? (Yes or No)", yes.state.title);
    expect(yesCard.formProposal?.employeeRole ?? null).toBeNull();
    expect(yesCard.formProposal?.payrollDeduct).toBe("yes");

    const monday = turn("Monday", "What is the date of the incident?", "Monday");
    expect(monday.state.title).toBeNull();
    expect(monday.state.formDate).toBe("2026-10-19");
    expect(monday.question).not.toMatch(/job title/i);
    const mondayCard = await card(monday.question, "What is the date of the incident?", monday.state.title);
    expect(mondayCard.formProposal?.employeeRole ?? null).toBeNull();
    expect(mondayCard.formProposal?.formDate).toBe("2026-10-19");
  });

  it("flag on still keeps a real title, including one given when the bot asked for it", async () => {
    flags(true);
    const stated = decideIntentTurn({
      question: "She is a TC",
      history: [],
      today: TODAY,
      saved,
      raw: { title: "TC", formTurn: true, formType: "Corrective Action Form", employee: "Sarah Test" },
      people: [],
      salons: [],
      headings: [],
      templates: TEMPLATES,
      formInProgress: true,
    });
    expect(stated.state.title).toBe("Tanning Consultant");

    const asked = turn("Monday", "The employee's job title (e.g. TC, ASD, SD) if you have it", "Monday");
    expect(asked.state.title).toBe("Monday");
    expect(asked.question).toMatch(/job title:\s*Monday/i);
  });
});
