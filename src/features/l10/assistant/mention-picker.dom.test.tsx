// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Hub's chat @-picker (src/components/assistant/MentionPicker.test.tsx there), in the DM L10 assistant: "@" offers
 * THIS meeting's people only (from the Hub, for this person), Enter picks instead of sending, Escape closes.
 * Invented people only.
 */
const people = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/features/l10/actions", () => ({
  meetingPeopleAction: async (key: string) => {
    people.calls.push(key);
    return [
      { id: "1", name: "Avery Quill" },
      { id: "2", name: "Bo Lark" },
      { id: "3", name: "Bea Marsh" },
    ];
  },
}));

import { AssistantPanel } from "./AssistantPanel";
import { ChatMentionText } from "./MentionPicker";

beforeEach(() => {
  window.localStorage.clear();
  people.calls = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPanel() {
  render(<AssistantPanel open onClose={() => {}} meetingKey="stc-dm" scope="sunny-user-1:stc-dm" />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the DM L10 assistant's @-picker", () => {
  it("offers this meeting's people, filtered as you type; Enter picks the highlighted one instead of sending", async () => {
    const user = userEvent.setup();
    await openPanel();
    expect(people.calls).toEqual(["stc-dm"]);
    const box = screen.getByLabelText("Message the Leadership Assistant") as HTMLTextAreaElement;
    await user.type(box, "Send @");
    expect(within(screen.getByRole("listbox", { name: "People you can mention" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Avery Quill", "Bo Lark", "Bea Marsh"]);
    await user.type(box, "b");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Bo Lark", "Bea Marsh"]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    const sends = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/l10/assistant") && !String(url).includes("config")).length;
    await user.keyboard("{ArrowDown}{Enter}");
    expect(box.value).toBe("Send @Bea Marsh ");
    expect(screen.queryByRole("listbox")).toBeNull();
    // Nothing was sent by that Enter.
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/l10/assistant") && !String(url).includes("config")).length).toBe(sends);
  });

  it("Escape closes without picking", async () => {
    const user = userEvent.setup();
    await openPanel();
    const box = screen.getByLabelText("Message the Leadership Assistant") as HTMLTextAreaElement;
    await user.type(box, "@av");
    expect(screen.getByRole("option", { name: "Avery Quill" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box.value).toBe("@av");
  });

  it("shows picked people in a sent message as name chips", () => {
    render(<p>{ChatMentionText({ text: "Send @Bo Lark a note", people: [{ id: "2", name: "Bo Lark" }] })}</p>);
    expect(screen.getByText("@Bo Lark").hasAttribute("data-mention")).toBe(true);
  });
});
