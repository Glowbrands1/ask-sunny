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
  // The Resignation/Exit Form is main's `stc-exit`, on its own permission.
  summary("stc-exit", "Resignation/Exit Form", "create_exit_form", 15),
  summary("demotion", "Demotion Form", "create_employment_change_form", 16),
  summary("position-transfer", "Position Transfer Form", "create_employment_change_form", 17),
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

describe("the exit form is the one Resignation/Exit Form", () => {
  it("proposes stc-exit, not an employment change form", async () => {
    const response = await ask("I need an exit form for JOHN SMITH");
    expect(response!.formProposal!.templateKey).toBe("stc-exit");
    expect(response!.formProposal!.employeeName).toBe("JOHN SMITH");
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
    expect(response!.content).not.toContain("not published");
  });
});

describe("found in hands-on QA: the chat copy", () => {
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

describe("found in production QA (Codex): the exact live conversations", () => {
  const DEMOTION_1 =
    "Create a Demotion Form for a synthetic test employee named Demo Alpha Test at salon 12. Their current position is District Manager and the new position is Salon Director, effective October 5, 2026. The reason is a mock role realignment for QA.";
  const DEMOTION_2 =
    "The employee is Demo Alpha Test. Salon 12 is the location. District Manager is the current position, Salon Director is the new position, and QA is just the reason/context.";
  const TRANSFER_1 =
    "Create a Position Transfer Form for synthetic test employee Transfer Beta Test. She is currently a Salon Manager at salon 18 and will move to salon 23 as a Salon Manager effective October 12, 2026. The reason is a mock staffing coverage change for QA.";
  const sunny = (id: string, content: string): ChatMessage => ({
    id,
    role: "assistant",
    content,
    createdAt: "2026-09-28T12:00:01Z",
  });

  it("takes Demo Alpha Test from the first message, with the salon, and asks nobody to choose", async () => {
    const response = await ask(DEMOTION_1);
    expect(response!.formProposal!.templateKey).toBe("demotion");
    expect(response!.formProposal!.employeeName).toBe("Demo Alpha Test");
    expect(response!.content).not.toContain("Which of them");
    expect(response!.content).toContain("District Manager at Salon 12 → Salon Director, effective October 5, 2026");
  });

  it("keeps Demo Alpha Test through the clarification reply, and does not ask again", async () => {
    const history = [
      manager("m1", DEMOTION_1),
      sunny(
        "a1",
        "I have the demotion details so far (District Manager → Salon Director, effective October 5, 2026). Which of them is this **Demotion Form** for — **Demo Alpha Test**, **District Manager** or **QA**?",
      ),
    ];
    const reply = await ask(DEMOTION_2, { history, continueTemplateKey: "demotion" });
    expect(reply!.formProposal!.employeeName).toBe("Demo Alpha Test");
    expect(reply!.content).not.toContain("Which of them");

    const last = await ask("Demo Alpha Test.", {
      history: [...history, manager("m2", DEMOTION_2), sunny("a2", reply!.content)],
      continueTemplateKey: "demotion",
    });
    expect(last!.formProposal!.employeeName).toBe("Demo Alpha Test");
    expect(last!.content).not.toContain("Which of them");
  });

  it("keeps 'Transfer' in Transfer Beta Test's name", async () => {
    const response = await ask(TRANSFER_1);
    expect(response!.formProposal!.templateKey).toBe("position-transfer");
    expect(response!.formProposal!.employeeName).toBe("Transfer Beta Test");
    expect(response!.content).not.toContain("Which of them");

    const answered = await ask("Transfer Beta Test.", {
      history: [manager("m1", TRANSFER_1), sunny("a1", response!.content)],
      continueTemplateKey: "position-transfer",
    });
    expect(answered!.formProposal!.employeeName).toBe("Transfer Beta Test");
  });
});
