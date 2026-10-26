import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * MANAGER, 26 OCT 2026 — "YES PAYROL LDEDUCT" IS A PAYROLL ANSWER, NOT A PERSON
 * ============================================================================
 *
 * A manager emailed Pau a screenshot of the "proposal error at the bottom"
 * (Ask Sunny production, conv 2a156f63). Her five turns, word for word, with
 * an invented name (Quinn Marlowe):
 *
 *   1 "i need to issue a ca for someone being late"
 *   2 "quinn marlowe was late on 10/20 and the salon was opened late"
 *   3 "she was issued a verbal ca on 10.1 for this same thing"
 *   4 "yes payrol ldeduct"
 *   5 "i dont know the amount"
 *
 * After turn 4 the card read "This proposal is out of date: the conversation
 * now says the form is for payrol ldeduct, not quinn marlowe. Use the newest
 * proposal." — the typed-name reader took the reply after "yes" as a name.
 * These tests drive `POST /api/forms/instances` with the body
 * `createInlineForm` sends. PAYROLL_TYPO_NOT_A_NAME_ENABLED is the fix; off,
 * the refusal is pinned as it is on main.
 */

const CARD = "I'll draft a **Corrective Action Form** for **quinn marlowe** from what you've described.";

const ORIGINAL = { ...process.env };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function load() {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  const created: { employeeName: string; templateKey?: string }[] = [];

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "admin" as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: { subject: "user-1", email: "admin@example.com", displayName: "Admin", role: "admin", scope: GLOBAL, verified: true },
          permission,
          provider: "supabase",
        };
      },
    };
  });

  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async (key: string) =>
      ({
        dpoa: { id: "tpl-dpoa", key: "dpoa", name: "Corrective Action Form", requiredPermission: "create_corrective_action", active: true },
      })[key] ?? null,
  }));

  vi.doMock("@/lib/forms/instances", () => ({
    createInstance: async (input: { employeeName: string; templateKey?: string }) => {
      created.push(input);
      return { id: "inst-1", ...input };
    },
    applyStatedFacts: async () => undefined,
    listInstances: async () => [],
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    deleteDemoInstances: async () => ({ deleted: 0 }),
    InstanceProtectedError: class extends Error {},
  }));

  const route = await import("./instances/route");
  return { route, created };
}

let counter = 0;
function said(content: string): Pick<ChatMessage, "id" | "role" | "content"> {
  counter += 1;
  return { id: `m-${counter}`, role: "user", content };
}
function answered(content: string): Pick<ChatMessage, "id" | "role" | "content"> {
  counter += 1;
  return { id: `m-${counter}`, role: "assistant", content };
}

function create(employeeName: string, turns: string[]): Request {
  const conversation = turns.flatMap((turn) => [said(turn), answered(CARD)]);
  return new Request("https://app.test/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateKey: "dpoa",
      employeeName,
      variantKey: null,
      employeeRole: null,
      locationId: null,
      source: "ask_sunny",
      conversation,
    }),
  });
}

async function createFor(employeeName: string, ...turns: string[]) {
  const { route, created } = await load();
  const response = await route.POST(create(employeeName, turns));
  const body = (await response.json()) as { error?: string; code?: string };
  return { status: response.status, body, created: created.map((form) => form.employeeName) };
}

const TURNS = [
  "i need to issue a ca for someone being late",
  "quinn marlowe was late on 10/20 and the salon was opened late",
  "she was issued a verbal ca on 10.1 for this same thing",
  "yes payrol ldeduct",
  "i dont know the amount",
];
/** Sentence case: each turn opens with a capital, and "i" is "I". */
const sentenceCase = (turn: string) => turn.replace(/^([a-z])/, (letter) => letter.toUpperCase()).replace(/\bi\b/g, "I");
const CASINGS = [
  ["lowercase", (turn: string) => turn, "quinn marlowe"],
  ["Sentence case", sentenceCase, "Quinn Marlowe"],
] as const;
const STALE = (name: string, employee: string) =>
  `This proposal is out of date: the conversation now says the form is for ${name}, not ${employee}. Use the newest proposal.`;
/** The other payroll answers QA asked for, typos included. */
const VARIANTS = ["yes payrol ldeduct", "yes payroll deduct", "payrol deduct yes", "yes payroll ldeduct", "Yes payrol ldeduct"];
/** Ask Sunny production's name flags (26 Oct 2026). */
const PRODUCTION = ["NOT_A_NAME_GUARD_ENABLED", "STATE_CODE_NOT_A_PERSON_ENABLED", "NAME_BEFORE_TITLE_ENABLED", "INTENT_EXTRACTION_ENABLED"];
const FLAG = "PAYROLL_TYPO_NOT_A_NAME_ENABLED";

beforeEach(() => {
  vi.resetModules();
  for (const name of [...PRODUCTION, FLAG, "GROUNDED_ENTITIES_ENABLED"]) delete process.env[name];
  for (const name of PRODUCTION) process.env[name] = "true";
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) vi.doUnmock(mod);
  vi.resetModules();
});

describe(`${FLAG} on: a payroll answer never names the employee`, () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
  });

  for (const [casing, cased, employee] of CASINGS) {
    for (const upTo of [4, 5]) {
      it(`${casing}: creates the card after turn ${upTo}, with no "out of date" warning`, async () => {
        const result = await createFor(employee, ...TURNS.slice(0, upTo).map(cased));
        expect(result.body.error ?? "").not.toContain("out of date");
        expect(result.status).toBe(200);
        expect(result.created).toEqual([employee]);
      });
    }
  }

  for (const variant of VARIANTS) {
    it(`"${variant}" after the card keeps the employee`, async () => {
      const result = await createFor("quinn marlowe", ...TURNS.slice(0, 3), variant);
      expect(result.status).toBe(200);
      expect(result.created).toEqual(["quinn marlowe"]);
    });
  }

  it("still refuses a real change of employee", async () => {
    const result = await createFor("quinn marlowe", ...TURNS.slice(0, 3), "actually it's for corvin mallow");
    expect(result.status).toBe(409);
    expect(result.body.error).toBe(STALE("corvin mallow", "quinn marlowe"));
  });

  it("a person whose name only looks like payroll is still a person", async () => {
    const { readEmployeeMentions } = await import("@/lib/forms/proposal");
    expect(readEmployeeMentions("create a ca for payton rolls").names).toEqual(["payton rolls"]);
    expect(readEmployeeMentions("yes payrol ldeduct").names).toEqual([]);
  });
});

describe(`${FLAG} off: pinned to main`, () => {
  for (const [casing, cased, employee] of CASINGS) {
    it(`${casing}: refuses after turn 4 with the manager's warning`, async () => {
      const result = await createFor(employee, ...TURNS.slice(0, 4).map(cased));
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("proposal_superseded");
      expect(result.body.error).toBe(STALE("payrol ldeduct", employee));
      expect(result.created).toEqual([]);
    });
  }

  it("the flag reads off by default", async () => {
    const { payrollTypoNotANameEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(payrollTypoNotANameEnabled()).toBe(false);
  });
});
