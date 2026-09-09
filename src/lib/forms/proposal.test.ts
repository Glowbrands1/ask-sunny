import { describe, expect, it } from "vitest";

import {
  MANAGER_CONTEXT_CHARS,
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
  inlineDraftSupported = true,
) {
  return buildProposal({
    proposalId: "prop-1",
    templateKey: "coaching",
    templateName: "Coaching Form",
    context: managerContext(history, { id: "msg-current", content: question }),
    scope,
    inlineDraftSupported,
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

/**
 * ============================================================================
 * PHASE 2 REMEDIATION, REQUIREMENTS R1-R6 — THE NEWEST WORDS WIN
 * ============================================================================
 *
 * THE DEFECT QA FOUND. The bounded window walked OLDEST -> NEWEST and stopped
 * at the first turn that would overflow the character budget, so a long earlier
 * statement could spend the whole budget and the manager's current correction
 * never entered the context at all.
 *
 * Every other bounding failure produces a THIN draft. This one produces a
 * CONFIDENT WRONG draft: an occurrence count on a disciplinary record that the
 * manager had explicitly retracted, written as fact.
 */
describe("R1. the current correction survives character pressure", () => {
  /*
   * Marissa's own shape of conversation, with the budget deliberately
   * exhausted by the earlier statement. Before the fix the correction was
   * dropped and "three times" was the only occurrence count in the context.
   */
  const longStatement = `Sarah was late three times this week. ${"Context that fills the budget. ".repeat(
    Math.ceil(MANAGER_CONTEXT_CHARS / 30),
  )}`;

  it("keeps the correction and drops the older statement", () => {
    const context = managerContext([userTurn(longStatement)], {
      id: "msg-current",
      content: "Correction — it was twice, not three times.",
    });

    expect(context.text).toContain("Correction — it was twice, not three times.");
    expect(context.text).not.toContain("late three times");
    expect(context.messages).toHaveLength(1);
  });

  it("is a real budget squeeze, not a test that would pass either way", () => {
    // The guard on the guard: both turns together must genuinely exceed the
    // budget, or "the correction survived" proves nothing.
    const correction = "Correction — it was twice, not three times.";
    expect(longStatement.length + correction.length).toBeGreaterThan(MANAGER_CONTEXT_CHARS);
  });
});

describe("R2. older context is dropped before newer context", () => {
  it("keeps the most recent turns that fit and stops there", () => {
    // Four turns, budget enough for roughly two of them plus the current one.
    const filler = "x".repeat(Math.floor(MANAGER_CONTEXT_CHARS / 3));
    const context = managerContext(
      [
        userTurn(`oldest ${filler}`),
        userTurn(`middle ${filler}`),
        userTurn(`newest-prior ${filler}`),
      ],
      { id: "msg-current", content: "the current turn" },
    );

    expect(context.text).toContain("the current turn");
    expect(context.text).toContain("newest-prior");
    expect(context.text).not.toContain("oldest ");
  });

  it("stops rather than skipping a long recent turn for a short old one", () => {
    /*
     * Skipping would reintroduce the same recency inversion in miniature: an
     * older statement surviving while a newer one is dropped.
     */
    const context = managerContext(
      [
        userTurn("SHORT-AND-OLD"),
        userTurn("LONG-AND-RECENT ".repeat(Math.ceil(MANAGER_CONTEXT_CHARS / 10))),
      ],
      { id: "msg-current", content: "now" },
    );

    expect(context.text).toContain("now");
    expect(context.text).not.toContain("LONG-AND-RECENT");
    expect(context.text).not.toContain("SHORT-AND-OLD");
  });
});

describe("R3. retained messages come back in chronological order", () => {
  it("reads the way the manager said them, not newest-first", () => {
    // Retention runs in priority order; presentation runs in time order.
    // Reversing an account misstates the sequence of events.
    const first = userTurn("Sarah was late on Monday.");
    const second = userTurn("She was late again on Wednesday.");
    const context = managerContext([first, second], {
      id: "msg-current",
      content: "Build a coaching form for Sarah.",
    });

    expect(context.messages.map((message) => message.content)).toEqual([
      "Sarah was late on Monday.",
      "She was late again on Wednesday.",
      "Build a coaching form for Sarah.",
    ]);
    expect(context.text.indexOf("Monday")).toBeLessThan(context.text.indexOf("Wednesday"));
  });
});

describe("R4. sourceMessageIds name only what was retained", () => {
  it("omits the id of a turn that did not fit", () => {
    const dropped = userTurn("y".repeat(MANAGER_CONTEXT_CHARS));
    const context = managerContext([dropped], { id: "msg-current", content: "now" });

    expect(context.ids).toEqual(["msg-current"]);
    expect(context.ids).not.toContain(dropped.id);
  });

  it("names every turn that was retained", () => {
    const first = userTurn("Sarah was late Monday.");
    const context = managerContext([first], { id: "msg-current", content: "now" });
    expect(context.ids).toEqual([first.id, "msg-current"]);
  });
});

describe("R5. the current message never disappears", () => {
  it("survives an earlier turn that consumed the entire budget", () => {
    const context = managerContext([userTurn("z".repeat(MANAGER_CONTEXT_CHARS * 2))], {
      id: "msg-current",
      content: "Build a coaching form for Sarah Jones.",
    });

    expect(context.messages).toHaveLength(1);
    expect(context.text).toBe("Build a coaching form for Sarah Jones.");
    expect(context.truncated).toBe(false);
  });
});

describe("R6. an over-long current message is cut visibly, not silently", () => {
  it("marks the truncation rather than pretending the whole message arrived", () => {
    const context = managerContext([], {
      id: "msg-current",
      content: "w".repeat(MANAGER_CONTEXT_CHARS * 2),
    });

    expect(context.truncated).toBe(true);
    expect(context.text.length).toBeLessThanOrEqual(MANAGER_CONTEXT_CHARS);
    expect(context.text).toMatch(/longer than Ask Sunny reads at once/);
    // And it is still the manager's own words up to the cut.
    expect(context.text.startsWith("w".repeat(100))).toBe(true);
  });

  it("is deterministic — the same message twice gives the same context", () => {
    const message = { id: "msg-current", content: "q".repeat(MANAGER_CONTEXT_CHARS + 500) };
    expect(managerContext([], message).text).toBe(managerContext([], message).text);
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

  it.each([
    "please draft a form for Jane Test, Salon Test, she was late today",
    "coaching form for Jane Test at Salon Test",
    "Jane Test, Location Test — late again",
  ])("a salon named alongside the employee is not a second candidate: %s", (sentence) => {
    // "Salon Test" reads as a capitalised full name, so the turn resolved as
    // ambiguous and Sunny re-asked for a name the manager had just given.
    expect(extractEmployeeNames(sentence)).toEqual(["Jane Test"]);
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
      "authorizedLocationIds",
      "employeeName",
      "locationId",
      "locationName",
      "locationResolution",
      "proposalId",
      "sourceMessageIds",
      "status",
      "supportsInlineDraft",
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

describe("P3-1. inline creation is offered only when nothing is missing", () => {
  it("is false while the employee is unknown", () => {
    const proposal = propose([], "coaching form please");
    expect(proposal.status).toBe("needs_employee");
    expect(proposal.supportsInlineDraft).toBe(false);
  });

  it("is false while the salon is unverified", () => {
    const proposal = propose([], "coaching form for Sarah Jones", {
      level: "district",
      primaryAreaId: "dist-01",
      alsoCoversAreaIds: [],
    });
    expect(proposal.status).toBe("needs_location");
    expect(proposal.supportsInlineDraft).toBe(false);
  });

  it("is false for a template the inline editor does not support", () => {
    // Ready in every other respect. The template is the reason.
    const proposal = propose([], "coaching form for Sarah Jones", SALON, false);
    expect(proposal.status).toBe("ready");
    expect(proposal.supportsInlineDraft).toBe(false);
  });

  it("is true only when both are true", () => {
    const proposal = propose([], "coaching form for Sarah Jones");
    expect(proposal.status).toBe("ready");
    expect(proposal.supportsInlineDraft).toBe(true);
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
