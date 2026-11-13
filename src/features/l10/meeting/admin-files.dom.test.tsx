// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoryRow } from "@/features/l10/data.server";
import type { IssueFile } from "@/features/l10/lib/types";

/*
 * The Hub's admin controls and issue files, as copied: the Hub's HistoryList.test, DeleteRecapButton.test and
 * SharedFiles.test, with this meeting and invented people.
 */
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/l10/files-actions", () => ({ prepareL10Upload: vi.fn(), finishL10Upload: vi.fn(), openL10File: vi.fn(), putFixtureL10File: vi.fn() }));
vi.mock("@/features/l10/actions", () => ({ deleteRecapAction: vi.fn() }));

import { finishL10Upload, openL10File, prepareL10Upload } from "@/features/l10/files-actions";
import { DeleteRecapButton } from "./_components/DeleteRecapButton";
import { HistoryList, type HistoryEntry } from "./_components/HistoryList";
import { SharedFiles } from "./_components/SharedFiles";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const row = (version: number, over: Partial<HistoryRow> = {}): HistoryRow => ({ version, savedAt: "2026-10-26T20:00:00Z", savedByName: "Avery Quill", isCurrent: false, isImport: false, source: null, bytes: 100, ...over });
const entries = (): HistoryEntry[] => [
  { row: row(3, { isCurrent: true }), summary: "2 issues added", when: "Mon, Oct 26, 2026, 3:00 PM CDT" },
  { row: row(2), summary: "1 to-do added", when: "Sun, Oct 25, 2026, 10:00 AM CDT" },
];

describe("History: Restore is for Hub admins, as in the Hub", () => {
  it("a member sees no Restore; a hub admin sees it on every version but the current one", () => {
    const restore = vi.fn();
    const { unmount } = render(<HistoryList meetingKey="stc-dm" meetingName="STC DM L10" entries={entries()} admin={false} currentVersion={3} olderBefore={null} restore={restore} />);
    expect(screen.queryByRole("button", { name: /^Restore version/ })).toBeNull();
    unmount();
    render(<HistoryList meetingKey="stc-dm" meetingName="STC DM L10" entries={entries()} admin currentVersion={3} olderBefore={null} restore={restore} />);
    expect(screen.queryByRole("button", { name: "Restore version 3" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore version 2" })).toBeTruthy();
  });

  it("asks first, says nothing is deleted, restores and says the new version", async () => {
    const restore = vi.fn().mockResolvedValue({ ok: true, version: 4 });
    render(<HistoryList meetingKey="stc-dm" meetingName="STC DM L10" entries={entries()} admin currentVersion={3} olderBefore={null} restore={restore} />);
    fireEvent.click(screen.getByRole("button", { name: "Restore version 2" }));
    const dialog = screen.getByRole("dialog", { name: "Restore version 2?" });
    expect(dialog.textContent).toContain("Version 3 is not deleted");
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, restore version 2" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("stc-dm", 2));
    expect((await screen.findByRole("status")).textContent).toBe("Restored. It is now version 4.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows the Hub's refusal when the restore is refused", async () => {
    const restore = vi.fn().mockResolvedValue({ ok: false, message: "Only a Leadership Hub admin can restore a version." });
    render(<HistoryList meetingKey="stc-dm" meetingName="STC DM L10" entries={entries()} admin currentVersion={3} olderBefore={null} restore={restore} />);
    fireEvent.click(screen.getByRole("button", { name: "Restore version 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, restore version 2" }));
    expect((await screen.findByRole("status")).textContent).toBe("Only a Leadership Hub admin can restore a version.");
  });
});

describe("Recaps: Delete (Hub admins)", () => {
  const label = "STC DM L10 recap from Nov 2, 2026";
  it("asks first; Cancel deletes nothing", () => {
    const remove = vi.fn();
    render(<DeleteRecapButton id="r1" label={label} remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: `Delete the ${label}` }));
    const dialog = screen.getByRole("dialog", { name: `Delete the ${label}?` });
    expect(dialog.textContent).toContain("An admin can restore it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes on confirm and stays on this meeting's recaps page", async () => {
    window.history.replaceState(null, "", "/meetings/stc-dm/recaps");
    const remove = vi.fn().mockResolvedValue({ ok: true, already: false });
    render(<DeleteRecapButton id="r1" label={label} remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: `Delete the ${label}` }));
    fireEvent.click(screen.getByRole("button", { name: "Delete recap" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/meetings/stc-dm/recaps?deleted=1", { scroll: false }));
    expect(remove).toHaveBeenCalledWith("r1");
  });

  it("says why when it fails, and keeps the dialog open", async () => {
    const remove = vi.fn().mockResolvedValue({ ok: false, kind: "forbidden", message: "Only hub admins can delete recaps." });
    render(<DeleteRecapButton id="r1" label={label} remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: `Delete the ${label}` }));
    fireEvent.click(screen.getByRole("button", { name: "Delete recap" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Only hub admins can delete recaps.");
  });
});

describe("Files on an issue (the Hub's SharedFiles)", () => {
  const legacy: IssueFile = { name: "Old plan.pdf", path: "stc-dm/i3/sample.pdf", size: 1024, uploadedBy: "Bo" };
  const current: IssueFile = { name: "New plan.pdf", path: "stc-dm/i3/abcdef123456-New_plan.pdf", size: 2048, bucket: "l10-files" };

  it("lists files; an old-app one has no Open; Remove only unlists it (the stored copy is kept, as in the Hub)", () => {
    let files = [legacy, current];
    render(<SharedFiles meetingKey="stc-dm" issueId="i3" files={files} onChange={(fn) => (files = fn(files))} />);
    expect(screen.getByTestId("shared-file-legacy").textContent).toBe("Old file from the previous app, attach it again");
    expect(screen.queryByRole("button", { name: "Open Old plan.pdf" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Old plan.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Old plan.pdf" }));
    expect(files).toEqual([current]);
  });

  it("Open asks the Hub and keeps a link in case the browser blocked the new tab", async () => {
    vi.mocked(openL10File).mockResolvedValueOnce({ ok: true, data: { kind: "url", url: "https://hub-storage.test/get" } });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<SharedFiles meetingKey="stc-dm" issueId="i3" files={[current]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open New plan.pdf" }));
    expect((await screen.findByTestId("shared-files-note")).textContent).toMatch(/may have blocked the new tab/);
    expect(openL10File).toHaveBeenCalledWith({ key: "stc-dm", path: current.path, name: current.name });
    expect(open).toHaveBeenCalledWith("https://hub-storage.test/get", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("attach: checks type and first bytes in the browser, uploads straight to the Hub's storage address, then saves it on the issue", async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", put);
    vi.mocked(prepareL10Upload).mockResolvedValueOnce({ ok: true, data: { mode: "storage", path: "stc-dm/i3/abcdefgh-Plan.pdf", signedUrl: "https://hub-storage.test/up", contentType: "application/pdf" } });
    const saved: IssueFile = { name: "Plan.pdf", path: "stc-dm/i3/abcdefgh-Plan.pdf", size: 8, bucket: "l10-files", uploadedBy: "Avery" };
    vi.mocked(finishL10Upload).mockResolvedValueOnce({ ok: true, data: saved });
    let files: IssueFile[] = [];
    const { container } = render(<SharedFiles meetingKey="stc-dm" issueId="i3" files={files} onChange={(fn) => (files = fn(files))} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], "Plan.pdf", { type: "application/pdf" });
    const exe = new File([new Uint8Array([0x4d, 0x5a])], "Plan.pdf", { type: "application/pdf" }); // renamed, not a real PDF
    fireEvent.change(input, { target: { files: [exe] } });
    expect((await screen.findByTestId("shared-files-note")).textContent).toMatch(/does not look like a real PDF/);
    expect(prepareL10Upload).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [pdf] } });
    await waitFor(() => expect(files).toEqual([saved]));
    expect(prepareL10Upload).toHaveBeenCalledWith({ key: "stc-dm", issueId: "i3", name: "Plan.pdf", size: 8 });
    expect(put).toHaveBeenCalledWith("https://hub-storage.test/up", expect.objectContaining({ method: "PUT" }));
  });
});
