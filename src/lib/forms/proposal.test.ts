import { describe, expect, it } from "vitest";

import {
  MANAGER_CONTEXT_TURNS,
  buildProposal,
  extractEmployeeNames,
  managerContext,
  resolveEmployee,
} from "./proposal";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 7–17 — WHAT A PROPOSAL MAY CONTAIN
 * ============================================================================
 *
 * Every test here exists because the retired flow had the opposite behaviour.
 * `buildFormDraft` filled an employment document like this when the manager had
 * said nothing:
 *
 *     employee_name  -> "Jane Kowalski"
 *     topic          -> "repeated tardiness"
 *     employee_role  -> "Tanning Consultant"
 *     details        -> "Arrived after the start of a scheduled shift on three
 *                        occasions in the past two weeks..."
 *     follow_up_date -> today + 14
 *
 * and `buildFormCollection` offered "Jane Kowalski — late on the 12th, 15th and
 * 19th" as a clickable follow-up chip. None of those facts existed.
 */

let counter = 0;
function userTurn(content: string): ChatMessage {
  counter += 1;
  return {
    id: `msg-${counter}`,
    role: "user",
    content,
    createdAt: "2026-01-05T10:00:00.000Z",
  };
}
function assistantTurn(content: string): ChatMessage {
  counter += 1;
  return {
    id: `msg-${counter}`,
    role: "assistant",
    content,
    createdAt: "2026-01-05T10:00:00.000Z",
  };
}

const SALON: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0101",
  alsoCoversAreaIds: [],
};

function propose(
  history: ChatMessage[],
  question: string,
  scope: AccessScope | null = SALON,
) {
  return buildProposal({
    proposalId: "prop-1",
    templateKey: "coaching",
    templateName: "Coaching Form",
    context: managerContext(history, { id: "msg-current", content: question }),
    scope,
  });
}

/* ================================================= manager turns only == */

describe("7. only the manager's own turns are read", () => {
  it("ignores a name that appears only in an assistant turn", () => {
    const history = [
      userTurn("I need to document a conversation"),
      // Sunny's own paraphrase. Promoting this to a fact on an employment
      // record is the failure nobody would notice, because it reads fine.
      assistantTurn("Sure — is this about Jane Kowalski?"),
    ];

    const context = managerContext(history, { id: "msg-current", content: "yes please" });

    expect(context.text).not.toContain("Jane Kowalski");
    expect(context.messages.map((message) => message.content)).toEqual([
      "I need to document a conversation",
      "yes please",
    ]);
  });

  it("ignores a failed turn, which is not something anybody said", () => {
    const failed: ChatMessage = {
      ...userTurn("Marcus Webb was late again"),
      error: {
        kind: "model_failed",
        message: "no",
        retryable: true,
        question: "Marcus Webb was late again",
      },
    };
    const context = managerContext([failed], { id: "msg-current", content: "carry on" });
    expect(context.text).not.toContain("Marcus Webb");
  });
});

describe("8. the window is bounded", () => {
  it("keeps the most recent turns and drops older ones", () => {
    const history = Array.from({ length: 30 }, (_unused, index) =>
      userTurn(`turn ${index}`),
    );
    const context = managerContext(history, { id: "msg-current", content: "now" });

    expect(context.messages).toHaveLength(MANAGER_CONTEXT_TURNS);
    expect(context.messages.at(-1)!.content).toBe("now");
    // "the whole conversation" is not context — it is every employee the
    // manager has mentioned since they signed in.
    expect(context.text).not.toContain("turn 0");
  });
});

describe("9. sourceMessageIds point at the manager's own turns", () => {
  it("records the ids that were supplied, and invents none", () => {
    const first = userTurn("Sarah Jones needs a coaching form");
    const proposal = propose([first], "about attendance");

    expect(proposal.sourceMessageIds).toEqual([first.id, "msg-current"]);
  });

  it("carries no id for a history entry that arrived without one", () => {
    // `parseHistory` drops a malformed id rather than rejecting the request, so
    // an id-less turn still contributes its words — just not its provenance.
    const context = managerContext(
      [{ role: "user", content: "Sarah Jones was late" } as ChatMessage],
      { id: "msg-current", content: "coaching form please" },
    );
    expect(context.ids).toEqual(["msg-current"]);
    expect(context.text).toContain("Sarah Jones");
  });
});

/* ======================================================== employee == */

describe("10. a capitalised first word is not a name", () => {
  it("does not produce an employee called 'Create'", () => {
    // The exact prototype regression: `extractEmployeeName` accepted a
    // capitalised leading word, so this sentence named an employee "Create".
    const names = extractEmployeeNames("Create a coaching form for a performance concern");
    expect(names).toEqual([]);
  });

  it.each([
    "Draft a form about attendance",
    "Please start a coaching document",
    "Write up the conversation from this morning",
  ])("%s yields no employee", (sentence) => {
    expect(extractEmployeeNames(sentence)).toEqual([]);
  });
});

describe("11. a name the manager actually gave is used verbatim", () => {
  it.each([
    ["I need a coaching form for Sarah Jones", "Sarah Jones"],
    ["this is about Marcus Webb", "Marcus Webb"],
    ["Jordan Vance", "Jordan Vance"],
  ])("%s", (sentence, expected) => {
    expect(extractEmployeeNames(sentence)).toContain(expected);
  });

  it("accepts a lone first name only when it is the whole message", () => {
    // What a manager types when Sunny has just asked who the form is for.
    expect(extractEmployeeNames("Sarah")).toEqual(["Sarah"]);
    expect(extractEmployeeNames("Sarah was late on Tuesday")).toEqual([]);
  });
});

describe("12. two possible people is a question, not a coin toss", () => {
  it("resolves to ambiguous rather than picking the first", () => {
    const context = managerContext([], {
      id: "msg-current",
      content: "Sarah Jones and Marcus Webb were both late",
    });
    const resolution = resolveEmployee(context);

    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind !== "ambiguous") return;
    expect(resolution.candidates).toEqual(["Sarah Jones", "Marcus Webb"]);
  });

  it("puts no employee on the proposal when it cannot tell", () => {
    const proposal = propose([], "Sarah Jones and Marcus Webb were both late");
    expect(proposal.employeeName).toBeNull();
    expect(proposal.status).toBe("needs_employee");
  });
});

describe("13. a missing employee stays missing", () => {
  it("is null, and is not Jane Kowalski", () => {
    const proposal = propose([], "I need a coaching form");

    expect(proposal.employeeName).toBeNull();
    expect(proposal.status).toBe("needs_employee");
    expect(JSON.stringify(proposal)).not.toMatch(/Jane|Kowalski/i);
  });
});

/* ======================================================== location == */

describe("14. the salon comes from the authenticated scope", () => {
  it("fills in the one salon a manager is assigned to", () => {
    const proposal = propose([], "coaching form for Sarah Jones");

    expect(proposal.locationId).toBe("loc-0101");
    expect(proposal.locationResolution).toBe("resolved");
    expect(proposal.status).toBe("ready");
  });

  it("asks when the manager covers more than one", () => {
    const proposal = propose([], "coaching form for Sarah Jones", {
      level: "salon",
      primaryAreaId: "loc-0101",
      alsoCoversAreaIds: ["loc-0102"],
    });

    expect(proposal.locationId).toBeNull();
    expect(proposal.locationResolution).toBe("needs_selection");
    expect(proposal.status).toBe("needs_location");
  });

  it("fills in nothing for a district manager", () => {
    const proposal = propose([], "coaching form for Sarah Jones", {
      level: "district",
      primaryAreaId: "dist-01",
      alsoCoversAreaIds: [],
    });

    expect(proposal.locationId).toBeNull();
    expect(proposal.locationResolution).toBe("unavailable");
  });
});

describe("15. no salon DISPLAY NAME is invented", () => {
  it("leaves locationName null even when the id resolved", () => {
    /*
     * There is no salon roster to resolve a name from, and `DEMO_LOCATIONS` is
     * seeded demo data rather than an authority. A fictional salon name in
     * front of a manager about to file a disciplinary record is exactly the
     * class of thing this phase removes.
     */
    const proposal = propose([], "coaching form for Sarah Jones");
    expect(proposal.locationId).toBe("loc-0101");
    expect(proposal.locationName).toBeNull();
  });
});

/* ==================================================== not a record == */

describe("16. a proposal carries no HR field values at all", () => {
  it("has no topic, details, role, follow-up date or checked options", () => {
    const proposal = propose(
      [userTurn("Sarah Jones was late on the 12th")],
      "coaching form please",
    );

    expect(Object.keys(proposal).sort()).toEqual([
      "employeeName",
      "locationId",
      "locationName",
      "locationResolution",
      "proposalId",
      "sourceMessageIds",
      "status",
      "templateKey",
      "templateName",
    ]);

    const serialized = JSON.stringify(proposal);
    for (const invented of [
      "Tanning Consultant",
      "repeated tardiness",
      "Documented coaching",
      "three occasions",
      "follow_up_date",
      "expected_action",
    ]) {
      expect(serialized, invented).not.toContain(invented);
    }
  });
});

describe("17. asking order is employee first, then salon", () => {
  it("does not ask two questions at once", () => {
    // A manager who has not said who the form is about cannot usefully answer
    // which salon it belongs to, and two questions get one answer.
    const proposal = propose([], "coaching form please", {
      level: "salon",
      primaryAreaId: "loc-0101",
      alsoCoversAreaIds: ["loc-0102"],
    });

    expect(proposal.employeeName).toBeNull();
    expect(proposal.locationId).toBeNull();
    expect(proposal.status).toBe("needs_employee");
  });
});
