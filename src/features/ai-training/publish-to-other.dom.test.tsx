// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublishToOtherBox, SaveOutcome, resetPublishToOtherForTests, usePublishToOther } from "./publish-to-other";

/** THE "ALSO PUBLISH TO <OTHER APP>" BOX on the AI Training editing screens. */

function Harness({ otherAppName }: { otherAppName: string | null }) {
  const [checked, setChecked] = usePublishToOther();
  return <PublishToOtherBox otherAppName={otherAppName} checked={checked} onChange={setChecked} />;
}

/** An in-memory Storage, so the test does not depend on the runner's own (sometimes missing) one. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  resetPublishToOtherForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PublishToOtherBox", () => {
  it("is not shown when publishing to the other app is not set up", () => {
    render(<Harness otherAppName={null} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("names the other app and starts unticked", () => {
    render(<Harness otherAppName="Ask Bubbles" />);
    const box = screen.getByRole("checkbox", { name: "Also publish to Ask Bubbles" });
    expect(box.getAttribute("aria-checked") ?? String((box as HTMLInputElement).checked)).toMatch(/false/);
  });

  it("remembers the editor's last choice", async () => {
    const first = render(<Harness otherAppName="Ask Bubbles" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Also publish to Ask Bubbles" }));
    first.unmount();
    render(<Harness otherAppName="Ask Bubbles" />);
    const box = screen.getByRole("checkbox", { name: "Also publish to Ask Bubbles" });
    await waitFor(() => expect(box.getAttribute("aria-checked") ?? String((box as HTMLInputElement).checked)).toMatch(/true/));
  });

  it("renders unticked first, as the server does, even when the last choice was ticked", () => {
    storage.setItem("ai-training:publish-to-other", "1");
    const html = renderToString(<Harness otherAppName="Ask Bubbles" />);
    expect(html).toContain('aria-checked="false"');
  });

  it("still works, unticked, when the browser blocks storage", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Harness otherAppName="Ask Sunny" />);
    const box = screen.getByRole("checkbox", { name: "Also publish to Ask Sunny" });
    expect(box.getAttribute("aria-checked") ?? String((box as HTMLInputElement).checked)).toMatch(/false/);
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked") ?? String((box as HTMLInputElement).checked)).toMatch(/true/);
  });
});

describe("SaveOutcome", () => {
  it("shows a publishing warning as a status, not as an error", () => {
    render(<SaveOutcome error={null} warning="Saved here, but not published to Ask Bubbles: it could not be reached" />);
    expect(screen.getByRole("status").textContent).toContain("Saved here, but not published to Ask Bubbles");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a failed save as an error", () => {
    render(<SaveOutcome error="Title is required." warning={null} />);
    expect(screen.getByRole("alert").textContent).toContain("Title is required.");
  });
});
