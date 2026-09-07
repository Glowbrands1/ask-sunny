// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadsNeedingAttention } from "./uploads-needing-attention";
import type { TrainingVideo } from "@/lib/videos/types";

/**
 * ============================================================================
 * A STUCK UPLOAD HAS TO BE CLEARABLE, NOT MERELY VISIBLE
 * ============================================================================
 *
 * THE QA FINDING THIS PINS. The section listed a title, a status sentence and a
 * badge, and offered no control at all. `DELETE /api/videos/:id` already
 * accepted a `pending_upload` or `failed` row and `DeleteVideoDialog` already
 * had the wording for one, but nothing on the page could reach either — so an
 * administrator could see a dead upload and had no way to remove it. A section
 * that exists to be acted on and cannot be acted on is worse than no section.
 *
 * THESE ARE RENDERED ASSERTIONS RATHER THAN A SOURCE SCAN, because the property
 * is behavioural: the control exists in the accessibility tree, it is reachable
 * per row, and pressing it hands THAT row's id back. A regex over the file
 * cannot see a button that renders inert.
 *
 * WHAT IT MUST NOT DO IS DELETE. `onDelete` opens the shared, named
 * confirmation; a row that deleted on click would be one click on a destructive
 * action, in the one list where every row looks alike.
 */

function video(overrides: Partial<TrainingVideo> = {}): TrainingVideo {
  return {
    id: "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d",
    title: "Adamant: In a hurry",
    description: "",
    category: "leadership",
    durationSeconds: 17,
    uploadedByName: "Manager",
    uploadedAt: "2026-09-06T00:00:00Z",
    equipment: [],
    keywords: [],
    tags: [],
    status: "pending_upload",
    hasCloudAsset: false,
    mimeType: "video/mp4",
    sizeBytes: null,
    transcriptStatus: "not_configured",
    transcriptText: null,
    transcriptErrorSafe: null,
    transcriptProvider: null,
    viewCount: 0,
    thumbnailTone: "sage",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the section renders only when there is something to act on", () => {
  it("renders nothing for a viewer, whose list is empty", () => {
    /*
     * The server sends `needsAttention: []` to a caller without
     * `manage_videos`, so an Employee never reaches this component with rows —
     * and an empty section heading would advertise a queue they cannot see.
     */
    const { container } = render(
      <UploadsNeedingAttention videos={[]} onDelete={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("names the section and says the rows are hidden from viewers", () => {
    render(<UploadsNeedingAttention videos={[video()]} onDelete={() => {}} />);

    expect(screen.getByText("Uploads needing attention")).toBeTruthy();
    expect(screen.getByText(/not visible to viewers/)).toBeTruthy();
  });

  it("describes each row by its real status, never as a legacy file", () => {
    const { container } = render(
      <UploadsNeedingAttention
        videos={[
          video({ id: "a", title: "Pending one", status: "pending_upload" }),
          video({ id: "b", title: "Failed one", status: "failed" }),
        ]}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("Upload has not been completed.")).toBeTruthy();
    expect(screen.getByText("Upload failed. Re-upload this video.")).toBeTruthy();
    // The wording that was false about a row this deployment created seconds ago.
    expect(container.textContent).not.toContain("before cloud video storage");
    expect(container.textContent).not.toContain("legacy");
  });
});

describe("every stuck row offers the delete control", () => {
  it("gives a pending upload one", () => {
    render(
      <UploadsNeedingAttention
        videos={[video({ status: "pending_upload" })]}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete Adamant: In a hurry" })).toBeTruthy();
  });

  it("gives a failed upload one", () => {
    render(
      <UploadsNeedingAttention
        videos={[video({ status: "failed" })]}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete Adamant: In a hurry" })).toBeTruthy();
  });

  it("names the video, so a column of identical rows is navigable", () => {
    render(
      <UploadsNeedingAttention
        videos={[
          video({ id: "a", title: "Bed sanitising" }),
          video({ id: "b", title: "Closing checklist", status: "failed" }),
        ]}
        onDelete={() => {}}
      />,
    );

    // Not two controls both reading "Delete".
    expect(screen.getByRole("button", { name: "Delete Bed sanitising" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Closing checklist" })).toBeTruthy();
  });

  it("gives one control per row and no more", () => {
    render(
      <UploadsNeedingAttention
        videos={[video({ id: "a" }), video({ id: "b" }), video({ id: "c" })]}
        onDelete={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

describe("the control asks, it does not delete", () => {
  it("hands back the id of the row that was pressed", () => {
    const onDelete = vi.fn();
    render(
      <UploadsNeedingAttention
        videos={[
          video({ id: "row-a", title: "Bed sanitising" }),
          video({ id: "row-b", title: "Closing checklist", status: "failed" }),
        ]}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Closing checklist" }));

    // The SECOND row's id — not the first, and not a title.
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("row-b");
  });

  it("sends no request of its own", () => {
    /*
     * The delete happens inside `DeleteVideoDialog`, after a person has
     * confirmed against the video's name. A fetch from here would be a
     * destructive action on a single click.
     */
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<UploadsNeedingAttention videos={[video()]} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Adamant: In a hurry" }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves the row in place — the list is refreshed from the server", () => {
    /*
     * Nothing is removed optimistically. The screen refetches after a
     * confirmed delete, so what this list shows is always what the server last
     * said rather than a local guess about what the delete did.
     */
    const { container } = render(
      <UploadsNeedingAttention videos={[video()]} onDelete={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Adamant: In a hurry" }));
    expect(container.textContent).toContain("Adamant: In a hurry");
  });
});
