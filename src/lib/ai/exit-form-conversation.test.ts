import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectTemplateIntent, formRequestPhrase } from "@/lib/forms/template-intent";
import { extractEmployeeNames } from "@/lib/forms/proposal";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE RESIGNATION/EXIT FORM, FROM A CONVERSATION
 * ============================================================================
 *
 * Asking for it by any of its names, the chat picker, who may be offered it,
 * reading the employee in any case, and the reply that says what was filled,
 * what was left, and what is still needed. Nothing here writes — the proposal
 * layer is handed the library and never reaches for a repository.
 */

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] };

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-coaching-id",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "The everyday documented coaching conversation.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

const exitForm = (overrides: Record<string, unknown> = {}) =>
  template({
    id: "tpl-exit-id",
    key: "stc-exit",
    name: "Resignation/Exit Form",
    shortName: "Exit Form",
    description: "The STC exit paperwork for an employee who is leaving.",
    category: "separation",
    layoutFamily: "exit",
    requiredPermission: "create_exit_form",
    displayOrder: 15,
    ...overrides,
  });

let library: Record<string, unknown>[] = [];

async function load(summaries: Record<string, unknown>[]) {
  vi.resetModules();
  library = summaries;
  vi.doMock("@/lib/forms/repository", () => ({
    listTemplateSummaries: async () => {
      throw new Error("form-proposal must take the library from its caller");
    },
    getTemplateByKey: async () => {
      throw new Error("form-proposal must not read or write the library");
    },
  }));
  return import("./form-proposal");
}

function turn(
  question: string,
  options: { role?: string | null; scope?: AccessScope | null; history?: ChatMessage[] } = {},
) {
  return {
    history: options.history ?? [],
    question,
    questionMessageId: "msg-current",
    actor: {
      role: (options.role === undefined ? "salon_director" : options.role) as never,
      scope: options.scope === undefined ? SALON : options.scope,
    },
    summaries: library as never,
    // A Monday: "yesterday" is Sunday the 27th, "last Friday" the 25th.
    today: "2026-09-28",
  };
}

const said = (id: string, content: string): ChatMessage => ({
  id,
  role: "user",
  content,
  createdAt: "2026-09-28T15:00:00Z",
});

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.doUnmock("@/lib/forms/repository");
  vi.resetModules();
});

/* ======================================================== recognition == */

describe("asking for it by any of its names", () => {
  it.each([
    "pull up the exit form",
    "Pull up the Exit Form",
    "create an STC exit for Sarah Jones",
    "I need the STC Exit form",
    "resignation paperwork for Maria",
    "where's the termination/exit form",
    "termination paperwork please",
    "I need a termination form for Dan",
    "Create a Resignation/Exit Form from this conversation.",
    "she quit, can you start the separation paperwork",
    "offboarding form for jess",
  ])("%s -> the exit form", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: "stc-exit" });
  });

  it("round-trips the picker card's own sentence", () => {
    expect(detectTemplateIntent(formRequestPhrase("Resignation/Exit Form"))).toEqual({
      kind: "explicit",
      templateKey: "stc-exit",
    });
  });

  it.each([
    "What's the termination policy?",
    "Should Sarah be terminated?",
    "Explain the termination process.",
    "What is the termination checklist?",
    "do you have an exit interview document?",
    "where is the fire exit",
    "she exited the building",
  ])("%s -> not the exit form", (question) => {
    const intent = detectTemplateIntent(question);
    expect(intent.kind === "explicit" && intent.templateKey === "stc-exit").toBe(false);
  });
});

describe("the employee, in any case and by first name", () => {
  it.each([
    ["create an STC exit for sarah jones", "sarah jones"],
    ["CREATE AN STC EXIT FOR SARAH JONES", "SARAH JONES"],
    ["Create an STC exit for Sarah Jones. She walked out mid-shift.", "Sarah Jones"],
    ["exit form for paulyne because she quit", "paulyne"],
    ["resignation paperwork for (Maria)", "Maria"],
    ["Sarah Jones was a No Call No Show on Saturday", "Sarah Jones"],
    ["Immediate Voluntary Resignation for Dan Smith", "Dan Smith"],
  ])("%s -> %s", (text, name) => {
    expect(extractEmployeeNames(text)).toEqual([name]);
  });
});

/* ========================================================== the picker == */

describe("the chat form picker and permissions", () => {
  it("is offered to a Salon Director asking for a form, behind See more forms", async () => {
    const proposals = await load([template(), exitForm()]);
    const response = await proposals.proposeFormForTurn(turn("I need a form"));
    expect(response!.formSelection!.primary.templateKey).toBe("coaching");
    expect(response!.formSelection!.additional.map((entry) => entry.templateName)).toEqual([
      "Resignation/Exit Form",
    ]);
  });

  it.each(["salon_director", "district_manager", "regional_manager", "admin", "owner", "developer"])(
    "is in the Which form do you need? picker for %s, who may create it",
    async (role) => {
      const proposals = await load([template(), exitForm()]);
      const response = await proposals.proposeFormForTurn(
        turn("I need a form", { role, scope: null }),
      );
      expect(response!.content).toBe("Which form do you need?");
      const keys = [response!.formSelection!.primary, ...response!.formSelection!.additional].map(
        (entry) => entry.templateKey,
      );
      expect(keys, role).toContain("stc-exit");
    },
  );

  it("is not withheld from the chooser", async () => {
    const { offeredInChooser } = await import("@/lib/forms/chooser");
    expect(offeredInChooser("stc-exit")).toBe(true);
  });

  it.each(["assistant_salon_director", "employee"])(
    "is never offered to or proposed for %s",
    async (role) => {
      const proposals = await load([template(), exitForm()]);
      const picker = await proposals.proposeFormForTurn(turn("I need a form", { role }));
      const names = picker?.formSelection
        ? [picker.formSelection.primary, ...picker.formSelection.additional].map(
            (entry) => entry.templateKey,
          )
        : [];
      expect(names).not.toContain("stc-exit");

      for (const alias of [
        "create an STC exit for Sarah Jones",
        "resignation paperwork for Sarah Jones",
        "termination/exit form for Sarah",
        "Create a Resignation/Exit Form from this conversation.",
        "offboarding form for Sarah Jones",
      ]) {
        const named = await proposals.proposeFormForTurn(turn(alias, { role }));
        expect(named!.formProposal, alias).toBeUndefined();
        expect(named!.formSelection, alias).toBeUndefined();
        expect(named!.content, alias).toMatch(/cannot create a \*\*Resignation\/Exit Form\*\*/);
      }
    },
  );

  it.each(["salon_director", "district_manager", "regional_manager", "admin", "owner"])(
    "is proposed for %s",
    async (role) => {
      const proposals = await load([exitForm()]);
      const response = await proposals.proposeFormForTurn(
        turn("create an STC exit for Sarah Jones", { role, scope: null }),
      );
      expect(response!.formProposal!.templateKey).toBe("stc-exit");
    },
  );

  it("says so, and stands in nothing else, when the library does not publish it", async () => {
    const proposals = await load([template()]);
    const response = await proposals.proposeFormForTurn(turn("pull up the exit form"));
    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/not published in Ask Sunny yet/);
  });
});

/* ============================================================ the reply == */

describe("what Ask Sunny says beside the proposal", () => {
  it("asks the short intake when only the form was named", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(turn("pull up the exit form"));
    expect(response!.formProposal!.status).toBe("needs_employee");
    expect(response!.content).toMatch(/1\. The employee's full name\./);
    expect(response!.content).toMatch(/last day worked/);
    expect(response!.content).toMatch(/how they told you \(in person, phone call, text message or email\)/);
    expect(response!.content).toMatch(/The date they resigned/);
    expect(response!.content).toMatch(/The reason they gave for leaving/);
    expect(response!.content).toMatch(
      /store items and salon key were returned, whether payroll deduction applies, whether they'll be dropped to minimum wage and forfeit their bonus, and whether they're eligible for rehire/,
    );
    expect(response!.content).toMatch(/I won't answer it for you/);
    expect(response!.content).toMatch(/signature lines stay blank/);
  });

  it("asks only who, when the departure was described without a name", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form please, she walked out yesterday"),
    );
    expect(response!.content).toBe(
      "Who is this **Resignation/Exit Form** for? Give me their name and I'll fill in what you've already described.",
    );
  });

  it("names both candidates when two people were named", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form. Sarah Jones and Maria Lopez both quit on the spot."),
    );
    expect(response!.content).toMatch(/\*\*Sarah Jones\*\* or \*\*Maria Lopez\*\*/);
  });

  it("lists what it filled, what it left, and asks only HR's lines nobody answered", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn(
        "Create an STC exit for sarah jones, she's a TC. She gave her two weeks notice on 9/1, worked her full two weeks, and her last day was 9/15.",
      ),
    );
    const content = response!.content;
    expect(content).toMatch(/- \*\*Last Day Worked:\*\* September 15, 2026/);
    // Handing in notice is resigning: the notice date is the resignation date.
    expect(content).toMatch(/- \*\*Resignation Date:\*\* September 1, 2026/);
    expect(content).toMatch(/\*\*Left blank for you to review:\*\* Location, Permanent Address, Date that notice was fulfilled, written notice attached and all three signature lines\./);
    expect(content).toMatch(/Before you create it:/);
    for (const question of [
      /- How did they let you know — in person, phone call, text message, email, or no call\/no show\?/,
      /- What reason did they give for leaving\? \(If they didn't give one, just say so\.\)/,
      /- Were their store items and salon key returned\?/,
      /- Is payroll deduction applicable\?/,
      /- Will they be dropped to minimum wage and forfeit their bonus\?/,
      /- Are they eligible for rehire\?/,
    ]) {
      expect(content).toMatch(question);
    }
    // What was said is not asked again.
    expect(content).not.toMatch(/What was their last day worked|How did they leave|What date did they resign/);
    expect(content).toMatch(/or create the draft now and fill those in on the form\./);
  });

  it("lists what it filled, what it left, and asks nothing when everything is there", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn(
        "Create an STC exit for sarah jones, she's a TC. She gave her two weeks notice on 9/1 by email, worked her full two weeks, and her last day was 9/15. She left for another job. She returned her store items and her key. No payroll deduction. She won't be dropped to minimum wage or forfeit her bonus. She is eligible for rehire.",
      ),
    );
    const proposal = response!.formProposal!;
    expect(proposal.employeeName).toBe("sarah jones");
    expect(proposal.employeeRole).toBe("Tanning Consultant");
    // The form is dated the day it is completed, never the first date in the chat.
    expect(proposal.formDate).toBeNull();
    expect(proposal.supportsInlineDraft).toBe(true);

    const content = response!.content;
    expect(content).toMatch(/- \*\*Name:\*\* sarah jones/);
    expect(content).toMatch(/- \*\*Job Title:\*\* Tanning Consultant/);
    expect(content).toMatch(/- \*\*Last Day Worked:\*\* September 15, 2026/);
    expect(content).toMatch(/- \*\*Date that notice was given:\*\* September 1, 2026/);
    expect(content).toMatch(/- \*\*Resignation Details:\*\* Submitted & Fulfilled Notice/);
    expect(content).toMatch(/- \*\*Resignation Date:\*\* September 1, 2026/);
    expect(content).toMatch(/- \*\*How Employee Resigned:\*\* Email/);
    expect(content).toMatch(/- \*\*Reason for Resignation:\*\* Another job\./);
    expect(content).toMatch(/- \*\*Store Items Returned:\*\* Store items were returned\./);
    expect(content).toMatch(/- \*\*Salon Key Returned:\*\* Salon key was returned\./);
    expect(content).toMatch(/- \*\*Payroll Deduction:\*\* Payroll deduction is not applicable\./);
    expect(content).toMatch(/- \*\*Minimum Wage \/ Bonus Forfeiture:\*\* Employee will not be dropped to minimum wage and will not forfeit bonus\./);
    expect(content).toMatch(/- \*\*Eligible for Rehire:\*\* Employee is eligible for rehire\./);
    expect(content).toMatch(/\*\*Left blank for you to review:\*\* Location, Permanent Address, Date that notice was fulfilled, written notice attached and all three signature lines\./);
    expect(content).not.toMatch(/\?\n/); // no question asked
    expect(content).not.toMatch(/Before you create it/);
    expect(content).toMatch(/doesn't sign anything, remove anyone from MyGlow, change payroll/);
  });

  it("reads the facts across the manager's turns, and never from Sunny's", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("create an STC exit for her", {
        history: [
          said("m1", "Dan Smith quit on the spot last Friday."),
          { id: "a1", role: "assistant", content: "Her last day was 9/1.", createdAt: "2026-09-28T15:00:01Z" },
        ],
      }),
    );
    const content = response!.content;
    expect(response!.formProposal!.employeeName).toBe("Dan Smith");
    expect(content).toMatch(/Immediate Voluntary Resignation/);
    expect(content).not.toMatch(/September 1, 2026/);
    // "quit ... last Friday" says when he quit, not which day he last worked.
    expect(content).toMatch(/What was their last day worked\?/);
  });

  it("asks for the last day and how they left when neither was said", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(turn("create an STC exit for Sarah Jones"));
    expect(response!.content).toMatch(/Before you create it:/);
    expect(response!.content).toMatch(/- What was their last day worked\?/);
    expect(response!.content).toMatch(/- How did they leave/);
    expect(response!.content).toMatch(/or create the draft now and fill those in on the form\./);
    // Still creatable: a question is not a gate.
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
  });

  it("takes the answer to its own question, and still answers an unrelated one", async () => {
    const proposals = await load([exitForm()]);
    const history: ChatMessage[] = [
      said("m1", "create an STC exit for Sarah Jones"),
      {
        id: "a1",
        role: "assistant",
        content: "Before you create it: What was their last day worked?",
        createdAt: "2026-09-28T15:00:01Z",
        formProposal: { templateKey: "stc-exit" } as never,
      },
    ];
    const answered = await proposals.proposeFormForTurn({
      ...turn("her last day was 9/15 and she quit on the spot", { history }),
      continueTemplateKey: "stc-exit",
    });
    expect(answered!.formProposal!.employeeName).toBe("Sarah Jones");
    expect(answered!.content).toMatch(/Last Day Worked:\*\* September 15, 2026/);
    expect(answered!.content).toMatch(/Immediate Voluntary Resignation/);
    expect(answered!.content).not.toMatch(/What was their last day worked/);

    const unrelated = await proposals.proposeFormForTurn({
      ...turn("what is the tardiness policy?", { history }),
      continueTemplateKey: "stc-exit",
    });
    expect(unrelated).toBeNull();
  });

  it("asks which date a bare weekday means", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Sarah Jones, she resigned effective immediately, her last day was Friday"),
    );
    expect(response!.content).toMatch(/Which date is "Friday" for \*\*Last Day Worked\*\*\?/);
    expect(response!.content).not.toMatch(/What was their last day worked/);
  });

  it("asks which separation applies when it was described two ways", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Sarah Jones. She worked out her notice, last day 9/15. She didn't fulfill her notice."),
    );
    expect(response!.content).toMatch(/You described this as both \*\*Submitted & Fulfilled Notice\*\* and \*\*Did not fulfill/);
    expect(response!.content).not.toMatch(/Resignation Details:\*\*/);
  });

  it("ticks an involuntary separation the manager says already happened, and lists it as filled", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("termination paperwork for Dan Smith, we let him go yesterday; yesterday was his last day"),
    );
    const content = response!.content;
    expect(content).toMatch(/Last Day Worked:\*\* September 27, 2026/);
    expect(content).toMatch(/- \*\*Resignation Details:\*\* Immediate involuntary separation/);
    expect(content).not.toMatch(/How did they leave/);
  });

  it.each([
    "Should we terminate Dan Smith? Pull up the exit form for him.",
    "We may fire Dan Smith. Termination form for Dan Smith.",
    "Create termination paperwork for Dan Smith.",
    "Termination form for Dan Smith",
  ])("does not tick it from intent or the form's name: %s", async (question) => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(turn(question));
    expect(response!.formProposal!.templateKey).toBe("stc-exit");
    expect(response!.content).not.toMatch(/Immediate involuntary separation/);
    // Nothing about how he left was established, so Sunny asks.
    expect(response!.content).toMatch(/How did they leave/);
  });

  it("never says anything is signed, or that a termination step was done", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Sarah Jones, she walked out, last day 9/15"),
    );
    expect(response!.content).not.toMatch(/\bsigned\b/i);
    expect(response!.content).not.toMatch(/removed from MyGlow|payroll (?:was|has been) updated/i);
  });
});

/* ================================================= the QA checklist == */

const MULTI: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0310",
  alsoCoversAreaIds: ["loc-0311", "loc-0309"],
};
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as never;

describe("QA 1 — natural-language retrieval", () => {
  it.each([
    ["pull up the exit form", null],
    ["create an STC exit for jane smith", "jane smith"],
    ["resignation paperwork for JANE SMITH", "JANE SMITH"],
    ["termination/exit form for Jane", "Jane"],
    ["I need the exit paperwork for Jane Smith", "Jane Smith"],
    ["start the separation form for Jane Smith", "Jane Smith"],
    ["Offboarding paperwork for Jane Smith", "Jane Smith"],
  ])("%s -> the exit form proposal", async (question, employee) => {
    const proposals = await load([template(), exitForm()]);
    const response = await proposals.proposeFormForTurn(turn(question));
    expect(response!.formProposal!.templateKey).toBe("stc-exit");
    expect(response!.formProposal!.employeeName).toBe(employee);
  });
});

describe("QA 2 — the employee", () => {
  it("normal mixed case", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(turn("create an STC exit for Jane Smith"));
    expect(response!.formProposal!.employeeName).toBe("Jane Smith");
  });

  it("completes an unambiguous first name from the manager's earlier turn", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("termination/exit form for jane", {
        history: [said("m1", "Jane Smith walked out mid-shift yesterday.")],
      }),
    );
    expect(response!.formProposal!.employeeName).toBe("Jane Smith");
    expect(response!.formProposal!.status).toBe("ready");
  });

  it("asks which one when a first name matches two people, and guesses neither", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("termination/exit form for Jane", {
        history: [said("m1", "Jane Smith and Jane Doe both quit on the spot today.")],
      }),
    );
    expect(response!.formProposal!.employeeName).toBeNull();
    expect(response!.formProposal!.status).toBe("needs_employee");
    expect(response!.formProposal!.supportsInlineDraft).toBe(false);
    expect(response!.content).toMatch(/\*\*Jane Smith\*\* or \*\*Jane Doe\*\*/);
  });
});

describe("QA 3 — location, title and dates", () => {
  it("a single assigned salon fills the Location from the roster", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Jane Smith, last day 9/15", {
        scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] },
      }),
    );
    expect(response!.formProposal!.locationId).toBe("loc-0309");
    expect(response!.content).toMatch(/- \*\*Location:\*\* NE Kearney/);
  });

  it.each([
    ["she worked at lincoln o street", "loc-0311", "NE Lincoln O Street"],
    ["she was at the Lincoln 27th Street salon", "loc-0310", "NE Lincoln 27th Street"],
    ["from NE KEARNEY", "loc-0309", "NE Kearney"],
  ])("a manager with several salons names one, in any case: %s", async (where, id, name) => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn(`exit form for Jane Smith, ${where}, last day 9/15`, { scope: MULTI }),
    );
    expect(response!.formProposal!.locationId).toBe(id);
    expect(response!.formProposal!.status).toBe("ready");
    expect(response!.content).toContain(`- **Location:** ${name}`);
  });

  it("a salon the manager is not assigned to is never proposed", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Jane Smith, she worked at KS Lawrence, last day 9/15", { scope: MULTI }),
    );
    expect(response!.formProposal!.locationId).toBeNull();
    expect(response!.formProposal!.status).toBe("needs_location");
    // The salon they named is said back, and only their own are offered.
    expect(response!.content).toMatch(/\*\*KS Lawrence\*\* isn't a salon on your/);
    expect(response!.formProposal!.authorizedLocationIds.sort()).toEqual(["loc-0309", "loc-0310", "loc-0311"]);
  });

  it("two assigned salons named is still a question", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Jane Smith, she split shifts at NE Kearney and NE Lincoln O Street", {
        scope: MULTI,
      }),
    );
    expect(response!.formProposal!.locationId).toBeNull();
  });

  it("a person called Lawrence is not the Lawrence salon", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Lawrence Smith, he quit on the spot", { scope: GLOBAL }),
    );
    expect(response!.formProposal!.employeeName).toBe("Lawrence Smith");
    expect(response!.formProposal!.locationId).toBeNull();
    expect(response!.formProposal!.locationResolution).toBe("not_applicable");
  });

  it("an owner who names a roster salon gets it", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Jane Smith at MO St Joseph", { role: "owner", scope: GLOBAL }),
    );
    expect(response!.formProposal!.locationId).toBe("loc-0495");
  });

  it("job titles through the existing reader", async () => {
    const proposals = await load([exitForm()]);
    for (const [said, title] of [
      ["she's an ASD", "ASD"],
      ["he is a salon director", "Salon Director"],
      ["she's a tanning consultant", "Tanning Consultant"],
    ]) {
      const response = await proposals.proposeFormForTurn(turn(`exit form for Jane Smith, ${said}`));
      expect(response!.formProposal!.employeeRole, said).toBe(title);
    }
  });

  it.each([
    ["her last day is today", "September 28, 2026"],
    ["her last day was today's date", "September 28, 2026"],
    ["last day worked was todays date", "September 28, 2026"],
    ["her last day was last Friday", "September 25, 2026"],
    ["her last day was Sept 30", "September 30, 2026"],
    ["her last day was 9/30", "September 30, 2026"],
    ["her last day was 09/30/2026", "September 30, 2026"],
  ])("%s", async (said, words) => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(turn(`exit form for Jane Smith, ${said}`));
    expect(response!.content).toContain(`- **Last Day Worked:** ${words}`);
    // The form's own Date is the day it is completed, whatever dates the chat holds.
    expect(response!.formProposal!.formDate).toBeNull();
  });
});

describe("QA 4 — what the manager said is filled; nothing else is inferred", () => {
  /*
   * HR (28 Sep 2026) wants the Details section to state these answers, so the
   * ones the manager SPOKE are prefilled — in the form's own sentences — and
   * the rest are asked. What is still never inferred: an answer nobody gave,
   * written notice, and a signature.
   */
  it("fills each answer the manager spoke aloud, and nothing they did not", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn(
        "exit form for Jane Smith. She quit on the spot 9/20. She returned her keys, she is not eligible for rehire, payroll should deduct her uniform, she forfeits her bonus, drop her to minimum wage, and her written notice is attached. She signed it.",
      ),
    );
    const content = response!.content;
    const filled = content.slice(0, content.indexOf("**Left blank"));
    expect(filled).toMatch(/- \*\*Resignation Date:\*\* September 20, 2026/);
    expect(filled).toMatch(/- \*\*Salon Key Returned:\*\* Salon key was returned\./);
    expect(filled).toMatch(/- \*\*Payroll Deduction:\*\* Payroll deduction is applicable\./);
    expect(filled).toMatch(/- \*\*Minimum Wage \/ Bonus Forfeiture:\*\* Employee will be dropped to minimum wage and forfeit bonus\./);
    expect(filled).toMatch(/- \*\*Eligible for Rehire:\*\* Employee is not eligible for rehire\./);
    // Nobody said anything about store items: not filled, asked.
    expect(filled).not.toMatch(/Store Items Returned/);
    expect(content).toMatch(/- Were their store items returned\?/);
    // Written notice and signatures are never read from chat.
    expect(filled).not.toMatch(/written notice|\bsign/i);
    expect(content).toMatch(/Left blank for you to review:[\s\S]*written notice attached and all three signature lines/);
  });

  it("never fills an answer said both ways in one breath — it asks", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("exit form for Jane Smith. She returned the key and she didn't return the key. Last day 9/15, she quit on the spot."),
    );
    expect(response!.content).not.toMatch(/Salon Key Returned:/);
    expect(response!.content).toMatch(/You answered \*\*salon key returned\*\* both yes and no\. Which is it\?/);
  });

  it("takes a later answer as the correction it is, before the form exists", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn({
      ...turn("actually she still has the key", {
        history: [said("m1", "exit form for Jane Smith. She quit on the spot 9/20 and returned her key.")],
      }),
      continueTemplateKey: "stc-exit",
    });
    expect(response!.formProposal!.employeeName).toBe("Jane Smith");
    expect(response!.content).toMatch(
      /- \*\*Salon Key Returned:\*\* Salon key was not returned\. Employee will be payroll deducted \$25 for the salon key\./,
    );
    expect(response!.content).not.toMatch(/Salon key was returned\./);
  });

  it("continues the open proposal with a reply that only answers HR's questions", async () => {
    const proposals = await load([exitForm()]);
    const history: ChatMessage[] = [said("m1", "create an STC exit for Sarah Jones, she quit on the spot 9/20, last day 9/19")];
    const response = await proposals.proposeFormForTurn({
      ...turn("store items yes, key no, payroll deduction: yes, min wage: no, bonus: no, rehire: yes", { history }),
      continueTemplateKey: "stc-exit",
    });
    const content = response!.content;
    expect(content).toMatch(/Store items were returned\./);
    expect(content).toMatch(/Salon key was not returned\./);
    expect(content).toMatch(/Payroll deduction is applicable\./);
    expect(content).toMatch(/Employee will not be dropped to minimum wage and will not forfeit bonus\./);
    expect(content).toMatch(/Employee is eligible for rehire\./);
    expect(content).not.toMatch(/- Are they eligible for rehire\?/);
  });

  it("does not ask how or why someone resigned when they were let go", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("termination paperwork for Dan Smith, we let him go yesterday; yesterday was his last day"),
    );
    expect(response!.content).not.toMatch(/What date did they resign|How did they let you know|What reason did they give/);
    expect(response!.content).toMatch(/- Are they eligible for rehire\?/);
  });
});

describe("QA 9 — exit, resignation and termination in ordinary conversation", () => {
  it.each([
    "the exit door alarm keeps going off",
    "customers say the exit sign by bed 4 is out",
    "how do I exit the report view?",
    "her resignation surprised the team — how do I keep morale up?",
    "is there a resignation policy?",
    "she mentioned she might resign next month",
    "how do I handle a termination conversation?",
    "what's our termination policy for no call no shows?",
    "should we terminate Sarah for this?",
    "what is the termination checklist?",
    "we had a no call no show today, what do I do?",
    "can you explain the separation between SD and ASD duties?",
    "do we do exit interviews?",
    "our lotion sales exited the quarter strong",
  ])("%s -> no form, and no exit proposal", async (question) => {
    expect(detectTemplateIntent(question).kind).not.toBe("explicit");
    const proposals = await load([template(), exitForm()]);
    const response = await proposals.proposeFormForTurn(turn(question));
    expect(response?.formProposal?.templateKey ?? null).not.toBe("stc-exit");
  });

  it("a question asked while an exit proposal is open still goes to retrieval", async () => {
    const proposals = await load([exitForm()]);
    const history: ChatMessage[] = [said("m1", "create an STC exit for Sarah Jones")];
    for (const question of [
      "how many no call no shows do we allow before it counts as quitting?",
      "what's the termination policy?",
      "is she eligible for rehire if she was fired?",
    ]) {
      const response = await proposals.proposeFormForTurn({
        ...turn(question, { history }),
        continueTemplateKey: "stc-exit",
      });
      expect(response, question).toBeNull();
    }
  });
});
