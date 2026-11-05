import { afterEach, describe, expect, it, vi } from "vitest";

import { ASK_WHO } from "@/lib/forms/roster-only-names";
import { NO_INCIDENT_NOTE } from "@/lib/forms/corrective-action-intake";
import type { ChatFormProposal } from "@/types";

import { replyMatchesCard, withReplyMatchesCard } from "./reply-matches-card";
import type { AskResponse } from "./types";

/**
 * REPLY_MATCHES_CARD_ENABLED (port from the sibling app; QA for Pau, 5 Nov
 * 2026). Each reply below is one
 * of today's contradictions, in production's words (the replies the gate, the
 * testers and QA quoted); every person is invented.
 */

const ROSTER = ["Marnie Holloway", "Remy Calder", "Corwin Hale", "Ignatius Wexlerby"];

function card(employeeName: string | null, more: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "p1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName,
    employeeRole: null,
    formDate: null,
    locationId: "loc-0309",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: ["loc-0309"],
    status: employeeName ? "ready" : "needs_employee",
    sourceMessageIds: [],
    ...more,
  };
}

const reply = (content: string, proposal: ChatFormProposal | null): AskResponse => ({ content, citations: [], recommendedVideoIds: [], formProposal: proposal ?? undefined });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("1. no employee on the card: no person named, never \"I have the employee\", asks who", () => {
  it("R3/R5/R7: the Action plan named the person while the card was empty and the reply asked who", () => {
    const out = replyMatchesCard(
      reply(
        "I'll draft a **Corrective Action Form** from what you've described, and check the applicable company policy before anything policy-related goes on it.\n\n**Issue:** he was 40 minutes late opening the salon on 11/2\n\n**Action plan:** Management will review the applicable company policy with Zebulon. Future policy violations may result in additional corrective action up to and including termination of employment.\n\nWho is this form for? Tell me the employee's full name.",
        card(null),
      ),
      ROSTER,
      "create a CA for Zebulon Marchbanks, he was 40 minutes late opening the salon on 11/2",
    );
    expect(out.content).not.toMatch(/Zebulon|Marchbanks/);
    expect(out.content).toContain("with the employee.");
    expect(out.content.split(ASK_WHO)).toHaveLength(2);
  });

  it("QA-A/B and the street placeholder: \"Everything I need is here … I have the employee and the salon\" on an empty card", () => {
    const out = replyMatchesCard(
      reply(
        "Here is what I would put on a **Coaching Form**.\n\nEverything I need is here, drawn from your message above.\n\nI have the employee and the salon (**Kearney**). Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.",
        card(null, { templateKey: "coaching", templateName: "Coaching Form" }),
      ),
      ROSTER,
      "make a coaching form for <name>, she was late today",
    );
    expect(out.content).not.toMatch(/Everything I need is here|I have the employee|Create the draft here/);
    expect(out.content).toContain(ASK_WHO);
  });

  it("\"I can create a CA for <A>\" / \"Name: <B>\" on an empty card: neither name stays", () => {
    const out = replyMatchesCard(reply("I can create a **Corrective Action Form** for **Zebulon Marchbanks**.\n\nName: Zeb Marchbanks", card(null)), ROSTER, "create a CA for Zebulon Marchbanks, he was late");
    expect(out.content).not.toMatch(/Zebulon|Marchbanks/);
    expect(out.content).not.toMatch(/^\s*Name:/m);
  });

  it("negative: the reason the card is empty keeps the name, and a choice of roster people is not replaced by \"who\"", () => {
    const text = "I couldn't find **Zebulon Marchbanks** in the Woven roster, so that name is not on the form.\n\nWhich of them is this **Corrective Action Form** for — **Marnie Holloway** or **Remy Calder**?";
    const out = replyMatchesCard(reply(text, card(null)), ROSTER, "create a CA for Zebulon Marchbanks, he was late");
    expect(out.content).toBe(text);
  });
});

describe("1b. the card's own list of details already asks for the name", () => {
  it("\"1. The employee's full name — or tell me it's for the whole team.\" is asked once, never again as \"Who is this form for?\"", () => {
    const text = "Here is what I would put on a **Coaching Form**.\n\nTo draft a form, I'll need a few details first:\n\n1. The employee's full name — or tell me it's for the whole team.\n2. The date for the form (if you say \"today,\" I'll use November 3, 2026).";
    expect(replyMatchesCard(reply(text, card(null, { templateKey: "coaching" })), ROSTER, "make a coaching form for <name>, she was late today").content).toBe(text);
  });
});

describe("1c. the sibling app's combined pre-check (5 Nov 2026): the CA list's \"1. Employee's full name\" already asks", () => {
  it("a CA intake list asking \"1. Employee's full name\" is asked once", () => {
    const text = "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:\n\n1. Employee's full name\n2. Date for the form";
    expect(replyMatchesCard(reply(text, card(null)), ROSTER, "create a corrective action form").content).toBe(text);
  });
});

describe("1d. the sibling app's final gate (5 Nov 2026): FIRST_NAME_ASK's own question already asks who", () => {
  it("\"Is this for ivy? Tell me her full name.\" is not followed by \"Who is this form for?\"", () => {
    const text = "Here is what I would put on a **Coaching Form**.\n\nIs this for ivy? Tell me her full name.";
    expect(replyMatchesCard(reply(text, card(null, { templateKey: "coaching" })), ROSTER, "make a coaching form for ivy, she was late").content).toBe(text);
  });
});

describe("2. an employee on the card: never asked who, and the person drafted for is the card's", () => {
  it("\"Who is this form for?\" beside a card that has its employee goes", () => {
    const out = replyMatchesCard(reply("I'll draft a **Corrective Action Form** for **Corwin Hale** from what you've described.\n\nWho is this form for? Tell me the employee's full name.", card("Corwin Hale")), ROSTER);
    expect(out.content).toBe("I'll draft a **Corrective Action Form** for **Corwin Hale** from what you've described.");
  });

  it("R2 (with the flip): the reply drafted for the district manager while the card was the employee's", () => {
    const out = replyMatchesCard(reply("I'll draft a **Corrective Action Form** for **Brenna Kowaldane** from what you've described.\n\n**Name:** Brenna Kowaldane", card("Corwin Hale")), ROSTER);
    expect(out.content).toBe("I'll draft a **Corrective Action Form** for **Corwin Hale** from what you've described.\n\n**Name:** Corwin Hale");
  });

  it("negative: a card with its employee and \"I have the employee and the salon\" is left as it is", () => {
    const text = "Here is what I would put on a **Coaching Form** for **Corwin Hale**.\n\nI have the employee and the salon (**Kearney**).";
    expect(replyMatchesCard(reply(text, card("Corwin Hale", { templateKey: "coaching" })), ROSTER).content).toBe(text);
  });
});

describe("3. one policy: the card's", () => {
  it("Evaluations p.34 beside the card's Standards of Conduct (C10): the other section goes", () => {
    const out = replyMatchesCard(
      reply("**Policy:** Standards of Conduct, JBA Policy Manual p.12, as you said\n\nEvaluations and Raises Policy, JBA Policy Manual p.34\n\nStandards of Conduct Policy, JBA Policy Manual p.12", card("Corwin Hale")),
      ROSTER,
    );
    expect(out.content).not.toMatch(/Evaluations and Raises/);
    expect(out.content).toContain("Standards of Conduct Policy, JBA Policy Manual p.12");
  });

  it("the Coaching card's sales line (s11): a cell-phone coaching cites Cell Phone/Smart Watch, never the Standards of Conduct too", () => {
    const out = replyMatchesCard(
      reply("Here is what I would put on a **Coaching Form**.\n\nCell Phone/Smart Watch Policy, JBA Policy Manual p.19\n\nStandards of Conduct Policy, JBA Policy Manual p.12", card("Corwin Hale", { templateKey: "coaching" })),
      ROSTER,
    );
    expect(out.content).toContain("Cell Phone/Smart Watch Policy, JBA Policy Manual p.19");
    expect(out.content).not.toMatch(/Standards of Conduct/);
  });
});

describe("4. no removed Type of Offense label", () => {
  it("\"I'll quote it on the draft under **Tardiness/Leaving Early**\": the sentence goes, the citation stays", () => {
    const out = replyMatchesCard(
      reply("**Policy:** Late Opening, as you said — the policy manual's section on page 15. I'll quote it on the draft under **Tardiness/Leaving Early**.", card("Corwin Hale")),
      ROSTER,
    );
    expect(out.content).toBe("**Policy:** Late Opening, as you said — the policy manual's section on page 15.");
  });

  it("negative: a current box (Standards of Conduct) stays", () => {
    const text = "**Policy:** Standards of Conduct — the policy manual's section on page 12. I'll quote it on the draft under **Standards of Conduct**.";
    expect(replyMatchesCard(reply(text, card("Corwin Hale")), ROSTER).content).toBe(text);
  });
});

describe("5. never \"You haven't told me what happened yet\" beside an account", () => {
  it("the kitten (message 83a93ef2): \"You haven't told me … so I can't cite the policy manual\" beside the policy cited from what was described", () => {
    const out = replyMatchesCard(
      reply(
        `I can create a **Corrective Action Form** for **Corwin Hale**.\n\n${NO_INCIDENT_NOTE}\n\n**Policy:** Animals in the Workplace, from what you described ("brought his new kitten") — the policy manual's section on page 30.`,
        card("Corwin Hale"),
      ),
      ROSTER,
    );
    expect(out.content).not.toMatch(/You haven't told me what happened yet/);
    expect(out.content).toContain("**Policy:** Animals in the Workplace");
  });

  it("a card with its Issue never says it was not told", () => {
    const out = replyMatchesCard(reply(`I can create a **Corrective Action Form** for **Corwin Hale**.\n\n${NO_INCIDENT_NOTE}`, card("Corwin Hale", { issue: "late opening the salon on 11/2" })), ROSTER);
    expect(out.content).not.toMatch(/You haven't told me what happened yet/);
  });

  it("negative: a name alone (no account anywhere) still says \"You haven't told me what happened yet\"", () => {
    const text = `I can create a **Corrective Action Form** for **Corwin Hale**.\n\n${NO_INCIDENT_NOTE}`;
    expect(replyMatchesCard(reply(text, card("Corwin Hale")), ROSTER).content).toBe(text);
  });
});

describe("only a reply with a card, and only with the flag", () => {
  it("a reply with no card, or a team card's employee rules, are left alone", () => {
    const plain = "A grounded answer from the policy manual.\n\nWho is this form for?";
    expect(replyMatchesCard(reply(plain, null), ROSTER).content).toBe(plain);
    const team = "Here is what I would put on a **Coaching Form** for the whole team.";
    expect(replyMatchesCard(reply(team, card(null, { templateKey: "coaching", subject: "team" })), ROSTER).content).toBe(team);
  });

  it("off: the reply as built; on: checked", () => {
    const response = reply("I'll draft a **Corrective Action Form** for **Corwin Hale**.\n\nWho is this form for? Tell me the employee's full name.", card("Corwin Hale"));
    expect(withReplyMatchesCard(response)).toBe(response);
    vi.stubEnv("REPLY_MATCHES_CARD_ENABLED", "true");
    expect(withReplyMatchesCard(response).content).toBe("I'll draft a **Corrective Action Form** for **Corwin Hale**.");
  });
});
