import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * A CORRECTIVE ACTION SAVED FROM THE FORM CARD KEEPS ITS SOURCED POLICY
 * ============================================================================
 *
 * ASK SUNNY FEEDBACK, 7 OCTOBER 2026: "it is not letting me complete it due to
 * policy verification being incomplete even though it is listed above."
 *
 * Ask Sunny drafted the Corrective Action Form with Direct Policy quoted from
 * the approved manual. The manager filled in the job title and prior actions;
 * the card saved EVERY field, and the save rewrote all of them as the
 * manager's with no provenance — so the untouched policy quote lost its
 * verification and finalize asked for an override.
 *
 * Driven through the real routes the card calls: PATCH (save), GET (reopen),
 * POST finalize. Only identity and the database are stand-ins.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return {
    ...actual,
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  };
});

vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async (_request: Request, permission: string) => ({
    identity: {
      subject: "dm-1",
      email: "dm@example.com",
      displayName: "District Manager",
      role: "district_manager",
      scope: { level: "salon", primaryAreaId: "loc-0410", alsoCoversAreaIds: [] },
      verified: true,
    },
    permission,
    provider: "supabase",
  }),
}));

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { applyAssistantDraft, createInstance } = await import("@/lib/forms/instances");
const route = await import("./instances/[id]/route");

const SOURCED = {
  grounded: true,
  verified: true,
  source: "official_policy_manual",
  documentId: "doc-manual",
  documentTitle: "JBA Policy Manual",
};
const POLICY_TEXT =
  "The Company expects Employees to follow rules of conduct that will protect the interests and safety of all customers, Employees, and The Company.";

function call(method: string, id: string, body?: unknown) {
  const request = new Request(`http://localhost/api/forms/instances/${id}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const handler = route[method as "GET" | "PATCH" | "POST"];
  return handler(request, { params: Promise.resolve({ id }) });
}

async function draftedCorrectiveForm() {
  const instance = await createInstance({
    templateKey: "dpoa",
    variantKey: null,
    employeeName: "Synthetic Employee",
    createdBy: "dm-1",
    source: "ask_sunny",
    locationId: "loc-0410",
  });
  await applyAssistantDraft(
    instance.id,
    {
      values: {
        observation: "Observed:\nThe 10 minute disinfect was not completed.",
        action_plan: "Complete the 10 minute disinfect every assigned shift.",
        policy_language: POLICY_TEXT,
      },
    },
    "sunny",
    { policy_language: SOURCED },
  );
  return instance.id;
}

/** What the card sends: every value it holds, with the manager's edits. */
async function cardSave(id: string, edits: Record<string, string>) {
  const opened = (await (await call("GET", id)).json()) as {
    values: { fieldKey: string; value: string | null }[];
  };
  const values = Object.fromEntries(
    opened.values.filter((row) => row.value !== null).map((row) => [row.fieldKey, row.value!]),
  );
  return call("PATCH", id, { values: { ...values, ...edits } });
}

beforeEach(async () => {
  for (const key of Object.keys(store)) store[key as keyof FakeStore] = [];
  await ensureTemplateLibrary();
});

describe("Corrective Action Form: draft, edit, save, reopen, finalize", () => {
  it("finalizes without an override when the manager edits other fields", async () => {
    const id = await draftedCorrectiveForm();

    const saved = await cardSave(id, {
      job_title: "Tanning Consultant",
      prior_actions: "Written CA 08.31.2026",
    });
    expect(saved.status).toBe(200);

    // Reopened, the quote is still Ask Sunny's and still sourced.
    const reopened = (await (await call("GET", id)).json()) as {
      values: { fieldKey: string; value: string | null; filledBy: string; provenance: Record<string, unknown> }[];
    };
    const policy = reopened.values.find((row) => row.fieldKey === "policy_language")!;
    expect(policy.value).toBe(POLICY_TEXT);
    expect(policy.filledBy).toBe("ai");
    expect(policy.provenance).toEqual(SOURCED);
    const title = reopened.values.find((row) => row.fieldKey === "job_title")!;
    expect(title.filledBy).toBe("manager");

    const finalized = await call("POST", id, { action: "finalize" });
    expect(finalized.status).toBe(200);
    const after = (await (await call("GET", id)).json()) as {
      events: { kind: string; detail: Record<string, unknown> }[];
    };
    const event = after.events.find((entry) => entry.kind === "finalized")!;
    expect(event.detail.policyVerificationOverride).toBeUndefined();
    expect(event.detail.unverifiedPolicy).toBeUndefined();
  });

  it("asks again once the manager rewrites the policy, and records the override", async () => {
    const id = await draftedCorrectiveForm();
    await cardSave(id, { policy_language: `${POLICY_TEXT} (paraphrased by me)` });

    const refused = await call("POST", id, { action: "finalize" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "policy_verification_required",
      fields: ["policy_language"],
    });

    const anyway = await call("POST", id, { action: "finalize", acknowledgeUnverifiedPolicy: true });
    expect(anyway.status).toBe(200);
    const after = (await (await call("GET", id)).json()) as {
      events: { kind: string; actor: string; detail: Record<string, unknown> }[];
    };
    const event = after.events.find((entry) => entry.kind === "finalized")!;
    expect(event.actor).toBe("dm-1");
    expect(event.detail.unverifiedPolicy).toEqual(["policy_language"]);
    expect(event.detail.policyVerificationOverride).toBe(true);
  });

  it("refuses to save a finalized form, so a signed record cannot be re-stamped", async () => {
    const id = await draftedCorrectiveForm();
    await call("POST", id, { action: "finalize" });

    const late = await cardSave(id, { job_title: "Changed after signing" });
    expect(late.status).toBeGreaterThanOrEqual(400);
  });
});
