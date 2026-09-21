import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import {
  checkboxGroupsForVariant,
  fieldsForVariant,
  objectiveRowFields,
  parseFormDocument,
  parseFormVariants,
  renderDocument,
  responsibilityMap,
  type FormBlock,
} from "./document";
import { supportsInlineDraft } from "./inline-draft";
import {
  TEMPLATE_SEEDS,
  TSD_EPP_EXPECTATIONS,
  TSD_JBA_POLICY_EXPECTATION,
  TSD_PLAN_CATEGORIES,
} from "./library";
import { renderFormPdf, type RenderMeta } from "./pdf-render";

/**
 * ============================================================================
 * THE MANAGEMENT PERFORMANCE PLAN, READ BACK OUT OF THE PDF IT PRODUCES
 * ============================================================================
 *
 * The reference is the business's own Training Salon Director plan: the
 * District Manager's assessment against nine management expectations, five
 * productivity metrics for the manager and five for the salon, the manager's
 * OWN self-assessment, eight fixed Plan of Action objectives, the follow-up
 * and acknowledgement, and the re-evaluation of those same eight. This asserts
 * the document Ask Sunny actually renders is that document.
 *
 * ============================================================================
 * THE TWO THINGS THIS FILE EXISTS TO CATCH
 * ============================================================================
 *
 * THE SDIT PLAN LEAKING IN. The obvious way to ship a TSD workflow is to point
 * it at the plan that already works, and the result would be an SDIT's seven
 * expectations and three metrics on a management document. Every count here is
 * asserted against the TSD's own numbers, and the shapes are asserted to
 * differ from the SDIT's.
 *
 * ASK SUNNY ANSWERING THE MANAGER'S OWN PAGE. The self-assessment is what the
 * Training Salon Director says about themselves in the review conversation.
 * Nothing Ask Sunny generates may reach it, and that is asserted structurally —
 * on the responsibility of every field and every mark column — rather than
 * trusted to a prompt.
 */

const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "tsd-epp")!;
const document = parseFormDocument(seed.document);
const variant = parseFormVariants(seed.variants)[0]!;
const fields = fieldsForVariant(document, variant.key);
const facets = checkboxGroupsForVariant(document, variant.key);
const field = (key: string) => fields.find((entry) => entry.key === key);

const META: RenderMeta = {
  templateName: "TSD EPP",
  templateVersion: 2,
  employeeName: "Sarah Johnson",
  formDate: "2026-09-21",
  locationName: "Lincoln South",
  reference: "form-0002",
  status: "draft",
};

const FILLED = {
  values: {
    employee_name: "Sarah Johnson",
    form_date: "2026-09-21",
    job_title: "TSD",
    location: "Lincoln South",
    where_succeeding: "Coaches her team consistently and is excellent with clients.",
    needs_improvement: "Arriving ready to work at the scheduled start time.",
    top_strengths: "Effective team coaching and development\nStrong client service",
    improvement_areas: "Improve punctuality and timely shift arrival",
    manager_ppta: "14.20",
    manager_lpsva: "9.10",
    manager_upta: "1.90",
    manager_club_close: "38%",
    manager_average_club_dollar: "21.40",
    salon_ppta: "12.80",
    salon_lpsva: "8.40",
    salon_upta: "1.70",
    salon_club_close: "34%",
    salon_average_club_dollar: "19.90",
    coaching_and_development:
      "Coach the team on shift-start readiness each week and follow up at the next visit.",
    follow_up_week: "2026-10-05",
    policy_references: "JBA Policy Manual — Attendance — Page 14",
  },
  checked: {
    expectations_success: ["coach_client_service"],
    expectations_improvement: ["lead_by_example"],
  },
};

async function readBack(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text, totalPages };
}

const sections = (blocks: FormBlock[]) =>
  blocks.filter((block) => block.kind === "section").map((block) => block.label);

/* ============================================================= structure == */

describe("the document the business recognises", () => {
  it("is titled Management Performance Plan, not renamed to match the SDIT plan", () => {
    /*
     * THE TITLE AND THE NAME ARE DIFFERENT STRINGS AND BOTH ARE CORRECT. The
     * paper says "Management Performance Plan"; managers say "TSD EPP", which
     * is the template's NAME on the row and what `formRequestPhrase` sends.
     */
    const letterhead = document.blocks.find((block) => block.kind === "letterhead")!;
    expect(letterhead.kind === "letterhead" && letterhead.title).toBe(
      "Management Performance Plan",
    );
    expect(seed.name).toBe("TSD EPP");
  });

  it("prints the sections of the reference, in its order", () => {
    expect(sections(renderDocument(document, variant))).toEqual([
      "Employee Information",
      "To be filled out by District Manager",
      "Manager's current productivity",
      "Salon's current productivity",
      "To be filled out by Manager",
      "Plan of Action",
      "Follow-up",
      "Acknowledgement",
      "Re-Evaluation",
      "Acknowledgement",
    ]);
  });

  it("keeps the employee-information header and the reviewed-with statement", () => {
    for (const key of ["employee_name", "form_date", "job_title", "location"]) {
      expect(field(key)?.responsibility, key).toBe("system");
    }
    const reference = document.blocks.find((block) => block.kind === "reference");
    expect(reference?.kind === "reference" && reference.label).toBe(
      "To be reviewed with District Manager",
    );
    expect(JSON.stringify(reference)).toContain("purpose and responsibilities");
  });

  it("asks the District Manager the two narrative questions about the manager", () => {
    expect(field("where_succeeding")?.label).toBe(
      "In what areas is the manager currently succeeding?",
    );
    expect(field("needs_improvement")?.label).toBe(
      "In what areas does the manager currently need improvement?",
    );
  });

  it("carries the nine management expectations, marked twice", () => {
    expect(TSD_EPP_EXPECTATIONS).toHaveLength(9);

    const dm = facets.filter((facet) =>
      ["expectations_success", "expectations_improvement"].includes(facet.key),
    );
    expect(dm).toHaveLength(2);
    for (const facet of dm) {
      expect(facet.options).toHaveLength(9);
      expect(facet.options.map((option) => option.key)).toEqual(
        TSD_EPP_EXPECTATIONS.map((expectation) => expectation.key),
      );
    }
  });

  it("names the nine the business names, and not the SDIT's seven", () => {
    expect(TSD_EPP_EXPECTATIONS.map((expectation) => expectation.label)).toEqual([
      "Uphold the Sun Tan City Experience.",
      "Coach team to provide, and personally provide, excellent client service.",
      "Bench planning and ability to lead management.",
      "Quality hiring and employee retention.",
      TSD_JBA_POLICY_EXPECTATION,
      "Control expenses by tracking secondary productivity through KPI.",
      "Makes fact based decisions and judgement calls without emotion.",
      "Lead by example at all times.",
      'Promote a positive atmosphere and create "buy-in".',
    ]);

    const sdit = TEMPLATE_SEEDS.find((entry) => entry.key === "sdit-epp")!;
    const sditShape = JSON.stringify(sdit.document.blocks.map((block) => block.kind));
    const tsdShape = JSON.stringify(document.blocks.map((block) => block.kind));
    expect(tsdShape).not.toBe(sditShape);
  });

  it("asks for three overall strengths and two overall areas of improvement", () => {
    const lists = document.blocks.filter((block) => block.kind === "numbered_list");
    const byKey = new Map(
      lists.map((block) => [
        block.kind === "numbered_list" ? block.key : "",
        block.kind === "numbered_list" ? block : null,
      ]),
    );
    expect(byKey.get("top_strengths")?.count).toBe(3);
    expect(byKey.get("top_strengths")?.label).toBe(
      "What are the manager's overall top three strengths?",
    );
    expect(byKey.get("improvement_areas")?.count).toBe(2);
    expect(byKey.get("improvement_areas")?.label).toBe(
      "What are the manager's overall two biggest areas of improvement?",
    );
  });
});

/* ========================================================== productivity == */

describe("five metrics for the manager and five for the salon", () => {
  /*
   * THE SDIT PLAN HAS THREE. Club Close and Average Club Dollar are what make
   * this a management document, and a plan that asked for the SDIT's three
   * would be missing the two a District Manager reviews a salon on.
   */
  const METRICS = ["ppta", "lpsva", "upta", "club_close", "average_club_dollar"] as const;
  const LABELS = ["PPTA", "LPSVA", "UPTA", "Club Close", "Average Club Dollar"];

  it.each(METRICS)("gives the manager a %s line", (metric) => {
    expect(field(`manager_${metric}`), metric).toBeDefined();
    expect(field(`manager_${metric}`)?.responsibility).toBe("ai");
  });

  it.each(METRICS)("gives the salon a %s line", (metric) => {
    expect(field(`salon_${metric}`), metric).toBeDefined();
    expect(field(`salon_${metric}`)?.responsibility).toBe("ai");
  });

  it("labels both rows with the business's own metric names", () => {
    expect(METRICS.map((metric) => field(`manager_${metric}`)?.label)).toEqual(LABELS);
    expect(METRICS.map((metric) => field(`salon_${metric}`)?.label)).toEqual(LABELS);
  });

  it("leaves every metric blank when the manager supplied none", async () => {
    const { text } = await readBack(
      renderFormPdf(document, variant, { values: {}, checked: {} }, META),
    );
    /* The labels print — they are the form — and no figure appears beside them. */
    for (const label of LABELS) expect(text).toContain(label);
    expect(text).not.toMatch(/\d+\.\d\d/);
  });
});

/* ======================================================= self-assessment == */

describe("the manager's own page, which Ask Sunny never answers", () => {
  const SELF_KEYS = [
    "self_important_skill",
    "self_strengths",
    "self_improvements",
    "salon_goals",
  ];

  it("exists, under the heading the reference prints", () => {
    expect(sections(renderDocument(document, variant))).toContain("To be filled out by Manager");
    expect(field("self_important_skill")?.label).toBe(
      "What do you feel is the most important skill for a Salon Director to possess?",
    );
  });

  it("marks every one of its fields the EMPLOYEE's, which is not AI-writable", () => {
    /*
     * A STRUCTURAL GUARANTEE, NOT A PROMPT INSTRUCTION. `employee` is absent
     * from `AI_WRITABLE`, so `enforceResponsibilities` drops any value a model
     * returns for these keys whatever the prompt said — which is the only kind
     * of promise worth making about somebody's self-assessment.
     */
    const map = responsibilityMap(document, variant.key);
    for (const key of SELF_KEYS) expect(map.get(key), key).toBe("employee");
    for (const key of ["self_expectations_success", "self_expectations_improvement"]) {
      expect(map.get(key), key).toBe("employee");
    }
  });

  it("asks the same nine expectations of the manager themselves", () => {
    const self = facets.filter((facet) => facet.key.startsWith("self_expectations_"));
    expect(self).toHaveLength(2);
    for (const facet of self) {
      expect(facet.options).toHaveLength(9);
      expect(facet.responsibility).toBe("employee");
    }
  });

  it("gives them three strengths, two improvements and three salon goals", () => {
    const lists = document.blocks.filter((block) => block.kind === "numbered_list");
    const count = (key: string) =>
      lists.find((block) => block.kind === "numbered_list" && block.key === key)?.count;
    expect(count("self_strengths")).toBe(3);
    expect(count("self_improvements")).toBe(2);
    expect(count("salon_goals")).toBe(3);
  });
});

/* ========================================================= plan of action == */

describe("the plan of action is eight fixed objectives, not a paragraph", () => {
  const rows = objectiveRowFields(document, variant.key);

  it("has no generic plan_of_action field at all", () => {
    expect(field("plan_of_action")).toBeUndefined();
  });

  it.each(TSD_PLAN_CATEGORIES.map((row) => [row.key, row.category] as const))(
    "carries the %s row",
    (key, category) => {
      const row = rows.find((entry) => entry.key === key);
      expect(row, key).toBeDefined();
      expect(row!.label).toBe(`Plan of Action — ${category}`);
      expect(row!.responsibility).toBe("ai");
    },
  );

  it("prints each objective beside its category, in the business's words", () => {
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.help)).toEqual(
      TSD_PLAN_CATEGORIES.map((row) => row.objective),
    );
  });

  it("leaves every row the conversation did not support blank", async () => {
    /*
     * EIGHT ROWS IS EIGHT INVITATIONS TO INVENT A WEAKNESS. A punctuality
     * concern supports the coaching row and nothing else; the other seven
     * print as empty rules, which is what a category outside this plan is
     * supposed to look like.
     */
    const { text } = await readBack(renderFormPdf(document, variant, FILLED, META));
    expect(text).toContain("Coach the team on shift-start readiness each week");
    for (const category of TSD_PLAN_CATEGORIES) expect(text).toContain(category.category);
    expect(text).not.toContain("Ability to find and select quality talent, and retain at bench goals set by DM.");
  });
});

/* ============================================ follow-up and re-evaluation == */

describe("follow-up, acknowledgement and the re-evaluation of the same eight", () => {
  it("asks when the two will meet again, and does not require an answer", () => {
    expect(field("follow_up_week")?.label).toBe(
      "Manager and Supervisor will meet and re-evaluate the week of",
    );
    expect(field("follow_up_week")?.responsibility).toBe("ai");
  });

  it("carries two acknowledgements and four signature lines, none of them fillable", async () => {
    const acknowledgements = document.blocks.filter(
      (block) => block.kind === "acknowledgement",
    );
    const signatures = document.blocks.filter((block) => block.kind === "signature_row");
    expect(acknowledgements).toHaveLength(2);
    expect(signatures).toHaveLength(4);

    /* A signature row declares no key, so there is nothing to write into. */
    const keys = [...responsibilityMap(document, variant.key).keys()];
    expect(keys.some((key) => key.includes("signature"))).toBe(false);

    const { text } = await readBack(renderFormPdf(document, variant, FILLED, META));
    expect((text.match(/Employee Signature/g) ?? []).length).toBe(2);
    expect((text.match(/Supervisor Signature/g) ?? []).length).toBe(2);
  });

  it("re-evaluates all eight categories, Met or Not met, blank on a new plan", () => {
    const reevaluation = facets.filter((facet) => facet.key.startsWith("reevaluation_"));
    expect(reevaluation.map((facet) => facet.key)).toEqual([
      "reevaluation_met",
      "reevaluation_not_met",
    ]);
    for (const facet of reevaluation) {
      expect(facet.options.map((option) => option.key)).toEqual(
        TSD_PLAN_CATEGORIES.map((row) => row.key),
      );
      /*
       * THE RE-EVALUATION IS THE MANAGER'S, AT THE REVIEW. Not `ai`: there is
       * nothing to assess on the day a plan is written, so a draft cannot
       * mark it and a new plan's marks are empty by construction.
       */
      expect(facet.responsibility).toBe("manager");
    }
    expect(FILLED.checked).not.toHaveProperty("reevaluation_met");
  });

  it("marks Met and Not met rather than success and improvement", () => {
    const block = document.blocks.find(
      (entry) => entry.kind === "expectation_checklist" && entry.successKey === "reevaluation_met",
    );
    expect(block?.kind === "expectation_checklist" && block.successLabel).toBe("Met");
    expect(block?.kind === "expectation_checklist" && block.improvementLabel).toBe("Not met");
  });

  it("carries the re-evaluation's own plan of action and objectives-met question", () => {
    expect(field("objectives_met")?.label).toBe("Which objectives were met?");
    expect(field("reevaluation_plan")?.label).toBe("Plan of Action");
    expect(field("objectives_met")?.responsibility).toBe("manager");
    expect(field("reevaluation_plan")?.responsibility).toBe("manager");
  });
});

/* ================================================================ policy == */

describe("the JB & Associates manual is the only policy this plan names", () => {
  it("states the company-policy expectation against the manual Ask Sunny can read", () => {
    expect(TSD_JBA_POLICY_EXPECTATION).toContain("JB & Associates Employment Policy Manual");
    expect(TSD_EPP_EXPECTATIONS.map((expectation) => expectation.label)).toContain(
      TSD_JBA_POLICY_EXPECTATION,
    );
  });

  it("carries no trace of the manual Ask Sunny cannot read", () => {
    /*
     * THE REFERENCE FORM SAYS "per Driven to Shine manual". That manual is not
     * in the corpus, so citing it would point a manager at a document nobody
     * checked — and the whole document, its expectations, its objectives and
     * its appendix, is asserted clean of it here.
     */
    const printed = JSON.stringify(renderDocument(document, variant));
    expect(printed).not.toMatch(/driven to shine/i);
    expect(printed).not.toMatch(/\bDTS\b/);
  });

  it("names the manual on the appendix line, and fails that line closed", () => {
    expect(field("policy_references")?.policyGrounded).toBe(true);
    expect(field("policy_references")?.responsibility).toBe("ai");
  });
});

/* ============================================================== appendix == */

describe("Ask Sunny Draft Details", () => {
  const appendix = document.blocks.find((block) => block.kind === "draft_details")!;

  it("is labelled as a reference sheet rather than as part of the form", () => {
    expect(appendix.kind === "draft_details" && appendix.label).toBe("Ask Sunny Draft Details");
    expect(appendix.kind === "draft_details" && appendix.note).toMatch(/not part of the official/i);
  });

  it("declares no key of its own, so it can never disagree with the form", () => {
    const entries = appendix.kind === "draft_details" ? appendix.entries : [];
    const declared = responsibilityMap(document, variant.key);
    for (const entry of entries) expect(declared.has(entry.key), entry.key).toBe(true);
  });

  it("prints the stored value under each heading, and omits the blanks", async () => {
    /*
     * ECHOES, NEVER REGENERATES. Every line on the appendix is the value
     * already stored against the key the entry names — there is no second
     * pass over the manager's notes — so the sheet and the form can never
     * say different things about the same employee.
     */
    const { text } = await readBack(renderFormPdf(document, variant, FILLED, META));

    expect(text).toContain("Areas Succeeding");
    expect(text).toContain("Coaches her team consistently and is excellent with clients.");
    expect(text).toContain("Areas Needing Improvement");
    /* The renderer folds the em dash to ASCII, so the printed heading is "-". */
    expect(text).toContain("Plan of Action - Coaching and Development");

    /*
     * A KEY NOBODY FILLED CONTRIBUTES NO HEADING AT ALL. Both of these are
     * appendix headings rather than anything the form itself prints, so
     * their absence is the appendix omitting a blank rather than the page
     * being short of a label. ("Salon Goals" is deliberately not tested
     * this way: the self-assessment page prints that question whether or
     * not anybody answered it.)
     */
    expect(text).not.toContain("Plan of Action - District Outreach");
    expect(text).not.toContain("Manager Productivity (as provided)");
  });

  it("echoes the strengths, improvements, salon goals, the eight rows and the figures", () => {
    const entries = appendix.kind === "draft_details" ? appendix.entries : [];
    const keys = entries.map((entry) => entry.key);
    expect(keys).toEqual([
      "where_succeeding",
      "needs_improvement",
      "top_strengths",
      "improvement_areas",
      "salon_goals",
      ...TSD_PLAN_CATEGORIES.map((row) => row.key),
      "employee_productivity",
      "salon_productivity",
    ]);
  });
});

/* =================================================================== PDF == */

describe("the printed PDF", () => {
  it("prints the whole form and nothing from the editor", async () => {
    const { text, totalPages } = await readBack(renderFormPdf(document, variant, FILLED, META));

    expect(totalPages).toBeGreaterThanOrEqual(5);
    for (const printed of [
      "Management Performance Plan",
      "To be filled out by District Manager",
      "Manager's current productivity",
      "Salon's current productivity",
      "To be filled out by Manager",
      "Plan of Action",
      "Follow-up",
      "Re-Evaluation",
      "Ask Sunny Draft Details",
      "Average Club Dollar",
      "Bench",
      "District Outreach",
      "Salon Standards of Cleanliness and Safety",
    ]) {
      expect(text, printed).toContain(printed);
    }

    /* Editor furniture never reaches the paper. */
    expect(text).not.toContain("AI FILLS");
    expect(text).not.toContain("FILLED BY HAND");
  });

  it("addresses the Training Salon Director, and never another role", () => {
    const printed = JSON.stringify(renderDocument(document, variant));
    expect(variant.roleAbbr).toBe("TSD");
    expect(variant.role).toBe("District Manager");
    expect(printed).not.toContain("{{role}}");
    expect(printed).not.toContain("{{roleAbbr}}");
    for (const wrong of ["SDIT", "FTTC", "DMIT"]) {
      expect(printed, wrong).not.toMatch(new RegExp(`\\b${wrong}\\b`));
    }
    /* "ASD" must not appear as a word; "DM" is the business's own shorthand
     * inside the bench objective and belongs there. */
    expect(printed).not.toMatch(/\bASD\b/);
  });

  it("can be created and drafted from chat, as one reading with nothing to choose", () => {
    expect(seed.variants).toHaveLength(1);
    expect(supportsInlineDraft("tsd-epp", parseFormVariants(seed.variants))).toBe(true);
  });
});

/* ========================================== nothing else in the library moved */

describe("the rest of the library is where it was", () => {
  it("leaves the SDIT plan at seven expectations and three metrics", () => {
    const sdit = parseFormDocument(
      TEMPLATE_SEEDS.find((entry) => entry.key === "sdit-epp")!.document,
    );
    const sditFacets = checkboxGroupsForVariant(sdit, "default");
    const expectations = sditFacets.filter((facet) => facet.key.startsWith("expectations_"));
    expect(expectations).toHaveLength(2);
    for (const facet of expectations) expect(facet.options).toHaveLength(7);

    const sditKeys = fieldsForVariant(sdit, "default").map((entry) => entry.key);
    expect(sditKeys).not.toContain("manager_club_close");
    expect(sditKeys).not.toContain("salon_average_club_dollar");
  });

  it("gives the eight-objective table to no other template", () => {
    for (const entry of TEMPLATE_SEEDS) {
      const kinds = entry.document.blocks.map((block) => block.kind);
      expect(kinds.includes("objective_rows"), entry.key).toBe(entry.key === "tsd-epp");
    }
  });

  it("moves no other template's revision", () => {
    const expected: Record<string, number> = {
      coaching: 2,
      dpoa: 3,
      "policy-review": 2,
      "follow-up-coaching": 2,
      "sdit-epp": 3,
      "tsd-epp": 2,
    };
    for (const entry of TEMPLATE_SEEDS) {
      expect(entry.revision, entry.key).toBe(expected[entry.key] ?? 1);
    }
  });
});
