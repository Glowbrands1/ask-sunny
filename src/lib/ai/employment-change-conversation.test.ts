import { describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/*
 * The Demotion and Position Transfer forms through the chat proposal path:
 * which form, who, what was read, what is asked, and that a reply carrying
 * only details continues the form. Invented names throughout.
 */

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("form-proposal must take the library from its caller");
  },
  getTemplateByKey: async () => {
    throw new Error("form-proposal must not read the library");
  },
}));

const { proposeFormForTurn } = await import("./form-proposal");

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0468", alsoCoversAreaIds: [] };
const TODAY = "2026-09-28";

function summary(key: string, name: string, requiredPermission: string, displayOrder: number) {
  return {
    id: `tpl-${key}`,
    key,
    name,
    shortName: name,
    description: name,
    layoutFamily: "coaching",
    category: "employment_changes",
    requiredPermission,
    active: true,
    displayOrder,
    currentVersion: { id: `v-${key}`, status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
  };
}

const LIBRARY = [
  summary("coaching", "Coaching Form", "create_coaching_form", 1),
  summary("demotion", "Demotion Form", "create_employment_change_form", 15),
  summary("position-transfer", "Position Transfer Form", "create_employment_change_form", 16),
  summary("resignation-exit", "Resignation/Exit Form", "create_employment_change_form", 17),
];

function manager(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-09-28T12:00:00Z" };
}

function ask(
  question: string,
  options: {
    history?: ChatMessage[];
    role?: string;
    continueTemplateKey?: string;
    library?: Record<string, unknown>[];
  } = {},
) {
  return proposeFormForTurn({
    history: options.history ?? [],
    question,
    questionMessageId: "msg-now",
    actor: { role: (options.role ?? "salon_director") as never, scope: SALON },
    summaries: (options.library ?? LIBRARY) as never,
    today: TODAY,
    ...(options.continueTemplateKey ? { continueTemplateKey: options.continueTemplateKey } : {}),
  });
}

describe("a demotion asked for in one sentence", () => {
  it("prefills what was said, asks for the rest in one question, and offers the form", async () => {
    const response = await ask("demote paulyne from manager to tanning consultant effective october 5");
    const proposal = response!.formProposal!;

    expect(proposal.templateKey).toBe("demotion");
    expect(proposal.employeeName).toBe("paulyne");
    // The title they are moving FROM, never the one they are moving to.
    expect(proposal.employeeRole).toBe("Manager");
    // The effective date is not the form's date.
    expect(proposal.formDate).toBeNull();
    expect(proposal.status).toBe("ready");
    expect(proposal.supportsInlineDraft).toBe(true);

    expect(response!.content).toContain("Manager → Tanning Consultant, effective October 5, 2026");
    // One sentence carries every open item.
    expect(response!.content).toContain(
      "To finish it I still need the current status (FT/PT) and pay rate, the new status (FT/PT) and pay rate, and whether it's voluntary or involuntary.",
    );
    expect(response!.content.match(/\?/g) ?? []).toHaveLength(0);
    expect(response!.content).toContain("Create the draft here");
  });

  it("asks for nothing when everything was given", async () => {
    const response = await ask(
      "Demotion form: Jane Doe, Salon Director FT at $18/hr → Tanning Consultant PT at $12/hr, effective 10/5, voluntary — she asked to step down.",
    );
    expect(response!.formProposal!.employeeName).toBe("Jane Doe");
    expect(response!.content).toContain("That covers every detail the form asks for.");
    expect(response!.content).not.toContain("still need");
  });
});

describe("the three ways of naming the employee", () => {
  it.each(["paulyne co", "PAULYNE CO", "Paulyne Co"])("%s", async (name) => {
    const response = await ask(`Create a demotion form for ${name}`);
    expect(response!.formProposal!.employeeName).toBe(name);
  });
});

describe("a bare request", () => {
  it("gets the details as one numbered list with an example, not one question at a time", async () => {
    const response = await ask("create a demotion form");
    expect(response!.formProposal!.status).toBe("needs_employee");
    expect(response!.content).toContain("Send me what you have in one message");
    expect(response!.content).toMatch(/1\. The employee's name/);
    expect(response!.content).toMatch(/5\. A short reason/);
    expect(response!.content).toContain("For example:");
  });

  it("works for the transfer form too", async () => {
    const response = await ask("make a transfer form");
    expect(response!.formProposal!.templateKey).toBe("position-transfer");
    expect(response!.content).toContain("The new location");
  });
});

describe("a transfer stated rather than requested", () => {
  it("reads the employee and both salons", async () => {
    const response = await ask("Jane is transferring from salon 12 to salon 18");
    const proposal = response!.formProposal!;
    expect(proposal.templateKey).toBe("position-transfer");
    expect(proposal.employeeName).toBe("Jane");
    expect(response!.content).toContain("Salon 12 → Salon 18");
    // New location was given, so it is not asked for again.
    expect(response!.content).not.toContain("new location");
  });
});

describe("answering the grouped question", () => {
  it("continues the open form when the reply is only details", async () => {
    const history = [manager("m1", "demote paulyne from manager to tanning consultant effective october 5")];
    const response = await ask("she was FT at $18/hr, new status PT at $12/hr, voluntary", {
      history,
      continueTemplateKey: "demotion",
    });
    expect(response!.formProposal!.templateKey).toBe("demotion");
    expect(response!.formProposal!.employeeName).toBe("paulyne");
    expect(response!.content).toContain(
      "FT Manager at $18.00/hr → PT Tanning Consultant at $12.00/hr, effective October 5, 2026, voluntary",
    );
    expect(response!.content).toContain("That covers every detail");
  });

  it("updates the proposal when a detail is corrected before the form exists", async () => {
    const history = [manager("m1", "Jane is transferring from salon 12 to salon 18")];
    const response = await ask("actually change her new location to salon 24", {
      history,
      continueTemplateKey: "position-transfer",
    });
    expect(response!.content).toContain("Salon 12 → Salon 24");
  });

  it("still lets a question asked mid-form go to the knowledge base", async () => {
    const history = [manager("m1", "create a demotion form for jane")];
    const response = await ask("what is the PTO policy for part time?", {
      history,
      continueTemplateKey: "demotion",
    });
    expect(response).toBeNull();
  });
});

describe("permissions", () => {
  it("refuses a role that may not create these forms", async () => {
    const response = await ask("Create a demotion form for jane", { role: "assistant_salon_director" });
    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toContain("Your role cannot create a **Demotion Form**");
  });

  it("offers them to a Salon Director, District Manager and administrator", async () => {
    for (const role of ["salon_director", "district_manager", "admin"]) {
      const response = await ask("Create a demotion form for jane", { role });
      expect(response!.formProposal?.templateKey, role).toBe("demotion");
    }
  });
});

describe("the exit form is published", () => {
  it("proposes it rather than saying it is unpublished", async () => {
    const response = await ask("I need an exit form for JOHN SMITH");
    expect(response!.formProposal!.templateKey).toBe("resignation-exit");
    expect(response!.formProposal!.employeeName).toBe("JOHN SMITH");
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
    expect(response!.content).not.toContain("not published");
  });
});

describe("the Resignation/Exit Form in chat", () => {
  const exit = ask;

  it.each([
    ["create an exit form for paulyne co", "paulyne co"],
    ["create an exit form for PAULYNE CO", "PAULYNE CO"],
    ["Create an Exit Form for Paulyne Co", "Paulyne Co"],
    ["resignation paperwork for john", "john"],
    ["termination form for maria", "maria"],
    ["mike quit yesterday", "mike"],
  ])("%s", async (question, name) => {
    const response = await exit(question);
    expect(response!.formProposal!.templateKey).toBe("resignation-exit");
    expect(response!.formProposal!.employeeName).toBe(name);
  });

  it("gives a bare request the numbered list", async () => {
    for (const question of ["pull up the exit form", "create a separation form"]) {
      const response = await exit(question);
      expect(response!.formProposal!.templateKey).toBe("resignation-exit");
      expect(response!.content).toContain("Send me what you have in one message");
      expect(response!.content).toContain("2. Their last day worked");
    }
  });

  it("asks for the important facts rather than assuming them", async () => {
    const response = await exit("create an exit form for Mike");
    expect(response!.formProposal!.status).toBe("ready");
    expect(response!.content).toContain(
      "To finish it I still need the last day worked, whether this was a resignation or an involuntary separation, and yes or no for store items returned, payroll deduction, forfeit bonus, drop to minimum wage, written notice attached, and eligible for rehire.",
    );
    expect(response!.content).toContain("I won't guess at any of them");
  });

  it("prefills several facts from one sentence and the form date stays today", async () => {
    const response = await exit(
      "create an exit form for john, he was a TC at STC 12, gave notice 9/10 and worked through 9/24, last day was september 24",
    );
    const proposal = response!.formProposal!;
    expect(proposal.employeeRole).toBe("Tanning Consultant");
    expect(proposal.formDate).toBeNull();
    expect(response!.content).toContain("last day September 24, 2026, notice submitted and fulfilled");
    expect(response!.content).not.toContain("last day worked,");
  });

  it("continues with a reply that is only details", async () => {
    const history = [manager("m1", "mike quit yesterday")];
    const response = await exit(
      "last day was september 25, immediate voluntary resignation, items returned, no payroll deduction, forfeit bonus no, minimum wage no, written notice attached no, not eligible for rehire",
      { history, continueTemplateKey: "resignation-exit" },
    );
    expect(response!.formProposal!.employeeName).toBe("mike");
    expect(response!.content).toContain("That covers every detail the form asks for.");
  });

  it("is refused to a role without the permission", async () => {
    const response = await exit("create an exit form for mike", { role: "assistant_salon_director" });
    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toContain("Your role cannot create a **Resignation/Exit Form**");
  });
});


describe("found in hands-on QA: the chat copy", () => {
  it("never says 'the whether' when the only open items are questions", async () => {
    const response = await ask("mike quit 9/25, salon 12, tc");
    expect(response!.content).toContain("Tanning Consultant at Salon 12, last day September 25, 2026");
    expect(response!.content).toContain("To finish it I still need whether they worked out their notice or resigned immediately and yes or no for");
    expect(response!.content).not.toMatch(/\bthe whether\b/);
  });

  it("does not read capitalised title and status abbreviations as other people", async () => {
    const response = await ask(
      "Create a demotion form for PAULYNE CO. She's a FT SD at $18/hr at STC 12 and asked to step down to a PT TC at $14/hr effective 10/5/26",
    );
    expect(response!.formProposal!.employeeName).toBe("PAULYNE CO");
    expect(response!.formProposal!.status).toBe("ready");
    expect(response!.content).toContain(
      "FT Salon Director at $18.00/hr at STC 12 → PT Tanning Consultant at $14.00/hr, effective October 5, 2026, voluntary",
    );
  });
});

describe("found in hands-on QA: facts from another employee's form never carry over", () => {
  it("reads a transfer for Jane from Jane's turn only, not from Paulyne's demotion before it", async () => {
    const history = [
      manager(
        "m1",
        "Create a demotion form for PAULYNE CO. She's a FT SD at $18/hr at STC 12 and asked to step down to a PT TC at $14/hr effective 10/5/26",
      ),
    ];
    const response = await ask(
      "pull up a transfer form for jane doe, she is a pt tc at $12/hr, transferring from stc 12 to salon 18 effective oct 5, same title, voluntary",
      { history },
    );
    const proposal = response!.formProposal!;
    expect(proposal.templateKey).toBe("position-transfer");
    expect(proposal.employeeName).toBe("jane doe");
    // Only Jane's own turn is sent to the draft, so the form cannot pick up Paulyne's $14.00/hr.
    expect(proposal.sourceMessageIds).toEqual(["msg-now"]);
    expect(response!.content).not.toContain("$14.00");
    expect(response!.content).toContain("PT Tanning Consultant at $12.00/hr at STC 12 → Salon 18, effective October 5, 2026, voluntary");
  });

  it("keeps earlier turns about the same employee", async () => {
    const history = [manager("m1", "Jane Doe is a PT TC at $12/hr")];
    const response = await ask("Jane Doe is transferring from salon 12 to salon 18", { history });
    expect(response!.formProposal!.sourceMessageIds).toEqual(["m1", "msg-now"]);
    expect(response!.content).toContain("PT Tanning Consultant at $12.00/hr at Salon 12 → Salon 18");
  });
});
