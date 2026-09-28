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

      const named = await proposals.proposeFormForTurn(
        turn("create an STC exit for Sarah Jones", { role }),
      );
      expect(named!.formProposal).toBeUndefined();
      expect(named!.content).toMatch(/cannot create a \*\*Resignation\/Exit Form\*\*/);
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
    expect(response!.content).toMatch(/payroll deduction, bonus forfeiture, minimum wage/);
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

  it("lists what it filled, what it left, and asks nothing when the facts are there", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn(
        "Create an STC exit for sarah jones, she's a TC. She gave her two weeks notice on 9/1, worked her full two weeks, and her last day was 9/15.",
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
    expect(content).toMatch(/\*\*Left blank for you to review:\*\* Location, Permanent Address, Date that notice was fulfilled/);
    expect(content).toMatch(/store items returned, payroll deduction, bonus forfeiture, minimum wage, written notice attached and rehire eligibility/);
    expect(content).toMatch(/all three signature lines/);
    expect(content).not.toMatch(/\?\n/); // no question asked
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

  it("does not tick an involuntary separation, and says why", async () => {
    const proposals = await load([exitForm()]);
    const response = await proposals.proposeFormForTurn(
      turn("termination paperwork for Dan Smith, we let him go yesterday; yesterday was his last day"),
    );
    const content = response!.content;
    expect(content).toMatch(/Last Day Worked:\*\* September 27, 2026/);
    expect(content).toMatch(/I haven't ticked \*\*Immediate involuntary separation\*\*/);
    expect(content).not.toMatch(/Resignation Details:\*\*/);
    expect(content).not.toMatch(/How did they leave/);
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
