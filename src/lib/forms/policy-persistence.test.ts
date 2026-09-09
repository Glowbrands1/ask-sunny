import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * AN UNVERIFIED POLICY QUOTATION IS NEVER WRITTEN. NOT BRIEFLY, NOT AT ALL.
 * ============================================================================
 *
 * THE DEFECT THESE TESTS EXIST FOR. `POST /api/forms/instances/[id]/draft` used
 * to persist the model's output and then "withhold" the ungrounded policy fields
 * afterwards, by calling `applyAssistantDraft` again with empty strings.
 *
 * That cleanup never worked. `enforceResponsibilities` drops empty strings
 * rather than treating them as a clear, so the second write carried no rows and
 * the first write's content stayed exactly where it was. On a Disciplinary Plan
 * of Action that means an invented "Policy Violated" and a fabricated quotation
 * under "Direct policy from official manual" were persisted to
 * `form_instance_values` — and the code that looked like it removed them removed
 * nothing at all.
 *
 * TWO INDEPENDENT MECHANISMS NOW STOP IT, and each has its own test here so that
 * each has its own mutation:
 *
 *   THE ORDERING. The route validates and policy-checks in memory and writes
 *   once, at the end. Restoring write-before-filter fails `the route never
 *   writes before it has checked`.
 *
 *   THE WRITE GUARD. `applyAssistantDraft` refuses a `policyGrounded` value
 *   whose provenance does not say it was verified, whatever the caller believed.
 *   Removing `refuseUnverifiedPolicyValues` fails `the write itself refuses`.
 *
 * A fix that lives only in the order of two statements is one edit away from
 * being undone, which is why the second mechanism exists rather than being
 * treated as redundant.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => fakeSupabase(store),
}));

const { applyAssistantDraft } = await import("./instances");

const VERSION_ID = "version-dpoa-1";
const ACTOR = "demo:salon_director:QA";

/**
 * The two policy-quoting fields, exactly as the DPOA's stored version marks
 * them, plus one ordinary drafted field so the test can tell "nothing was
 * written" apart from "the policy fields were refused".
 */
const DPOA_DOCUMENT = {
  paper: "letter",
  blocks: [
    { kind: "section", label: "Details" },
    {
      kind: "field",
      field: {
        key: "observation",
        label: "Observation of Offense",
        input: "long_text",
        responsibility: "ai",
      },
    },
    {
      kind: "field",
      field: {
        key: "policy_violated",
        label: "Policy Violated",
        input: "text",
        responsibility: "ai",
        policyGrounded: true,
      },
    },
    {
      kind: "field",
      field: {
        key: "policy_language",
        label: "Direct policy from official manual",
        input: "long_text",
        responsibility: "ai",
        policyGrounded: true,
      },
    },
  ],
};

function storedValue(key: string) {
  return store.form_instance_values.find(
    (row) => row.instance_id === "form-dpoa" && row.field_key === key,
  );
}

beforeEach(() => {
  store.form_instances = [
    {
      id: "form-dpoa",
      template_id: "template-dpoa",
      template_key: "dpoa",
      template_name: "Disciplinary Plan of Action",
      template_short_name: "DPOA",
      layout_family: "corrective",
      template_version_id: VERSION_ID,
      template_version: 1,
      variant_key: null,
      employee_name: "Jordan Vance (test)",
      employee_role: null,
      location_id: null,
      location_name: "Riverbend Commons",
      created_by: ACTOR,
      created_by_role: "salon_director",
      source: "ask_sunny",
      status: "draft",
      form_date: "2026-09-09",
      follow_up_date: null,
      followed_up_at: null,
      followed_up_by: null,
      finalized_at: null,
      exported_at: null,
      archived_at: null,
      revises_instance_id: null,
      created_at: "2026-09-09T10:00:00Z",
      updated_at: "2026-09-09T10:00:00Z",
    },
  ];
  store.form_instance_values = [];
  store.form_instance_events = [];
  store.form_template_versions = [
    {
      id: VERSION_ID,
      template_id: "template-dpoa",
      version: 1,
      status: "published",
      document: DPOA_DOCUMENT,
      variants: [],
      notes: "",
      created_by: "system",
      created_at: "2026-09-09T00:00:00Z",
      published_at: "2026-09-09T00:00:00Z",
      published_by: "system",
    },
  ];
});

/* ==================================================================== */
/*  THE WRITE GUARD                                                     */
/* ==================================================================== */

describe("the write itself refuses an unverified policy value", () => {
  /** What the model returned when retrieval had found no approved policy. */
  const INVENTED = {
    observation: "Arrived twenty minutes after the start of a scheduled shift.",
    policy_violated: "Attendance Policy Section 4.2",
    policy_language:
      "Employees who accrue three unexcused absences within a rolling ninety-day period are subject to immediate termination.",
  };

  it("writes neither policy field when provenance says nothing", async () => {
    const result = await applyAssistantDraft("form-dpoa", { values: INVENTED }, ACTOR);

    // THE ASSERTION THIS FILE EXISTS FOR: not in the table.
    expect(storedValue("policy_violated")).toBeUndefined();
    expect(storedValue("policy_language")).toBeUndefined();

    // And the ordinary field still landed, so this is a refusal of the policy
    // values rather than the whole write having failed.
    expect(storedValue("observation")?.value).toBe(INVENTED.observation);

    expect(result.policyRefused.sort()).toEqual(["policy_language", "policy_violated"]);
    expect(result.accepted.values.policy_violated).toBeUndefined();
    expect(result.accepted.values.policy_language).toBeUndefined();
  });

  it("writes neither when provenance says the grounding was NOT verified", async () => {
    // The shape `provenanceFor` produces when `groundPolicy` came back
    // unverified. Present-but-false must be refused exactly like absent.
    const provenance = {
      policy_violated: { grounded: true, verified: false, sources: [] },
      policy_language: { grounded: true, verified: false, sources: [] },
    };

    await applyAssistantDraft("form-dpoa", { values: INVENTED }, ACTOR, provenance);

    expect(storedValue("policy_violated")).toBeUndefined();
    expect(storedValue("policy_language")).toBeUndefined();
  });

  it("records the refusal on the audit trail rather than swallowing it", async () => {
    await applyAssistantDraft("form-dpoa", { values: INVENTED }, ACTOR);

    const drafted = store.form_instance_events.find((event) => event.kind === "drafted");
    expect(drafted).toBeDefined();
    expect((drafted!.detail as Record<string, unknown>).policyRefused).toEqual(
      expect.arrayContaining(["policy_violated", "policy_language"]),
    );
  });

  it("DOES write a policy value whose provenance says it was verified", async () => {
    /*
     * The guard on the guard. A test that only proved values were dropped would
     * pass just as well against a build that never wrote a policy field at all,
     * which would break the feature rather than secure it.
     */
    const provenance = {
      policy_violated: {
        grounded: true,
        verified: true,
        sources: [{ documentId: "doc-1", documentTitle: "JBA Policy Manual", locator: "Page 12" }],
      },
      policy_language: {
        grounded: true,
        verified: true,
        sources: [{ documentId: "doc-1", documentTitle: "JBA Policy Manual", locator: "Page 12" }],
      },
    };

    await applyAssistantDraft("form-dpoa", { values: INVENTED }, ACTOR, provenance);

    expect(storedValue("policy_violated")?.value).toBe(INVENTED.policy_violated);
    expect(storedValue("policy_language")?.value).toBe(INVENTED.policy_language);
    // And the provenance travelled with it, so "where did this come from" has
    // an answer months later.
    expect(storedValue("policy_violated")?.provenance).toMatchObject({ verified: true });
  });

  it("leaves a non-policy field alone whatever its provenance", async () => {
    await applyAssistantDraft("form-dpoa", { values: INVENTED }, ACTOR, {});
    expect(storedValue("observation")?.value).toBe(INVENTED.observation);
  });

  it("never leaves a blank row behind for a refused field", async () => {
    /*
     * The old cleanup wrote empty strings, which `enforceResponsibilities` then
     * dropped. If anything ever DID persist an empty policy row, the printed
     * form would show a ruled line under "Direct policy from official manual"
     * that reads as "no policy applies" rather than "not established".
     */
    await applyAssistantDraft("form-dpoa", { values: INVENTED }, ACTOR);

    const rows = store.form_instance_values.filter((row) =>
      ["policy_violated", "policy_language"].includes(String(row.field_key)),
    );
    expect(rows).toEqual([]);
  });
});

/* ==================================================================== */
/*  THE ORDERING                                                        */
/* ==================================================================== */

describe("the route never writes before it has checked", () => {
  const handler = readFileSync(
    "src/app/api/forms/instances/[id]/draft/route.ts",
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const body = handler.slice(handler.indexOf("export async function POST"));

  it("policy-checks before it persists", () => {
    expect(body).toContain("dropUngroundedPolicy(fields, validated.values, grounding)");
    expect(body.indexOf("dropUngroundedPolicy")).toBeLessThan(
      body.indexOf("applyAssistantDraft("),
    );
  });

  it("validates responsibilities in memory, not by writing", () => {
    expect(body).toContain("enforceResponsibilities(document, variantKey");
    expect(body.indexOf("enforceResponsibilities")).toBeLessThan(
      body.indexOf("applyAssistantDraft("),
    );
  });

  it("persists exactly once", () => {
    const writes = body.split("applyAssistantDraft(").length - 1;
    expect(writes, "the draft path must contain a single write").toBe(1);
  });

  it("persists the policy-checked values, never the raw model output", () => {
    expect(body).toContain("values: policyChecked.values");
    expect(body).not.toContain("values: narrated.values,\n      checked: drafted.checked ?? {} },\n      actor.id");
    expect(body).not.toContain("values: drafted.values");
  });

  it("has no write-then-blank cleanup left in it", () => {
    // The exact shape of the defect: a second write of empty strings for the
    // keys the policy rule withheld.
    expect(body).not.toMatch(/withheld\.map\(\s*\(key\)\s*=>\s*\[key,\s*""\]\s*\)/);
    expect(body).not.toContain('[key, ""]');
  });
});
