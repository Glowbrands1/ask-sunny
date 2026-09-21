import { describe, expect, it } from "vitest";

import { buildFormInventory } from "@/lib/forms/inventory";
import type { TemplateSummary } from "@/lib/forms/repository";

import { answerInventoryQuestion, buildFormInventoryBlock } from "./form-answers";

/**
 * ============================================================================
 * THE ANSWERS THAT PUT FORMS IN FRONT OF SOMEBODY
 * ============================================================================
 *
 * `form-proposal.test.ts` covers the cards. This covers the sentences: the
 * server-written lists Sunny gives when a manager asks which form to use, and
 * the block the model is handed for every other turn.
 *
 * The rule being pinned is the same one either way. The four Hiring &
 * Interview forms are withheld from what Sunny OFFERS — and they are still
 * published, still named honestly when somebody asks after one, and still on
 * Forms → Create a Form, which is what the location answer describes.
 */

function summary(overrides: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    id: `tpl-${overrides.key ?? "coaching"}`,
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "The everyday documented coaching conversation.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published" },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  } as unknown as TemplateSummary;
}

const PRESCREEN = summary({
  key: "prescreen-phone-interview",
  name: "Prescreen / Phone Interview Form",
  shortName: "Prescreen",
  description: "The prescreening call, before anyone is booked for an interview.",
  category: "hiring",
  layoutFamily: "interview",
  requiredPermission: "create_hiring_form",
  displayOrder: 10,
});

const TANNING_CONSULTANT = summary({
  key: "tanning-consultant-interview",
  name: "Tanning Consultant Interview Form",
  shortName: "TC Interview",
  description: "The in-salon interview for a Tanning Consultant.",
  category: "hiring",
  layoutFamily: "interview",
  requiredPermission: "create_hiring_form",
  displayOrder: 11,
});

const MANAGEMENT_ROUND_1 = summary({
  key: "management-interview-round-1",
  name: "First Round Management Interview Form",
  shortName: "Mgmt Round 1",
  description: "The first management interview.",
  category: "hiring",
  layoutFamily: "interview",
  requiredPermission: "create_hiring_form",
  displayOrder: 12,
});

const MANAGEMENT_ROUND_2 = summary({
  key: "management-interview-round-2",
  name: "Second Round Management Interview Form",
  shortName: "Mgmt Round 2",
  description: "The second management interview and job preview.",
  category: "hiring",
  layoutFamily: "interview",
  requiredPermission: "create_hiring_form",
  displayOrder: 13,
});

const HIRING = [PRESCREEN, TANNING_CONSULTANT, MANAGEMENT_ROUND_1, MANAGEMENT_ROUND_2];

const LIBRARY: TemplateSummary[] = [
  summary(),
  summary({
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "DPOA",
    description: "The formal corrective step after coaching.",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
  } as Partial<TemplateSummary>),
  ...HIRING,
];

const inventory = () =>
  buildFormInventory(LIBRARY, { role: "salon_director", scope: null });

describe('"which form should I use?"', () => {
  it("lists what a Salon Director can start, without the withheld four", () => {
    const answer = answerInventoryQuestion({
      question: { kind: "list" },
      inventory: inventory(),
      role: "salon_director",
      namedTemplateKey: null,
    });

    expect(answer!.content).toContain("Coaching Form");
    expect(answer!.content).toContain("Corrective Action Form");
    for (const entry of HIRING) {
      expect(answer!.content, entry.name).not.toContain(entry.name);
    }
    // The category heading goes with its forms rather than printing empty.
    expect(answer!.content).not.toContain("Hiring & Interview Forms");
  });
});

describe('"do we have a prescreen form?"', () => {
  it("still says yes, because withheld is not retired", () => {
    const answer = answerInventoryQuestion({
      question: { kind: "availability" },
      inventory: inventory(),
      role: "salon_director",
      namedTemplateKey: "prescreen-phone-interview",
    });

    expect(answer!.content).toContain("Prescreen / Phone Interview Form");
    expect(answer!.content).toMatch(/^Yes/);
  });

  it("does not offer one as a substitute for a form that does not exist", () => {
    const answer = answerInventoryQuestion({
      question: { kind: "availability" },
      inventory: inventory(),
      role: "salon_director",
      namedTemplateKey: "role-play-evaluation",
    });

    expect(answer!.content).toMatch(/no published template for that/i);
    for (const entry of HIRING) {
      expect(answer!.content, entry.name).not.toContain(entry.name);
    }
  });
});

describe('"where are the forms?"', () => {
  it("still describes both headings on Forms → Create a Form", () => {
    /*
     * The page is unchanged, so the answer about the page has to be too. This
     * names no form — it names the sections a manager will see when they get
     * there, and one of them is still Hiring & Interview.
     */
    const answer = answerInventoryQuestion({
      question: { kind: "location" },
      inventory: inventory(),
      role: "salon_director",
      namedTemplateKey: null,
    });

    expect(answer!.content).toContain("HR & Performance Forms");
    expect(answer!.content).toContain("Hiring & Interview Forms");
  });
});

describe("the FORMS LIBRARY block the model is given", () => {
  const block = () => buildFormInventoryBlock(inventory());

  it("still lists all four, because they still exist", () => {
    for (const entry of HIRING) {
      expect(block(), entry.name).toContain(entry.name);
    }
  });

  it("marks each of them NOT OFFERED, and marks nothing else", () => {
    const marked = block()
      .split("\n")
      .filter((line) => line.includes("NOT OFFERED —"))
      .join("\n");

    for (const entry of HIRING) {
      expect(marked, entry.name).toContain(entry.name);
    }
    expect(marked).not.toContain("Coaching Form");
    expect(marked).not.toContain("Corrective Action Form");
  });

  it("says what the marker means, so the rule travels with the list", () => {
    expect(block()).toMatch(/never suggest/i);
    expect(block()).toMatch(/answer honestly if the user asks about it by name/i);
  });
});
