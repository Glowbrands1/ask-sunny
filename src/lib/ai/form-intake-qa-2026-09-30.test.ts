import { describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRODUCTION QA, 30 SEPTEMBER 2026 — THE FORM INTAKE, TURN BY TURN
 * ============================================================================
 *
 * Codex ran 99 live prompts against production as a signed-in Admin with the
 * synthetic employees Avery Testperson and Jordan Testperson; 24 failed. Every
 * failure was a conversation, not a sentence: the employee was overwritten by
 * a topic word, a correction was read as a second candidate, an advice answer
 * in between dropped the Coaching intake, "topic is policy review" switched
 * the form.
 *
 * So these tests replay CONVERSATIONS through the real server path. Each
 * manager turn goes to `proposeFormForTurn` with the continuation hint the
 * browser would compute from the thread so far (`continuationFor`); a null
 * answer is recorded as an ordinary advice reply, exactly as the grounded path
 * would append one. What is asserted is the LATEST card — the one the manager
 * would press — never a card further up.
 */

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("the proposal takes the library from its caller");
  },
  getTemplateByKey: async () => {
    throw new Error("the proposal must not read the library");
  },
}));

/* The Admin the QA ran as: global scope, so no salon is ever recorded. */
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

function template(key: string, name: string, permission: string, extra: Record<string, unknown> = {}) {
  return {
    id: `tpl-${key}`,
    key,
    name,
    shortName: name,
    description: name,
    layoutFamily: key,
    requiredPermission: permission,
    active: true,
    displayOrder: 1,
    currentVersion: { id: `v-${key}`, status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...extra,
  };
}

const LIBRARY = [
  template("coaching", "Coaching Form", "create_coaching_form"),
  template("follow-up-coaching", "Follow-Up Coaching Form", "create_coaching_form"),
  template("policy-review", "Policy Review", "create_policy_review"),
  template("dpoa", "Corrective Action Form", "create_corrective_action", {
    currentVersion: { id: "v-dpoa", status: "published", document: correctiveActionDocument(), variants: [] },
  }),
  template("stc-exit", "Resignation/Exit Form", "create_exit_form"),
  template("sdit-epp", "SDIT EPP", "create_epp"),
  template("demotion", "Demotion Form", "create_employment_change_form"),
  template("position-transfer", "Position Transfer Form", "create_employment_change_form"),
  template("prescreen-phone-interview", "Prescreen / Phone Interview Form", "create_hiring_form"),
];

let counter = 0;
function id(): string {
  counter += 1;
  return `msg-${counter}`;
}

interface Replay {
  thread: ChatMessage[];
  /** The latest assistant turn. */
  last: ChatMessage;
  /** The latest card in the thread, wherever it is. */
  latestProposal: ChatMessage["formProposal"] | undefined;
}

/**
 * Sends each turn the way the chat screen does and returns the thread.
 * A turn the form path declines becomes a plain advice reply.
 */
async function converse(...turns: string[]): Promise<Replay> {
  const { proposeFormForTurn } = await import("./form-proposal");
  const thread: ChatMessage[] = [];
  for (const question of turns) {
    const history = [...thread];
    const user: ChatMessage = { id: id(), role: "user", content: question, createdAt: "2026-09-30T12:00:00Z" };
    thread.push(user);
    const answer = await proposeFormForTurn({
      history,
      question,
      questionMessageId: user.id,
      actor: { role: "admin" as never, scope: GLOBAL },
      continueTemplateKey: continuationFor(history)?.templateKey,
      summaries: LIBRARY as never,
      today: "2026-09-30",
    });
    thread.push({
      id: id(),
      role: "assistant",
      content: answer?.content ?? "Coaching is the right call here — here is how to run the conversation.",
      createdAt: "2026-09-30T12:00:00Z",
      ...(answer?.formProposal ? { formProposal: answer.formProposal } : {}),
      ...(answer?.formSelection ? { formSelection: answer.formSelection } : {}),
      ...(answer?.followUpSuggestions ? { followUpSuggestions: answer.followUpSuggestions } : {}),
    });
  }
  const last = thread[thread.length - 1]!;
  const latestProposal = [...thread].reverse().find((message) => message.formProposal)?.formProposal;
  return { thread, last, latestProposal };
}

/** The last turn produced a card for this form and this person. */
function expectCard(replay: Replay, templateKey: string, employeeName: string | null) {
  expect(replay.last.formProposal, replay.last.content).toBeDefined();
  expect(replay.last.formProposal!.templateKey).toBe(templateKey);
  if (employeeName === null) {
    expect(replay.last.formProposal!.employeeName).toBeNull();
  } else {
    expect(replay.last.formProposal!.employeeName?.toLowerCase()).toBe(employeeName.toLowerCase());
  }
}

/** The last turn was left to the grounded advice path. */
function expectAdvice(replay: Replay) {
  expect(replay.last.formProposal, replay.last.content).toBeUndefined();
  expect(replay.last.formSelection).toBeUndefined();
}

/* ============================================ 1. employee resolution === */

describe("QA 1 — the employee is read the same way whatever the capitals", () => {
  it.each([
    // F06 failed; X01 (title case) passed.
    ["coaching form\nemployee: avery testperson\nissue: skipped a tour", "avery testperson"],
    ["coaching form\nemployee: Avery Testperson\nissue: skipped a tour", "Avery Testperson"],
    // F13 failed; X02 passed.
    ["avery testperson needs a coaching form today", "avery testperson"],
    ["Avery Testperson needs a coaching form today", "Avery Testperson"],
    // F12: a lower-case name in a narrative position.
    ["i coached avery testperson on client tours and need the form", "avery testperson"],
    ["coaching form, employee name: Avery Testperson, date: today", "Avery Testperson"],
    ["coaching form for avery testperson", "avery testperson"],
    ["COACHING FORM FOR AVERY TESTPERSON", "AVERY TESTPERSON"],
  ])("%s", async (question, employee) => {
    const replay = await converse(question);
    expectCard(replay, "coaching", employee);
    // THE SPELLING IS THE MANAGER'S, not a normalised copy.
    expect(replay.last.formProposal!.employeeName).toBe(employee);
  });

  it.each([
    // N02b: "It's" became part of the name.
    ["It's Avery Testperson"],
    ["it's avery testperson"],
    ["the employee is Avery Testperson"],
    ["the employee is avery testperson"],
    ["employee: avery testperson"],
    ["this is for Avery Testperson"],
    ["this is for avery testperson"],
    ["Her name is Avery Testperson"],
  ])("answers 'who is this for?' with %s", async (answer) => {
    const replay = await converse("I need a coaching form", answer);
    expectCard(replay, "coaching", "Avery Testperson");
    expect(replay.last.formProposal!.status).toBe("ready");
  });
});

describe("QA 1 — a correction replaces the employee, and nothing else does", () => {
  it("C01: Jordan, corrected to Avery, survives a topic/date turn that names a form as its topic", async () => {
    const replay = await converse(
      "Coaching form for Jordan Testperson",
      "Sorry, the employee is Avery Testperson",
      "This is a policy review coaching about opening the salon late. Today.",
    );
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it("C02: 'No, not Jordan Testperson. Avery Testperson.' resolves to Avery and excludes Jordan", async () => {
    const replay = await converse("Coaching form for Jordan Testperson", "No, not Jordan Testperson. Avery Testperson.");
    expectCard(replay, "coaching", "Avery Testperson");
    expect(replay.last.formProposal!.status).toBe("ready");
  });

  it("'No, not Jordan. Avery.' resolves to Avery, excluding Jordan", async () => {
    const replay = await converse("Coaching form for Jordan", "No, not Jordan. Avery.");
    expectCard(replay, "coaching", "Avery");
  });

  it("C02d: the corrected employee survives topic, date and pronoun follow-ups", async () => {
    const replay = await converse(
      "Coaching form for Jordan Testperson",
      "No, not Jordan Testperson. Avery Testperson.",
      "employee name should be Avery Testperson",
      "She missed the opening checklist today. Please keep this as coaching.",
    );
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it("a confirmed employee is not replaced by another person mentioned in the narrative", async () => {
    const replay = await converse(
      "Coaching form for Avery Testperson",
      "She skipped the tour today and Jordan Testperson had to cover for her.",
    );
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it("an explicit correction to a new person does replace the confirmed one", async () => {
    const replay = await converse("Coaching form for Avery Testperson", "Actually it's for Jordan Testperson");
    expectCard(replay, "coaching", "Jordan Testperson");
  });

  it("F18: two genuine candidates are named back instead of guessed", async () => {
    const replay = await converse("coaching form for Avery Testperson and Jordan Testperson");
    expectCard(replay, "coaching", null);
    expect(replay.last.content).toContain("Avery Testperson");
    expect(replay.last.content).toContain("Jordan Testperson");
  });

  it("F19: a pronoun is never a name", async () => {
    const replay = await converse("create coaching form for her");
    expectCard(replay, "coaching", null);
  });
});

/* ======================================== 2. the intake across turns === */

describe("QA 2 — the active Coaching intake survives the conversation", () => {
  it("coaching form → employee: avery testperson → she missed the opening checklist today", async () => {
    const replay = await converse("coaching form", "employee: avery testperson", "she missed the opening checklist today");
    expectCard(replay, "coaching", "avery testperson");
    // The facts turn is in the proposal's provenance, so the draft is written from it.
    const facts = replay.thread[4]!;
    expect(replay.last.formProposal!.sourceMessageIds).toContain(facts.id);
  });

  it("N03/N06: repeated employee answers keep one Coaching intake", async () => {
    const replay = await converse(
      "coaching",
      "employee: avery testperson",
      "I already said Avery Testperson",
      "this is for avery testperson",
    );
    for (const index of [3, 5, 7]) {
      expect(replay.thread[index]!.formProposal?.templateKey, replay.thread[index]!.content).toBe("coaching");
      expect(replay.thread[index]!.formProposal?.employeeName?.toLowerCase()).toBe("avery testperson");
    }
  });

  it("an advice answer in between does not silently end an unfinished intake", async () => {
    const replay = await converse(
      "coaching form",
      "what does the handbook say about opening checklists?",
      "Avery Testperson",
    );
    // The question in the middle is still answered as a question.
    expect(replay.thread[3]!.formProposal).toBeUndefined();
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it("a question asked mid-intake is still answered as a question", async () => {
    const replay = await converse("coaching form for Avery Testperson", "what is the late opening policy?");
    expectAdvice(replay);
  });

  it("the manager can end the intake explicitly", async () => {
    const replay = await converse("coaching form", "never mind, no form", "she missed the opening checklist today");
    expectAdvice(replay);
  });

  it("a date and a topic on their own continue the open form", async () => {
    const replay = await converse("Coaching form for Avery Testperson", "topic is store tours. today.");
    expectCard(replay, "coaching", "Avery Testperson");
  });
});

/* ================================= 3. requested form versus its topic === */

describe("QA 3 — a topic never hijacks the form that was asked for", () => {
  it("F08: 'coaching form for Avery Testperson; topic is policy review' stays Coaching", async () => {
    const replay = await converse("coaching form for Avery Testperson; topic is policy review");
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it.each([
    ["Coaching form for Avery Testperson about a policy review"],
    ["coaching form for Avery Testperson regarding policy review"],
    ["a policy review coaching for Avery Testperson"],
  ])("%s stays Coaching", async (question) => {
    const replay = await converse(question);
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it("'topic is policy review' inside an open Coaching intake stays Coaching", async () => {
    const replay = await converse("Coaching form for Avery Testperson", "topic is policy review");
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it.each([
    ["Policy Review for Avery Testperson"],
    ["Policy Review for Avery Testperson about late opening"],
    ["create a policy review for avery testperson"],
  ])("R02: %s is still the standalone Policy Review", async (question) => {
    const replay = await converse(question);
    expectCard(replay, "policy-review", "Avery Testperson");
  });

  it("an explicit switch to the Policy Review form is honoured", async () => {
    const replay = await converse("Coaching form for Avery Testperson", "Actually make it a Policy Review instead");
    expectCard(replay, "policy-review", "Avery Testperson");
  });
});

/* ====================================== 4. natural form request wording === */

describe("QA 4 — managers do not have to memorise one command", () => {
  it.each([
    ["need a coaching on Avery Testperson"], // E05
    ["can u do coaching for avery testperson pls"], // F02
    ["pls make a coaching frm for Avery Testperson"], // F01
    ["please document this as coaching, not CA, for Avery Testperson"], // F26
    ["coahcing form for Avery Testperson"], // F17
    ["coaching Avery Testperson about attendance"], // E10
    ["can you make a coaching for avery testperson"], // E06
    ["need to document coaching for Avery Testperson, they skipped the tour today"], // F03
    ["Avery Testperson - coaching form please"], // F04
    ["for Avery Testperson, a coaching form"], // F05
  ])("%s", async (question) => {
    const replay = await converse(question);
    expectCard(replay, "coaching", "Avery Testperson");
  });

  it("I05: 'I need a coaching on attendance' opens the intake and does not take attendance as a name", async () => {
    const replay = await converse("I need a coaching on attendance");
    expectCard(replay, "coaching", null);
  });

  it.each([
    ["what does coaching mean?"], // F21
    ["how should I coach Avery Testperson?"],
    ["I don't want an actual form yet; how should I coach Avery Testperson?"], // F23
    ["can you coach me on how to discuss attendance with Avery Testperson?"], // F24
    ["coach me on how to discuss attendance"],
    ["I don't want a coaching form yet"],
    ["what is the late opening policy for avery testperson?"], // F22
    ["coaching tips for new hires"],
  ])("advice stays advice: %s", async (question) => {
    const replay = await converse(question);
    expectAdvice(replay);
  });

  it.each([["coach Avery"], ["coach Avery Testperson"], ["I need to coach Avery Testperson"], ["Avery Testperson needs coaching"]])(
    "ambiguous shorthand asks instead of guessing: %s",
    async (question) => {
      const replay = await converse(question);
      expect(replay.last.formProposal).toBeUndefined();
      expect(replay.last.content).toMatch(/coaching guidance, or do you want me to start a Coaching Form/i);
      // Never the old "type this exact command" instruction.
      expect(replay.last.content).not.toMatch(/ask me to create a coaching form/i);
    },
  );

  it("answering the clarification with 'the form' starts the Coaching Form for that person", async () => {
    const replay = await converse("coach Avery", "the form");
    expectCard(replay, "coaching", "Avery");
  });

  it("the clarification's own suggestion chip starts the form", async () => {
    const first = await converse("coach Avery Testperson");
    const chip = first.last.followUpSuggestions?.find((suggestion) => /form/i.test(suggestion));
    expect(chip).toBeDefined();
    const replay = await converse("coach Avery Testperson", chip!);
    expectCard(replay, "coaching", "Avery Testperson");
  });
});

/* ======================================= existing routes do not regress === */

describe("the other forms still route with the supplied employee", () => {
  it.each([
    ["CA for Avery Testperson", "dpoa"],
    ["Policy Review for Avery Testperson about late opening", "policy-review"],
    ["Exit form for Avery Testperson", "stc-exit"],
    ["Follow-up coaching form for Avery Testperson", "follow-up-coaching"],
    ["SDIT EPP for Avery Testperson", "sdit-epp"],
    ["Demotion form for Avery Testperson", "demotion"],
    ["Position transfer form for Avery Testperson", "position-transfer"],
    ["Prescreen / Phone Interview Form for Avery Testperson", "prescreen-phone-interview"],
  ])("%s", async (question, key) => {
    const replay = await converse(question);
    expectCard(replay, key, "Avery Testperson");
  });
});

/* ============================== 5. stale cards, on a replayed thread === */

describe("QA 5 — an older card cannot create a form with superseded state", () => {
  it("after the Jordan → Avery correction, the Jordan card is superseded and refused; the Avery card is current", async () => {
    const { isProposalSuperseded } = await import("@/lib/forms/proposal-continuation");
    const { checkProposalIsCurrent } = await import("@/lib/forms/proposal-currency");
    const replay = await converse("Coaching form for Jordan Testperson", "No, not Jordan Testperson. Avery Testperson.");
    const jordan = replay.thread[1]!.formProposal!;
    const avery = replay.thread[3]!.formProposal!;
    expect(jordan.employeeName).toBe("Jordan Testperson");
    expect(avery.employeeName).toBe("Avery Testperson");

    expect(isProposalSuperseded(replay.thread, jordan.proposalId)).toBe(true);
    expect(isProposalSuperseded(replay.thread, avery.proposalId)).toBe(false);

    const conversation = replay.thread.map(({ id, role, content }) => ({ id, role, content }));
    expect(checkProposalIsCurrent({ conversation, templateKey: "coaching", employeeName: jordan.employeeName! }).current).toBe(false);
    expect(checkProposalIsCurrent({ conversation, templateKey: "coaching", employeeName: avery.employeeName! }).current).toBe(true);
  });

  it("after a switch to the Policy Review, the Coaching card is refused", async () => {
    const { checkProposalIsCurrent } = await import("@/lib/forms/proposal-currency");
    const replay = await converse("Coaching form for Avery Testperson", "Actually make it a Policy Review instead");
    const conversation = replay.thread.map(({ id, role, content }) => ({ id, role, content }));
    expect(checkProposalIsCurrent({ conversation, templateKey: "coaching", employeeName: "Avery Testperson" }).current).toBe(false);
    expect(checkProposalIsCurrent({ conversation, templateKey: "policy-review", employeeName: "Avery Testperson" }).current).toBe(true);
  });
});

/* ======================== 6. Late Opening still reaches retrieval === */

describe("QA 6 — the Late Opening questions are still knowledge questions", () => {
  /*
   * Codex verified all nine retrieve the specific JBA Late Opening policy in
   * production, and this change does not touch retrieval. What it COULD break
   * is the step before retrieval: a phrasing about opening late being read as a
   * form request. None may be — each must leave the form path entirely.
   */
  it.each([
    ["What is the policy if a salon opens late?"],
    ["employee opened the salon late"],
    ["what policy applies to opening late"],
    ["late opening policy"],
    ["salon wasn't opened on time"],
    ["what happens if someone opens the store late"],
    ["manager opened late"],
    ["opening the salon after scheduled opening time"],
    ["employee was late opening the salon"],
    ["The salon must open late because of icy roads. What policy applies?"],
    ["Can a salon employee wear slippers at work? What specific policy applies?"],
  ])("%s", async (question) => {
    const { detectTemplateIntent } = await import("@/lib/forms/template-intent");
    const { detectInventoryQuestion } = await import("@/lib/forms/inventory-question");
    const { answersFormClarification } = await import("@/lib/forms/form-clarification");
    expect(detectTemplateIntent(question)).toEqual({ kind: "none" });
    expect(detectInventoryQuestion(question)).toEqual({ kind: "none" });
    expect(answersFormClarification([], question)).toBe(false);
    expectAdvice(await converse(question));
  });
});

/* ================== 7. the name after a separator, found after merge === */

describe("QA 7 — 'coaching - avery testperson': a name after a separator, in any case", () => {
  /*
   * Found in production after the 30 September fixes shipped: "coaching -
   * avery testperson" selected the Coaching Form and then asked for the
   * employee, because a separator after the form's name was read as "details
   * follow" and only a capitalised pair downstream could still find a name.
   */
  it.each([
    ["coaching - avery testperson"],
    ["coaching: avery testperson"],
    ["coaching, avery testperson"],
    ["coaching avery testperson"],
    ["coaching for avery testperson"],
    ["coaching - Avery Testperson"],
    ["coaching: Avery Testperson"],
    ["coaching, Avery Testperson"],
    ["coaching Avery Testperson"],
    ["coaching — avery testperson"],
    ["coaching; avery testperson"],
  ])("%s → Coaching Form for Avery Testperson, nothing asked", async (question) => {
    const replay = await converse(question);
    expectCard(replay, "coaching", "Avery Testperson");
    expect(replay.last.formProposal!.status).toBe("ready");
    expect(replay.last.content).not.toMatch(/employee's full name|who is this form for/i);
  });

  it("the same position works for every form, not only Coaching", async () => {
    expectCard(await converse("exit - avery testperson"), "stc-exit", "avery testperson");
    expectCard(await converse("ca: avery testperson"), "dpoa", "avery testperson");
    expectCard(await converse("demotion form, avery testperson"), "demotion", "avery testperson");
  });

  it.each([
    ["coaching - attendance"],
    ["coaching - footwear"],
    ["coaching - opening"],
    ["coaching - wearing slippers"],
    ["coaching - missed tour"],
    ["coaching: late arrival"],
  ])("%s → Coaching Form, and the topic is never the employee", async (question) => {
    expectCard(await converse(question), "coaching", null);
  });

  it("'coaching - policy review' stays the Coaching Form, with policy review as its topic", async () => {
    expectCard(await converse("coaching - policy review"), "coaching", null);
    expectCard(await converse("coaching - avery testperson, policy review"), "coaching", "avery testperson");
  });

  it("the details after the name are not part of it", async () => {
    const replay = await converse("coaching - avery testperson, today wearing slippers");
    expectCard(replay, "coaching", "avery testperson");
  });

  it("the production sequence: the second turn names Avery, keeps the intake, and 'wearing slippers' is not the name", async () => {
    const replay = await converse("coaching - attendance", "name is avery testperson, today wearing slippers");
    expectCard(replay, "coaching", "avery testperson");
    expect(replay.last.formProposal!.employeeName).not.toMatch(/slippers|wearing|today/i);
    const facts = replay.thread[2]!;
    expect(replay.last.formProposal!.sourceMessageIds).toContain(facts.id);
  });

  it("'name is …' is read only where it opens the message or a clause", async () => {
    const { extractEmployeeNames } = await import("@/lib/forms/proposal");
    expect(extractEmployeeNames("name is avery testperson, today wearing slippers")).toEqual(["avery testperson"]);
    expect(extractEmployeeNames("today wearing slippers. name: avery testperson")).toEqual(["avery testperson"]);
    expect(extractEmployeeNames("the company name is sun tan city")).toEqual([]);
  });

  it("an explicit switch in the same message still changes the form", async () => {
    expectCard(await converse("coaching form for Avery Testperson, actually make it a policy review"), "policy-review", "Avery Testperson");
  });
});
