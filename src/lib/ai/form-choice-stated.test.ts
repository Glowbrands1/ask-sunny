import { afterEach, describe, expect, it, vi } from "vitest";

import { formChoiceStatedEnabled } from "@/lib/config/chat-quality-flags";
import { PRODUCTION_SALONS } from "@/data/salons";
import { HR_TEMPLATE_SEEDS } from "@/lib/forms/library";
import { findManualSection, manualSectionHeadings } from "@/lib/forms/official-policy-manual";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { AccessScope } from "@/types";

import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "./__fixtures__/jba-policy-manual";
import { attachFormTurnSources, statedManualHeading } from "./form-card-slots";
import { proposeFormForTurn } from "./form-proposal";
import type { ConversationFormState } from "./form-state";
import { augmentIntakeQuestion } from "./intake-augment";
import { decideIntentTurn } from "./intent-slots";
import { prepareProposalQuestion } from "./proposal-question";

/**
 * FORM_CHOICE_STATED_ENABLED. Low-rated chats, 24 Oct 2026 (QA rounds 4 and 5):
 *
 *   conv_mvmvl6jy23nwuuk  "Please make me a coaching form …", then "Can you
 *                         make coaching work sheets for the team ?" — both a
 *                         Corrective Action Form.
 *   conv_mvmw1ccu2t7y3bi  "Create a coaching form for a performance concern."
 *                         and four more turns asking for coaching — every one a
 *                         Corrective Action Form.
 *   conv_mvmyba3d2ojmzuf  "Create a Policy Review" — a Corrective Action Form.
 *   conv_mvmyqvkq2zwzrln  "create a Verbal CA … woven deadline" — the reply
 *                         named Standards of Conduct, the only source was
 *                         "Page 14 — Disciplinary Action".
 *
 * Root cause: the intent read accepted the model's "Disciplinary Action" (the
 * discipline procedure) as the policy, and its "Policy reference:" line put a
 * Corrective Action alias ahead of the turn; then the form was read from a
 * blob holding the assistant's "**Corrective Action Form**". Each turn runs
 * through this app's live path: decideIntentTurn, the intake question, the
 * proposal, and the card's sources. The manager's words and the assistant's
 * replies are the real turns (the employees in them were already test names);
 * the tool payload copies the manager's words.
 */

const TODAY = "2026-10-24";
const SALONS = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));
const HEADINGS = manualSectionHeadings(JBA_MANUAL_CHUNKS);
const PAGES: Record<string, number> = {};
for (const heading of HEADINGS) {
  const section = findManualSection(JBA_MANUAL_CHUNKS, [heading]);
  if (section && section.page > 0) PAGES[heading] = section.page;
}
const LIBRARY = HR_TEMPLATE_SEEDS.map((seed) => ({
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
const TEMPLATES = LIBRARY.map((row) => ({ key: row.key, name: row.name }));
const SCOPE: AccessScope = { level: "global", primaryAreaId: "", alsoCoversAreaIds: [] };

type Turn = { id: string; role: "user" | "assistant"; content: string };

interface LiveTurn {
  readonly question: string;
  readonly raw: unknown;
}

/** One manager turn through intent extraction, the proposal and the card's sources. */
async function live(input: {
  history: readonly Turn[];
  question: string;
  saved: ConversationFormState | null;
  raw: unknown;
  continueTemplateKey?: string | null;
}) {
  const decision = decideIntentTurn({
    question: input.question,
    history: input.history,
    today: TODAY,
    saved: input.saved,
    raw: input.raw,
    people: [],
    salons: SALONS,
    headings: HEADINGS,
    headingPages: PAGES,
    templates: TEMPLATES,
    formInProgress: Boolean(input.saved?.templateKey || input.continueTemplateKey),
  });
  const question = prepareProposalQuestion(
    augmentIntakeQuestion({ slots: true, fields: true, question: decision.question, history: input.history, today: TODAY }),
  );
  const proposed = await proposeFormForTurn({
    history: [...input.history],
    question,
    questionMessageId: `msg-${input.history.length}`,
    actor: { role: "admin", scope: SCOPE },
    continueTemplateKey: input.continueTemplateKey ?? undefined,
    summaries: LIBRARY as never,
    today: TODAY,
    policyManual: async () => JBA_MANUAL_CHUNKS,
    policyManualIdentity: async () => ({ title: "JBA Policy Manual", confirmed: true }),
  });
  const notes = [...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content), decision.question].join("\n");
  const sources = proposed
    ? attachFormTurnSources({
        content: proposed.content,
        citations: [],
        notes,
        chunks: JBA_MANUAL_CHUNKS,
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: "JBA Policy Manual",
        documentCategory: "policies_compliance",
        modelHeading: statedManualHeading(notes),
      })
    : null;
  return { decision, proposed, sources, templateKey: proposed?.formProposal?.templateKey ?? null };
}

/**
 * Every manager turn in order. The prior assistant turns are the replies
 * production sent; the open card's template is what the last turn proposed.
 */
async function replay(turns: readonly LiveTurn[], replies: readonly string[]) {
  const keys: (string | null)[] = [];
  const history: Turn[] = [];
  let saved: ConversationFormState | null = null;
  let open: string | null = null;
  for (const [at, turn] of turns.entries()) {
    const out = await live({ history, question: turn.question, saved, raw: turn.raw, continueTemplateKey: open });
    keys.push(out.templateKey);
    saved = out.decision.state;
    open = out.templateKey ?? open;
    history.push({ id: `u${at}`, role: "user", content: turn.question });
    history.push({ id: `a${at}`, role: "assistant", content: replies[at] ?? "" });
  }
  return { keys, saved };
}

/* ---------------------------------------------------- conv_mvmvl6jy23nwuuk -- */

const CLOSING_DUTIES =
  "Please make me a coaching form for test employee at the lincoln pine lake location Test did not complete closing duties. Trash was not taken out of the bathrooms, there was no\ntoilet paper in the women's bathroom, and there were no spray towels in the rooms also all the cleaning duties were signed off in the binder and not alll were completed and the way she signed off on the checklist was incorrect she signed one box with a arrown throught the rest each box needs an initial";
const TEAM_WORKSHEETS = "Can you make coaching work sheets for the team ? on closing duties at night ?";
const CLOSING_REPLY =
  "I'll draft a **Corrective Action Form** for **test employee** from what you've described, and check the applicable company policy before anything policy-related goes on it.\n\n**Policy:** this reads as **Standards of Conduct** — assigned work that wasn't completed. I'll check it against the current policy manual and quote that section on the draft; if the manual doesn't support it, I'll leave the policy for you. Tell me if a different policy applies.\n\nYou'll set the verbal/written warning level and any prior coaching or corrective action on the form — I won't guess at them.\n\nOne more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.\n\nCreate the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.\n\nDisciplinary Action Policy, JBA Policy Manual p.14";

const CLOSING_TURNS: LiveTurn[] = [
  {
    question: CLOSING_DUTIES,
    raw: {
      employee: "test employee",
      salon: "lincoln pine lake",
      incidentType: "did not complete closing duties",
      formType: "coaching form",
      formTurn: true,
      policyHeading: "Disciplinary Action",
    },
  },
  { question: TEAM_WORKSHEETS, raw: { employee: "test employee", formType: null, formTurn: true, policyHeading: "Disciplinary Action" } },
];

/* ---------------------------------------------------- conv_mvmw1ccu2t7y3bi -- */

const PERFORMANCE_CONCERN = "Create a coaching form for a performance concern.";
const LATE_OPENING = "name is test testy, todays date, shawnee location, test was late opening salon";
const DID_NOT_CALL = "create coaching form. test testy is ass't salon director. test did not call anyone about opening late";
const USE_TODAY = "name is test testy and use todays date to create coaching form";
const FROM_CONVERSATION = "Create a form from this conversation.";

const ASKED_FOR_DETAILS =
  "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:\n\n1. Employee's full name\n2. Date for the form (if you say “today,” I'll use October 24, 2026)\n3. What happened — a clear description of the incident(s) with dates and specifics\n4. Whether this is a verbal or written warning\n5. Whether the employee has previously received coaching and/or corrective action, and if yes, what and the date each was signed\n6. Is payroll deduct applicable? (Yes or No)\n7. The employee's job title (e.g. TC, ASD, SD) if you have it\n\nOnce I have that I'll prepare the Corrective Action Form and check the applicable company policy before anything policy-related goes on it.\n\nDisciplinary Action Policy, JBA Policy Manual p.14";
const LATE_OPENING_REPLY =
  "I'll draft a **Corrective Action Form** for **test testy** from what you've described, and check the applicable company policy before anything policy-related goes on it.\n\n**Policy:** Late Opening, as you said. I'll quote that section from the current policy manual on the draft.\n\n**Type of Warning:** Written Warning, as you said — I'll tick it on the form. Tell me if that should change.\n\nYou'll set any prior coaching or corrective action on the form — I won't guess at it.\n\nOne more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.\n\nCreate the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.\n\nLate Opening Policy, JBA Policy Manual p.15\n\nAttendance Policy, JBA Policy Manual p.14";
const PERFORMANCE_REPLIES = [ASKED_FOR_DETAILS, LATE_OPENING_REPLY, LATE_OPENING_REPLY, LATE_OPENING_REPLY];

const PERFORMANCE_TURNS: LiveTurn[] = [
  {
    question: PERFORMANCE_CONCERN,
    raw: { incidentType: "performance concern", formType: "coaching form", formTurn: true, policyHeading: "Disciplinary Action" },
  },
  {
    question: LATE_OPENING,
    raw: {
      employee: "test testy",
      salon: "shawnee",
      incidentType: "late opening salon",
      incidentDate: "todays date",
      // The model copies the assistant's form name.
      formType: "Corrective Action Form",
      formTurn: true,
      policyHeading: "Late Opening",
    },
  },
  {
    question: DID_NOT_CALL,
    raw: {
      employee: "test testy",
      title: "ass't salon director",
      incidentType: "did not call anyone about opening late",
      formType: null,
      formTurn: true,
      policyHeading: "Late Opening",
    },
  },
  { question: USE_TODAY, raw: { employee: "test testy", incidentDate: "todays date", formType: null, formTurn: true, policyHeading: "Late Opening" } },
  { question: FROM_CONVERSATION, raw: { employee: "test testy", formType: null, formTurn: true, policyHeading: "Late Opening" } },
];

/* ---------------------------------------------------- conv_mvmyba3d2ojmzuf -- */

const CELL_PHONE = "Test Employee at NE Grand Island used her cell phone on the sales floor on 10-17";
const POLICY_REVIEW = "Create a Policy Review";
const CELL_PHONE_REPLY =
  "Here's the policy language you'd be working from on that one.\n\nPersonal cell phones are permitted in the workplace but must be kept out of sight, and it's the employee's personal responsibility to protect the customer's experience.\n\nAs a general approach, before you decide the level, it's worth pinning down what you actually observed on 10-17 and whether this is a first conversation or a repeat. That's what decides whether this is a documented coaching conversation, a policy review, or a formal corrective step. The decision and the signature stay with you.\n\nOne thing to flag from your own history: you have four Corrective Action Form drafts for Test Employee sitting unfinalized, dated 10-19, 10-20, 10-21 and 10-24. If any of those were meant to cover this, it's worth pulling the right one back up rather than starting fresh.\n\nWhen you know which way you're going, ask me by name and employee — for example \"create a policy review for Test Employee\" or \"edit the corrective action form for Test Employee\" — and the draft card will come up here.";

const POLICY_REVIEW_TURNS: LiveTurn[] = [
  {
    question: CELL_PHONE,
    raw: {
      employee: "Test Employee",
      salon: "NE Grand Island",
      incidentType: "used her cell phone on the sales floor",
      incidentDate: "10-17",
      formType: null,
      formTurn: false,
      policyHeading: "Cell Phone/Smart Watch Policy",
    },
  },
  {
    question: POLICY_REVIEW,
    raw: { employee: "Test Employee", salon: "NE Grand Island", incidentDate: "10-17", formType: null, formTurn: true, policyHeading: "Cell Phone/Smart Watch Policy" },
  },
];

/* ---------------------------------------------------- conv_mvmyqvkq2zwzrln -- */

const WOVEN_DEADLINE = "create a Verbal CA for Test Employee for missing the 10-15-26 woven deadline";
const WOVEN_RAW = {
  employee: "Test Employee",
  incidentType: "missing the woven deadline",
  incidentDate: "10-15-26",
  warningLevel: "verbal",
  formType: "Verbal CA",
  formTurn: true,
  policyHeading: "Disciplinary Action",
};

/* ---------------------------------------------------- conv_mvnbbhdq2a8t7nk -- */

/**
 * QA, 25 Oct 2026: three identical runs. conv_mvnbbhdq2a8t7nk showed the
 * Follow-Up Coaching card on turns 2–5 with no earlier coaching mentioned;
 * conv_mvnbeya221vuc5g and conv_mvnbg6l92wxhtfa gave the Coaching Form. The
 * replies are that bad run's; the tool payload reads "follow-up-coaching",
 * as the bad run's model did.
 */
const COACH_TURNS: LiveTurn[] = [
  { question: "I need to coach an employee", raw: { formType: null, formTurn: true } },
  { question: "Her name is Test Employee", raw: { employee: "Test Employee", formType: "follow-up-coaching", formTurn: true } },
  { question: "She works at NE Grand Island", raw: { employee: "Test Employee", salon: "NE Grand Island", formType: "follow-up-coaching", formTurn: true } },
  { question: "It happened on 10-21", raw: { employee: "Test Employee", incidentDate: "10-21", formType: "follow-up-coaching", formTurn: true } },
  {
    question: "She was on her cell phone for 30+ minutes at the front desk",
    raw: {
      employee: "Test Employee",
      incidentType: "on her cell phone for 30+ minutes at the front desk",
      formType: "follow-up-coaching",
      formTurn: true,
      policyHeading: "Cell Phone/Smart Watch Policy",
    },
  },
];
const FOLLOW_UP_CARD =
  "Here is what I would put on a **Follow-Up Coaching Form**.\n\nEverything I need is here, drawn from your messages above.\n\nI have the employee and the salon. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.";
const COACH_REPLIES = [
  "Happy to help with that. Tell me a bit and I can shape the conversation with you:\n\n- **Who** — the employee's name.\n- **What you saw or heard** — the specific behavior or the metric signal, in plain terms.\n- **Any history** — have you coached this before, and did anything change since?\n\nThat's enough for me to help you frame the observation, the expectation, why it matters, a role play, and a follow-up plan — which is the structure a good coaching conversation follows [S6].\n\nOne thing worth naming up front: coaching is where most issues should start and usually get solved. The progression runs observation → coaching → role play → follow-up coaching before anything formal, and a metric on its own is a coaching signal, not grounds for documentation beyond that [S17].\n\nWhen you're ready for the paperwork, ask me to create a coaching form for them and the draft card will come up here.",
  FOLLOW_UP_CARD,
  FOLLOW_UP_CARD,
  FOLLOW_UP_CARD,
];

describe("FORM_CHOICE_STATED_ENABLED: the form the manager named wins", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults off", () => {
    expect(formChoiceStatedEnabled()).toBe(false);
  });

  it("conv_mvmvl6jy23nwuuk: the coaching form and the team coaching worksheets are the Coaching Form", async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const { keys, saved } = await replay(CLOSING_TURNS, [CLOSING_REPLY]);
    expect(keys).toEqual(["coaching", "coaching"]);
    expect(saved?.templateKey).toBe("coaching");
    expect(saved?.policyHeading).not.toBe("Disciplinary Action");
  });

  it("conv_mvmw1ccu2t7y3bi: every coaching turn stays the Coaching Form", async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const { keys, saved } = await replay(PERFORMANCE_TURNS, PERFORMANCE_REPLIES);
    expect(keys).toEqual(["coaching", "coaching", "coaching", "coaching", "coaching"]);
    expect(saved?.templateKey).toBe("coaching");
    expect(saved?.policyHeading).toBe("Late Opening");
  });

  it('"Create a Coaching Form" after a conversation about a late opening is the Coaching Form', async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const before = await replay(PERFORMANCE_TURNS.slice(1, 2), []);
    const out = await live({
      history: [
        { id: "u0", role: "user", content: LATE_OPENING },
        { id: "a0", role: "assistant", content: LATE_OPENING_REPLY },
      ],
      question: "Create a Coaching Form",
      saved: before.saved,
      raw: { employee: "test testy", formType: null, formTurn: true, policyHeading: "Late Opening" },
      continueTemplateKey: before.keys[0],
    });
    expect(out.templateKey).toBe("coaching");
    expect(out.decision.state.templateKey).toBe("coaching");
  });

  // The library has no worksheet template. A team coaching sheet is the
  // Coaching Form, whose subject may be the whole team (team-subject.ts).
  it("a team worksheet request with no earlier form is the Coaching Form, never a Corrective Action", async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    expect(TEMPLATES.some((template) => /work\s?sheet/i.test(template.name))).toBe(false);
    const out = await live({ history: [], question: TEAM_WORKSHEETS, saved: null, raw: { formType: null, formTurn: true } });
    expect(out.templateKey).toBe("coaching");
    expect(out.decision.state.templateKey).toBe("coaching");
  });

  it('conv_mvmyba3d2ojmzuf: "Create a Policy Review" is the Policy Review', async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const { keys, saved } = await replay(POLICY_REVIEW_TURNS, [CELL_PHONE_REPLY]);
    expect(keys[1]).toBe("policy-review");
    expect(saved?.templateKey).toBe("policy-review");
  });

  it('"create a CA" is still the Corrective Action Form, fresh and after a coaching form', async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const fresh = await live({ history: [], question: "create a CA", saved: null, raw: { formType: "CA", formTurn: true } });
    expect(fresh.decision.state.templateKey).toBe("dpoa");
    expect(fresh.templateKey ?? "dpoa").toBe("dpoa");

    const coached = await replay(PERFORMANCE_TURNS.slice(0, 1), []);
    expect(coached.keys).toEqual(["coaching"]);
    const out = await live({
      history: [
        { id: "u0", role: "user", content: PERFORMANCE_CONCERN },
        { id: "a0", role: "assistant", content: "Here is what I would put on a **Coaching Form**." },
      ],
      question: "create a CA",
      saved: coached.saved,
      raw: { formType: "CA", formTurn: true },
      continueTemplateKey: "coaching",
    });
    expect(out.decision.state.templateKey).toBe("dpoa");
    expect(out.templateKey).toBe("dpoa");

    const woven = await live({ history: [], question: WOVEN_DEADLINE, saved: null, raw: WOVEN_RAW });
    expect(woven.templateKey).toBe("dpoa");
  });

  it("conv_mvmyqvkq2zwzrln: the card cites the Standards of Conduct the reply names, not Disciplinary Action", async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const out = await live({ history: [], question: WOVEN_DEADLINE, saved: null, raw: WOVEN_RAW });
    expect(out.proposed?.content).toMatch(/\*\*Standards of Conduct\*\*/);
    expect(out.decision.state.policyHeading).toBeNull();
    expect(out.decision.question).not.toMatch(/Disciplinary Action/);
    expect(out.sources?.citations.map((citation) => citation.locator)).toEqual(["Page 12"]);
    expect(out.sources?.content).not.toMatch(/Disciplinary Action/);
  });

  it("conv_mvnbbhdq2a8t7nk: no earlier coaching mentioned is the Coaching Form, not the follow-up", async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const { keys, saved } = await replay(COACH_TURNS, COACH_REPLIES);
    expect(keys.slice(1)).toEqual(["coaching", "coaching", "coaching", "coaching"]);
    expect(saved?.templateKey).toBe("coaching");
  });

  it("a follow-up the manager mentions is still the Follow-Up Coaching Form", async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const named = await live({
      history: [],
      question: "Create a follow-up coaching form for Test Employee at NE Grand Island",
      saved: null,
      raw: { employee: "Test Employee", formType: "follow-up-coaching", formTurn: true },
    });
    expect(named.templateKey).toBe("follow-up-coaching");
    const earlier = await replay(
      [
        COACH_TURNS[0]!,
        { question: "Her name is Test Employee, I coached her on 10-1 about her phone", raw: { employee: "Test Employee", formType: "follow-up-coaching", formTurn: true } },
      ],
      COACH_REPLIES,
    );
    expect(earlier.saved?.templateKey).toBe("follow-up-coaching");
  });

  // QA round 12 (conv_mvnmetao241awxn); the whole chat runs through
  // answerQuestion in form-choice-stated-live-oct25.test.ts.
  it("the model's Corrective Action Form counts only outside a first coaching conversation", async () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    const raw = { formType: "Corrective Action Form", formTurn: true };
    const question = "I have an employee that is not verifying documents are signed";
    const coaching = await live({
      history: [
        { id: "u0", role: "user", content: "Help me prepare for a coaching conversation." },
        { id: "a0", role: "assistant", content: "Happy to help." },
      ],
      question,
      saved: null,
      raw,
    });
    expect(coaching.decision.state.templateKey).toBeNull();
    const coachedBefore = await live({
      history: [
        { id: "u0", role: "user", content: "I coached her last week about this" },
        { id: "a0", role: "assistant", content: "Happy to help." },
      ],
      question,
      saved: null,
      raw,
    });
    expect(coachedBefore.decision.state.templateKey).toBe("dpoa");
  });

  it("a Policy reference line names no form", () => {
    vi.stubEnv("FORM_CHOICE_STATED_ENABLED", "true");
    expect(
      detectTemplateIntent(`Policy reference: Disciplinary Action, JBA Policy Manual p.14.\n${PERFORMANCE_CONCERN}`),
    ).toEqual({ kind: "explicit", templateKey: "coaching" });
    expect(detectTemplateIntent("Policy reference: Disciplinary Action, JBA Policy Manual p.14.")).toEqual({ kind: "none" });
    expect(detectTemplateIntent("disciplinary action form for Test Employee")).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  describe("off, the production behaviour of 24 Oct", () => {
    it("conv_mvmw1ccu2t7y3bi turned every coaching request into a Corrective Action", async () => {
      const { keys } = await replay(PERFORMANCE_TURNS, PERFORMANCE_REPLIES);
      expect(keys).toEqual(["dpoa", "dpoa", "dpoa", "dpoa", "dpoa"]);
    });

    it("conv_mvmvl6jy23nwuuk turned both coaching requests into a Corrective Action", async () => {
      const { keys } = await replay(CLOSING_TURNS, [CLOSING_REPLY]);
      expect(keys).toEqual(["dpoa", "dpoa"]);
    });

    it('conv_mvmyba3d2ojmzuf turned "Create a Policy Review" into a Corrective Action', async () => {
      const { keys } = await replay(POLICY_REVIEW_TURNS, [CELL_PHONE_REPLY]);
      expect(keys[1]).toBe("dpoa");
    });

    it("conv_mvnbbhdq2a8t7nk showed the Follow-Up Coaching card with no earlier coaching mentioned", async () => {
      const { keys } = await replay(COACH_TURNS, COACH_REPLIES);
      expect(keys.slice(1)).toEqual(["follow-up-coaching", "follow-up-coaching", "follow-up-coaching", "follow-up-coaching"]);
    });

    it("conv_mvmyqvkq2zwzrln cited page 14, Disciplinary Action", async () => {
      const out = await live({ history: [], question: WOVEN_DEADLINE, saved: null, raw: WOVEN_RAW });
      expect(out.sources?.citations.map((citation) => citation.locator)).toEqual(["Page 14"]);
    });
  });
});
