// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UploadDialog } from "./upload-dialog";

/**
 * ============================================================================
 * SELECTING EIGHT DOCUMENTS FILES EIGHT DOCUMENTS
 * ============================================================================
 *
 * THE DEFECT THIS CLOSES, and it was silent, which is the worst kind. The input
 * had no `multiple`, and BOTH the picker and the drop handler read `files[0]`:
 * so dropping eight policies onto the dialog queued one and discarded seven
 * with no message. Nothing failed; seven documents simply were not there.
 *
 * WHAT IS ASSERTED HERE is the queue's contract rather than its looks:
 *
 *   - the input actually accepts a multiple selection;
 *   - every file that passes the pre-check is queued, and a file that fails it
 *     is named without costing the rest of the selection;
 *   - each file gets its OWN title derived from its OWN filename, because a
 *     title decides which document this supersedes;
 *   - the same file dropped twice is queued once;
 *   - the description field, which describes ONE document, is not offered for a
 *     batch.
 *
 * The batch RUNNER is tested separately in `bulk-upload.test.ts` — this is the
 * dialog, in demo mode, where nothing is sent anywhere.
 */

const addDocument = vi.fn(async () => {});
const updateDocument = vi.fn();

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { name: "Paulyne Camacho" } }),
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: () => ({
    addDocument,
    updateDocument,
    storageAvailable: true,
  }),
}));

/* Demo mode, so `handleSubmit` stores locally and sends no request. */
vi.mock("./upload-service", async () => {
  const actual = await vi.importActual<typeof import("./upload-service")>(
    "./upload-service",
  );
  return { ...actual, uploadsAreLive: () => false };
});

function txt(name: string, bytes = 12): File {
  const file = new File(["x".repeat(bytes)], name, { type: "text/plain" });
  return file;
}

/** Drops a set of files onto the dialog's drop zone. */
function drop(...files: File[]) {
  const zone = screen.getByText(/drag documents here/i).closest("div");
  if (!zone) throw new Error("drop zone not found");
  fireEvent.drop(zone, { dataTransfer: { files } });
}

beforeEach(() => {
  addDocument.mockClear();
  updateDocument.mockClear();
});

afterEach(cleanup);

describe("the picker accepts a selection, not a file", () => {
  it("marks the input multiple", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    const input = document.getElementById("knowledge-file") as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it("queues every dropped file, with a title derived from each filename", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("attendance-policy.txt"), txt("dress_code.txt"), txt("safety.txt"));

    expect(screen.getByText("3 documents")).toBeTruthy();

    // Each title comes from its OWN name, separators tidied — never one title
    // reused, which would file three documents on top of each other.
    const titles = screen
      .getAllByPlaceholderText("Document title")
      .map((input) => (input as HTMLInputElement).value);
    expect(titles).toEqual(["attendance policy", "dress code", "safety"]);
  });

  it("queues the same file once, however many times it is dropped", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("attendance.txt"));
    drop(txt("attendance.txt"));
    expect(screen.getByText("1 document")).toBeTruthy();
  });

  it("adds a second selection to the queue rather than replacing it", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("a.txt"));
    drop(txt("b.txt"));
    expect(screen.getByText("2 documents")).toBeTruthy();
  });
});

describe("a rejected file does not cost the rest of the selection", () => {
  it("queues the good files and names the one it skipped", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    // 60 MB, over the 50 MB per-file limit.
    const huge = txt("enormous.txt", 60 * 1024 * 1024);
    drop(txt("a.txt"), huge, txt("b.txt"));

    // The two good ones are queued...
    expect(screen.getByText("2 documents")).toBeTruthy();
    // ...and the skipped one is named, so nothing disappears silently.
    expect(screen.getByText(/enormous\.txt/)).toBeTruthy();
  });
});

describe("what a batch shares and what it does not", () => {
  it("offers a description for one document", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("a.txt"));
    expect(screen.getByLabelText(/description/i)).toBeTruthy();
  });

  it("withholds it for a batch, rather than writing one line onto many records", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("a.txt"), txt("b.txt"));
    expect(screen.queryByLabelText(/description/i)).toBeNull();
    // And says where descriptions come from instead of just removing the field.
    expect(screen.getByText(/descriptions are per document/i)).toBeTruthy();
  });

  it("keeps category and tags shared, which is the work being removed", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("a.txt"), txt("b.txt"));
    expect(screen.getByLabelText(/category/i)).toBeTruthy();
    expect(screen.getByLabelText(/tags/i)).toBeTruthy();
    expect(screen.getByText(/applied to every document in this batch/i)).toBeTruthy();
  });
});

describe("uploading the batch", () => {
  it("names the count on the button, so the reader knows what they are committing", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("a.txt"), txt("b.txt"), txt("c.txt"));
    expect(screen.getByRole("button", { name: /upload 3 documents/i })).toBeTruthy();
  });

  it("stores every queued document, not just the first", async () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("attendance.txt"), txt("dress-code.txt"), txt("safety.txt"));

    fireEvent.click(screen.getByRole("button", { name: /upload 3 documents/i }));

    await waitFor(() => expect(addDocument).toHaveBeenCalledTimes(3));

    // Each with its own title and its own file.
    const titles = addDocument.mock.calls.map(
      (call) => (call as unknown as [{ title: string }])[0].title,
    );
    // Separators become spaces, which is the derivation the single-file flow
    // already used — "dress-code.txt" files as "dress code".
    expect(titles).toEqual(["attendance", "dress code", "safety"]);
  });

  it("removing a file drops it from the batch", () => {
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("a.txt"), txt("b.txt"));
    fireEvent.click(screen.getByRole("button", { name: /remove b\.txt/i }));
    expect(screen.getByText("1 document")).toBeTruthy();
  });

  it("refuses to send while any queued file has no title", () => {
    /*
     * A blank title is not a harmless empty field: the server requires one, and
     * a batch that sent it would fail that file for a reason the reader could
     * have fixed in the queue.
     */
    render(<UploadDialog onDone={vi.fn()} />);
    drop(txt("a.txt"), txt("b.txt"));
    const [first] = screen.getAllByPlaceholderText("Document title");
    fireEvent.change(first, { target: { value: "  " } });
    expect(
      screen.getByRole("button", { name: /upload 2 documents/i }),
    ).toHaveProperty("disabled", true);
  });
});
