import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/*
 * HR APPROVAL — WHO KNOWS A FORM WAITING FOR HR EXISTS (owner, 23 Nov 2026: "i created it wornhall salon, only me and
 * HR can see its waiting and im the only one to see HR's note or approval").
 *
 * A form that is pending, sent back or rejected is seen by its creator and HR, and by nobody else: not the creator's
 * District or Regional Manager, not an administrator, not another salon's manager. By list, by id, as a PDF and in its
 * history. Once HR approves it, it reads as any finalized form does. Invented ids and roles only.
 */

const FLAG = "FORMS_HR_APPROVAL_ENABLED";
const ORIGINAL = { ...process.env };

const WORNALL: AccessScope = { level: "salon", primaryAreaId: "loc-wornall", alsoCoversAreaIds: [] };
const OTHER_SALON: AccessScope = { level: "salon", primaryAreaId: "loc-other", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const CREATOR = "sd-creator";
const HR = "hr-approver";

const WAITING = "11111111-1111-4111-8111-111111111111";
const SENT_BACK = "22222222-2222-4222-8222-222222222222";
const REJECTED = "33333333-3333-4333-8333-333333333333";
const APPROVED = "44444444-4444-4444-8444-444444444444";
const ORDINARY = "55555555-5555-4555-8555-555555555555";
/** An Assistant's draft, sent to HR by the Wornall salon director (the "creator" viewer below). */
const SENT_FOR_ASSISTANT = "66666666-6666-4666-8666-666666666666";

interface Row {
  id: string;
  createdBy: string;
  status: "draft" | "finalized";
  hrApprovalState: "pending" | "changes_requested" | "rejected" | "approved" | null;
  /** Who sent it to HR; defaults to its creator. */
  requestedBy?: string;
}

let rows: Row[] = [];
/** What the mocked writers were asked, for the leak tests below. */
const calls: { exported: string[]; saveOptions: unknown[] } = { exported: [], saveOptions: [] };
/** The revision "Edit as new draft" finds already open (someone else's, waiting for HR), when set. */
let openRevision: Row | null = null;

function instanceRow(row: Row) {
  return {
    id: row.id,
    templateId: "tpl-dpoa",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    templateShortName: "CA",
    layoutFamily: "dpoa",
    templateVersionId: "ver-1",
    templateVersion: 1,
    variantKey: null,
    employeeName: "Invented Person",
    employeeRole: null,
    locationId: "loc-wornall",
    locationName: "KC Wornall",
    createdBy: row.createdBy,
    createdByRole: "salon_director",
    source: "ask_sunny",
    status: row.status,
    formDate: "2026-11-20",
    followUpDate: null,
    followedUpAt: null,
    followedUpBy: null,
    finalizedAt: row.status === "finalized" ? "2026-11-21T12:00:00Z" : null,
    exportedAt: null,
    archivedAt: null,
    revisesInstanceId: null,
    createdAt: "2026-11-20T12:00:00Z",
    updatedAt: "2026-11-20T12:00:00Z",
    hrApprovalState: row.hrApprovalState,
    hrApprovalRequestedAt: row.hrApprovalState ? "2026-11-20T15:00:00Z" : null,
    hrApprovalRequestedBy: row.hrApprovalState ? (row.requestedBy ?? row.createdBy) : null,
    hrApprovalSenders: row.hrApprovalState ? [row.requestedBy ?? row.createdBy] : [],
  };
}

/** Every viewer, with the salon or estate their account covers. HR is a District Manager with every salon. */
const VIEWERS = {
  "the creator (Wornall salon director)": { role: "salon_director", subject: CREATOR, scope: WORNALL },
  "HR (a district manager on the approver list)": { role: "district_manager", subject: HR, scope: GLOBAL },
  "Wornall's district manager": { role: "district_manager", subject: "dm-wornall", scope: GLOBAL },
  "Wornall's regional manager": { role: "regional_manager", subject: "rm-wornall", scope: GLOBAL },
  "another Wornall salon director": { role: "salon_director", subject: "sd-wornall-2", scope: WORNALL },
  "another salon's director": { role: "salon_director", subject: "sd-other", scope: OTHER_SALON },
  admin: { role: "admin", subject: "admin-1", scope: GLOBAL },
  developer: { role: "developer", subject: "dev-1", scope: GLOBAL },
} as const;
type Viewer = keyof typeof VIEWERS;
const KNOWS: Viewer[] = ["the creator (Wornall salon director)", "HR (a district manager on the approver list)"];
/** Who reads Wornall's ordinary forms at all (global readers and Wornall's own). */
const READS_WORNALL: Viewer[] = [
  "the creator (Wornall salon director)",
  "HR (a district manager on the approver list)",
  "Wornall's district manager",
  "Wornall's regional manager",
  "another Wornall salon director",
  "admin",
  "developer",
];

async function load(viewer: Viewer, env: { flag?: boolean } = {}) {
  const { role, subject, scope } = VIEWERS[viewer];
  delete process.env[FLAG];
  if (env.flag) process.env[FLAG] = "true";
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.FORM_REVISIONS_ENABLED = "true";
  vi.resetModules();
  const listFilters: unknown[] = [];

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return {
          identity: { subject, email: `${subject}@example.com`, displayName: subject, role, scope, verified: true },
          permission,
          provider: "supabase",
        };
      },
    };
  });
  // The visibility each reader resolves to: global readers every salon, salon readers their own.
  vi.doMock("@/lib/forms/forms-visibility", () => ({ resolveFormsVisibility: async () => scope }));
  vi.doMock("@/lib/forms/hr-approval-approvers", () => ({
    resolveHrApprover: async (id: string) => env.flag === true && id === HR,
    listHrApprovers: async () => [],
    accountEmail: async () => null,
  }));
  vi.doMock("@/lib/forms/repository", () => ({
    getTemplateByKey: async () => ({
      id: "tpl-dpoa",
      key: "dpoa",
      name: "Corrective Action Form",
      shortName: "CA",
      description: "",
      layoutFamily: "dpoa",
      requiredPermission: "create_corrective_action",
      active: true,
      displayOrder: 2,
    }),
  }));
  vi.doMock("@/lib/forms/instances", () => ({
    loadInstance: async (id: string) => {
      const row = rows.find((entry) => entry.id === id);
      return row
        ? { instance: instanceRow(row), version: { id: "ver-1", document: { paper: "letter", blocks: [] }, variants: [] }, values: [], events: [] }
        : null;
    },
    // The query filter is recorded; the predicate (`visibleInstances`) is what each test checks.
    listInstances: async (_view: string, _limit?: number, filter?: unknown) => {
      listFilters.push(filter);
      return rows.map(instanceRow);
    },
    findDemoInstances: async () => ({ deletable: [], protected: [] }),
    markExported: async (id: string) => {
      calls.exported.push(id);
    },
    saveInstanceValues: async (_id: string, _values: unknown, _actor: string, options: unknown) => {
      calls.saveOptions.push(options);
      return { rejected: [] };
    },
    InstanceProtectedError: class extends Error {},
    UnverifiedPolicyError: class extends Error {},
    RequiredFieldsBlankError: class extends Error {},
    HeldForHrError: class extends Error {},
  }));
  vi.doMock("@/lib/forms/pdf-render", () => ({ renderFormPdf: async () => new Uint8Array([37, 80, 68, 70]), pdfFileName: () => "form.pdf" }));
  vi.doMock("@/lib/forms/revision-chain", () => ({
    loadRevisionHistory: async () => ({ entries: [] }),
    marksFor: () => ({}),
    reviseFinalizedForm: async () => (openRevision ? instanceRow(openRevision) : null),
    RevisionReasonRequiredError: class extends Error {},
  }));
  vi.doMock("@/lib/forms/revision-history", () => ({ revisionLabel: () => null }));
  const rules = await import("@/lib/forms/hr-approval-rules");
  vi.doMock("@/lib/forms/hr-approval", () => ({
    // #1303's rule, built from the real rules: HR, or a verified creator or sender, while the form is held for HR.
    mayEditWhileWithHr: (actor: { id: string; verified?: boolean; hrApprover?: boolean }, instance: Parameters<typeof rules.isCreatorOrSender>[1] & { hrApprovalState?: string | null }) =>
      rules.heldForHr((instance.hrApprovalState ?? null) as Parameters<typeof rules.heldForHr>[0]) &&
      (actor.hrApprover === true || (actor.verified === true && rules.isCreatorOrSender(actor, instance))),
    hrApprovalViewFor: async () => null,
    finalizeGoesToHr: async () => false,
    sendForHrApproval: async () => null,
    decideHrApproval: async () => null,
    commentOnHrApproval: async () => undefined,
    recordHrEdit: async () => undefined,
    withdrawnFromHr: async () => undefined,
    HrApprovalError: class extends Error {},
  }));

  const detail = await import("./instances/[id]/route");
  const list = await import("./instances/route");
  const pdf = await import("./instances/[id]/pdf/route");
  const history = await import("./instances/[id]/history/route");
  return { detail, list, pdf, history, listFilters };
}

const req = (method: string) => new Request("https://app.test/api/forms/instances/x", { method });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  rows = [
    { id: WAITING, createdBy: CREATOR, status: "draft", hrApprovalState: "pending" },
    { id: SENT_BACK, createdBy: CREATOR, status: "draft", hrApprovalState: "changes_requested" },
    { id: REJECTED, createdBy: CREATOR, status: "draft", hrApprovalState: "rejected" },
    { id: APPROVED, createdBy: CREATOR, status: "finalized", hrApprovalState: "approved" },
    { id: ORDINARY, createdBy: "sd-wornall-2", status: "finalized", hrApprovalState: null },
    { id: SENT_FOR_ASSISTANT, createdBy: "asd-wornall", status: "draft", hrApprovalState: "pending", requestedBy: CREATOR },
  ];
  calls.exported = [];
  calls.saveOptions = [];
  openRevision = null;
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const mod of [
    "@/lib/auth/server",
    "@/lib/forms/forms-visibility",
    "@/lib/forms/hr-approval-approvers",
    "@/lib/forms/repository",
    "@/lib/forms/instances",
    "@/lib/forms/pdf-render",
    "@/lib/forms/revision-chain",
    "@/lib/forms/revision-history",
    "@/lib/forms/hr-approval",
  ]) {
    vi.doUnmock(mod);
  }
  vi.resetModules();
});

const ON = { flag: true };
/** Every form that is waiting: the creator viewer created the first three and sent the fourth. */
const NOT_APPROVED = [WAITING, SENT_BACK, REJECTED, SENT_FOR_ASSISTANT];

describe("a form waiting for HR, by every route, for every viewer", () => {
  it.each(Object.keys(VIEWERS) as Viewer[])("%s", async (viewer) => {
    const knows = KNOWS.includes(viewer);
    const readsWornall = READS_WORNALL.includes(viewer);
    const { detail, list, pdf, history } = await load(viewer, ON);

    const response = await list.GET(new Request("https://app.test/api/forms/instances"));
    expect(response.status).toBe(200);
    const listed = ((await response.json()) as { instances: { id: string }[] }).instances.map((entry) => entry.id);
    for (const id of NOT_APPROVED) expect(listed.includes(id), `list: ${id}`).toBe(knows);
    // Approved reads as any finalized form, for everybody who reads Wornall.
    expect(listed.includes(APPROVED)).toBe(readsWornall);
    expect(listed.includes(ORDINARY)).toBe(readsWornall);

    for (const id of NOT_APPROVED) {
      expect((await detail.GET(req("GET"), params(id))).status, `by id: ${id}`).toBe(knows ? 200 : 404);
      expect((await pdf.GET(req("GET"), params(id))).status, `pdf: ${id}`).toBe(knows ? 200 : 404);
      expect((await history.GET(req("GET"), params(id))).status, `history: ${id}`).toBe(knows ? 200 : 404);
    }
  });
});

describe("the list query leaves waiting forms out before its limit", () => {
  it("everybody but HR: the hide filter, with their own account as the exception", async () => {
    const { list, listFilters } = await load("admin", ON);
    await list.GET(new Request("https://app.test/api/forms/instances"));
    expect(listFilters.at(-1)).toMatchObject({ hideAwaitingHrExceptCreatedBy: "admin-1" });
  });

  it("HR: no hide filter", async () => {
    const { list, listFilters } = await load("HR (a district manager on the approver list)", ON);
    await list.GET(new Request("https://app.test/api/forms/instances"));
    expect(listFilters.at(-1) ?? {}).not.toHaveProperty("hideAwaitingHrExceptCreatedBy");
  });

  it("flag off: the list read is asked exactly as before (no filter for a global reader)", async () => {
    const { list, listFilters } = await load("admin", {});
    await list.GET(new Request("https://app.test/api/forms/instances"));
    expect(listFilters.at(-1)).toBeUndefined();
  });
});

describe("flag off: a form already carrying an approval state stays hidden", () => {
  it("an administrator still gets 404 for a form HR never approved (turning the flag off publishes nothing)", async () => {
    const { detail } = await load("admin", {});
    expect((await detail.GET(req("GET"), params(WAITING))).status).toBe(404);
  });
});

describe("the hide rule sits before the global early return", () => {
  it("actorMaySeeInstance tests it before visibility.level", () => {
    const source = readFileSync("src/lib/forms/instance-scope.ts", "utf8");
    const body = source.slice(source.indexOf("export function actorMaySeeInstance"));
    expect(body.indexOf("hiddenWhileAwaitingHr(actor, instance)")).toBeGreaterThan(-1);
    expect(body.indexOf("hiddenWhileAwaitingHr(actor, instance)")).toBeLessThan(body.indexOf("visibility.level"));
  });
});

/*
 * ============================================================================
 * THE LEAK AUDIT (owner, 23 Nov 2026): "are u sure this doesnt leak information, that other people cant see what a
 * certain manager created? make sure history also in chat people dont see what a certain person created pls."
 * ============================================================================
 */
const REVISION = "77777777-7777-4777-8777-777777777777";
const json = (body: unknown) =>
  new Request("https://app.test/api/forms/instances/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("Edit as new draft never hands back someone else's revision waiting for HR", () => {
  beforeEach(() => {
    // The salon director opened a revision of the finalized form and sent it to HR.
    openRevision = { id: REVISION, createdBy: CREATOR, status: "draft", hrApprovalState: "pending" };
  });

  it("Wornall's district manager gets one plain refusal: no form, no name, nothing about HR", async () => {
    const { detail } = await load("Wornall's district manager", ON);
    const response = await detail.POST(json({ action: "revise" }), params(ORDINARY));
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "This form can't be edited right now.", code: "FORM_NOT_EDITABLE_NOW" });
    expect(body).not.toContain(REVISION);
    expect(body).not.toContain(CREATOR);
  });

  it("its creator gets their own revision, as before", async () => {
    const { detail } = await load("the creator (Wornall salon director)", ON);
    const response = await detail.POST(json({ action: "revise" }), params(ORDINARY));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { instance: { id: string } }).instance.id).toBe(REVISION);
  });
});

describe("an approved form's HR columns reach only its creator, its senders and HR", () => {
  it.each(READS_WORNALL)("%s", async (viewer) => {
    const knows = KNOWS.includes(viewer);
    const { detail, list } = await load(viewer, ON);
    const one = ((await (await detail.GET(req("GET"), params(APPROVED))).json()) as { instance: Record<string, unknown> }).instance;
    const listed = ((await (await list.GET(new Request("https://app.test/api/forms/instances"))).json()) as {
      instances: Record<string, unknown>[];
    }).instances.find((entry) => entry.id === APPROVED)!;
    for (const row of [one, listed]) {
      if (knows) {
        expect(row.hrApprovalState).toBe("approved");
      } else {
        expect(row.hrApprovalState, "an approved form says it went through HR").toBeNull();
        expect(row.hrApprovalRequestedBy).toBeNull();
        expect(row.hrApprovalRequestedAt).toBeNull();
        expect(row.hrApprovalSenders).toEqual([]);
      }
    }
  });
});

describe("HR's downloads and edits stay out of the form's general history", () => {
  it("a PDF of a form waiting for HR is not recorded as an export; an approved one is", async () => {
    const { pdf } = await load("HR (a district manager on the approver list)", ON);
    expect((await pdf.GET(req("GET"), params(WAITING))).status).toBe(200);
    expect(calls.exported).toEqual([]);
    expect((await pdf.GET(req("GET"), params(APPROVED))).status).toBe(200);
    expect(calls.exported).toEqual([APPROVED]);
  });

  it("HR's edit of a form they sent back goes to the approval history only; the creator's does not", async () => {
    const patch = (body: unknown) =>
      new Request("https://app.test/api/forms/instances/x", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    const hr = await load("HR (a district manager on the approver list)", ON);
    await hr.detail.PATCH(patch({ values: { observation: "x" } }), params(SENT_BACK));
    expect(calls.saveOptions.at(-1)).toMatchObject({ hrHistoryOnly: true });
    const creator = await load("the creator (Wornall salon director)", ON);
    await creator.detail.PATCH(patch({ values: { observation: "y" } }), params(SENT_BACK));
    expect(calls.saveOptions.at(-1)).toMatchObject({ hrHistoryOnly: false });
  });
});
