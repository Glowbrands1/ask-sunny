import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRODUCTION, 26 OCT 2026 — "AT DODGE, NE" IS A PLACE, NOT A SECOND PERSON
 * ============================================================================
 *
 * A manager typed "Create a CA for Odalys Merriweather at Dodge, NE. She did
 * not clock in on 10/22." The card showed; Create was refused because the
 * conversation "names more than one person (Odalys Merriweather, NE)". The
 * "never", "didn't" and "no call" sentences were created; only "did not"
 * with the state code was refused. These tests drive `POST
 * /api/forms/instances` with the body `createInlineForm` sends, using the
 * manager's exact wording. Odalys Merriweather, Rowan Pell and Ne Oakes are
 * invented names. STATE_CODE_NOT_A_PERSON_ENABLED is the fix; off, the
 * refusal is pinned as it is on main.
 */

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
  const conversation = turns.flatMap((turn) => [said(turn), answered("Here is what I would put on a Corrective Action Form.")]);
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

/** The manager's sentence, and the same with each of the salon cities they named. */
const DID_NOT = [
  "Create a CA for Odalys Merriweather at Dodge, NE. She did not clock in on 10/22.",
  "Create a CA for Odalys Merriweather at Lawrence, KS. She did not clock in on 10/22.",
  "Create a CA for Odalys Merriweather at Kearney, NE. She did not clock in on 10/22.",
  "Create a CA for Odalys Merriweather at Grand Island, NE. She did not clock in on 10/22.",
];
const DID_NOT_LOWER = [
  "create a ca for odalys merriweather at dodge, ne. she did not clock in on 10/22",
  "create a ca for odalys merriweather at lawrence, ks. she did not clock in on 10/22",
  "create a ca for odalys merriweather at kearney, ne. she did not clock in on 10/22",
  "create a ca for odalys merriweather at grand island, ne. she did not clock in on 10/22",
];
const OTHER_WORDING = [
  "Create a CA for Odalys Merriweather at Dodge, NE. She never clocked in on 10/22.",
  "Create a CA for Odalys Merriweather at Dodge, NE. He didn't clock in on 10/22.",
  "Create a CA for Odalys Merriweather at Dodge, NE. No call no show on 10/22.",
];
const TWO_PEOPLE = "Create a CA for Odalys Merriweather and Rowan Pell at Dodge, NE. She did not clock in on 10/22.";
const NE_AS_A_NAME = "Create a CA for Ne Oakes at Dodge, NE. She did not clock in on 10/22.";

beforeEach(() => {
  vi.resetModules();
  // The default reading. GROUNDED_ENTITIES_ENABLED / INTENT_EXTRACTION_ENABLED already drop a roster
  // state ("NE", "KS") from the people; they have their own test below.
  delete process.env.STATE_CODE_NOT_A_PERSON_ENABLED;
  delete process.env.GROUNDED_ENTITIES_ENABLED;
  delete process.env.INTENT_EXTRACTION_ENABLED;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of ["@/lib/auth/server", "@/lib/forms/repository", "@/lib/forms/instances"]) vi.doUnmock(mod);
  vi.resetModules();
});

describe("STATE_CODE_NOT_A_PERSON_ENABLED on: a state after the salon's city is never a second person", () => {
  beforeEach(() => {
    process.env.STATE_CODE_NOT_A_PERSON_ENABLED = "true";
  });

  for (const sentence of DID_NOT) {
    it(`creates the card for "${sentence}"`, async () => {
      const result = await createFor("Odalys Merriweather", sentence);
      expect(result.body.error).toBeUndefined();
      expect(result.status).toBe(200);
      expect(result.created).toEqual(["Odalys Merriweather"]);
    });
  }

  for (const sentence of DID_NOT_LOWER) {
    it(`creates the card for the lower-case "${sentence}"`, async () => {
      const result = await createFor("odalys merriweather", sentence);
      expect(result.body.error).toBeUndefined();
      expect(result.status).toBe(200);
      expect(result.created).toEqual(["odalys merriweather"]);
    });
  }

  for (const sentence of OTHER_WORDING) {
    it(`still creates "${sentence}"`, async () => {
      const result = await createFor("Odalys Merriweather", sentence);
      expect(result.status).toBe(200);
      expect(result.created).toEqual(["Odalys Merriweather"]);
    });
  }

  it("reads the state after the salon's name as part of the place: 'at the Kearney, NE salon', 'Dodge, NE, she …', 'Dodge, NE 68022'", async () => {
    for (const sentence of [
      "Create a CA for Odalys Merriweather at the Kearney, NE salon. She did not clock in on 10/22.",
      "Create a CA for Odalys Merriweather at Dodge, NE, she did not clock in on 10/22.",
      "Create a CA for Odalys Merriweather at Dodge, NE 68022. She did not clock in on 10/22.",
    ]) {
      const result = await createFor("Odalys Merriweather", sentence);
      expect(result.status, sentence).toBe(200);
      expect(result.created, sentence).toEqual(["Odalys Merriweather"]);
    }
  });

  it("keeps the employee when the salon and its state come in a later turn", async () => {
    const result = await createFor(
      "Odalys Merriweather",
      "Create a CA for Odalys Merriweather.",
      "She works at Dodge, NE. She did not clock in on 10/22.",
    );
    expect(result.body.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.created).toEqual(["Odalys Merriweather"]);
  });

  it("still refuses two people — and no longer lists the state as one of them", async () => {
    const result = await createFor("Odalys Merriweather", TWO_PEOPLE);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("proposal_superseded");
    expect(result.body.error).toBe(
      "This proposal is out of date: the conversation now names more than one person (Odalys Merriweather, Rowan Pell). Tell Sunny which one the form is for, then use the newest proposal.",
    );
    expect(result.created).toEqual([]);
  });

  it("reads a turn with the salon's state exactly as the same turn without it", async () => {
    // A person in the account, not the form's subject, is the incident's
    // (the District Manager rule in `proposal.ts`, `formRecipient`): created
    // without the state on main, and now with it too.
    for (const sentence of [
      "Create a CA for Odalys Merriweather at Dodge. Rowan Pell did not clock in on 10/22 either.",
      "Create a CA for Odalys Merriweather at Dodge, NE. Rowan Pell did not clock in on 10/22 either.",
    ]) {
      const result = await createFor("Odalys Merriweather", sentence);
      expect(result.status, sentence).toBe(200);
      expect(result.created, sentence).toEqual(["Odalys Merriweather"]);
    }
  });

  it("'Ne' as a first name stays one person: Ne Oakes", async () => {
    const result = await createFor("Ne Oakes", NE_AS_A_NAME);
    expect(result.status).toBe(200);
    expect(result.created).toEqual(["Ne Oakes"]);
    const other = await createFor("Odalys Merriweather", NE_AS_A_NAME);
    expect(other.status).toBe(409);
    expect(other.body.error).toBe(
      "This proposal is out of date: the conversation now says the form is for Ne Oakes, not Odalys Merriweather. Use the newest proposal.",
    );
  });

  it("a state code straight after a person's surname is still a question: 'Odalys Merriweather, NE' is the shape of a list", async () => {
    const result = await createFor("Odalys Merriweather", "Create a CA for Odalys Merriweather, NE. She did not clock in on 10/22.");
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("(Odalys Merriweather, NE)");
  });

  it("'Sacramento, CA' (STATE_CA_GUARD) and the Salon Director 'SD' are unchanged: created as before", async () => {
    for (const sentence of [
      "Create a CA for Odalys Merriweather at Sacramento, CA. She did not clock in on 10/22.",
      "Create a CA for Odalys Merriweather at Sioux Falls, SD. She did not clock in on 10/22.",
      "Create a CA for Odalys Merriweather, SD at Kearney. She did not clock in on 10/22.",
    ]) {
      const result = await createFor("Odalys Merriweather", sentence);
      expect(result.status, sentence).toBe(200);
    }
  });
});

describe("STATE_CODE_NOT_A_PERSON_ENABLED with GROUNDED_ENTITIES_ENABLED and INTENT_EXTRACTION_ENABLED on", () => {
  beforeEach(() => {
    process.env.STATE_CODE_NOT_A_PERSON_ENABLED = "true";
    process.env.GROUNDED_ENTITIES_ENABLED = "true";
    process.env.INTENT_EXTRACTION_ENABLED = "true";
  });

  it("creates the manager's sentence, still refuses two people, and reads the account as it does without the state", async () => {
    expect((await createFor("Odalys Merriweather", DID_NOT[0]!)).status).toBe(200);
    expect((await createFor("odalys merriweather", DID_NOT_LOWER[0]!)).status).toBe(200);
    const two = await createFor("Odalys Merriweather", TWO_PEOPLE);
    expect(two.status).toBe(409);
    expect(two.body.error).toContain("(Odalys Merriweather, Rowan Pell)");
    const account = await createFor(
      "Odalys Merriweather",
      "Create a CA for Odalys Merriweather at Dodge, NE. Rowan Pell did not clock in on 10/22 either.",
    );
    expect(account.status).toBe(200);
  });
});

describe("STATE_CODE_NOT_A_PERSON_ENABLED off: pinned to main", () => {
  for (const sentence of DID_NOT) {
    it(`still refuses "${sentence}" with the state listed as a person`, async () => {
      const result = await createFor("Odalys Merriweather", sentence);
      const state = /, ([A-Z]{2})\./.exec(sentence)![1];
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("proposal_superseded");
      expect(result.body.error).toBe(
        `This proposal is out of date: the conversation now names more than one person (Odalys Merriweather, ${state}). Tell Sunny which one the form is for, then use the newest proposal.`,
      );
      expect(result.created).toEqual([]);
    });
  }

  it("still refuses the lower-case sentence", async () => {
    const result = await createFor("odalys merriweather", DID_NOT_LOWER[0]!);
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("(odalys merriweather, ne)");
  });

  it("still refuses when the state comes in a later turn", async () => {
    const result = await createFor(
      "Odalys Merriweather",
      "Create a CA for Odalys Merriweather.",
      "She works at Dodge, NE. She did not clock in on 10/22.",
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toBe(
      "This proposal is out of date: the conversation now says the form is for NE, not Odalys Merriweather. Use the newest proposal.",
    );
  });

  for (const sentence of OTHER_WORDING) {
    it(`creates "${sentence}" as before`, async () => {
      const result = await createFor("Odalys Merriweather", sentence);
      expect(result.status).toBe(200);
      expect(result.created).toEqual(["Odalys Merriweather"]);
    });
  }

  it("refuses two people with the state among them, as before", async () => {
    const result = await createFor("Odalys Merriweather", TWO_PEOPLE);
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("(Odalys Merriweather, Rowan Pell, NE)");
  });

  it("Ne Oakes is one person, as before", async () => {
    const result = await createFor("Ne Oakes", NE_AS_A_NAME);
    expect(result.status).toBe(200);
    expect(result.created).toEqual(["Ne Oakes"]);
  });
});
