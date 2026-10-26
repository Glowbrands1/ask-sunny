import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";
import type { ChatFormProposal } from "@/types";

import { appSentencesOnePerLine, isAppLine, withoutAppLines } from "./app-sentences";
import { enrichFormCard } from "./form-card-slots";
import { EMPTY_FORM_STATE } from "./form-state";
import { decideIntentTurn, type IntentTurnInput } from "./intent-slots";
import { holdFilledSlots } from "./keep-filled-slots";
import type { AskResponse } from "./types";

/**
 * Live Ask Sunny chats, 24 Oct 2026 (replays of the 28-29 Sep manager chats
 * conv_mulf7u2j2jpu66p and conv_mumxp13p2s15e4x, plus conv_mvmsz82120ndhi5,
 * conv_mvmt1v0u2u32xsf and conv_mvmt0j332vxbulf). The manager turns are
 * copied exactly. The app put its own lines on the question —
 * "Job title: CA. It happened at KS Lawrence." — and two readers took them
 * as the manager's words:
 *
 *   Job title            "CA. It happened", "tan consultant. It happened",
 *                        "test. It happened"
 *   Observation of       "It happened at NE Grand Island. She works at NE
 *   Offense              Grand Island" — not what the manager wrote, and not
 *                        an offense.
 *
 * MANAGER_WORDS_ONLY_ENABLED reads only the manager's words for both.
 */

const FLAG = "MANAGER_WORDS_ONLY_ENABLED";
const TODAY = "2026-10-24";

const SALONS = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));
const TEMPLATES = [
  { key: "dpoa", name: "Corrective Action Form" },
  { key: "coaching", name: "Coaching Form" },
] as const;
const HEADINGS = ["Attendance", "Late Opening", "Handling Theft", "Cell Phone/Smart Watch Policy"];
const PAGES: Record<string, number> = {
  Attendance: 14,
  "Late Opening": 15,
  "Handling Theft": 30,
  "Cell Phone/Smart Watch Policy": 19,
};

function turn(overrides: Partial<IntentTurnInput>): IntentTurnInput {
  return {
    question: "",
    history: [],
    today: TODAY,
    saved: null,
    raw: null,
    people: [],
    salons: SALONS,
    headings: HEADINGS,
    headingPages: PAGES,
    templates: TEMPLATES,
    formInProgress: false,
    ...overrides,
  };
}

function proposal(partial: Partial<ChatFormProposal> & Pick<ChatFormProposal, "templateKey" | "templateName">): ChatFormProposal {
  return {
    proposalId: "prop-1",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName: null,
    employeeRole: null,
    formDate: null,
    locationId: null,
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds: [],
    ...partial,
  };
}

function answer(content: string, formProposal: ChatFormProposal): AskResponse {
  return { content, citations: [], recommendedVideoIds: [], formProposal };
}

const LEAD = "I'll draft a **Corrective Action Form** from what you've described.";

function jobTitleLine(content: string): string | null {
  return /\*\*Job title:\*\*\s*([^\n]+)/.exec(content)?.[1]?.trim() ?? null;
}

function observation(content: string): string | null {
  return /\*\*Observation of Offense:\*\*\s*([^\n]+)/.exec(content)?.[1]?.trim() ?? null;
}

beforeEach(() => {
  vi.stubEnv("INTENT_EXTRACTION_ENABLED", "1");
  vi.stubEnv(FLAG, "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the app's own lines are not the manager's words (24 Oct 2026)", () => {
  it("CA for Test Employee at KS Lawrence, register short $40 on 10-20, payroll deduct $40 applies", () => {
    const question = "CA for Test Employee at KS Lawrence, register short $40 on 10-20, payroll deduct $40 applies";
    // The model's tool reading, as chat_traces.slots stored it: title "CA".
    const reading = {
      employee: "Test Employee",
      title: "CA",
      salon: "KS Lawrence",
      formType: "CA",
      formTurn: true,
      policyHeading: "Handling Theft",
      payrollAmount: "40",
    };
    // "CA" is the form the manager asked for, not her job title.
    const decision = decideIntentTurn(turn({ question, raw: reading }));
    expect(decision.state.title).toBeNull();
    expect(decision.question).not.toContain("Job title:");

    // The question exactly as production sent it (chat_traces.original_query),
    // with the title the earlier reading had saved.
    const sent =
      "The form is the Corrective Action Form.\nThe employee is Test Employee. Job title: CA. It happened at KS Lawrence. Payroll deduct applies. Policy reference: Handling Theft, JBA Policy Manual p.30. Payroll amount: 40.\n" +
      question;
    const card = enrichFormCard({
      response: answer(LEAD, proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        employeeName: "Test Employee",
        locationId: "loc-0468",
      })),
      question: sent,
      said: question,
      today: TODAY,
      people: [],
      saved: { ...EMPTY_FORM_STATE, employeeName: "Test Employee", title: "CA", salonId: "loc-0468", templateKey: "dpoa" },
    });
    // Production stored formProposal.employeeRole "CA. It happened".
    expect(card.formProposal?.employeeRole ?? "").not.toMatch(/It happened/i);
    expect(jobTitleLine(card.content) ?? "").not.toMatch(/It happened/i);
  });

  it("create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26", () => {
    const question = "create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26";
    const decision = decideIntentTurn(
      turn({
        question,
        raw: {
          employee: "ima employee",
          title: "tan consultant",
          salon: "manhattan",
          incidentDate: "9-28-26",
          formType: "CA",
          formTurn: true,
          policyHeading: "Late Opening",
        },
      }),
    );
    expect(decision.question).toContain("Job title: tan consultant. It happened at KS Manhattan.");

    const card = enrichFormCard({
      response: answer(LEAD, proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        employeeName: "ima employee",
        locationId: "loc-0462",
      })),
      question: decision.question,
      said: question,
      today: TODAY,
      people: [],
      saved: decision.state,
    });
    // The title the manager typed, and nothing the app wrote after it.
    expect(card.formProposal?.employeeRole).toBe("tan consultant");
    expect(jobTitleLine(card.content)).toBe("tan consultant");

    const held = holdFilledSlots({
      response: card,
      question: decision.question,
      history: [],
      today: TODAY,
      people: [],
    });
    expect(held.formProposal?.employeeRole).toBe("tan consultant");
    // What happened is the manager's sentence. "Job title: tan consultant.",
    // "It happened at KS Manhattan.", "Policy reference: …" and "Incident: …"
    // are the app's.
    // Changed on purpose (QA decision, 25 Oct 2026): with MANAGER_WORDS_ONLY
    // on, What happened drops the clauses that only request the form, name
    // the employee or give their place ("create a CA form for ima employee",
    // "tan consultant at manhattan"); the rest stays word for word. Was the
    // whole question, which REMAP_INCIDENT_FIX_ENABLED did not print.
    expect(observation(held.content)).toBe("opening salon late on 9-28-26");
  });

  it("name is test testy, todays date, shawnee location, test was late opening salon", () => {
    const first = "Create a coaching form for a performance concern.";
    const question = "name is test testy, todays date, shawnee location, test was late opening salon";
    const history = [
      { role: "user", content: first },
      { role: "assistant", content: "Great, I can help you create a **Corrective Action Form**." },
    ];
    // The model read "test" (the employee's first name) as the job title.
    const decision = decideIntentTurn(
      turn({
        question,
        history,
        saved: { ...EMPTY_FORM_STATE, templateKey: "dpoa", policyHeading: "Late Opening", policyPage: 15 },
        raw: {
          employee: "test testy",
          title: "test",
          incidentType: "Late Opening",
          warningLevel: "written",
          formTurn: true,
          policyHeading: "Late Opening",
        },
      }),
    );
    expect(decision.state.title).toBeNull();

    // chat_traces.original_query for that turn.
    const sent =
      "The form is the Corrective Action Form.\nThe employee is test testy. Job title: test. It happened on 10/24/2026. Warning level: written. Policy reference: Late Opening, JBA Policy Manual p.15. Incident: Late Opening.\n" +
      question;
    const card = enrichFormCard({
      response: answer(LEAD, proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        employeeName: "test testy",
        locationId: "loc-0463",
      })),
      question: sent,
      said: `${first}\n${question}`,
      today: TODAY,
      people: [],
      saved: { ...EMPTY_FORM_STATE, employeeName: "test testy", title: "test", formDate: TODAY, templateKey: "dpoa" },
    });
    // Production stored "test. It happened".
    expect(card.formProposal?.employeeRole ?? "").not.toMatch(/\.\s|It happened|Warning level/i);
    expect(jobTitleLine(card.content) ?? "").not.toMatch(/\.\s|It happened|Warning level/i);
  });

  it("She works at NE Grand Island — no Observation of Offense the manager did not write", () => {
    const history = [
      { role: "user", content: "I need to coach an employee" },
      { role: "assistant", content: "Happy to help. Give me a few details." },
      { role: "user", content: "Her name is Test Employee" },
      { role: "assistant", content: "Here is what I would put on a **Coaching Form**." },
    ];
    const coaching = proposal({
      templateKey: "coaching",
      templateName: "Coaching Form",
      employeeName: "Test Employee",
      locationId: "loc-0307",
    });
    const lead = "Here is what I would put on a **Coaching Form**.";

    // The question exactly as production sent it (chat_traces.original_query).
    const salonTurn = holdFilledSlots({
      response: answer(lead, coaching),
      question: "The form is the Coaching Form.\nThe employee is Test Employee. It happened at NE Grand Island.\nShe works at NE Grand Island",
      history,
      today: TODAY,
      people: [],
    });
    expect(salonTurn.content).not.toMatch(/It happened at NE Grand Island/);
    expect(observation(salonTurn.content)).toBeNull();

    const later = [
      ...history,
      { role: "user", content: "She works at NE Grand Island" },
      { role: "assistant", content: lead },
      { role: "user", content: "It happened on 10-21" },
      { role: "assistant", content: lead },
      { role: "user", content: "She was on her cell phone for 30+ minutes at the front desk" },
      { role: "assistant", content: lead },
    ];
    const created = holdFilledSlots({
      response: answer(lead, coaching),
      question:
        "The employee is Test Employee. It happened at NE Grand Island. Policy reference: Cell Phone/Smart Watch Policy, JBA Policy Manual p.19.\nCreate a Coaching Form",
      history: later,
      today: TODAY,
      people: [],
    });
    expect(observation(created.content)).toBe("She was on her cell phone for 30+ minutes at the front desk");

    // Naming the salon in the account of what happened keeps the account.
    const late = holdFilledSlots({
      response: answer(lead, coaching),
      question: "She opened the salon late at NE Grand Island",
      history,
      today: TODAY,
      people: [],
    });
    // Changed on purpose (QA decision, 25 Oct 2026, QA's own example): the
    // place is not what happened, so "at NE Grand Island" goes and the rest
    // stays word for word. Was the whole sentence, place included, which
    // REMAP_INCIDENT_FIX_ENABLED did not print.
    expect(observation(late.content)).toBe("She opened the salon late");
  });

  it("INCIDENT_CLAUSE_SPLIT_ENABLED on: the card's own lines and where she works are no Observation", () => {
    vi.stubEnv(FLAG, "");
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", "");
    vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "true");
    const on = holdFilledSlots({
      response: answer("Here is what I would put on a **Coaching Form**.", proposal({
        templateKey: "coaching",
        templateName: "Coaching Form",
        employeeName: "Test Employee",
        locationId: "loc-0307",
      })),
      question: "The form is the Coaching Form.\nThe employee is Test Employee. It happened at NE Grand Island.\nShe works at NE Grand Island",
      history: [{ role: "user", content: "Her name is Test Employee" }],
      today: TODAY,
      people: [],
    });
    // Changed on purpose with the flag on (QA, 26 Oct 2026): "It happened at …" is the
    // intent read's own sentence and "She works at …" an employee fact; neither is the account.
    expect(observation(on.content)).toBeNull();
  });

  it("off, the card reads the question as main does", () => {
    vi.stubEnv(FLAG, "");
    // Main's production card: the remap fix is off there too. The bundle runs
    // this file with every flag on, and that flag reads What happened itself.
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", "");
    // So do INCIDENT_CLAUSE_SPLIT_ENABLED and INCIDENT_COMMAND_WORDS_ENABLED (their twins are below).
    vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "");
    vi.stubEnv("INCIDENT_COMMAND_WORDS_ENABLED", "");
    const off = holdFilledSlots({
      response: answer("Here is what I would put on a **Coaching Form**.", proposal({
        templateKey: "coaching",
        templateName: "Coaching Form",
        employeeName: "Test Employee",
        locationId: "loc-0307",
      })),
      question: "The form is the Coaching Form.\nThe employee is Test Employee. It happened at NE Grand Island.\nShe works at NE Grand Island",
      history: [{ role: "user", content: "Her name is Test Employee" }],
      today: TODAY,
      people: [],
    });
    // The 24 Oct production card, unchanged with the flag off.
    expect(observation(off.content)).toBe("It happened at NE Grand Island. She works at NE Grand Island");
    const reading = decideIntentTurn(
      turn({
        question: "CA for Test Employee at KS Lawrence, register short $40 on 10-20, payroll deduct $40 applies",
        raw: { employee: "Test Employee", title: "CA", salon: "KS Lawrence", formType: "CA", formTurn: true },
      }),
    );
    expect(reading.state.title).toBe("CA");
  });
});

/*
 * QA decision, 25 Oct 2026: "With MANAGER_WORDS_ONLY on, drop only the
 * clauses that just request the form, name the employee or give their place
 * (salon/store, job title at a place). Keep everything else word for word.
 * Example: 'She opened the salon late at NE Grand Island' → 'She opened the
 * salon late'." The same card with REMAP_INCIDENT_FIX_ENABLED off and on: the
 * two readers that write What happened (keep-filled-slots' withObservation
 * and withAccount) agree. Ask Bubbles applies the same rule on its remap path.
 */
describe("QA 25 Oct 2026: What happened without the request, the name or the place", () => {
  const lead = "Here is what I would put on a **Coaching Form**.";
  const history = [
    { role: "user", content: "I need to coach an employee" },
    { role: "assistant", content: "Happy to help. Give me a few details." },
  ];

  function held(question: string, employeeName: string) {
    return holdFilledSlots({
      response: answer(lead, proposal({ templateKey: "coaching", templateName: "Coaching Form", employeeName, locationId: "loc-0307" })),
      question,
      history,
      today: TODAY,
      people: [],
    });
  }

  for (const remapFix of ["", "1"]) {
    const label = remapFix ? "with REMAP_INCIDENT_FIX_ENABLED on" : "with REMAP_INCIDENT_FIX_ENABLED off";

    it(`She opened the salon late at NE Grand Island → She opened the salon late (${label})`, () => {
      vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", remapFix);
      expect(observation(held("She opened the salon late at NE Grand Island", "Test Employee").content)).toBe(
        "She opened the salon late",
      );
    });

    it(`create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26 (${label})`, () => {
      vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", remapFix);
      expect(
        observation(
          held("create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26", "ima employee").content,
        ),
      ).toBe("opening salon late on 9-28-26");
    });

    it(`a sentence that says only where she works is still no account (${label})`, () => {
      vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", remapFix);
      expect(observation(held("She works at NE Grand Island", "Test Employee").content)).toBeNull();
      // A place that is not a salon is part of what happened.
      expect(observation(held("She was on her cell phone for 30+ minutes at the front desk", "Test Employee").content)).toBe(
        "She was on her cell phone for 30+ minutes at the front desk",
      );
    });
  }

  it("flag off, the sentence is printed as main prints it", () => {
    vi.stubEnv(FLAG, "");
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", "");
    // INCIDENT_CLAUSE_SPLIT_ENABLED and INCIDENT_COMMAND_WORDS_ENABLED off too (their twin is below).
    vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "");
    vi.stubEnv("INCIDENT_COMMAND_WORDS_ENABLED", "");
    expect(observation(held("She opened the salon late at NE Grand Island", "Test Employee").content)).toBe(
      "She opened the salon late at NE Grand Island",
    );
  });

  it("INCIDENT_CLAUSE_SPLIT_ENABLED on: the salon goes from the sentence", () => {
    vi.stubEnv(FLAG, "");
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", "");
    vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "true");
    // Changed on purpose with the flag on (QA, 26 Oct 2026): a short act is the account
    // in the manager's words without the place, as MANAGER_WORDS_ONLY reads it.
    expect(observation(held("She opened the salon late at NE Grand Island", "Test Employee").content)).toBe("She opened the salon late");
  });
});

describe("the job title is a title the manager stated (24 Oct 2026, round 4)", () => {
  const CA_LEAD = "I'll draft a **Corrective Action Form** from what you've described.";

  it("name is test testy, todays date, shawnee location, test was late opening salon (conv_mvmw1ccu2t7y3bi)", () => {
    const first = "Create a coaching form for a performance concern.";
    const question = "name is test testy, todays date, shawnee location, test was late opening salon";
    // chat_traces.slots.title for this turn: the model copied a clause.
    const decision = decideIntentTurn(
      turn({
        question,
        history: [
          { role: "user", content: first },
          { role: "assistant", content: "Great, I can help you create a **Corrective Action Form**." },
        ],
        saved: { ...EMPTY_FORM_STATE, templateKey: "dpoa", policyHeading: "Late Opening", policyPage: 15 },
        raw: { employee: "test testy", title: "test was late opening salon", formTurn: true, policyHeading: "Late Opening" },
      }),
    );
    expect(decision.state.title).toBeNull();
    const card = enrichFormCard({
      response: answer(CA_LEAD, proposal({ templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "test testy", locationId: "loc-0463" })),
      question: decision.question,
      said: `${first}\n${question}`,
      today: TODAY,
      people: [],
      saved: decision.state,
    });
    // Production printed "test was late opening".
    expect(card.formProposal?.employeeRole ?? null).toBeNull();
    expect(jobTitleLine(card.content)).toBeNull();
  });

  it("create coaching form. test testy is ass't salon director. test did not call anyone about opening late", () => {
    const question = "create coaching form. test testy is ass't salon director. test did not call anyone about opening late";
    const history = [
      { role: "user", content: "Create a coaching form for a performance concern." },
      { role: "assistant", content: "Great, I can help you create a **Corrective Action Form**." },
      { role: "user", content: "name is test testy, todays date, shawnee location, test was late opening salon" },
      { role: "assistant", content: CA_LEAD },
    ];
    const decision = decideIntentTurn(
      turn({
        question,
        history,
        saved: { ...EMPTY_FORM_STATE, employeeName: "test testy", templateKey: "dpoa", formDate: TODAY },
        raw: { employee: "test testy", title: "ass't salon director", formTurn: true },
      }),
    );
    // Production stored "Salon Director". ASD is how this form prints an
    // assistant salon director (JOB_TITLES).
    expect(decision.state.title).toBe("ASD");
    const card = enrichFormCard({
      response: answer(CA_LEAD, proposal({ templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "test testy", locationId: "loc-0463" })),
      question: decision.question,
      said: [...history.filter((item) => item.role === "user").map((item) => item.content), question].join("\n"),
      today: TODAY,
      people: [],
      saved: decision.state,
    });
    const held = holdFilledSlots({ response: card, question: decision.question, history, today: TODAY, people: [] });
    expect(card.formProposal?.employeeRole).toBe("ASD");
    expect(held.formProposal?.employeeRole).toBe("ASD");
  });

  it("Please make me a coaching form for test employee at the lincoln pine lake location … (conv_mvmvl6jy23nwuuk, \"HR. It happened\")", () => {
    const question =
      "Please make me a coaching form for test employee at the lincoln pine lake location Test did not complete closing duties. Trash was not taken out of the bathrooms, there was no\ntoilet paper in the women's bathroom, and there were no spray towels in the rooms also all the cleaning duties were signed off in the binder and not alll were completed and the way she signed off on the checklist was incorrect she signed one box with a arrown throught the rest each box needs an initial";
    // The model read "HR"; the manager never wrote it ("throught" holds the letters).
    const decision = decideIntentTurn(
      turn({ question, raw: { employee: "test employee", title: "HR", salon: "lincoln pine lake", formTurn: true } }),
    );
    expect(decision.state.title).toBeNull();

    // chat_traces.original_query as production sent it.
    const sent =
      "The employee is test employee. Job title: HR. It happened at NE Lincoln Pine Lake. Policy reference: Disciplinary Action, JBA Policy Manual p.14.\n" +
      question;
    const card = enrichFormCard({
      response: answer(CA_LEAD, proposal({ templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "test employee", locationId: "loc-0312" })),
      question: sent,
      said: question,
      today: TODAY,
      people: [],
      saved: { ...EMPTY_FORM_STATE, employeeName: "test employee", title: "HR", salonId: "loc-0312", templateKey: "dpoa" },
    });
    // Production stored "HR. It happened".
    expect(card.formProposal?.employeeRole ?? "").not.toMatch(/It happened/i);
  });

  it("a pasted Late Opening policy does not make ima employee a District Manager (conv_mumxp13p2s15e4x)", () => {
    const paste =
      "When an employee assigned to open a location is unable to open the location at the proper\ntime, the employee must notify the manager as soon as possible. The manager of the salon will\nbe required to open the salon and work until the person originally assigned arrives, or a\nreplacement is found. The employee who failed to open will then be required to reimburse The\nCompany $25.00 via payroll deduction (when applicable and following all state and local\nguidelines), for all expenses incurred. Managers or District Managers will be responsible for\noffering restitution to affected clients, as well as giving the payroll deduct total to Payroll. *";
    const history = [
      { role: "user", content: "create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26" },
      { role: "assistant", content: CA_LEAD },
      { role: "user", content: "this should be a written and note a verbal ca was given on 9-1-26" },
      { role: "assistant", content: CA_LEAD },
    ];
    const saved = {
      ...EMPTY_FORM_STATE,
      employeeName: "ima employee",
      title: "tan consultant",
      salonId: "loc-0462",
      formDate: "2026-09-28",
      warningLevel: "written" as const,
      templateKey: "dpoa",
    };
    const decision = decideIntentTurn(turn({ question: paste, history, saved, raw: { formTurn: true } }));
    // Production stored "District Manager".
    expect(decision.state.title).toBe("tan consultant");
    const card = enrichFormCard({
      response: answer(CA_LEAD, proposal({ templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "ima employee", locationId: "loc-0462" })),
      question: decision.question,
      said: [...history.filter((item) => item.role === "user").map((item) => item.content), paste].join("\n"),
      today: TODAY,
      people: [],
      saved: decision.state,
    });
    const held = holdFilledSlots({ response: card, question: decision.question, history, today: TODAY, people: [] });
    expect(card.formProposal?.employeeRole).toBe("tan consultant");
    expect(held.formProposal?.employeeRole).toBe("tan consultant");
  });
});

describe("app-sentences", () => {
  it("knows a line the app wrote from a line the manager wrote", () => {
    expect(
      isAppLine(
        "The employee is ima employee. Job title: tan consultant. It happened at KS Manhattan. It happened on 9/28/2026. Warning level: written. Payroll deduct applies. Policy reference: Late Opening, JBA Policy Manual p.15. Incident: Late Opening. Payroll amount: 25.00.",
      ),
    ).toBe(true);
    expect(isAppLine("It happened on 10-21")).toBe(false);
    expect(isAppLine("She works at NE Grand Island")).toBe(false);
    expect(isAppLine("Job title: TC. She was late to open")).toBe(false);
  });

  it("drops the app's lines and splits them for a line reader", () => {
    const text = "The employee is Test Employee. Job title: CA. It happened at KS Lawrence.\nCA for Test Employee at KS Lawrence";
    expect(withoutAppLines(text)).toBe("CA for Test Employee at KS Lawrence");
    expect(appSentencesOnePerLine(text).split("\n")).toEqual([
      "The employee is Test Employee.",
      "Job title: CA.",
      "It happened at KS Lawrence.",
      "CA for Test Employee at KS Lawrence",
    ]);
  });
});
