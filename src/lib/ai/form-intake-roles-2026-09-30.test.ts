import { describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import { continuationFor, isProposalSuperseded } from "@/lib/forms/proposal-continuation";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { AccessScope, ChatMessage, Permission, Role } from "@/types";

/**
 * ============================================================================
 * THE 30 SEPTEMBER INTAKE FIXES, FOR EVERY ROLE — NOT ONLY THE ADMIN QA RAN AS
 * ============================================================================
 *
 * `form-intake-qa-2026-09-30.test.ts` replays the production QA conversations
 * as a global Admin, because that is the account the QA used. This file asks
 * the question that QA could not: does the same prompt behave the same way for
 * a Regional Manager, a District Manager, a Salon Director, an Assistant Salon
 * Director and an Employee?
 *
 * The answer this file pins, turn by turn through the real server path:
 *
 *   THE READING IS ROLE-AGNOSTIC. Which form, which employee, a correction, a
 *   continuation — every role that may create the form gets exactly the card
 *   Admin gets, field for field, apart from the salon.
 *
 *   PERMISSION DECIDES WHETHER THERE IS A CARD AT ALL, and a refusal says it is
 *   a refusal. It never asks for the employee, so a permission failure cannot
 *   pass for a parsing failure.
 *
 *   THE SALON IS WHERE ROLES DIVERGE, and the district/region case is pinned as
 *   it behaves TODAY: the employee is read, the salon cannot be verified, and
 *   the card offers no "Create draft". That is a known gap, not the goal — see
 *   `location-scope.ts` — and these tests are the ones to change when it closes.
 */

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("the proposal takes the library from its caller");
  },
  getTemplateByKey: async () => {
    throw new Error("the proposal must not read the library");
  },
}));

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

/* The same library, and the same permissions, the Admin QA file uses. */
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

/* ------------------------------------------------------------ actors -- */

interface Actor {
  label: string;
  role: Role;
  scope: AccessScope;
}

const ADMIN: Actor = {
  label: "Admin (global)",
  role: "admin",
  scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
};
const RM_REGION: Actor = {
  label: "Regional Manager (region scope)",
  role: "regional_manager",
  scope: { level: "region", primaryAreaId: "reg-patterson-madeline", alsoCoversAreaIds: [] },
};
/* The live RM account's configuration: see docs/authorization-qa-2026-09-14.md. */
const RM_SALON: Actor = {
  label: "Regional Manager (salon scope, as the live account is)",
  role: "regional_manager",
  scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
};
const DM: Actor = {
  label: "District Manager (district scope)",
  role: "district_manager",
  scope: { level: "district", primaryAreaId: "dist-dugan-rachael", alsoCoversAreaIds: [] },
};
const SD: Actor = {
  label: "Salon Director (one salon)",
  role: "salon_director",
  scope: { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] },
};
const ASD: Actor = {
  label: "Assistant Salon Director",
  role: "assistant_salon_director",
  scope: { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] },
};
const EMPLOYEE: Actor = {
  label: "Employee",
  role: "employee",
  scope: { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] },
};

const ALL = [ADMIN, RM_REGION, RM_SALON, DM, SD, ASD, EMPLOYEE];

/* ------------------------------------------------------------ replay -- */

let counter = 0;
function id(): string {
  counter += 1;
  return `msg-${counter}`;
}

interface Replay {
  thread: ChatMessage[];
  last: ChatMessage;
}

/**
 * The chat screen's loop, as in the Admin QA file, with the actor as the one
 * thing that varies. A turn the form path declines becomes an advice reply.
 */
async function converse(actor: Actor, ...turns: string[]): Promise<Replay> {
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
      actor: { role: actor.role, scope: actor.scope },
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
  return { thread, last: thread[thread.length - 1]! };
}

/**
 * What the READING produced, with the salon left out: the one part of a card
 * that is meant to differ by account. Every role allowed the form must match
 * Admin on all of this.
 */
function reading(replay: Replay) {
  return replay.thread
    .filter((message) => message.role === "assistant")
    .map((message) =>
      message.formProposal
        ? {
            card: true,
            templateKey: message.formProposal.templateKey,
            employeeName: message.formProposal.employeeName,
            employeeKnown: message.formProposal.employeeName !== null,
            employeeRole: message.formProposal.employeeRole,
            formDate: message.formProposal.formDate,
            sourceTurns: message.formProposal.sourceMessageIds.length,
          }
        : {
            card: false,
            selection: message.formSelection
              ? [message.formSelection.primary, ...message.formSelection.additional].map((choice) => choice.templateKey)
              : null,
            suggestions: message.followUpSuggestions ?? null,
          },
    );
}

/** The refusal a role without the template's permission gets. */
function expectRefused(replay: Replay, formName: string) {
  expect(replay.last.formProposal, replay.last.content).toBeUndefined();
  expect(replay.last.formSelection).toBeUndefined();
  expect(replay.last.content).toContain(`Your role cannot create a **${formName}**`);
  // A permission failure must never read as "I didn't catch the name".
  expect(replay.last.content).not.toMatch(/full name|who is this form for|tell me the employee/i);
  expect(replay.last.content).not.toMatch(/avery/i);
}

/* ================================================ 0. the matrix itself === */

/*
 * WRITTEN OUT, NOT DERIVED FROM THE MATRIX. A table computed from
 * `DEFAULT_PERMISSION_MATRIX` would agree with any change to it; this one
 * fails when somebody widens or narrows a role, which is when these
 * expectations need a human to look at them again.
 */
const FORMS: { key: string; name: string; prompt: string }[] = [
  { key: "coaching", name: "Coaching Form", prompt: "coaching - avery testperson" },
  { key: "policy-review", name: "Policy Review", prompt: "Policy Review for Avery Testperson about late opening" },
  { key: "dpoa", name: "Corrective Action Form", prompt: "CA for Avery Testperson" },
  { key: "stc-exit", name: "Resignation/Exit Form", prompt: "exit - avery testperson" },
  { key: "follow-up-coaching", name: "Follow-Up Coaching Form", prompt: "Follow-up coaching form for Avery Testperson" },
  { key: "demotion", name: "Demotion Form", prompt: "demotion form, avery testperson" },
  { key: "position-transfer", name: "Position Transfer Form", prompt: "Position transfer form for Avery Testperson" },
  { key: "sdit-epp", name: "SDIT EPP", prompt: "SDIT EPP for Avery Testperson" },
  { key: "prescreen-phone-interview", name: "Prescreen / Phone Interview Form", prompt: "Prescreen / Phone Interview Form for Avery Testperson" },
];

const EVERY_FORM = FORMS.map((form) => form.key);

const CREATES: Record<Role, readonly string[]> = {
  admin: EVERY_FORM,
  owner: EVERY_FORM,
  developer: EVERY_FORM,
  regional_manager: EVERY_FORM,
  district_manager: EVERY_FORM,
  // Everything but the EPPs: `create_epp` starts at District Manager.
  salon_director: EVERY_FORM.filter((key) => key !== "sdit-epp"),
  // `create_coaching` is coaching ADVICE; no form permission at all.
  assistant_salon_director: [],
  // Ask Sunny, the knowledge base and training videos — nothing else.
  employee: [],
};

describe("the form-creation matrix by role, as the server applies it", () => {
  it.each(Object.keys(CREATES) as Role[])("%s", (role) => {
    const permitted = LIBRARY.filter((summary) =>
      hasPermission(DEFAULT_PERMISSION_MATRIX, role, summary.requiredPermission as Permission),
    ).map((summary) => summary.key);
    expect(permitted.sort()).toEqual([...CREATES[role]].sort());
  });
});

/* ============================== 1. the core prompt, role by role === */

describe("'coaching - avery testperson', for each role", () => {
  it("Admin: a ready card for avery testperson, no salon recorded", async () => {
    const replay = await converse(ADMIN, "coaching - avery testperson");
    const card = replay.last.formProposal!;
    expect(card.templateKey).toBe("coaching");
    expect(card.employeeName).toBe("avery testperson");
    expect(card.status).toBe("ready");
    expect(card.locationResolution).toBe("not_applicable");
    expect(card.supportsInlineDraft).toBe(true);
  });

  it.each([RM_SALON, SD])("$label: a ready card for avery testperson at their own salon", async (actor) => {
    const replay = await converse(actor, "coaching - avery testperson");
    const card = replay.last.formProposal!;
    expect(card.templateKey).toBe("coaching");
    expect(card.employeeName).toBe("avery testperson");
    expect(card.status).toBe("ready");
    expect(card.locationResolution).toBe("resolved");
    expect(card.locationId).toBe(actor.scope.primaryAreaId);
    expect(card.supportsInlineDraft).toBe(true);
  });

  /*
   * TODAY'S BEHAVIOUR, PINNED — NOT THE INTENDED END STATE.
   *
   * The name is read exactly as for Admin. What stops the card is the salon:
   * `proposeLocation` cannot expand a district or region into salons, so the
   * proposal waits on a salon the manager has no way to supply, and no create
   * action is offered. The server would accept the same form with no salon
   * (see the route test), so this is a chat-only dead end for these accounts.
   */
  it.each([DM, RM_REGION])("$label: the name is read, but the card stops at an unverifiable salon", async (actor) => {
    const replay = await converse(actor, "coaching - avery testperson");
    const card = replay.last.formProposal!;
    expect(card.templateKey).toBe("coaching");
    expect(card.employeeName).toBe("avery testperson");
    expect(card.status).toBe("needs_location");
    expect(card.locationResolution).toBe("unavailable");
    expect(card.authorizedLocationIds).toEqual([]);
    expect(card.supportsInlineDraft).toBe(false);
    // It does not ask for the employee — the parsing succeeded.
    expect(replay.last.content).not.toMatch(/full name|who is this form for/i);
  });

  it.each([ASD, EMPLOYEE])("$label: refused plainly, with nothing else offered", async (actor) => {
    const replay = await converse(actor, "coaching - avery testperson");
    expectRefused(replay, "Coaching Form");
    expect(replay.last.content).toMatch(/ask your district manager/i);
  });
});

/* =========================== 2. the reading is identical for every role === */

/*
 * THE PROMPTS THE 30 SEPTEMBER FIXES WERE WRITTEN FOR — separators, lower
 * case, "name is …", corrections, company-name exclusion, topics that are not
 * names — replayed for every role that may create a Coaching Form, and
 * compared with Admin's reading of the same conversation.
 */
const CONVERSATIONS: string[][] = [
  // separators, both cases
  ["coaching - avery testperson"],
  ["coaching: avery testperson"],
  ["coaching, avery testperson"],
  ["coaching; avery testperson"],
  ["coaching — avery testperson"],
  ["coaching avery testperson"],
  ["coaching - Avery Testperson"],
  ["COACHING FORM FOR AVERY TESTPERSON"],
  // lower case in narrative positions
  ["avery testperson needs a coaching form today"],
  ["i coached avery testperson on client tours and need the form"],
  ["coaching form\nemployee: avery testperson\nissue: skipped a tour"],
  // "name is …"
  ["coaching - attendance", "name is avery testperson, today wearing slippers"],
  ["I need a coaching form", "Her name is Avery Testperson"],
  ["I need a coaching form", "it's avery testperson"],
  // corrections
  ["Coaching form for Jordan Testperson", "No, not Jordan Testperson. Avery Testperson."],
  ["Coaching form for Jordan", "No, not Jordan. Avery."],
  ["Coaching form for Avery Testperson", "Actually it's for Jordan Testperson"],
  // topics and incident words are never the employee
  ["coaching - attendance"],
  ["coaching - wearing slippers"],
  ["coaching - policy review"],
  ["coaching - avery testperson, today wearing slippers"],
  ["coaching form for Avery Testperson; topic is policy review"],
  // company name is not a person
  ["coaching form", "the company name is sun tan city"],
  // two people, and a pronoun
  ["coaching form for Avery Testperson and Jordan Testperson"],
  ["create coaching form for her"],
  // the clarification between advice and the form
  ["coach Avery Testperson"],
  ["coach Avery", "the form"],
];

describe("every role allowed a Coaching Form reads the conversation exactly as Admin does", () => {
  const PERMITTED = [RM_REGION, RM_SALON, DM, SD];

  it.each(CONVERSATIONS.map((turns) => [turns.join("  ⏎  "), turns] as const))("%s", async (_label, turns) => {
    const admin = reading(await converse(ADMIN, ...turns));
    for (const actor of PERMITTED) {
      expect(reading(await converse(actor, ...turns)), actor.label).toEqual(admin);
    }
  });

  it("including the separator fix's positive cases, which Admin reads as Avery", async () => {
    for (const actor of [ADMIN, ...PERMITTED]) {
      for (const question of ["coaching - avery testperson", "coaching: avery testperson", "coaching; avery testperson"]) {
        const card = (await converse(actor, question)).last.formProposal!;
        expect(card.employeeName?.toLowerCase(), `${actor.label}: ${question}`).toBe("avery testperson");
      }
    }
  });

  it("and the corrections land on the same person", async () => {
    for (const actor of [ADMIN, ...PERMITTED]) {
      const replay = await converse(actor, "Coaching form for Jordan Testperson", "No, not Jordan Testperson. Avery Testperson.");
      expect(replay.last.formProposal!.employeeName, actor.label).toBe("Avery Testperson");
    }
  });
});

/* ============================================ 3. every form, every role === */

describe("form routing by role: the permitted form is proposed, the rest refused", () => {
  const cases = ALL.flatMap((actor) => FORMS.map((form) => [actor.label, form.name, actor, form] as const));

  it.each(cases)("%s — %s", async (_actorLabel, _formName, actor, form) => {
    const replay = await converse(actor, form.prompt);
    if (CREATES[actor.role].includes(form.key)) {
      const admin = await converse(ADMIN, form.prompt);
      expect(replay.last.formProposal, replay.last.content).toBeDefined();
      expect(replay.last.formProposal!.templateKey).toBe(form.key);
      expect(replay.last.formProposal!.employeeName).toBe(admin.last.formProposal!.employeeName);
      expect(replay.last.formProposal!.employeeName?.toLowerCase()).toBe("avery testperson");
    } else {
      expectRefused(replay, form.name);
    }
  });

  /*
   * THE ONE PLACE THE SAME PROMPT IS MEANT TO LOOK DIFFERENT. "Which form?"
   * offers only forms the role may start, so the picker is role-filtered by
   * design — and it must never offer a form the role would be refused.
   */
  it.each(ALL)("$label: the 'which form?' picker offers only forms this role may create", async (actor) => {
    const replay = await converse(actor, "I need to fill out a form for avery testperson");
    const selection = replay.last.formSelection;
    const offered = selection ? [selection.primary, ...selection.additional].map((choice) => choice.templateKey) : [];
    expect(replay.last.formProposal).toBeUndefined();
    for (const key of offered) expect(CREATES[actor.role], `${actor.label} offered ${key}`).toContain(key);
    if (CREATES[actor.role].length === 0) expect(offered).toEqual([]);
    else expect(offered.length).toBeGreaterThan(0);
  });

  it("a Salon Director refused the SDIT EPP is shown the forms they CAN start", async () => {
    const replay = await converse(SD, "SDIT EPP for Avery Testperson");
    expectRefused(replay, "SDIT EPP");
    expect(replay.last.content).toContain("You can start these");
    expect(replay.last.content).toContain("Coaching Form");
    expect(replay.last.content).not.toMatch(/- SDIT EPP/);
  });
});

/* ======================================== 4. the intake across turns === */

describe("an unfinished intake survives follow-up turns for every role that may start it", () => {
  const TURNS = ["coaching form", "employee: avery testperson", "she missed the opening checklist today"];

  it.each([ADMIN, RM_REGION, RM_SALON, DM, SD])("$label", async (actor) => {
    const replay = await converse(actor, ...TURNS);
    const card = replay.last.formProposal!;
    expect(card, replay.last.content).toBeDefined();
    expect(card.templateKey).toBe("coaching");
    expect(card.employeeName).toBe("avery testperson");
    const facts = replay.thread[4]!;
    expect(card.sourceMessageIds).toContain(facts.id);
    expect(reading(replay)).toEqual(reading(await converse(ADMIN, ...TURNS)));
  });

  it.each([ASD, EMPLOYEE])("$label: refused once, and nothing is left open to continue", async (actor) => {
    const replay = await converse(actor, ...TURNS);
    expect(replay.thread[1]!.content).toContain("Your role cannot create a **Coaching Form**");
    // No card was ever produced, so the browser has no continuation to send…
    expect(continuationFor(replay.thread)).toBeNull();
    // …and the follow-ups are ordinary turns, never a form.
    expect(replay.thread.some((message) => message.formProposal)).toBe(false);
  });

  it("a forged continuation hint confers nothing on a role without the permission", async () => {
    const { proposeFormForTurn } = await import("./form-proposal");
    const answer = await proposeFormForTurn({
      history: [],
      question: "avery testperson",
      actor: { role: EMPLOYEE.role, scope: EMPLOYEE.scope },
      continueTemplateKey: "coaching",
      summaries: LIBRARY as never,
      today: "2026-09-30",
    });
    expect(answer?.formProposal).toBeUndefined();
    expect(answer?.content).toContain("Your role cannot create a **Coaching Form**");
  });
});

/* =========================================== 5. stale cards, per role === */

describe("a corrected card is superseded for every role", () => {
  it.each([ADMIN, RM_REGION, RM_SALON, DM, SD])("$label", async (actor) => {
    const { checkProposalIsCurrent } = await import("@/lib/forms/proposal-currency");
    const replay = await converse(actor, "Coaching form for Jordan Testperson", "No, not Jordan Testperson. Avery Testperson.");
    const jordan = replay.thread[1]!.formProposal!;
    const avery = replay.thread[3]!.formProposal!;
    expect(jordan.employeeName).toBe("Jordan Testperson");
    expect(avery.employeeName).toBe("Avery Testperson");
    expect(isProposalSuperseded(replay.thread, jordan.proposalId)).toBe(true);
    expect(isProposalSuperseded(replay.thread, avery.proposalId)).toBe(false);

    const conversation = replay.thread.map(({ id, role, content }) => ({ id, role, content }));
    expect(checkProposalIsCurrent({ conversation, templateKey: "coaching", employeeName: "Jordan Testperson" }).current).toBe(false);
    expect(checkProposalIsCurrent({ conversation, templateKey: "coaching", employeeName: "Avery Testperson" }).current).toBe(true);
  });

  it("the lower-case separator card is current when the server re-reads its conversation", async () => {
    const { checkProposalIsCurrent } = await import("@/lib/forms/proposal-currency");
    for (const actor of [ADMIN, SD, DM]) {
      const replay = await converse(actor, "coaching - avery testperson");
      const conversation = replay.thread.map(({ id, role, content }) => ({ id, role, content }));
      expect(
        checkProposalIsCurrent({ conversation, templateKey: "coaching", employeeName: replay.last.formProposal!.employeeName! }),
        actor.label,
      ).toEqual({ current: true });
    }
  });
});
