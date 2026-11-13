import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedIdentity } from "@/lib/auth/types";

/*
 * THE HUB'S ADMIN ACTIONS AND ISSUE FILES, FROM ASK SUNNY.
 *   - Restore a version and Delete a recap go to the Hub, for the verified person; the Hub decides (hub_admin).
 *   - Issue files: the Hub's own size, type and path rules are checked here first, so a bad file or a path outside
 *     this meeting never reaches the Hub (or its Storage) at all; a good one goes to the Hub for the verified person.
 * People in these tests are invented.
 */
const page = vi.hoisted(() => ({ identity: null as Partial<AuthenticatedIdentity> | null }));
vi.mock("@/lib/auth/page", () => ({
  pageAuthorizationEnforced: () => true,
  pageIdentity: async () => page.identity,
  requireAuthenticatedPage: async () => page.identity,
}));

const hub = vi.hoisted(() => ({
  calls: [] as { op: string; email: string; args: Record<string, unknown> }[],
  answer: (() => ({ status: 404, body: { error: "not_found" } })) as (op: string, args: Record<string, unknown>) => { status: number; body: Record<string, unknown> },
}));
vi.mock("./partner/client.server", async (orig) => {
  const real = await orig<typeof import("./partner/client.server")>();
  return {
    ...real,
    callHub: async (op: string, email: string, args: Record<string, unknown> = {}) => {
      hub.calls.push({ op, email, args });
      return hub.answer(op, args);
    },
  };
});

beforeEach(() => {
  vi.stubEnv("HUB_PARTNER_SECRET", "s".repeat(40));
  page.identity = { subject: "u-1", email: "avery.quill@example.test", displayName: "Avery Quill", role: "district_manager", verified: true };
  hub.calls = [];
  hub.answer = () => ({ status: 404, body: { error: "not_found" } });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Restore a version (the Hub's rule: hub admins only)", () => {
  it("asks the Hub for the verified person and passes its answer on", async () => {
    hub.answer = () => ({ status: 200, body: { ok: true, version: 9 } });
    const { restoreVersionAction } = await import("./actions");
    expect(await restoreVersionAction("stc-dm", 4)).toEqual({ ok: true, version: 9 });
    expect(hub.calls).toEqual([{ op: "restore-version", email: "avery.quill@example.test", args: { key: "stc-dm", version: 4 } }]);
  });

  it("a person who is not a hub admin gets the Hub's words; a bad version or meeting never reaches the Hub", async () => {
    hub.answer = () => ({ status: 200, body: { ok: false, message: "Only a Leadership Hub admin can restore a version." } });
    const { restoreVersionAction } = await import("./actions");
    expect(await restoreVersionAction("stc-dm", 4)).toEqual({ ok: false, message: "Only a Leadership Hub admin can restore a version." });
    hub.calls = [];
    expect((await restoreVersionAction("stc-dm", 0)).ok).toBe(false);
    expect((await restoreVersionAction("no-such-meeting", 2)).ok).toBe(false);
    expect(hub.calls).toEqual([]);
    // Another Hub meeting is a meeting key, so it is asked about, and the Hub refuses it (not on Ask Sunny's allowlist).
    hub.answer = () => ({ status: 404, body: { error: "not_found" } });
    expect(await restoreVersionAction("leadership", 2)).toEqual({ ok: false, message: "You do not have access to this meeting." });
  });

  it("the meeting says whether the viewer is a hub admin (only to show the button)", async () => {
    hub.answer = () => ({ status: 200, body: { info: { key: "stc-dm", name: "STC DM L10" }, viewer: { id: "h1", name: "Avery Quill", isHubAdmin: true }, loaded: { version: 1, updatedAt: "t", doc: {} }, people: [], roster: { members: [], leader: null } } });
    const { openMeeting } = await import("./data.server");
    const res = await openMeeting("stc-dm");
    expect(res.ok && res.meeting.viewer.isHubAdmin).toBe(true);
  });
});

describe("the assistant's @-picker people", () => {
  it("are this meeting's people from the Hub, for the verified person; nothing for someone the Hub refuses", async () => {
    const { meetingPeopleAction } = await import("./actions");
    expect(await meetingPeopleAction("stc-dm")).toEqual([]);
    hub.answer = () => ({ status: 200, body: { info: { key: "stc-dm", name: "STC DM L10" }, viewer: { id: "h1", name: "Avery Quill" }, loaded: { version: 1, updatedAt: "t", doc: {} }, people: [{ id: "h1", name: "Avery Quill" }, { id: "h2", name: "Bo Lark" }], roster: { members: [], leader: null } } });
    expect(await meetingPeopleAction("stc-dm")).toEqual([{ id: "h1", name: "Avery Quill" }, { id: "h2", name: "Bo Lark" }]);
    expect(hub.calls.map((c) => [c.op, c.email, c.args.key])).toEqual([
      ["meeting", "avery.quill@example.test", "stc-dm"],
      ["meeting", "avery.quill@example.test", "stc-dm"],
    ]);
  });
});

describe("Delete a recap (the Hub's rule: hub admins only)", () => {
  it("goes to the Hub; a refusal (404) says only hub admins can delete", async () => {
    const { deleteRecapAction } = await import("./actions");
    expect(await deleteRecapAction("00000000-0000-4000-8000-0000000000a1")).toEqual({ ok: false, kind: "forbidden", message: "Only hub admins can delete recaps." });
    hub.answer = () => ({ status: 200, body: { ok: true, already: false } });
    expect(await deleteRecapAction("00000000-0000-4000-8000-0000000000a1")).toEqual({ ok: true, already: false });
    expect(hub.calls.map((c) => [c.op, c.args.id])).toEqual([
      ["delete-recap", "00000000-0000-4000-8000-0000000000a1"],
      ["delete-recap", "00000000-0000-4000-8000-0000000000a1"],
    ]);
    hub.calls = [];
    expect((await deleteRecapAction("")).ok).toBe(false);
    expect(hub.calls).toEqual([]);
  });
});

describe("issue files", () => {
  it("a good file: one request to the Hub, for the verified person, with the Hub's upload address back", async () => {
    hub.answer = () => ({ status: 200, body: { ok: true, data: { mode: "storage", path: "stc-dm/i1/abcdefgh-Plan.pdf", signedUrl: "https://hub-storage.test/up", contentType: "application/pdf" } } });
    const { prepareL10Upload } = await import("./files-actions");
    expect(await prepareL10Upload({ key: "stc-dm", issueId: "i1", name: "Plan.pdf", size: 2048 })).toMatchObject({ ok: true, data: { mode: "storage" } });
    expect(hub.calls).toEqual([{ op: "file-prepare", email: "avery.quill@example.test", args: { key: "stc-dm", issueId: "i1", name: "Plan.pdf", size: 2048 } }]);
  });

  it("over 25 MB, a type the Hub does not take, or an empty file never reaches the Hub", async () => {
    const { prepareL10Upload } = await import("./files-actions");
    expect(await prepareL10Upload({ key: "stc-dm", issueId: "i1", name: "Plan.pdf", size: 26_214_401 })).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(await prepareL10Upload({ key: "stc-dm", issueId: "i1", name: "run.exe", size: 10 })).toMatchObject({ ok: false, error: { message: "Only PDF, Word (docx), Excel (xlsx), PowerPoint (pptx), PNG and JPG files can be added." } });
    expect(await prepareL10Upload({ key: "stc-dm", issueId: "i1", name: "Plan.pdf", size: 0 })).toMatchObject({ ok: false, error: { message: "The file is empty." } });
    expect(hub.calls).toEqual([]);
  });

  it("a path outside stc-dm (another meeting, a climbing path, another issue) never reaches the Hub", async () => {
    const { finishL10Upload, openL10File, prepareL10Upload } = await import("./files-actions");
    expect((await finishL10Upload({ key: "stc-dm", issueId: "i1", path: "leadership/i1/abcdefgh-Plan.pdf", name: "Plan.pdf" })).ok).toBe(false);
    expect((await finishL10Upload({ key: "stc-dm", issueId: "i1", path: "stc-dm/../leadership/i1/abcdefgh-Plan.pdf", name: "Plan.pdf" })).ok).toBe(false);
    expect((await finishL10Upload({ key: "stc-dm", issueId: "i1", path: "stc-dm/i2/abcdefgh-Plan.pdf", name: "Plan.pdf" })).ok).toBe(false);
    expect((await openL10File({ key: "stc-dm", path: "leadership/i1/abcdefgh-Plan.pdf" })).ok).toBe(false);
    expect((await openL10File({ key: "stc-dm", path: "../../etc/passwd" })).ok).toBe(false);
    expect(hub.calls).toEqual([]);
    // Another Hub meeting's own key and path: the Hub decides, and refuses it (only stc-dm is allowlisted for Ask Sunny;
    // the Hub's tests prove its Storage is never called for it).
    expect(await prepareL10Upload({ key: "leadership", issueId: "i1", name: "Plan.pdf", size: 10 })).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });

  it("someone the Hub refuses (not in the meeting) is told plainly, and signed-out people send nothing", async () => {
    const { openL10File } = await import("./files-actions");
    expect(await openL10File({ key: "stc-dm", path: "stc-dm/i1/abcdefgh-Plan.pdf" })).toEqual({ ok: false, error: { kind: "forbidden", message: "You do not have permission to add files to this meeting." } });
    page.identity = null;
    hub.calls = [];
    expect((await openL10File({ key: "stc-dm", path: "stc-dm/i1/abcdefgh-Plan.pdf" })).ok).toBe(false);
    expect(hub.calls).toEqual([]);
  });

  it("there is no fixture storage here: that upload is always refused", async () => {
    const { putFixtureL10File } = await import("./files-actions");
    expect((await putFixtureL10File(new FormData())).ok).toBe(false);
  });
});
