// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TrainingCatalog } from "@/lib/ai-training/types";

/** THE LESSON EDITOR: creating a module without leaving it. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ai-training/manage/lessons/new",
  useSearchParams: () => new URLSearchParams(),
}));
const saveLessonAction = vi.fn<(input: unknown) => Promise<{ ok: true; value: string }>>(async () => ({ ok: true, value: "new-id" }));
vi.mock("./actions", () => ({ saveLessonAction: (input: unknown) => saveLessonAction(input) }));

// The checkbox measures itself; jsdom has no ResizeObserver (same stub as the sidebar test).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { LessonEditor } = await import("./lesson-editor");

const catalog: TrainingCatalog = {
  tracks: [{ id: "t1", slug: "claude", title: "Claude Training", sortOrder: 1 }],
  modules: [
    { id: "m1", trackId: "t1", slug: "m1", title: "Module 1: Basics", sortOrder: 1, adminOnly: false },
    { id: "m9", trackId: "t1", slug: "archive", title: "Archive: Retired Lessons", sortOrder: 9, adminOnly: true },
  ],
  lessons: [],
};

afterEach(() => {
  cleanup();
  saveLessonAction.mockClear();
});

function renderEditor() {
  render(<LessonEditor problem={null} catalog={catalog} lesson={null} isNew defaultTrackId="t1" />);
  return screen.getByLabelText("Module") as HTMLSelectElement;
}

describe("+ New module… in the lesson editor", () => {
  it("is the last choice in the Module list", () => {
    const select = renderEditor();
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels.at(-1)).toBe("+ New module…");
  });

  it("shows a name box pre-filled with the next module number, and hides it again", () => {
    const select = renderEditor();
    expect(screen.queryByLabelText("New module name")).toBeNull();
    fireEvent.change(select, { target: { value: "__new__" } });
    expect((screen.getByLabelText("New module name") as HTMLInputElement).value).toBe("Module 2: ");
    fireEvent.change(select, { target: { value: "m1" } });
    expect(screen.queryByLabelText("New module name")).toBeNull();
  });

  it("sends the new module's name with the lesson and no module id", async () => {
    const select = renderEditor();
    fireEvent.change(select, { target: { value: "__new__" } });
    fireEvent.change(screen.getByLabelText("New module name"), { target: { value: "Module 2: Agents" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Build an agent" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(saveLessonAction).toHaveBeenCalledTimes(1));
    expect(saveLessonAction.mock.calls[0][0]).toMatchObject({ moduleId: null, newModuleTitle: "Module 2: Agents" });
  });
});

describe("publishing a lesson to the other app", () => {
  it("sends publishToOther only when the box is ticked", async () => {
    render(<LessonEditor problem={null} catalog={catalog} lesson={null} isNew defaultTrackId="t1" otherAppName="Ask Bubbles" />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Build an agent" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Also publish to Ask Bubbles" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(saveLessonAction).toHaveBeenCalledTimes(1));
    expect(saveLessonAction.mock.calls[0][0]).toMatchObject({ publishToOther: true });
  });

  it("has no box when sync is not set up", () => {
    render(<LessonEditor problem={null} catalog={catalog} lesson={null} isNew defaultTrackId="t1" otherAppName={null} />);
    expect(screen.queryByRole("checkbox", { name: /Also publish to/ })).toBeNull();
  });
});
