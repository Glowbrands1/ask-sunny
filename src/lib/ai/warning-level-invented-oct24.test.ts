import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import type { AccessScope, ChatMessage } from "@/types";

import { managerStatedWarningLevel, statedWarningLevel } from "@/lib/forms/warning-level";

import { decideIntentTurn, type IntentTurnInput } from "./intent-slots";

/**
 * ============================================================================
 * "WRITTEN WARNING, AS YOU SAID" WHEN NOBODY SAID WRITTEN — LIVE, 24 OCT 2026
 * ============================================================================
 *
 * Managers' thumbs-down chats, replayed on production (fa1870b, the flag-off
 * path): 6 of 13 replies read back "**Type of Warning:** Written Warning, as
 * you said — I'll tick it on the form." The manager never said written. The
 * level came from Ask Sunny's own previous reply — "You'll set the
 * verbal/written warning level … I won't guess at them" reads as "written
 * warning" — which the intent reading split out of the whole conversation
 * (assistant turns included), stored as `warningLevel: "written"` in
 * chat_form_state, and put ahead of the next question as "Warning level:
 * written." (chat_traces.original_query of the second turn).
 *
 * And the bare "Yes" that answered "Is payroll deduct applicable? Yes or No?"
 * was lost: once the stored slots were put ahead of it, it was no longer a
 * bare answer, and the payroll question was asked again.
 *
 * The turns are the replays' exact words (conv_mvmtc8k72x22ox6,
 * conv_mvmtndnm2k6ilyr; originals conv_mvi4qyos257k30u, conv_mvh1m29j25aig2n),
 * with the managers' employees already replaced by test names.
 */

const FLAG = "WARNING_LEVEL_MANAGER_ONLY_ENABLED";

const SALONS = [{ id: "loc-0101", name: "North Salon" }] as const;
const TEMPLATES = [
  { key: "dpoa", name: "Corrective Action Form" },
  { key: "coaching", name: "Coaching Form" },
] as const;
const HEADINGS = ["Attendance", "Late Opening", "Standards of Conduct"];

/* conv_mvmtc8k72x22ox6 */
const REQUEST =
  "create ca for Test Employee, Salon Director for violating standards of conduct. Test failed to have Test Newhire complete required policy acknowledgements in woven during Test Newhire's onboarding on 9-28-26 as reflected on the woven policy acknowledgement report run on 10-16-26.";
const REQUEST_REPLY =
  "I'll draft a **Corrective Action Form** for **Test Employee** from what you've described, and check the applicable company policy before anything policy-related goes on it.\n\n**Policy:** Standards of Conduct, as you said. I'll quote that section from the current policy manual on the draft.\n\nYou'll set the verbal/written warning level and any prior coaching or corrective action on the form — I won't guess at them.\n\nOne more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.\n\nYour account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do.\n\nYou mentioned more than one date (**9/28**, **10/16**). Which date goes on the form? Say \"most recent\" (10/16), pick one, or say \"today\" for the day you create it. Every date stays in the description of what happened — this only sets the form's Date, and until you choose it is dated today.";
const FOR_EMPLOYEE = "for Test Employee";

/* conv_mvmtndnm2k6ilyr */
const BARE_REQUEST = "create a corrective action form for Test Employee";
const BARE_REQUEST_REPLY =
  "I can create a **Corrective Action Form** for **Test Employee**.\n\n**You haven't told me what happened yet**, so I can't cite the policy manual — the draft will come back without the policy section and page. You can create it now and fill it in yourself, or tell me here what happened and I'll draft it (or redraft the form you created) with the manual's section and page cited.\n\nYou'll set the verbal/written warning level and any prior coaching or corrective action on the form — I won't guess at them.\n\nOne more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.\n\nYour account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do.\n\n**Action Plan:** Management will review the applicable company policy with Test. Future policy violations may result in additional corrective action up to and including termination of employment.";

/* conv_mvh1m29j25aig2n — the "Yes" that confirms a name is not a payroll answer. */
const TYPO_REQUEST = "create a corrective action form for Rowen Testo";
const DID_YOU_MEAN =
  "Did you mean **Rowan Testo**? I couldn't find **Rowen Testo** exactly in the employee list for your salons, so I want to be sure before it goes on the form. Reply \"yes\" to use **Rowan Testo**, or \"no\" to keep **Rowen Testo** as you typed it.";

const said = (content: string) => ({ role: "user", content });
const replied = (content: string) => ({ role: "assistant", content });

function intent(overrides: Partial<IntentTurnInput>): IntentTurnInput {
  return {
    question: "",
    history: [],
    today: "2026-10-24",
    saved: null,
    raw: null,
    people: [],
    salons: SALONS,
    headings: HEADINGS,
    templates: TEMPLATES,
    formInProgress: false,
    ...overrides,
  };
}

/** Two turns through the intent reading, the first turn's state saved as production saves it. */
function secondTurn(first: string, reply: string, second: string, raw: unknown = null) {
  const one = decideIntentTurn(intent({ question: first, raw }));
  return decideIntentTurn(
    intent({
      question: second,
      history: [said(first), replied(reply)],
      saved: one.state,
      raw,
      formInProgress: Boolean(one.state.templateKey),
    }),
  );
}

let previous: string | undefined;
beforeEach(() => {
  previous = process.env[FLAG];
});
afterEach(() => {
  if (previous === undefined) delete process.env[FLAG];
  else process.env[FLAG] = previous;
});

describe("live replay, 24 Oct 2026: the level is only what the manager said", () => {
  it.each([
    ["with no slot reading", null],
    ["with the slot model guessing written", { warningLevel: "written", formTurn: true }],
  ])('"for Test Employee" after Ask Sunny\'s "verbal/written warning level" stores no level (%s)', (_name, raw) => {
    process.env[FLAG] = "true";
    const decision = secondTurn(REQUEST, REQUEST_REPLY, FOR_EMPLOYEE, raw);
    expect(decision.state.warningLevel).toBeNull();
    expect(decision.question).not.toMatch(/Warning level:/);
  });

  it('a bare "Yes" after "Is payroll deduct applicable? Yes or No?" is no warning level', () => {
    process.env[FLAG] = "true";
    const decision = secondTurn(BARE_REQUEST, BARE_REQUEST_REPLY, "Yes");
    expect(decision.state.warningLevel).toBeNull();
    expect(decision.question).not.toMatch(/Warning level:/);
  });

  it("flag off keeps main's reading (the replayed defect), so the change is opt-in", () => {
    delete process.env[FLAG];
    expect(secondTurn(REQUEST, REQUEST_REPLY, FOR_EMPLOYEE).state.warningLevel).toBe("written");
    expect(secondTurn(BARE_REQUEST, BARE_REQUEST_REPLY, "Yes").state.warningLevel).toBe("written");
  });

  it("a level the manager did state is still kept", () => {
    process.env[FLAG] = "true";
    const stated = secondTurn(REQUEST, REQUEST_REPLY, "this is written");
    expect(stated.state.warningLevel).toBe("written");
    expect(stated.question).toMatch(/Warning level: written\./);
    expect(secondTurn("create verbal CA for Test Employee for violating standards of conduct", REQUEST_REPLY, FOR_EMPLOYEE).state.warningLevel).toBe("verbal");
  });

  it('a bare "Yes" counts only after one yes/no question about that exact level', () => {
    process.env[FLAG] = "true";
    expect(secondTurn(BARE_REQUEST, "Should I tick **Written Warning** on the form?", "Yes").state.warningLevel).toBe("written");
    expect(secondTurn(BARE_REQUEST, "Is this a **verbal or written warning**?", "Yes").state.warningLevel).toBeNull();
    expect(
      secondTurn(BARE_REQUEST, "Should I tick **Written Warning** on the form? **Is payroll deduct applicable?**", "Yes").state
        .warningLevel,
    ).toBeNull();
  });
});

describe('live replay, 24 Oct 2026: a bare "Yes"/"No" answers the payroll question just asked', () => {
  it.each([
    ["Yes", "yes", /Payroll deduct applies\./],
    ["No", "no", /No payroll deduction\./],
  ])('"%s" right after "Is payroll deduct applicable? Yes or No?" is the payroll answer', (reply, answer, sentence) => {
    process.env[FLAG] = "true";
    const decision = secondTurn(BARE_REQUEST, BARE_REQUEST_REPLY, reply);
    expect(decision.state.payrollDeduct).toBe(answer);
    expect(decision.question).toMatch(sentence);
  });

  it('the "Yes" that confirms a name ("Did you mean …?") is not a payroll answer', () => {
    process.env[FLAG] = "true";
    expect(secondTurn(TYPO_REQUEST, DID_YOU_MEAN, "Yes").state.payrollDeduct).toBeNull();
  });

  it("flag off keeps main's reading: the stored slots bury the bare Yes", () => {
    delete process.env[FLAG];
    expect(secondTurn(BARE_REQUEST, BARE_REQUEST_REPLY, "Yes").state.payrollDeduct).toBeNull();
  });
});

/* ========================================================================= */
/* THE CARD ITSELF: "as you said" is never printed for an unstated level      */
/* ========================================================================= */

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] };

const DPOA = {
  id: "tpl-dpoa-id",
  key: "dpoa",
  name: "Corrective Action Form",
  shortName: "DPOA",
  description: "The formal corrective step after coaching.",
  layoutFamily: "corrective",
  requiredPermission: "create_corrective_action",
  active: true,
  displayOrder: 2,
  currentVersion: { id: "v1", status: "published", document: correctiveActionDocument(), variants: [] },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
};

async function card(first: string, reply: string, second: string) {
  vi.resetModules();
  vi.doMock("@/lib/forms/repository", () => ({
    listTemplateSummaries: async () => {
      throw new Error("form-proposal takes the library from its caller");
    },
    getTemplateByKey: async () => {
      throw new Error("form-proposal must not read the library");
    },
  }));
  const { proposeFormForTurn } = await import("./form-proposal");
  const { decideIntentTurn: decide } = await import("./intent-slots");
  const one = decide(intent({ question: first }));
  const decision = decide(
    intent({
      question: second,
      history: [said(first), replied(reply)],
      saved: one.state,
      formInProgress: Boolean(one.state.templateKey),
    }),
  );
  const history: ChatMessage[] = [
    { id: "m1", role: "user", content: first, createdAt: "2026-10-24T19:50:00Z" },
    { id: "a1", role: "assistant", content: reply, createdAt: "2026-10-24T19:50:04Z" },
  ];
  const response = await proposeFormForTurn({
    history,
    question: decision.question,
    questionMessageId: "m2",
    actor: { role: "salon_director" as never, scope: SALON },
    summaries: [DPOA] as never,
    today: "2026-10-24",
    continueTemplateKey: "dpoa",
  });
  vi.doUnmock("@/lib/forms/repository");
  return response!;
}

describe("the Corrective Action card on the replayed turns", () => {
  it('"for Test Employee" — no "Written Warning, as you said"', async () => {
    process.env[FLAG] = "true";
    const response = await card(REQUEST, REQUEST_REPLY, FOR_EMPLOYEE);
    expect(response.formProposal?.warningLevel ?? null).toBeNull();
    expect(response.content).not.toMatch(/Type of Warning:\*\* Written Warning, as you said/);
    expect(response.content).toMatch(/verbal\/written warning level/);
  });

  it('a bare "Yes" — no "Written Warning, as you said", and payroll is not asked again', async () => {
    process.env[FLAG] = "true";
    const response = await card(BARE_REQUEST, BARE_REQUEST_REPLY, "Yes");
    expect(response.formProposal?.warningLevel ?? null).toBeNull();
    expect(response.content).not.toMatch(/as you said — I'll tick it/);
    expect(response.formProposal?.payrollDeduct).toBe("yes");
    // Read back as the manager's answer, not asked again.
    expect(response.content).toMatch(/Is payroll deduct applicable\? \*\*Yes\*\* — tell me if that should change/);
    expect(response.content).not.toMatch(/Yes or No\?/);
  });
});

describe('"verbal/written", "verbal or written" name the choice, not a level', () => {
  const LEVEL_LEFT_OPEN =
    "You'll set the verbal/written warning level and any prior coaching or corrective action on the form — I won't guess at them.";

  const manager = (content: string) => managerStatedWarningLevel([{ role: "user", content }]);

  it("read as the manager's words, undecided wording states no level; a decided one still does", () => {
    expect(manager(LEVEL_LEFT_OPEN)).toBeNull();
    expect(manager("4. Whether this is a verbal or written warning")).toBeNull();
    expect(manager("not sure if written or verbal warning yet")).toBeNull();
    expect(manager("create a written CA for Test Employee")).toBe("written");
    expect(manager("verbal. no payroll deduct.")).toBe("verbal");
  });

  it("main's sentence reader is unchanged: it reads the same sentence as written (the replayed defect)", () => {
    expect(statedWarningLevel(LEVEL_LEFT_OPEN)).toBe("written");
  });

  it("assistant turns never state the level", () => {
    process.env[FLAG] = "true";
    expect(
      managerStatedWarningLevel([
        { role: "user", content: BARE_REQUEST },
        { role: "assistant", content: "**Type of Warning:** Written Warning, as you said — I'll tick it on the form." },
        { role: "user", content: "Yes" },
      ]),
    ).toBeNull();
  });
});
