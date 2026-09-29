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
  positionTransferDocument,
} from "./employment-change-library";
import {
  correctionValues,
  describeKnownFacts,
  employmentChangeKind,
  formDateFor,
  missingDetails,
  readEmploymentChange,
  selectStatedFacts,
  statedFactValues,
  syncNarrative,
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

  it("reads no employment change facts onto the Resignation/Exit Form", () => {
    expect(employmentChangeKind("stc-exit")).toBeNull();
    expect(employmentChangeKind("demotion")).toBe("demotion");
    expect(employmentChangeKind("position-transfer")).toBe("transfer");
  });

  it("adds no second Exit Form — the Resignation/Exit Form is main's stc-exit", () => {
    expect(TEMPLATE_SEEDS.filter((seed) => /exit/i.test(seed.name)).map((seed) => seed.key)).toEqual([
      "stc-exit",
    ]);
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
    ["I need an exit form for JOHN SMITH", "stc-exit"],
    ["pull up the exit form", "stc-exit"],
    ["create an exit form for mike, last day was 9/25", "stc-exit"],
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
    expect(describeKnownFacts(facts)).toBe(
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
      "the current status (FT/PT) and pay rate",
      "the new status (FT/PT) and pay rate",
      "whether it's voluntary or involuntary",
    ]);
  });

  it("asks a transfer for the new location, not an effective date", () => {
    const keys = missingDetails("transfer", read("transfer form for jane")).map((item) => item.key);
    expect(keys).toContain("new_location");
    expect(keys).not.toContain("effective_date");
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


describe("found in hands-on QA", () => {
  it("reads the items before 'going to' as the current side", () => {
    const facts = read("salon 12, manager, $18/hr, going to TC at $14/hr effective 10/5");
    expect(facts.current).toEqual({ location: "Salon 12", title: "Manager", rate: "$18.00/hr" });
    expect(facts.next).toEqual({ title: "Tanning Consultant", rate: "$14.00/hr" });
    expect(facts.effectiveDate).toBe("2026-10-05");
  });

  it("never takes the name or the request in such a list for a title", () => {
    const facts = read("create a demotion form for jane, SD, FT, going to TC");
    expect(facts.current).toEqual({ title: "Salon Director", status: "full_time" });
  });

  it("keeps a spelled-out title as the manager wrote it, and expands an abbreviation", () => {
    expect(correctionValues("new title should be Assistant Salon Director", TODAY)?.values).toEqual({
      new_job_title: "Assistant Salon Director",
    });
    expect(correctionValues("new title should be asd", TODAY)?.values).toEqual({ new_job_title: "ASD" });
    expect(correctionValues("new title is salon director in training", TODAY)?.values).toEqual({
      new_job_title: "Salon Director in Training",
    });
  });
});

describe("found in hands-on QA: a bare list", () => {
  it("does not assign a bare list to either side of a demotion", () => {
    const facts = read("create a demotion form for jane, SD, FT");
    expect(facts.current).toEqual({});
    expect(facts.next).toEqual({});
  });
});

/* ======================================== found in production QA (Codex) == */

/*
 * The exact messages from the live production audit, word for word. Each was
 * reproduced against this code before the fix.
 */
const PRODUCTION = {
  demotion: [
    "Create a Demotion Form for a synthetic test employee named Demo Alpha Test at salon 12. Their current position is District Manager and the new position is Salon Director, effective October 5, 2026. The reason is a mock role realignment for QA.",
    "The employee is Demo Alpha Test. Salon 12 is the location. District Manager is the current position, Salon Director is the new position, and QA is just the reason/context.",
    "Demo Alpha Test.",
  ],
  transfer: [
    "Create a Position Transfer Form for synthetic test employee Transfer Beta Test. She is currently a Salon Manager at salon 18 and will move to salon 23 as a Salon Manager effective October 12, 2026. The reason is a mock staffing coverage change for QA.",
    "Transfer Beta Test.",
  ],
};

describe("found in production QA: the Demotion Form's Location", () => {
  it("reads 'named … at salon 12' as the current location, onto the Location field", () => {
    const facts = read(PRODUCTION.demotion[0]!);
    expect(facts.current).toEqual({ title: "District Manager", location: "Salon 12" });
    expect(statedFactValues(facts).values.location).toBe("Salon 12");
  });

  it("reads 'Salon 12 is the location' as the current location", () => {
    expect(read(PRODUCTION.demotion[1]!).current.location).toBe("Salon 12");
    expect(readEmploymentChange(PRODUCTION.demotion, TODAY).current).toEqual({
      title: "District Manager",
      location: "Salon 12",
    });
  });

  it.each([
    ["location: salon 12", "Salon 12"],
    ["her location is STC 12", "STC 12"],
  ])("reads %s", (text, location) => {
    expect(read(text).current.location).toBe(location);
  });

  it("never reads a new or future salon as the current one", () => {
    expect(read("she starts at salon 18 on 10/5").current.location).toBeUndefined();
    expect(read("her new location is salon 24").current.location).toBeUndefined();
    expect(read("her new location is salon 24").next.location).toBe("Salon 24");
    // The transfer's two sides are still read as they were.
    expect(read(PRODUCTION.transfer[0]!).current.location).toBe("Salon 18");
    expect(read(PRODUCTION.transfer[0]!).next.location).toBe("Salon 23");
  });
});

describe("found in production QA: the employee's name", () => {
  it("keeps 'Transfer' when it is part of the employee's name", () => {
    expect(extractEmployeeNames(PRODUCTION.transfer[0]!)).toEqual(["Transfer Beta Test"]);
    /*
     * A bare "Transfer Beta Test." reads "Transfer" as the verb, exactly as
     * "Demote Paulyne Co" must: a form word at the start of a message is never
     * glued onto the name. In the conversation it is completed to the full name
     * the manager gave earlier — see the conversation tests.
     */
    expect(extractEmployeeNames(PRODUCTION.transfer[1]!)).toEqual(["Beta Test"]);
    expect(extractEmployeeNames("Create a Position Transfer Form for Transfer Beta Test")).toEqual([
      "Transfer Beta Test",
    ]);
  });

  it("takes the name the manager marked, never a job title or the reason", () => {
    expect(extractEmployeeNames(PRODUCTION.demotion[0]!)).toEqual(["Demo Alpha Test"]);
    expect(extractEmployeeNames(PRODUCTION.demotion[1]!)).toEqual(["Demo Alpha Test"]);
    expect(extractEmployeeNames(PRODUCTION.demotion[2]!)).toEqual(["Demo Alpha Test"]);
  });

  it("never reads a job title as a person", () => {
    expect(extractEmployeeNames("District Manager is the current position")).toEqual([]);
    expect(extractEmployeeNames("She is currently a Salon Manager")).toEqual([]);
  });

  it("still reads 'Transfer' as the verb when a person follows it", () => {
    expect(extractEmployeeNames("Transfer Jane Doe to salon 18")).toEqual(["Jane Doe"]);
    expect(extractEmployeeNames("transfer jane from FT to PT, involuntary")).toEqual(["jane"]);
    expect(extractEmployeeNames("Corrective Action")).toEqual([]);
    expect(extractEmployeeNames("the employee handbook says")).toEqual([]);
  });
});

describe("found in production QA: the reason paragraph follows a correction", () => {
  const reason =
    "Transfer Beta Test is transferring from Salon Manager at salon 18 to Salon Manager at salon 23, effective October 12, 2026. The transfer is due to a mock staffing coverage change for QA.";

  it("replaces the old new location in the reason, leaving nothing stale", () => {
    const sync = syncNarrative({
      narrative: reason,
      changes: [{ from: "Salon 23", to: "Salon 24" }],
      unchanged: ["Transfer Beta Test", "Salon Manager", "Salon 18", "Salon Manager"],
    });
    expect(sync.text).toBe(reason.replace("salon 23", "Salon 24"));
    expect(sync.text).not.toMatch(/salon 23/i);
    expect(sync.text).toContain("at salon 18");
    expect(sync.replaced).toEqual([{ from: "Salon 23", to: "Salon 24" }]);
    expect(sync.left).toEqual([]);
  });

  it("does not guess when the old value is also another line on the form", () => {
    const sync = syncNarrative({
      narrative: reason,
      changes: [{ from: "Salon Manager", to: "Shift Lead" }],
      unchanged: ["Salon Manager", "Salon 18", "Salon 23"],
    });
    expect(sync.text).toBe(reason);
    expect(sync.left).toEqual(["Salon Manager"]);
  });

  it.each([
    ["$12.00/hr", "$13.25/hr", "moving to $12/hr on October 5", "moving to $13.25/hr on October 5"],
    ["$12.00/hr", "$13.25/hr", "pay drops to 12 an hour", "pay drops to $13.25/hr"],
    ["Salon 23", "Salon 24", "moving to STC 23 next week", "moving to Salon 24 next week"],
    ["Beta Test", "Transfer Beta Test", "Transfer Beta Test, known as Beta Test, is moving", "Transfer Beta Test, known as Transfer Beta Test, is moving"],
  ])("replaces %s with %s however the paragraph wrote it", (from, to, before, after) => {
    expect(syncNarrative({ narrative: before, changes: [{ from, to }], unchanged: [] }).text).toBe(after);
  });

  it("leaves a number that is not the old rate alone", () => {
    const narrative = "Effective 10/12, she moves to salon 12 at $12.50/hr.";
    expect(syncNarrative({ narrative, changes: [{ from: "$12.00/hr", to: "$14.00/hr" }], unchanged: [] }).text).toBe(narrative);
  });
});


/* ================================== found in adversarial review of PR #49 == */

describe("found in review: a marked name never overrides the form's subject", () => {
  it.each([
    ["Coaching form for Sarah Jones, a customer named Karen complained about her attitude", ["Sarah Jones"]],
    ["Corrective action for Maria Lopez for violating the Employee Dress Code", ["Maria Lopez"]],
    ["Coaching form for Sarah Jones, she ignored the Employee Handbook", ["Sarah Jones"]],
    ["Employee Name: Jane Doe", ["Jane Doe"]],
    ["Employee: Jane Doe", ["Jane Doe"]],
    ["Demote Paulyne Co", ["Paulyne Co"]],
    ["Transfer Jane Doe", ["Jane Doe"]],
    ["Exit Jane Smith", []],
    ["Coaching Sarah Jones", []],
    ["the employee handbook says", []],
  ])("%s", (text, names) => {
    expect(extractEmployeeNames(text)).toEqual(names);
  });

  it("asks rather than choosing when a marked name and the form's subject disagree", () => {
    expect(extractEmployeeNames("Coaching form for Sarah Jones. Another employee named Karen Diaz saw it.")).toEqual([
      "Karen Diaz",
      "Sarah Jones",
    ]);
  });

  it("still reads the production messages whole", () => {
    expect(extractEmployeeNames(PRODUCTION.demotion[0]!)).toEqual(["Demo Alpha Test"]);
    expect(extractEmployeeNames(PRODUCTION.transfer[0]!)).toEqual(["Transfer Beta Test"]);
    expect(extractEmployeeNames("Create a Position Transfer Form for Transfer Beta Test is moving to salon 24")).toEqual([
      "Transfer Beta Test",
    ]);
    expect(extractEmployeeNames("Demotion form. Employee Name: Jane Doe")).toEqual(["Jane Doe"]);
    expect(extractEmployeeNames("coaching form for employee named paulyne co")).toEqual(["paulyne co"]);
  });
});

describe("found in review: the reason paragraph is rewritten only where it is safe", () => {
  it("never rewrites a single ordinary word, and reports it instead", () => {
    const manager = syncNarrative({
      narrative: "Jane is a Manager at Salon 12. She discussed it with her manager before stepping down.",
      changes: [{ from: "Manager", to: "Salon Director" }],
      unchanged: [],
    });
    expect(manager.text).toBe("Jane is a Manager at Salon 12. She discussed it with her manager before stepping down.");
    expect(manager.replaced).toEqual([]);
    expect(manager.left).toEqual(["Manager"]);

    const will = syncNarrative({
      narrative: "Will asked to step down, and he will start as a TC on 10/5.",
      changes: [{ from: "Will", to: "William Grant" }],
      unchanged: [],
    });
    expect(will.text).toBe("Will asked to step down, and he will start as a TC on 10/5.");
    expect(will.left).toEqual(["Will"]);
  });

  it("does not flag the ordinary word when only the verb is there", () => {
    const sync = syncNarrative({
      narrative: "He asked to step down, and he will start as a TC on 10/5.",
      changes: [{ from: "Will", to: "William Grant" }],
      unchanged: [],
    });
    expect(sync).toEqual({ text: "He asked to step down, and he will start as a TC on 10/5.", replaced: [], left: [] });
  });

  it("rewrites a multi-word value only as written, and flags another casing", () => {
    expect(
      syncNarrative({ narrative: "Jane Doe asked to step down.", changes: [{ from: "Jane Doe", to: "Janet Doe" }], unchanged: [] }).text,
    ).toBe("Janet Doe asked to step down.");
    const mixed = syncNarrative({
      narrative: "jane doe asked; Jane Doe agreed.",
      changes: [{ from: "Jane Doe", to: "Janet Doe" }],
      unchanged: [],
    });
    expect(mixed.text).toBe("jane doe asked; Janet Doe agreed.");
    expect(mixed.left).toEqual(["Jane Doe"]);
  });

  it("keeps salons and rates to their own numbers", () => {
    expect(
      syncNarrative({ narrative: "moving from salon 12 to salon 1.", changes: [{ from: "Salon 1", to: "Salon 2" }], unchanged: [] }).text,
    ).toBe("moving from salon 12 to Salon 2.");
    expect(
      syncNarrative({
        narrative: "pay was $120 bonus and $12.50/hr, base was $12/hr",
        changes: [{ from: "$12.00/hr", to: "$14.00/hr" }],
        unchanged: [],
      }).text,
    ).toBe("pay was $120 bonus and $12.50/hr, base was $14.00/hr");
  });
});

describe("found in review: the location is read only where it is a salon, and stays put", () => {
  it("never reads 'location is changing to salon 24' as the current location", () => {
    const facts = read("her location is changing to salon 24");
    expect(facts.current.location).toBeUndefined();
    expect(facts.next.location).toBe("Salon 24");
  });

  it("keeps a transfer's current salon when a later turn mentions the new one", () => {
    const facts = readEmploymentChange(
      ["Jane is transferring from salon 12 to salon 18", "she was already trained at salon 18"],
      TODAY,
    );
    expect(facts.current.location).toBe("Salon 12");
    expect(facts.next.location).toBe("Salon 18");
  });

  it("lets a stated location win over an unlabelled 'at salon', in either order", () => {
    expect(readEmploymentChange(["demotion for jane, she works at salon 5", "location is salon 12"], TODAY).current.location).toBe(
      "Salon 12",
    );
    expect(readEmploymentChange(["location is salon 12", "we had the talk at salon 5"], TODAY).current.location).toBe("Salon 12");
  });

  it("never corrects a form's location from an unlabelled 'at salon'", () => {
    expect(correctionValues("we met at salon 5 about it", TODAY)).toBeNull();
    expect(correctionValues("her location is salon 12", TODAY)?.values).toEqual({ location: "Salon 12" });
  });
});
