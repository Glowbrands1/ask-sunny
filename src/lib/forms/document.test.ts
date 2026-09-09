import { describe, expect, it } from "vitest";

import {
  blocksForVariant,
  fieldsForVariant,
  interpolate,
  parseFormDocument,
  parseFormVariants,
  renderDocument,
  responsibilityMap,
  FormDocumentError,
  type FormDocument,
} from "./document";
import {
  draftableFields,
  enforcePersonEdit,
  enforceResponsibilities,
  requiredOfPeople,
} from "./responsibility";
import { DMIT_VARIANTS, TEMPLATE_SEEDS, defaultVariantKey } from "./library";

/**
 * THE ENGINE THE WHOLE FORMS FEATURE RESTS ON.
 *
 * Three things are being protected here, and only the first is about types:
 *
 *   a stored document that this code cannot fully understand must FAIL rather
 *   than render with a block quietly missing — a form is a record somebody
 *   signs;
 *
 *   the assistant writes only into fields the TEMPLATE says it may, whatever it
 *   returns, and never into a signature;
 *
 *   responsibility is per template. The tests below assert that the DMIT EPP's
 *   self-assessment is hand-filled while the SDIT EPP's is drafted, because
 *   that difference is a business decision read off the reference forms and the
 *   kind of thing a later "tidy-up" would flatten into one rule.
 */

const seed = (key: string) => {
  const found = TEMPLATE_SEEDS.find((entry) => entry.key === key);
  if (!found) throw new Error(`no seed ${key}`);
  return found;
};

/** A document round-tripped through JSON, the way the database stores it. */
const stored = (document: FormDocument) =>
  parseFormDocument(JSON.parse(JSON.stringify(document)));

describe("reading a stored document", () => {
  it("round-trips every seeded template", () => {
    for (const template of TEMPLATE_SEEDS) {
      const parsed = stored(template.document);
      expect(parsed.blocks.length, template.key).toBe(template.document.blocks.length);
    }
  });

  it("refuses a block kind it does not understand", () => {
    // Rendering "most of" a disciplinary form is worse than refusing to render
    // it: the missing part is invisible on the page that gets signed.
    expect(() => parseFormDocument({ blocks: [{ kind: "iframe" }] })).toThrow(FormDocumentError);
  });

  it("refuses two fields with the same key", () => {
    expect(() =>
      parseFormDocument({
        blocks: [
          { kind: "field", field: { key: "a", label: "A", input: "text", responsibility: "ai" } },
          { kind: "field", field: { key: "a", label: "B", input: "text", responsibility: "ai" } },
        ],
      }),
    ).toThrow(/duplicate field key/);
  });

  it("refuses a field whose responsibility is not one of the six", () => {
    expect(() =>
      parseFormDocument({
        blocks: [
          { kind: "field", field: { key: "a", label: "A", input: "text", responsibility: "whoever" } },
        ],
      }),
    ).toThrow(/unknown responsibility/);
  });

  it("refuses a checkbox group with no options", () => {
    expect(() =>
      parseFormDocument({
        blocks: [{ kind: "checkbox_group", key: "k", options: [], responsibility: "ai" }],
      }),
    ).toThrow(/no options/);
  });
});

describe("role variants", () => {
  it("gives each DMIT reading its own position description and nothing else", () => {
    const document = stored(seed("dmit-epp-tsd").document);
    const tsd = blocksForVariant(document, "tsd");
    const dmit = blocksForVariant(document, "dmit");

    const references = (blocks: typeof tsd) =>
      blocks.filter((block) => block.kind === "reference").length;

    // One reference block each — never both, never neither.
    expect(references(tsd)).toBe(1);
    expect(references(dmit)).toBe(1);
    // And the two readings are otherwise the same document.
    expect(tsd.length).toBe(dmit.length);
    expect(fieldsForVariant(document, "tsd").map((f) => f.key)).toEqual(
      fieldsForVariant(document, "dmit").map((f) => f.key),
    );
  });

  it("resolves {{role}} and {{roleAbbr}} from the chosen variant", () => {
    const document = stored(seed("dmit-epp-tsd").document);
    const variant = DMIT_VARIANTS[0];
    const rendered = renderDocument(document, variant);
    const text = JSON.stringify(rendered);

    expect(text).not.toContain("{{role}}");
    expect(text).not.toContain("{{roleAbbr}}");
    expect(text).toContain("District Manager");
    expect(text).toContain("TSD");
  });

  it("leaves an unknown placeholder visible rather than blanking it", () => {
    /*
     * A form that prints "{{seniority}}" is obviously broken and gets fixed. A
     * form that prints an empty space looks finished and is not.
     */
    expect(interpolate("Reviewed by {{seniority}}", DMIT_VARIANTS[0])).toBe(
      "Reviewed by {{seniority}}",
    );
  });

  it("parses stored variants and keeps the reviewed position", () => {
    const parsed = parseFormVariants(JSON.parse(JSON.stringify(DMIT_VARIANTS)));
    expect(parsed.map((v) => v.key)).toEqual(["tsd", "dmit"]);
    expect(parsed[0].reviewedPosition).toBe("TSD");
  });

  it("starts each DMIT template on its own reading", () => {
    expect(defaultVariantKey("dmit-epp-tsd")).toBe("tsd");
    expect(defaultVariantKey("dmit-epp-dmit")).toBe("dmit");
  });
});

describe("what the assistant is allowed to write", () => {
  const document = stored(seed("dpoa").document);

  it("keeps values for AI fields", () => {
    const result = enforceResponsibilities(document, null, {
      values: { observation: "Arrived 25 minutes late on three shifts." },
    });
    expect(result.values.observation).toContain("25 minutes late");
    expect(result.rejected).toEqual([]);
  });

  it("drops a field that is not on this template version", () => {
    const result = enforceResponsibilities(document, null, {
      values: { employee_signature: "Jane Smith" },
    });
    expect(result.values).toEqual({});
    expect(result.rejected[0].reason).toMatch(/not a field/);
  });

  it("drops checkbox options the form does not offer", () => {
    const result = enforceResponsibilities(document, null, {
      checked: { warning_type: ["written", "banishment"] },
    });
    expect(result.checked.warning_type).toEqual(["written"]);
    expect(result.rejected[0].reason).toMatch(/options not on this form/);
  });

  it("never writes into a hand-filled field", () => {
    /*
     * The DMIT EPP's self-assessment. The model is not shown these fields, and
     * if it returns them anyway the values are discarded — which is the point
     * of enforcing on the output rather than in the prompt.
     */
    const dmit = stored(seed("dmit-epp-tsd").document);
    const result = enforceResponsibilities(dmit, "tsd", {
      values: { self_succeeding: "I am doing well at scheduling." },
    });
    expect(result.values).toEqual({});
    expect(result.rejected[0].reason).toMatch(/manual fields are not drafted/);
  });

  it("never writes a signature, because there is nothing to write into", () => {
    // Signature blocks carry no key at all, so a signature cannot even be
    // addressed. This asserts that property rather than a filter that could be
    // removed.
    for (const template of TEMPLATE_SEEDS) {
      const parsed = stored(template.document);
      const keys = [...responsibilityMap(parsed, defaultVariantKey(template.key)).keys()];
      const signatureKeys = keys.filter((key) => /signature/i.test(key));
      expect(signatureKeys, template.key).toEqual([]);
    }
  });

  it("is offered no system fields to write", () => {
    // Employee name, date, job title and location come from the record. The
    // model is never asked for them, so it cannot get them wrong.
    const draftable = draftableFields(document, null).map((field) => field.key);
    expect(draftable).not.toContain("employee_name");
    expect(draftable).not.toContain("form_date");
    expect(draftable).toContain("observation");
  });
});

describe("what a person is allowed to write", () => {
  const document = stored(seed("dmit-epp-tsd").document);

  it("lets a manager edit an AI-drafted field", () => {
    const result = enforcePersonEdit(document, "tsd", {
      values: { plan_of_action: "Shadow a district visit in week two." },
    });
    expect(result.values.plan_of_action).toContain("Shadow a district visit");
  });

  it("refuses to store a hand-filled field from the app", () => {
    /*
     * Those lines are answered on the printed page, in the conversation. Typing
     * them into the app would put words in the employee's mouth.
     */
    const result = enforcePersonEdit(document, "tsd", {
      values: { self_strengths: "Coaching, scheduling, merchandising" },
    });
    expect(result.values).toEqual({});
    expect(result.rejected[0].reason).toMatch(/manual fields are not completed/);
  });
});

describe("responsibility is per template, not per field name", () => {
  it("drafts the SDIT EPP's self review and leaves the DMIT EPP's by hand", () => {
    /*
     * THE ASSERTION THAT STOPS A TIDY-UP. Two questions that read almost the
     * same, answered differently by the business:
     *
     *   SDIT EPP  "Assistant Salon Director Thoughts"  -> AI FILLS chip
     *   DMIT EPP  "In what areas do you feel..."       -> FILLED BY HAND chip
     *
     * Both are copied from the reference captures. A rule like "self-review
     * fields are always manual" would be wrong, and this fails if anyone adds
     * one.
     */
    const sdit = stored(seed("sdit-epp").document);
    const dmit = stored(seed("dmit-epp-tsd").document);

    expect(responsibilityMap(sdit, "default").get("employee_self_review")).toBe("ai");
    expect(responsibilityMap(dmit, "tsd").get("self_succeeding")).toBe("manual");
  });

  it("marks every policy-quoting field as grounded, and only those", () => {
    const grounded: string[] = [];
    for (const template of TEMPLATE_SEEDS) {
      const parsed = stored(template.document);
      for (const field of fieldsForVariant(parsed, defaultVariantKey(template.key))) {
        if (field.policyGrounded) grounded.push(`${template.key}:${field.key}`);
      }
    }
    // The two corrective forms, two fields each: which policy, and its words.
    expect(grounded.sort()).toEqual([
      "dpoa:policy_language",
      "dpoa:policy_violated",
      "policy-review:policy_language",
      "policy-review:policy_violated",
    ]);
  });

  it("only ever grounds a field the assistant is allowed to draft", () => {
    // A grounded field that nobody may draft would be a contradiction: the
    // grounding exists to constrain the assistant's output.
    for (const template of TEMPLATE_SEEDS) {
      const parsed = stored(template.document);
      for (const field of fieldsForVariant(parsed, defaultVariantKey(template.key))) {
        if (field.policyGrounded) expect(field.responsibility, field.key).toBe("ai");
      }
    }
  });
});

describe("the library matches the verified inventory", () => {
  it("has exactly the fourteen templates, once each", () => {
    expect(TEMPLATE_SEEDS).toHaveLength(14);
    const keys = TEMPLATE_SEEDS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(14);
    expect(keys).toEqual([
      "coaching",
      "dpoa",
      "policy-review",
      "sdit-epp",
      "tsd-epp",
      "asd-sdit-epp",
      "fttc-epp",
      "dmit-epp-tsd",
      "dmit-epp-dmit",
      /*
       * The fourteenth, and the only one with no paper source form: defined by
       * §9.2 of the approved Performance Management Framework. Listed last in
       * this file because `display_order` is written only on INSERT, so
       * renumbering the eight forms above it would leave the code and every
       * already-seeded database disagreeing.
       */
      "follow-up-coaching",
      "prescreen-phone-interview",
      "tanning-consultant-interview",
      "management-interview-round-1",
      "management-interview-round-2",
    ]);
  });

  it("records the framework provenance of the one form with no paper source", () => {
    /*
     * The distinction that has to survive: every other template stands for a
     * document the business issues on paper, and this one does not. Asserted on
     * the seed because the seeder writes it onto the template's asset row, so
     * "which official form is this?" has an answer months later — and for this
     * one the honest answer is "none, it comes from the framework".
     */
    const paper = TEMPLATE_SEEDS.filter((entry) => entry.provenance === undefined);
    expect(paper).toHaveLength(13);

    const framework = TEMPLATE_SEEDS.filter((entry) => entry.provenance !== undefined);
    expect(framework.map((entry) => entry.key)).toEqual(["follow-up-coaching"]);
    expect(framework[0]!.provenance).toEqual({
      kind: "framework",
      document: "ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT",
      locator: "§9.2 Template: Create a follow-up coaching form",
      note: expect.stringContaining("did NOT originate from an uploaded business PDF"),
    });
    // And it must not claim to be a paper form anywhere in its own notes.
    expect(framework[0]!.revisionNote).toContain("Framework-defined");
  });

  it("builds them from five layouts, in the proportions the references showed", () => {
    const counts = TEMPLATE_SEEDS.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.layoutFamily] = (acc[entry.layoutFamily] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      // Two now: the Coaching Form and the Follow-Up Coaching Form are the same
      // family of document, and the family is a semantic grouping rather than a
      // layout — the coaching form carries its paper source's own `style`, and
      // the follow-up, having no paper source, carries none.
      coaching: 2,
      corrective: 2,
      epp: 4,
      dmit_epp: 2,
      interview: 4,
    });
  });

  it("gives the four EPPs one shared shape and different role pairings", () => {
    const epps = TEMPLATE_SEEDS.filter((entry) => entry.layoutFamily === "epp");
    const shapes = new Set(
      epps.map((entry) => entry.document.blocks.map((block) => block.kind).join("|")),
    );
    expect(shapes.size, "the four EPPs should be one layout").toBe(1);

    const pairings = epps.map((entry) => `${entry.variants[0].role}/${entry.variants[0].roleAbbr}`);
    expect(pairings).toEqual([
      "Training Salon Director/ASD",
      "District Manager/SD",
      "Training Salon Director/ASD",
      "Salon Director/TC",
    ]);
  });

  /**
   * ==========================================================================
   * THE HR HEADER, AND THE ONE FORM THAT CARRIES LESS OF IT
   * ==========================================================================
   *
   * The nine forms read from paper sources all open with the same four
   * record-filled fields, because all nine paper forms do.
   *
   * The Follow-Up Coaching Form carries only two — the employee and the date —
   * and that is deliberate rather than an oversight. Its source is §9.2 of the
   * Performance Management Framework, whose output format lists NEITHER a job
   * title nor a location; §9.1, the coaching form's, does list Job Title. Adding
   * the other two to match the rest of the library would be inventing fields on
   * a document that goes in an employment file, which is the whole failure this
   * work exists to remove. The two that ARE there are the minimum for the page
   * to identify its subject, and they are `system` — seeded from the
   * `form_instances` row, never drafted and never typed.
   */
  const PAPER_SOURCED_HR_HEADER = ["employee_name", "form_date", "job_title", "location"];

  it("starts every paper-sourced HR form with the same four record-filled header fields", () => {
    const paperHr = TEMPLATE_SEEDS.filter(
      (entry) => entry.category === "hr_performance" && entry.provenance === undefined,
    );
    expect(paperHr).toHaveLength(9);

    for (const template of paperHr) {
      const parsed = stored(template.document);
      const map = responsibilityMap(parsed, defaultVariantKey(template.key));
      for (const key of PAPER_SOURCED_HR_HEADER) {
        expect(map.get(key), `${template.key}:${key}`).toBe("system");
      }
    }
  });

  it("gives the framework-defined form only the header its source specifies", () => {
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "follow-up-coaching")!;
    const map = responsibilityMap(stored(seed.document), defaultVariantKey(seed.key));

    // Present, and filled from the record rather than by anybody.
    expect(map.get("employee_name")).toBe("system");
    expect(map.get("form_date")).toBe("system");

    // Absent, because §9.2 does not list them.
    expect(map.get("job_title")).toBeUndefined();
    expect(map.get("location")).toBeUndefined();
  });

  it("gives the framework-defined form no signature or acknowledgement block", () => {
    /*
     * §9.2 specifies neither, and copying the Coaching Form's for visual
     * consistency would mean inventing the wording of an employee
     * acknowledgement. If the business issues a paper Follow-Up Coaching Form
     * later, its acknowledgement arrives with it as revision 2.
     */
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "follow-up-coaching")!;
    const kinds = seed.document.blocks.map((block) => block.kind);

    expect(kinds).not.toContain("signature_row");
    expect(kinds).not.toContain("acknowledgement");
  });

  it("gives the framework-defined form exactly the fields and options of §9.2", () => {
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "follow-up-coaching")!;
    const parsed = stored(seed.document);
    const map = responsibilityMap(parsed, defaultVariantKey(seed.key));

    // The eight §9.2 entries, and nothing beyond them but the two header fields.
    expect([...map.keys()].sort()).toEqual(
      [
        "additional_coaching",
        "employee_name",
        "follow_up_observation",
        "form_date",
        "next_follow_up",
        "next_step",
        "original_expectation",
        "original_topic",
        "progress_level",
        "specific_evidence",
      ].sort(),
    );

    // No policy field, no warning level: §9.2 has neither, and "Next Step"
    // NAMES an escalation rather than imposing one.
    const fields = parsed.blocks.flatMap((block) =>
      block.kind === "field" ? [block.field] : block.kind === "field_row" ? block.fields : [],
    );
    expect(fields.some((field) => field.policyGrounded)).toBe(false);

    // The two option lists, verbatim from §9.2.
    const groups = parsed.blocks.filter((block) => block.kind === "checkbox_group");
    const options = Object.fromEntries(
      groups.map((group) => [
        group.kind === "checkbox_group" ? group.key : "",
        group.kind === "checkbox_group" ? group.options.map((option) => option.label) : [],
      ]),
    );
    expect(options.progress_level).toEqual([
      "Improved",
      "Partially Improved",
      "No Improvement",
    ]);
    expect(options.next_step).toEqual([
      "Continue",
      "Role-play",
      "EPP",
      "DPOA",
      "Leadership Review",
    ]);
  });

  /*
   * THE HIRING FORMS' HEADER IS DIFFERENT, AND THE DIFFERENCE IS THE POINT.
   *
   * An interview form has no Job Title, because the applicant does not have
   * one yet — only the prescreening call asks, and it asks "Position Applied
   * For". What all four DO share is the subject, the date and the salon, and
   * they carry the engine's own keys for those so `createInstance` fills them
   * from the record rather than asking the interviewer to type a name twice.
   */
  it("fills the applicant, the date and the salon on every hiring form", () => {
    const hiring = TEMPLATE_SEEDS.filter((entry) => entry.category === "hiring");
    expect(hiring).toHaveLength(4);
    for (const template of hiring) {
      const parsed = stored(template.document);
      const map = responsibilityMap(parsed, defaultVariantKey(template.key));
      expect(map.get("employee_name"), `${template.key}:employee_name`).toBe("system");
      expect(map.get("form_date"), `${template.key}:form_date`).toBe("system");
      if (template.key !== "prescreen-phone-interview") {
        expect(map.get("location"), `${template.key}:location`).toBe("system");
      }
    }
  });

  it("asks a person for something on every form", () => {
    // A form nobody has to complete is a form that finalizes itself, which is
    // not what any of these documents are for.
    for (const template of TEMPLATE_SEEDS) {
      const parsed = stored(template.document);
      const people = requiredOfPeople(parsed, defaultVariantKey(template.key));
      const draftable = draftableFields(parsed, defaultVariantKey(template.key));
      expect(people.length + draftable.length, template.key).toBeGreaterThan(0);
    }
  });

  it("keeps the DMIT lifecycle in one document", () => {
    /*
     * Follow-up, acknowledgement, re-evaluation and a second acknowledgement
     * are one form in the reference, not four. Splitting them would lose the
     * link between a plan and whether its objectives were met.
     */
    const parsed = stored(seed("dmit-epp-tsd").document);
    const map = responsibilityMap(parsed, "tsd");
    expect(map.has("follow_up_week")).toBe(true);
    expect(map.has("objectives_met")).toBe(true);
    expect(map.has("reevaluation_plan")).toBe(true);

    const acknowledgements = parsed.blocks.filter((block) => block.kind === "acknowledgement");
    expect(acknowledgements.length).toBe(2);

    const pageBreaks = parsed.blocks.filter((block) => block.kind === "page_break");
    expect(pageBreaks.length).toBe(2);
  });
});

describe("the versioned visual style", () => {
  const withStyle = (style: unknown) =>
    parseFormDocument({ paper: "letter", style, blocks: [{ kind: "section", label: "S" }] });

  it("reads a full style back exactly as it was stored", () => {
    const style = {
      headingStyle: "rule",
      letterhead: "centered",
      margins: "wide",
      signatureLayout: "ruled",
      logo: { assetKey: "sun-tan-city", placement: "top-right", widthPt: 76 },
    };
    expect(withStyle(style).style).toEqual(style);
  });

  it("is absent, not invented, on a document that has none", () => {
    /*
     * Every version written before the style model has no `style` key at all,
     * and must keep rendering the way it always did. An absent style is the
     * documented default, never an error.
     */
    const parsed = parseFormDocument({ paper: "letter", blocks: [{ kind: "section", label: "S" }] });
    expect(parsed.style).toBeUndefined();
    expect(withStyle(null).style).toBeUndefined();
    expect(withStyle({}).style).toBeUndefined();
  });

  it("refuses a style value it cannot render, rather than dropping it", () => {
    /*
     * The same rule as an unknown block kind, and for the same reason: a value
     * this code silently ignored would change how a signed document looks — or
     * fail to — with nothing anywhere saying so.
     *
     * GUARD ON THE GUARD: the valid spelling of each one is accepted directly
     * above and below, so these are refusals of the VALUE, not of the key.
     */
    expect(() => withStyle({ headingStyle: "underline" })).toThrow(FormDocumentError);
    expect(() => withStyle({ letterhead: "banner" })).toThrow(FormDocumentError);
    expect(() => withStyle({ margins: "narrow" })).toThrow(FormDocumentError);
    expect(() => withStyle({ signatureLayout: "stacked" })).toThrow(FormDocumentError);
    expect(() => withStyle({ logo: { assetKey: "x", placement: "middle", widthPt: 10 } })).toThrow(
      FormDocumentError,
    );
    expect(() => withStyle("rule")).toThrow(FormDocumentError);
  });

  it("refuses a logo with no key or no width", () => {
    // A logo reference that resolves to nothing is a masthead that silently
    // loses its mark on every printed record.
    expect(() => withStyle({ logo: { placement: "top-right", widthPt: 76 } })).toThrow(
      FormDocumentError,
    );
    expect(() => withStyle({ logo: { assetKey: "sun-tan-city" } })).toThrow(FormDocumentError);
    expect(() => withStyle({ logo: { assetKey: "sun-tan-city", widthPt: 0 } })).toThrow(
      FormDocumentError,
    );
  });

  it("carries a field's narrative marking through storage", () => {
    const parsed = parseFormDocument({
      paper: "letter",
      blocks: [
        {
          kind: "field",
          field: {
            key: "d",
            label: "D",
            input: "long_text",
            responsibility: "ai",
            narrative: "observed_expectation",
          },
        },
        {
          kind: "field",
          field: { key: "e", label: "E", input: "text", responsibility: "ai", narrative: "nonsense" },
        },
      ],
    });
    const [first, second] = parsed.blocks;
    expect(first.kind === "field" && first.field.narrative).toBe("observed_expectation");
    // An unrecognised marking is dropped rather than trusted: it can only ever
    // relax a guard, never tighten one.
    expect(second.kind === "field" && second.field.narrative).toBeUndefined();
  });
});
