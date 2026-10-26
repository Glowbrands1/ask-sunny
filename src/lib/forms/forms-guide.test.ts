import { describe, expect, it } from "vitest";

import { buildFormsGuideAnswer, readFormsGuideQuestion, type GuideTemplate } from "./forms-guide";
import { guideAccess, seedTemplates } from "./forms-guide-answer";
import type { Role } from "@/types";

/**
 * ============================================================================
 * THE FORMS GUIDE (FORMS_GUIDE_ENABLED) — "READ THE FORMS AND THAT SHOULD BE
 * THE ANSWER"
 * ============================================================================
 *
 * The owner, 26 Oct 2026: "both sunny and bubbles should also guide managers
 * on the differences of each form, like what is a CA, what is coaching and so
 * on. Read the forms and that should be the answer."
 *
 * The openers below are managers' own words, as QA collected them (most
 * typed all lowercase; "which forms can i create here?" is the starter chip
 * managers used three times in Ask Bubbles). Each runs as typed and in
 * sentence case. The answers are built from this app's templates and role
 * matrix; the fixture-change test proves no sentence about a form is fixed
 * text.
 */

const TEMPLATES = seedTemplates();

function answer(question: string, role: Role | null, templates: readonly GuideTemplate[] = TEMPLATES) {
  const reading = readFormsGuideQuestion(question);
  if (!reading) return null;
  return buildFormsGuideAnswer<Role>({ reading, templates, access: guideAccess(role), productName: "Ask Sunny" });
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function both(wording: string): string[] {
  return [wording, sentenceCase(wording)];
}

const template = (key: string) => TEMPLATES.find((entry) => entry.key === key)!;
const CA = template("dpoa");
const COACHING = template("coaching");

describe("the managers' openers, as typed and in sentence case", () => {
  it.each([
    ...both("what is a ca?"),
    ...both("what is a ca"),
    ...both("what is dpoa"),
    ...both("what is ca"),
    ...both("whats a ca"),
    ...both("what is a c/a"),
    "What's a C/A?",
    "whats a c.a.",
  ])(
    "%s explains the Corrective Action Form from its template",
    (wording) => {
      const text = answer(wording, "salon_director");
      expect(text).not.toBeNull();
      expect(text).toContain("**Corrective Action Form**");
      expect(text).toContain(CA.description);
      expect(text).toContain("Type of Warning (Verbal Warning, Written Warning, Termination, Demotion)");
      expect(text).toContain('say "create a corrective action form for <name>" to start it.');
    },
  );

  it.each([...both("what is coaching"), "what is a cf", "what is caoching"])("%s explains the Coaching Form", (wording) => {
    const text = answer(wording, "salon_director");
    expect(text).toContain("**Coaching Form**");
    expect(text).toContain(COACHING.description);
    expect(text).not.toContain("**Corrective Action Form**");
  });

  it.each([
    ...both("difference between coaching and ca"),
    ...both("when do i use a coaching form vs a corrective action"),
    ...both("ca vs coaching"),
  ])("%s puts both forms side by side", (wording) => {
    const text = answer(wording, "salon_director")!;
    expect(text).toContain(`**Coaching Form** — ${COACHING.description}`);
    expect(text).toContain(`**Corrective Action Form** — ${CA.description}`);
  });

  it.each(both("what is an epp"))("%s lists every EPP template", (wording) => {
    const text = answer(wording, "district_manager")!;
    const epps = TEMPLATES.filter((entry) => entry.layoutFamily === "epp" || entry.layoutFamily === "dmit_epp");
    expect(epps.length).toBeGreaterThan(1);
    expect(text).toContain(`There are ${epps.length} EPP forms:`);
    for (const epp of epps) expect(text).toContain(`**${epp.name}**`);
  });

  it.each(both("what is a policy review"))("%s explains the Policy Review", (wording) => {
    const text = answer(wording, "salon_director")!;
    expect(text).toContain(`**Policy Review** — ${template("policy-review").description}`);
  });

  it.each(both("what form do i use for someone who quit"))("%s names the separation form", (wording) => {
    const exit = TEMPLATES.find((entry) => entry.category === "separation")!;
    const text = answer(wording, "salon_director")!;
    expect(text).toContain(`The form for this is the ${exit.name}.`);
    expect(text).toContain(exit.description);
  });

  it.each(both("which forms can i create here?"))("%s lists exactly the role's creatable forms", (wording) => {
    const text = answer(wording, "salon_director")!;
    const access = guideAccess("salon_director");
    const mine = TEMPLATES.filter((entry) => access.may("salon_director", entry.requiredPermission));
    expect(text).toContain(`As a Salon Director you can create these ${mine.length} forms in Ask Sunny:`);
    for (const entry of TEMPLATES) {
      if (mine.includes(entry)) expect(text).toContain(`- ${entry.name}`);
      else expect(text).not.toContain(`- ${entry.name} `);
    }
    // EPPs are District Manager and above in this app's matrix.
    expect(text).not.toContain("SDIT EPP");
  });
});

describe("the answer is the template, not fixed text", () => {
  it("changing the template's description changes the answer", () => {
    const edited = TEMPLATES.map((entry) =>
      entry.key === "dpoa" ? { ...entry, description: "Fixture wording: the second formal step." } : entry,
    );
    const before = answer("what is a ca?", "salon_director")!;
    const after = answer("what is a ca?", "salon_director", edited)!;
    expect(before).toContain(CA.description);
    expect(after).toContain("Fixture wording: the second formal step.");
    expect(after).not.toContain(CA.description);
  });

  it("changing a section heading in the published document changes what it records", () => {
    const edited = TEMPLATES.map((entry) =>
      entry.key === "dpoa" && entry.document
        ? {
            ...entry,
            document: {
              ...entry.document,
              blocks: entry.document.blocks.map((block) =>
                block.kind === "section" && block.label === "Type of Warning" ? { ...block, label: "Level of Warning" } : block,
              ),
            },
          }
        : entry,
    );
    expect(answer("what is a ca", "salon_director", edited)).toContain("Level of Warning (Verbal Warning");
  });

  it("a template with no description is described by its fields, never guessed", () => {
    const edited = TEMPLATES.map((entry) => (entry.key === "dpoa" ? { ...entry, description: "" } : entry));
    const text = answer("what is a ca", "salon_director", edited)!;
    expect(text).toContain("**Corrective Action Form**\n");
    expect(text).toContain("What its fields show: Employee Information; Type of Warning");
    expect(text).not.toContain(CA.description);
  });

  it("a form that is not published is not explained — the turn goes on as before", () => {
    const unpublished = TEMPLATES.filter((entry) => entry.key !== "policy-review");
    expect(answer("what is a policy review", "salon_director", unpublished)).toBeNull();
  });
});

describe("who can create it, per role", () => {
  it.each(["employee", "assistant_salon_director"] as const)(
    "%s is told what a Corrective Action is and that they cannot create it",
    (role) => {
      const text = answer("what is a ca?", role)!;
      expect(text).toContain(CA.description);
      expect(text).toContain("Who can create it: Salon Director, District Manager, Regional Manager, Admin, Owner.");
      expect(text).toMatch(/Your role \((Employee|Assistant Salon Director)\) can't create this one; your [A-Z][a-z]+ [A-Z][a-z]+ can\./);
      expect(text).not.toContain("to start it");
    },
  );

  it.each(["employee", "assistant_salon_director"] as const)("%s can create no forms here", (role) => {
    expect(answer("which forms can i create here?", role)).toMatch(/^Your role \([^)]+\) can't create forms in Ask Sunny\./);
  });

  it("a Salon Director is told the EPPs are District Manager and above", () => {
    const text = answer("what is an epp", "salon_director")!;
    expect(text).toContain("Who can create it: District Manager, Regional Manager, Admin, Owner.");
    expect(text).toContain("Your role (Salon Director) can't create this one; your District Manager can.");
  });

  it("a District Manager's list includes the EPPs", () => {
    const text = answer("Which forms can I create here?", "district_manager")!;
    expect(text).toContain("- SDIT EPP");
    expect(text).toContain("As a District Manager you can create these");
  });
});

describe("Could this break: sentences that merely contain 'form' or 'ca' are not read", () => {
  it.each([
    "what is the ca for california sales tax",
    "What is the CA for California sales tax?",
    "performance review",
    "what is a performance review",
    "ca for Avery Holt",
    "CA for Avery Holt",
    "create a coaching form for Avery Holt",
    "create a corrective action for Avery Holt",
    "coaching for Avery Holt",
    "should i do a coaching or corrective action",
    "what is our attendance policy",
    "what is the dress code",
    "what is a coaching form for Avery Holt",
    "show me the form",
    "what form do i use for Avery Holt",
    "ca",
    "coaching",
    // QA, 26 Oct: glossary and metric questions stay as they are.
    "what is ppta",
    "what is ach",
    "what is a district manager",
    // QA, 26 Oct: the coaching-conversation chip keeps its own path.
    "help me prepare for a coaching conversation",
    "Help me prepare for a coaching conversation",
  ])("%s", (wording) => {
    expect(answer(wording, "salon_director")).toBeNull();
  });
});
