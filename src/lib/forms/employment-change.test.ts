import { describe, expect, it } from "vitest";

import { groupTemplatesByCategory } from "./catalog";
import {
  checkboxGroupsForVariant,
  fieldsForVariant,
  parseFormDocument,
} from "./document";
import {
  DEMOTION_ACKNOWLEDGEMENT,
  EMPLOYMENT_CHANGE_TEMPLATE_SEEDS,
  STATED_FACT_KEYS,
  TRANSFER_ACKNOWLEDGEMENT,
  demotionDocument,
  exitFormSourceSupplied,
  positionTransferDocument,
  resignationExitDocument,
  resignationExitSeed,
} from "./employment-change-library";
import {
  correctionValues,
  describeKnownFacts,
  formDateFor,
  missingDetails,
  readEmploymentChange,
  selectStatedFacts,
  statedFactValues,
} from "./employment-change";
import { extractFormDate } from "./form-date-answer";
import { TEMPLATE_SEEDS } from "./library";
import { extractEmployeeNames } from "./proposal";
import { detectTemplateIntent, formRequestPhrase } from "./template-intent";
import { resolveSalonText } from "./salon-text";

/*
 * Invented names throughout, in the shapes managers actually type them.
 */
const TODAY = "2026-09-28";
const read = (text: string) => readEmploymentChange([text], TODAY);

/* ============================================================ the library == */

describe("the employment change forms in the library", () => {
  it("adds one Demotion Form and one Position Transfer Form — the example is not a template", () => {
    const keys = TEMPLATE_SEEDS.map((seed) => seed.key);
    expect(keys.filter((key) => key === "demotion")).toHaveLength(1);
    expect(keys).toContain("position-transfer");
    expect(TEMPLATE_SEEDS.filter((seed) => /demotion/i.test(seed.name))).toHaveLength(1);
    expect(keys.some((key) => /example/i.test(key))).toBe(false);
  });

  it("holds the Resignation/Exit Form back until its source wording is supplied", () => {
    expect(exitFormSourceSupplied()).toBe(false);
    expect(TEMPLATE_SEEDS.some((seed) => seed.key === "resignation-exit")).toBe(false);
    // Refuses to build an exit form with an invented acknowledgement.
    expect(() => resignationExitDocument()).toThrow(/acknowledgement/);
  });

  it("lists them under their own heading in the Forms picker, between HR and Hiring", () => {
    const grouped = groupTemplatesByCategory(TEMPLATE_SEEDS);
    const section = grouped.find((group) => group.key === "employment_changes");
    expect(section?.label).toBe("Employment Change Forms");
    expect(section?.templates.map((seed) => seed.name)).toEqual([
      "Demotion Form",
      "Position Transfer Form",
    ]);
  });

  it("gates them on their own permission and a layout that is not a ladder rung", () => {
    for (const seed of EMPLOYMENT_CHANGE_TEMPLATE_SEEDS) {
      expect(seed.requiredPermission, seed.key).toBe("create_employment_change_form");
      expect(seed.layoutFamily, seed.key).toBe("coaching");
    }
  });

  it("parses, and carries every field of the source forms", () => {
    const demotion = parseFormDocument(demotionDocument());
    expect(fieldsForVariant(demotion, null).map((field) => field.key)).toEqual([
      "employee_name",
      "form_date",
      "job_title",
      "location",
      "current_pay_rate",
      "new_job_title",
      "new_location",
      "new_pay_rate",
      "reason",
    ]);
    expect(checkboxGroupsForVariant(demotion, null).map((group) => group.key)).toEqual([
      "current_status",
      "new_status",
      "demotion_type",
    ]);

    const transfer = parseFormDocument(positionTransferDocument());
    expect(checkboxGroupsForVariant(transfer, null).map((group) => group.key)).toEqual([
      "current_status",
      "new_status",
      "transfer_type",
    ]);
    // New Employment Status prints PT / FT on this document.
    expect(
      checkboxGroupsForVariant(transfer, null)
        .find((group) => group.key === "new_status")
        ?.options.map((option) => option.label),
    ).toEqual(["PT", "FT"]);
  });

  it("keeps the acknowledgements verbatim and the signature lines, including the witness", () => {
    const blocks = demotionDocument().blocks;
    expect(blocks).toContainEqual({ kind: "acknowledgement", text: DEMOTION_ACKNOWLEDGEMENT });
    expect(DEMOTION_ACKNOWLEDGEMENT).toMatch(/^By signing this form, I confirm/);
    expect(
      blocks.filter((block) => block.kind === "signature_row").map((block) => block.label),
    ).toEqual(["Employee Signature", "Supervisor Signature", "Witness Signature"]);

    const transfer = positionTransferDocument().blocks;
    for (const text of TRANSFER_ACKNOWLEDGEMENT) {
      expect(transfer).toContainEqual({ kind: "acknowledgement", text });
    }
    expect(transfer.filter((block) => block.kind === "signature_row")).toHaveLength(3);
  });

  it("never lets the model write a fact — only the reason is drafted", () => {
    for (const document of [demotionDocument(), positionTransferDocument()]) {
      const parsed = parseFormDocument(document);
      const drafted = [
        ...fieldsForVariant(parsed, null).filter((field) => field.responsibility === "ai"),
        ...checkboxGroupsForVariant(parsed, null).filter((group) => group.responsibility === "ai"),
      ].map((entry) => entry.key);
      expect(drafted).toEqual(["reason"]);
    }
  });

  it("names each published form so the picker's card resolves back to it", () => {
    for (const seed of EMPLOYMENT_CHANGE_TEMPLATE_SEEDS) {
      expect(detectTemplateIntent(formRequestPhrase(seed.name))).toEqual({
        kind: "explicit",
        templateKey: seed.key,
      });
    }
  });
});

/* ================================================================ intent == */

describe("asking for one in chat", () => {
  it.each([
    ["Create a demotion form for paulyne co", "demotion"],
    ["create a demotion form", "demotion"],
    ["demote paulyne from manager to tanning consultant effective october 5", "demotion"],
    ["I need to do a demotion for paulyne", "demotion"],
    ["she's stepping down to TC effective 10/5", "demotion"],
    ["pull up a transfer form for Jane Doe", "position-transfer"],
    ["make a transfer form", "position-transfer"],
    ["Jane is transferring from salon 12 to salon 18", "position-transfer"],
    ["can you pull up a transfer for jane?", "position-transfer"],
    ["I need an exit form for JOHN SMITH", "resignation-exit"],
    ["make a resignation form for maria", "resignation-exit"],
    ["pull up the exit form", "resignation-exit"],
    ["create an exit form for mike, last day was 9/25", "resignation-exit"],
    ["mike quit, last day was 9/25", "resignation-exit"],
    ["I need a termination form", "resignation-exit"],
  ])("%s", (question, key) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: key });
  });

  it.each([
    "what is our transfer policy?",
    "What happens to PTO when someone goes from FT to PT?",
    "do I need to do anything when someone resigns?",
    "how do I handle a no call no show?",
    "My best TC quit. Ugh.",
  ])("leaves a question or a remark alone: %s", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "none" });
  });

  it("does not take over the corrective-action branch or the existing forms", () => {
    expect(detectTemplateIntent("create a corrective action for sarah, we are demoting her").kind).toBe(
      "corrective_action",
    );
    expect(detectTemplateIntent("Create a Coaching Form for Sarah")).toEqual({
      kind: "explicit",
      templateKey: "coaching",
    });
  });
});

/* ================================================================= names == */

describe("the employee's name, in any case", () => {
  it.each([
    ["Create a demotion form for paulyne co", "paulyne co"],
    ["Create a demotion form for PAULYNE CO", "PAULYNE CO"],
    ["Create a demotion form for Paulyne Co", "Paulyne Co"],
    ["I need an exit form for JOHN SMITH", "JOHN SMITH"],
    ["make a resignation form for maria", "maria"],
    ["pull up a transfer form for Jane Doe", "Jane Doe"],
    ["Position Transfer Form for Jane Doe", "Jane Doe"],
    ["Jane is transferring from salon 12 to salon 18", "Jane"],
    ["jane's transferring to lawrence", "jane"],
    ["demote paulyne from manager to tanning consultant effective october 5", "paulyne"],
    ["transfer jane from FT to PT, involuntary", "jane"],
    ["create an exit form for mike, last day was 9/25", "mike"],
    ["mike quit, last day was 9/25", "mike"],
  ])("%s", (text, name) => {
    expect(extractEmployeeNames(text)).toEqual([name]);
  });

  it.each(["she quit yesterday", "Our SD is leaving", "I think jane is leaving", "transfer her to salon 18", "make a transfer form"])(
    "reads nobody from %s",
    (text) => {
      expect(extractEmployeeNames(text)).toEqual([]);
    },
  );
});

/* ================================================================= dates == */

describe("dates, in the formats managers type", () => {
  it.each([
    ["10/5/26", "2026-10-05"],
    ["oct 5", "2026-10-05"],
    ["October 5", "2026-10-05"],
    ["October 5, 2026", "2026-10-05"],
    ["10-05-2026", "2026-10-05"],
    ["10-5-26", "2026-10-05"],
  ])("effective %s", (date, iso) => {
    expect(read(`demote jane to TC effective ${date}`).effectiveDate).toBe(iso);
  });

  it("does not read a range as a dashed date", () => {
    expect(extractFormDate("she worked 10-12 hours", TODAY)).toBeNull();
  });

  it("keeps the effective date, the last day and notice dates off the form's own date", () => {
    expect(formDateFor("demote jane to TC effective 10/5", TODAY)).toBeNull();
    expect(formDateFor("mike quit, last day was 9/25", TODAY)).toBeNull();
    expect(formDateFor("gave notice on 9/11 and worked his notice through 9/25", TODAY)).toBeNull();
    expect(formDateFor("date this 9/27, effective 10/5", TODAY)).toBe("2026-09-27");
  });
});

/* ======================================================= the change facts == */

describe("the facts of the change", () => {
  it("reads direction from 'from ... to'", () => {
    const facts = read("demote paulyne from manager to tanning consultant effective october 5");
    expect(facts.current.title).toBe("Manager");
    expect(facts.next.title).toBe("Tanning Consultant");
    expect(facts.effectiveDate).toBe("2026-10-05");
  });

  it("reads a whole sentence of details, in any casing", () => {
    const facts = read(
      "Create a demotion form for paulyne co. She's a full time SD at $18/hr at KS Lawrence and asked to step down to a part time TC at $12.50/hr starting 10-05-2026",
    );
    expect(facts.current).toEqual({
      title: "Salon Director",
      status: "full_time",
      rate: "$18.00/hr",
      location: "KS Lawrence",
    });
    expect(facts.next).toEqual({ title: "Tanning Consultant", status: "part_time", rate: "$12.50/hr" });
    expect(facts.changeType).toBe("voluntary");
    expect(facts.effectiveDate).toBe("2026-10-05");
  });

  it("reads the intake's own example, arrow and all", () => {
    const facts = read(
      "Jane Doe, Salon Director FT at $18/hr → Tanning Consultant PT at $12/hr, effective 10/5, voluntary — she asked to step down.",
    );
    expect(describeKnownFacts("demotion", facts)).toBe(
      "FT Salon Director at $18.00/hr → PT Tanning Consultant at $12.00/hr, effective October 5, 2026, voluntary",
    );
    expect(missingDetails("demotion", facts)).toEqual([]);
  });

  it.each([
    ["FT", "full_time"],
    ["full time", "full_time"],
    ["Full-Time", "full_time"],
    ["PT", "part_time"],
    ["part time", "part_time"],
    ["Part-time", "part_time"],
  ])("reads %s as one status", (token, status) => {
    expect(read(`new status ${token}`).next.status).toBe(status);
  });

  it.each([
    ["salon 12", "Salon 12"],
    ["STC 12", "STC 12"],
    ["sun tan city 12", "Sun Tan City 12"],
    ["lawrence", "KS Lawrence"],
    ["ks lawrence", "KS Lawrence"],
    ["#468", "KS Lawrence"],
    ["salon 0468", "KS Lawrence"],
  ])("reads the salon %s", (typed, printed) => {
    expect(resolveSalonText(typed)).toBe(printed);
  });

  it("reads salons on both sides of a transfer", () => {
    const facts = read("Jane is transferring from salon 12 to salon 18");
    expect(facts.current.location).toBe("Salon 12");
    expect(facts.next.location).toBe("Salon 18");
  });

  it("never assigns an undirected status, rate or type", () => {
    const facts = read("Create a demotion form for jane. She makes $15/hr and it's been rough.");
    expect(facts.current.rate).toBeUndefined();
    expect(facts.next.rate).toBeUndefined();
    expect(facts.changeType).toBeUndefined();
  });

  it("reads voluntary and involuntary only from explicit words, and cancels a conflict", () => {
    expect(read("it's an involuntary demotion").changeType).toBe("involuntary");
    expect(read("voluntary").changeType).toBe("voluntary");
    expect(read("she requested a demotion").changeType).toBe("voluntary");
    expect(read("we are demoting her to TC").changeType).toBeUndefined();
    expect(read("voluntary, no wait, involuntary").changeType).toBeUndefined();
  });

  it("never reads a question as a fact", () => {
    const facts = read("What happens to PTO when someone goes from FT to PT?");
    expect(facts.current).toEqual({});
    expect(facts.next).toEqual({});
  });

  it("lets a later turn correct an earlier one", () => {
    const facts = readEmploymentChange(
      ["Jane is transferring from salon 12 to salon 18", "actually change her new location to salon 24"],
      TODAY,
    );
    expect(facts.next.location).toBe("Salon 24");
    expect(facts.current.location).toBe("Salon 12");
  });

  it("copies 'same title and pay' from what the manager gave, never from nothing", () => {
    const facts = read("Jane Doe is a PT TC at $12/hr, transferring from salon 12 to salon 18, same title and pay, voluntary — she moved closer to home.");
    const { values } = statedFactValues(facts);
    expect(values.new_job_title).toBe("Tanning Consultant");
    expect(values.new_pay_rate).toBe("$12.00/hr");
    expect(missingDetails("transfer", facts).map((item) => item.key)).toEqual(["new_status"]);
  });
});

/* ================================================== clarifying questions == */

describe("what is still asked for", () => {
  it("groups each side's status and pay, and asks for nothing already given", () => {
    const facts = read("demote paulyne from manager to tanning consultant effective october 5");
    expect(missingDetails("demotion", facts).map((item) => item.phrase)).toEqual([
      "current status (FT/PT) and pay rate",
      "new status (FT/PT) and pay rate",
      "whether it's voluntary or involuntary",
    ]);
  });

  it("asks a transfer for the new location, not an effective date", () => {
    const keys = missingDetails("transfer", read("transfer form for jane")).map((item) => item.key);
    expect(keys).toContain("new_location");
    expect(keys).not.toContain("effective_date");
  });

  it("asks one short question when an exit could be either kind", () => {
    const quit = missingDetails("exit", read("mike quit, last day was 9/25"));
    expect(quit.find((item) => item.key === "separation")?.phrase).toBe(
      "whether they worked out their notice or resigned immediately",
    );
    const unknown = missingDetails("exit", read("exit form for mike, last day was 9/25"));
    expect(unknown.find((item) => item.key === "separation")?.phrase).toBe(
      "whether this was a resignation or an involuntary separation",
    );
  });
});

/* ======================================================= the exit reading == */

describe("the exit form's answers", () => {
  it("reads notice, dates and explicit yes/no answers", () => {
    const facts = read(
      "mike quit, gave two weeks notice on 9/11 and worked his notice through 9/25. items returned. not eligible for rehire. no payroll deduction. forfeit bonus: yes",
    );
    expect(facts.noticeGivenDate).toBe("2026-09-11");
    expect(facts.noticeFulfilledDate).toBe("2026-09-25");
    expect(facts.separation).toEqual(["submitted_fulfilled_notice"]);
    expect(facts.answers).toEqual({
      store_items_returned: "yes",
      payroll_deduction: "no",
      forfeit_bonus: "yes",
      eligible_for_rehire: "no",
    });
  });

  it("infers none of the sensitive answers that were not given", () => {
    const facts = read("mike quit, last day was 9/25");
    expect(facts.answers).toEqual({});
    expect(facts.separation).toBeUndefined();
  });

  it("reads a no call no show and unreturned keys", () => {
    const facts = read("she no call no showed three shifts, last day worked 9/20, did not return her keys");
    expect(facts.separation).toEqual(["no_call_no_show"]);
    expect(facts.lastDayWorked).toBe("2026-09-20");
    expect(facts.answers.store_items_returned).toBe("no");
  });
});

/* ==================================================== onto the form ==== */

describe("putting stated facts on the form", () => {
  const document = parseFormDocument(demotionDocument());
  const stated = statedFactValues(
    read("Jane Doe, Salon Director FT at $18/hr → Tanning Consultant PT at $12/hr, effective 10/5, voluntary"),
  );

  it("fills only empty fields, and only the listed ones", () => {
    const selected = selectStatedFacts({
      document,
      variantKey: null,
      stated,
      existing: [
        // The salon the record was filed against, and a value the manager typed.
        { fieldKey: "location", value: "KS Lawrence", checked: [] },
        { fieldKey: "new_pay_rate", value: "$12.25/hr", checked: [] },
      ],
    });
    expect(selected.values).toEqual({
      job_title: "Salon Director",
      current_pay_rate: "$18.00/hr",
      new_job_title: "Tanning Consultant",
    });
    expect(selected.checked).toEqual({
      current_status: ["full_time"],
      new_status: ["part_time"],
      demotion_type: ["voluntary"],
    });
    // The transfer form's group is not on a demotion form and is not written.
    expect(selected.checked.transfer_type).toBeUndefined();
    for (const key of [...Object.keys(selected.values), ...Object.keys(selected.checked)]) {
      expect(STATED_FACT_KEYS.has(key), key).toBe(true);
    }
  });

  it("can never reach a drafted field, a signature or an unknown key", () => {
    const selected = selectStatedFacts({
      document,
      variantKey: null,
      stated: { values: { reason: "invented", employee_name: "Someone Else", nonsense: "x" }, checked: {} },
      existing: [],
    });
    expect(selected).toEqual({ values: {}, checked: {} });
  });
});

describe("a correction typed after the form exists", () => {
  it.each([
    ["change her new location to salon 24", { new_location: "Salon 24" }],
    ["new title is shift lead", { new_job_title: "Shift Lead" }],
    ["change her current title to SD", { job_title: "Salon Director" }],
    ["change the name to Paulyne Camacho", { employee_name: "Paulyne Camacho" }],
    ["change the date to 9/27", { form_date: "2026-09-27" }],
    ["make the new pay $13.25/hr", { new_pay_rate: "$13.25/hr" }],
  ])("%s", (text, values) => {
    expect(correctionValues(text, TODAY)?.values).toEqual(values);
  });

  it("reads a status or type correction as ticks", () => {
    expect(correctionValues("it's involuntary", TODAY)?.checked).toMatchObject({
      demotion_type: ["involuntary"],
    });
  });

  it("is never a question, and is nothing when nothing was stated", () => {
    expect(correctionValues("what is her new location?", TODAY)).toBeNull();
    expect(correctionValues("thanks!", TODAY)).toBeNull();
  });
});

describe("reading stays fast on long or awkward input", () => {
  it.each([
    "from ".repeat(800),
    "to a ".repeat(800),
    `new status ${"FT ".repeat(1000)}`,
    `${"salon 12, ".repeat(400)}`,
    `demote ${"x ".repeat(1500)} to TC`,
    "same title, pay, status, ".repeat(150),
  ])("case %#", (text) => {
    const started = Date.now();
    readEmploymentChange([text.slice(0, 4000)], TODAY);
    correctionValues(text.slice(0, 4000), TODAY);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});


/* ============================================ the Resignation/Exit Form ==== */

/*
 * The source wording is not in this repository yet, so these tests build the
 * form with a visibly placeholder acknowledgement. Everything else — fields,
 * options, permission, parsing, questions — is the real form.
 */
const PLACEHOLDER = {
  acknowledgement: "[TEST PLACEHOLDER — not the STC Exit acknowledgement]",
  terminationSteps: ["[TEST PLACEHOLDER — not the STC Exit steps]"],
};

describe("the Resignation/Exit Form's document", () => {
  const exit = parseFormDocument(resignationExitDocument(PLACEHOLDER));

  it("carries every field of the STC Exit document", () => {
    expect(fieldsForVariant(exit, null).map((field) => [field.key, field.label])).toEqual([
      ["employee_name", "Name"],
      ["form_date", "Date"],
      ["job_title", "Job Title"],
      ["location", "Location"],
      ["permanent_address", "Permanent Address"],
      ["last_day_worked", "Last Day Worked"],
      ["notice_given_date", "Date notice was given"],
      ["notice_fulfilled_date", "Date notice was fulfilled"],
      ["details", "Details"],
    ]);
    const groups = checkboxGroupsForVariant(exit, null);
    expect(groups.find((group) => group.key === "separation_type")?.options.map((option) => option.label)).toEqual([
      "Submitted & Fulfilled Notice",
      "Immediate Voluntary Resignation",
      "Immediate Involuntary Separation",
      "Did not fulfill required 14-day / 30-day notice",
      "No Call No Show",
    ]);
    expect(groups.filter((group) => group.key !== "separation_type").map((group) => group.label)).toEqual([
      "All store items returned",
      "Payroll Deduction applicable",
      "Forfeit bonus",
      "Drop to minimum wage",
      "Written notice attached",
      "Eligible for rehire",
    ]);
  });

  it("has three signature lines and the source's two passages, never invented ones", () => {
    const blocks = resignationExitDocument(PLACEHOLDER).blocks;
    expect(blocks.filter((block) => block.kind === "signature_row").map((block) => block.label)).toEqual([
      "Employee Signature",
      "Supervisor Signature",
      "District Manager/Witness Signature",
    ]);
    expect(blocks).toContainEqual({ kind: "acknowledgement", text: PLACEHOLDER.acknowledgement });
    expect(blocks).toContainEqual({ kind: "section", label: "Steps to Finish Termination" });
    expect(() => resignationExitDocument(null)).toThrow(/acknowledgement/);
  });

  it("lets the model draft Details and nothing else — every HR decision is the manager's", () => {
    const drafted = [
      ...fieldsForVariant(exit, null).filter((field) => field.responsibility === "ai"),
      ...checkboxGroupsForVariant(exit, null).filter((group) => group.responsibility === "ai"),
    ].map((entry) => entry.key);
    expect(drafted).toEqual(["details"]);
    for (const group of checkboxGroupsForVariant(exit, null)) {
      expect(group.responsibility, group.key).toBe("manager");
    }
  });

  it("seeds into the employment change category on the same permission and layout", () => {
    const seed = resignationExitSeed(PLACEHOLDER);
    expect(seed).toMatchObject({
      key: "resignation-exit",
      name: "Resignation/Exit Form",
      category: "employment_changes",
      requiredPermission: "create_employment_change_form",
      layoutFamily: "coaching",
    });
    expect(detectTemplateIntent(formRequestPhrase(seed.name))).toEqual({
      kind: "explicit",
      templateKey: "resignation-exit",
    });
    const grouped = groupTemplatesByCategory([...TEMPLATE_SEEDS, seed]);
    expect(grouped.find((group) => group.key === "employment_changes")?.templates.map((entry) => entry.key)).toEqual([
      "demotion",
      "position-transfer",
      "resignation-exit",
    ]);
  });
});

describe("asking for the exit form", () => {
  it.each([
    "pull up the exit form",
    "create an exit form for paulyne co",
    "resignation paperwork for john",
    "termination form for maria",
    "mike quit yesterday",
    "create a separation form",
    "I need an offboarding form for jane",
    "she no call no showed 9/20, create the paperwork",
  ])("%s", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: "resignation-exit" });
  });

  it.each(["did mike quit yesterday?", "what is our resignation policy?", "how much notice do they have to give?"])(
    "leaves a question alone: %s",
    (question) => {
      expect(detectTemplateIntent(question)).toEqual({ kind: "none" });
    },
  );

  it.each([
    ["create an exit form for paulyne co", "paulyne co"],
    ["create an exit form for PAULYNE CO", "PAULYNE CO"],
    ["create an exit form for Paulyne Co", "Paulyne Co"],
    ["resignation paperwork for john", "john"],
    ["termination form for maria", "maria"],
    ["mike quit yesterday", "mike"],
    ["John resigned, gave notice 9/10", "John"],
  ])("reads the name in %s", (text, name) => {
    expect(extractEmployeeNames(text)).toEqual([name]);
  });
});

describe("the exit facts managers give", () => {
  it.each([
    ["september 25", "2026-09-25"],
    ["Sept 25th", "2026-09-25"],
    ["9/25", "2026-09-25"],
    ["9/25/26", "2026-09-25"],
    ["09-25-2026", "2026-09-25"],
  ])("last day was %s", (date, iso) => {
    expect(read(`mike quit yesterday, last day was ${date}`).lastDayWorked).toBe(iso);
  });

  it("reads notice given and worked through, and ticks Submitted & Fulfilled Notice", () => {
    const facts = read("john gave notice 9/10 and worked through 9/24");
    expect(facts.noticeGivenDate).toBe("2026-09-10");
    expect(facts.noticeFulfilledDate).toBe("2026-09-24");
    expect(facts.separation).toEqual(["submitted_fulfilled_notice"]);
  });

  it("reads an explicitly immediate voluntary resignation", () => {
    expect(read("this was an immediate voluntary resignation").separation).toEqual([
      "immediate_voluntary_resignation",
    ]);
  });

  it("reads the title and salon she held", () => {
    const facts = read("she was a salon director at salon 12");
    expect(facts.current).toEqual({ title: "Salon Director", location: "Salon 12" });
    const stc = read("he was a TC at STC 12");
    expect(stc.current).toEqual({ title: "Tanning Consultant", location: "STC 12" });
  });

  it("reads several facts from one sentence", () => {
    const { values, checked } = statedFactValues(
      read(
        "Maria was a full time TC at KS Lawrence, gave notice 9/10 and worked through 9/24, all store items returned, written notice attached: yes, eligible for rehire",
      ),
    );
    expect(values).toMatchObject({
      job_title: "Tanning Consultant",
      location: "KS Lawrence",
      notice_given_date: "2026-09-10",
      notice_fulfilled_date: "2026-09-24",
    });
    expect(checked).toMatchObject({
      separation_type: ["submitted_fulfilled_notice"],
      store_items_returned: ["yes"],
      written_notice_attached: ["yes"],
      eligible_for_rehire: ["yes"],
    });
  });

  it.each([
    "create an exit form for Mike",
    "mike quit yesterday",
    "mike quit yesterday, last day was september 25",
    "termination form for maria",
  ])("infers no HR decision from: %s", (text) => {
    const facts = read(text);
    expect(facts.answers).toEqual({});
    expect(facts.separation).toBeUndefined();
    expect(facts.changeType).toBeUndefined();
    const { checked } = statedFactValues(facts);
    expect(checked).toEqual({});
  });

  it("asks the grouped questions, and only the missing ones", () => {
    const bare = missingDetails("exit", read("create an exit form for Mike")).map((item) => item.phrase);
    expect(bare).toEqual([
      "last day worked",
      "whether this was a resignation or an involuntary separation",
      "yes or no for all store items returned, payroll deduction applicable, forfeit bonus, drop to minimum wage, written notice attached, and eligible for rehire",
    ]);
    const quit = missingDetails("exit", read("mike quit yesterday, last day was september 25")).map((item) => item.key);
    expect(quit).toEqual(["separation", "yes_no"]);
  });

  it("corrects an exit fact after the form exists", () => {
    expect(correctionValues("change the last day worked to 9/26", TODAY)?.values).toEqual({
      last_day_worked: "2026-09-26",
    });
    expect(correctionValues("actually she is eligible for rehire", TODAY)?.checked).toEqual({
      eligible_for_rehire: ["yes"],
    });
  });
});
