import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import {
  parseFormDocument,
  parseFormVariants,
  renderDocument,
  responsibilityMap,
  type FormBlock,
} from "./document";
import { JBA_POLICY_EXPECTATION, SDIT_EPP_EXPECTATIONS, TEMPLATE_SEEDS } from "./library";
import { supportsInlineDraft, variantsAllowInline } from "./inline-draft";
import { OFFICIAL_POLICY_MANUAL } from "./official-policy-manual";
import { renderFormPdf, type RenderMeta } from "./pdf-render";

/**
 * ============================================================================
 * THE SDIT EPP AS IT PRINTS, READ BACK OUT OF THE PDF IT PRODUCES
 * ============================================================================
 *
 * The reference the business works from is the completed plan: a manager's
 * page with the standing expectations marked, the employee's own page, the
 * plan, the follow-up, the acknowledgement, the re-evaluation, and a reference
 * sheet at the back. This asserts the document Ask Sunny actually renders is
 * that document — parsed with the same library the uploader uses, so what is
 * checked is the file a manager downloads.
 */

const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "sdit-epp")!;
const document = parseFormDocument(seed.document);
const variant = parseFormVariants(seed.variants)[0]!;

const META: RenderMeta = {
  templateName: "SDIT EPP",
  templateVersion: 2,
  employeeName: "Paulyne Co",
  formDate: "2026-09-21",
  locationName: "Kearney",
  reference: "form-0001",
  status: "draft",
};

const FILLED = {
  values: {
    employee_name: "Paulyne Co",
    form_date: "2026-09-21",
    job_title: "SDIT",
    location: "Kearney",
    where_succeeding: "Consistently warm and welcoming with every client.",
    needs_improvement: "Arriving ready to work at the scheduled start time.",
    plan_of_action: "Review clock-in times together each week during the review period.",
    follow_up_week: "2026-10-05",
    policy_references: "JBA Policy Manual — Attendance — Page 14",
  },
  checked: {
    expectations_success: ["client_service"],
    expectations_improvement: ["company_policies"],
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
  it("prints the sections of the SDIT EPP, in the reference's order", () => {
    expect(sections(renderDocument(document, variant))).toEqual([
      "Employee Information",
      "To be filled out by Training Salon Director",
      "Salon's current productivity",
      "SDIT's personal productivity",
      "To be filled out by the SDIT",
      "Plan of Action",
      "Follow-up",
      "Acknowledgement",
      "Re-Evaluation",
      "Acknowledgement",
    ]);
  });

  it("carries the seven standing expectations, once for each side of the review", () => {
    const checklists = renderDocument(document, variant).filter(
      (block) => block.kind === "expectation_checklist",
    );
    expect(checklists).toHaveLength(2);
    for (const checklist of checklists) {
      if (checklist.kind !== "expectation_checklist") throw new Error("unreachable");
      expect(checklist.options).toHaveLength(7);
    }
  });

  it("asks for PPTA, LPSVA and UPTA by name, for the salon and the employee", () => {
    const keys = new Set(responsibilityMap(document, variant.key).keys());
    for (const key of [
      "salon_ppta",
      "salon_lpsva",
      "salon_upta",
      "employee_ppta",
      "employee_lpsva",
      "employee_upta",
      "salon_productivity",
      "employee_productivity",
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it("keeps the employee's own answers out of Ask Sunny's reach", () => {
    const map = responsibilityMap(document, variant.key);
    expect(map.get("employee_expectations_success")).toBe("employee");
    expect(map.get("employee_expectations_improvement")).toBe("employee");
    expect(map.get("employee_strengths")).toBe("employee");
    expect(map.get("employee_improvements")).toBe("employee");
    // The re-evaluation happens after the plan, so it is the manager's.
    expect(map.get("objectives_met")).toBe("manager");
    expect(map.get("reevaluation_plan")).toBe("manager");
  });

  it("addresses the SDIT, and never another role", () => {
    /*
     * ======================================================================
     * THE REGRESSION THIS ASSERTS, REPORTED FROM THE LIVE FORM
     * ======================================================================
     *
     * `{{roleAbbr}}` came from the variant, and the variant said "ASD" —
     * inherited from the original reference pairing. So an SDIT EPP asked "In
     * what areas is the ASD currently succeeding?" on a page whose own title
     * says SDIT.
     *
     * Checked on the RENDERED document, which is where the substitution
     * actually happens: a label that still reads `{{roleAbbr}}`, or reads any
     * other role, fails here.
     */
    expect(variant.roleAbbr).toBe("SDIT");
    expect(variant.role).toBe("Training Salon Director");

    const printed = JSON.stringify(renderDocument(document, variant));
    expect(printed).toContain("In what areas is the SDIT currently succeeding?");
    expect(printed).toContain("In what areas does the SDIT currently need improvement?");
    expect(printed).not.toMatch(/\bASD\b/);
    expect(printed).not.toContain("{{roleAbbr}}");
    expect(printed).not.toContain("{{role}}");
  });

  it("leaves every other plan addressing the role it always addressed", () => {
    // The ASD-SDIT plan's subject really is an ASD. Nothing here may change
    // that, and this is what would catch a blanket find-and-replace.
    const pairing = (key: string) => {
      const seed = TEMPLATE_SEEDS.find((entry) => entry.key === key)!;
      return `${seed.variants[0]!.role}/${seed.variants[0]!.roleAbbr}`;
    };
    expect(pairing("asd-sdit-epp")).toBe("Training Salon Director/ASD");
    expect(pairing("tsd-epp")).toBe("District Manager/SD");
    expect(pairing("fttc-epp")).toBe("Salon Director/TC");
  });

  it("does not change the three plans that share the old builder", () => {
    /*
     * The widening that would have been wrong. TSD, ASD-SDIT and FTTC are
     * other people's performance plans, and an SDIT's standing expectations
     * have no business on them.
     */
    for (const key of ["tsd-epp", "asd-sdit-epp", "fttc-epp"]) {
      const other = parseFormDocument(TEMPLATE_SEEDS.find((e) => e.key === key)!.document);
      expect(other.blocks.some((block) => block.kind === "expectation_checklist"), key).toBe(
        false,
      );
      expect(other.blocks.some((block) => block.kind === "draft_details"), key).toBe(false);
    }
  });
});

/* =================================================================== PDF == */

describe("the printed PDF", () => {
  it("prints the whole form, the appendix and nothing from the editor", async () => {
    const { text, totalPages } = await readBack(renderFormPdf(document, variant, FILLED, META));

    expect(totalPages).toBeGreaterThanOrEqual(3);

    for (const printed of [
      "Employee Performance Plan - SDIT",
      "Employee Information",
      "To be filled out by Training Salon Director",
      "Mark areas of success",
      "Mark areas needing improvement",
      "Overall top three strengths",
      "Salon's current productivity",
      "PPTA",
      "LPSVA",
      "UPTA",
      "To be filled out by the SDIT",
      "Plan of Action",
      "Follow-up",
      "Acknowledgement",
      "Re-Evaluation",
      "Employee Signature",
      "Supervisor Signature",
      "Ask Sunny Draft Details",
    ]) {
      expect(text, printed).toContain(printed);
    }

    // Editor furniture never reaches the page.
    for (const chip of ["AI FILLS", "FILLED BY HAND", "MANAGER", "EMPLOYEE"]) {
      expect(text, chip).not.toContain(chip);
    }
  });

  it("says the appendix is not part of the official form", async () => {
    const { text } = await readBack(renderFormPdf(document, variant, FILLED, META));
    expect(text).toContain("not part of the official form pages above");
    expect(text).toContain("JBA Policy Manual - Attendance - Page 14");
  });

  it("prints an unmarked expectation as unmarked, not as absent", async () => {
    /*
     * "I'll complete those later" has to survive onto the paper. An
     * expectation nobody marked prints with both boxes empty — the document
     * saying it was not evaluated — rather than vanishing from the list.
     */
    const { text } = await readBack(
      renderFormPdf(document, variant, { values: {}, checked: {} }, META),
    );
    for (const expectation of SDIT_EPP_EXPECTATIONS) {
      // The labels wrap, so the opening clause is what is asserted.
      expect(text, expectation.key).toContain(expectation.label.split(" ").slice(0, 4).join(" "));
    }
  });

  it("leaves both signature blocks blank, because they are signed on paper", async () => {
    /*
     * A SIGNATURE HAS NO KEY, so there is nothing to write into — which is a
     * claim about the whole path rather than about one renderer. The test is
     * a DIFFERENCE: a value addressed to a signature changes the printed
     * document not at all.
     */
    const blank = await readBack(renderFormPdf(document, variant, FILLED, META));
    const attempted = await readBack(
      renderFormPdf(
        document,
        variant,
        {
          values: {
            ...FILLED.values,
            employee_signature: "SIGNED BY ASK SUNNY",
            supervisor_signature: "SIGNED BY ASK SUNNY",
          },
          checked: FILLED.checked,
        },
        META,
      ),
    );

    expect(attempted.text).toBe(blank.text);
    expect(attempted.text).not.toContain("SIGNED BY ASK SUNNY");
    expect((attempted.text.match(/Employee Signature/g) ?? []).length).toBe(2);
    expect((attempted.text.match(/Supervisor Signature/g) ?? []).length).toBe(2);
  });
});

/* ========================================== nothing else in the library moved */

describe("the rest of the library is where it was", () => {
  it("adds the SDIT EPP to chat and leaves the inline set otherwise alone", () => {
    const inline = TEMPLATE_SEEDS.filter((entry) =>
      supportsInlineDraft(entry.key, entry.variants),
    ).map((entry) => entry.key);

    expect(inline.sort()).toEqual([
      "coaching",
      "dpoa",
      "follow-up-coaching",
      "policy-review",
      "sdit-epp",
    ]);
  });

  it("still refuses a document printed as two readings", () => {
    /*
     * The structural half of the rule, on the real seeds. The DMIT plans are
     * one document read two ways, so which review is being written is a
     * question nothing in chat asks — and until something does, they are
     * refused whatever any list says.
     */
    for (const key of ["dmit-epp-tsd", "dmit-epp-dmit"]) {
      const dmit = TEMPLATE_SEEDS.find((entry) => entry.key === key)!;
      expect(dmit.variants.length, key).toBeGreaterThan(1);
      expect(variantsAllowInline(dmit.variants), key).toBe(false);
      expect(supportsInlineDraft(key, dmit.variants), key).toBe(false);
    }
  });

  it("moves no revision but the SDIT EPP's among the performance plans", () => {
    const plans = TEMPLATE_SEEDS.filter((entry) => entry.requiredPermission === "create_epp");
    expect(plans.length).toBe(6);
    for (const plan of plans) {
      expect(plan.revision, plan.key).toBe(plan.key === "sdit-epp" ? 3 : 1);
    }
  });

  it("keeps the official manual pinned to the JB & Associates document", () => {
    expect(OFFICIAL_POLICY_MANUAL.fallbackFilenames).toEqual(["JBA-Policy-Manual"]);
    expect(OFFICIAL_POLICY_MANUAL.fallbackTitles).toEqual(["JBA Policy Manual"]);
  });
});

/* ================================================================ source == */

describe("the policy this form names is the JB & Associates manual", () => {
  it("states the company-policy expectation against the manual Ask Sunny can read", () => {
    expect(SDIT_EPP_EXPECTATIONS[2]!.label).toBe(JBA_POLICY_EXPECTATION);
    expect(JBA_POLICY_EXPECTATION).toContain("JB & Associates Employment Policy Manual");
    expect(JBA_POLICY_EXPECTATION).toContain("Sun Tan City");
  });

  it("names the legacy manual nowhere in any shipped code path", () => {
    /*
     * ======================================================================
     * THE LEGACY MANUAL IS NOT A SOURCE, AND NOT A STRING EITHER
     * ======================================================================
     *
     * Ask Sunny cannot read it: it is not in the corpus, so a reference to it
     * would be a citation of a document nobody checked. The paper SDIT EPP
     * names it in one expectation; this build states that expectation against
     * the JBA manual instead.
     *
     * COMMENTS ARE STRIPPED BEFORE THE SCAN. Two modules explain, in prose,
     * what the old manual was and why the citation engine no longer looks for
     * it — that history is worth keeping and is not a code path. What must not
     * exist is a matcher, an identity, a heading, a prompt line or a template
     * label that names it.
     */
    const roots = ["src/lib/forms", "src/lib/ai", "src/lib/knowledge", "src/app/api/forms"];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;

        const code = readFileSync(path, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/^\s*\/\/.*$/gm, " ");
        if (/driven[\s-]*to[\s-]*shine/i.test(code)) offenders.push(path);
      }
    };
    for (const root of roots) walk(root);

    expect(offenders).toEqual([]);
  });

  it("names it nowhere in the seeded template library either", () => {
    expect(JSON.stringify(TEMPLATE_SEEDS).toLowerCase()).not.toContain("driven to shine");
  });
});
