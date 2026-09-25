// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/overlays";
import type { ChatConversation } from "@/types";

import { ConversationList } from "./conversation-list";

/* Live mode: the history panel measures "today" against the real clock. */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
});

function conversation(id: string, title: string, at: string): ChatConversation {
  return {
    id,
    title,
    createdAt: at,
    updatedAt: at,
    attachedDocumentIds: [],
    messages: [{ id: `msg_${id}`, role: "user", content: title, createdAt: at }],
  };
}

const CORRECTIVE = conversation(
  "conv_b",
  "Employee Corrective Action Form",
  "2026-09-26T00:05:00.000Z", // Sep 25, 7:05 PM CDT
);
const ATTENDANCE = conversation(
  "conv_c",
  "Policy Question – Attendance",
  "2026-09-24T20:42:00.000Z", // Sep 24, 3:42 PM CDT
);
const ONBOARDING = conversation(
  "conv_a",
  "Onboarding checklist",
  "2026-09-22T14:00:00.000Z", // Sep 22, 9:00 AM CDT
);
const OLD = conversation("conv_o", "Spring schedule", "2026-08-01T15:00:00.000Z");

function renderList(
  conversations: ChatConversation[],
  overrides: Partial<React.ComponentProps<typeof ConversationList>> = {},
) {
  const props = {
    conversations,
    activeId: null,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onDelete: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
  const view = render(
    <TooltipProvider>
      <ConversationList {...props} />
    </TooltipProvider>,
  );
  return { ...view, props };
}

function titlesInOrder(): string[] {
  const region = screen.getByRole("region", { name: "Chat history" });
  return within(region)
    .getAllByRole("button", { name: /^(?!Delete)/ })
    .map((button) => button.querySelector("span span")?.textContent ?? "");
}

function sectionsInOrder(): string[] {
  const region = screen.getByRole("region", { name: "Chat history" });
  return [...region.querySelectorAll("p.eyebrow")].map((node) => node.textContent ?? "");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T01:00:00.000Z")); // Sep 25, 8:00 PM CDT
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("chat history panel", () => {
  it("shows the newest conversation first, whatever order they arrive in", () => {
    renderList([ONBOARDING, OLD, CORRECTIVE, ATTENDANCE]);
    expect(titlesInOrder()).toEqual([
      "Employee Corrective Action Form",
      "Policy Question – Attendance",
      "Onboarding checklist",
      "Spring schedule",
    ]);
  });

  it("labels each conversation with its last-active date and time in Central", () => {
    renderList([CORRECTIVE, ATTENDANCE]);
    const corrective = screen.getByText("Sep 25, 2026 • 7:05 PM CT");
    expect(corrective.tagName).toBe("TIME");
    expect(corrective.getAttribute("dateTime")).toBe("2026-09-26T00:05:00.000Z");
    expect(corrective.getAttribute("title")).toBe("Last active Sep 25, 2026 • 7:05 PM CDT");
    expect(screen.getByText("Sep 24, 2026 • 3:42 PM CT")).toBeTruthy();
  });

  it("groups into Today, Yesterday, Previous 7 Days and Earlier", () => {
    renderList([OLD, ONBOARDING, ATTENDANCE, CORRECTIVE]);
    expect(sectionsInOrder()).toEqual(["Today", "Yesterday", "Previous 7 Days", "Earlier"]);
  });

  it("moves a conversation back to the top when it gets new activity", () => {
    const { rerender, props } = renderList([CORRECTIVE, ATTENDANCE, ONBOARDING]);
    expect(titlesInOrder()[0]).toBe("Employee Corrective Action Form");

    const continued: ChatConversation = {
      ...ONBOARDING,
      updatedAt: "2026-09-26T00:55:00.000Z",
      messages: [
        ...ONBOARDING.messages,
        { id: "msg_new", role: "assistant", content: "Here you go", createdAt: "2026-09-26T00:55:00.000Z" },
      ],
    };
    rerender(
      <TooltipProvider>
        <ConversationList {...props} conversations={[CORRECTIVE, ATTENDANCE, continued]} />
      </TooltipProvider>,
    );

    expect(titlesInOrder()).toEqual([
      "Onboarding checklist",
      "Employee Corrective Action Form",
      "Policy Question – Attendance",
    ]);
    expect(sectionsInOrder()).toEqual(["Today", "Yesterday"]);
    expect(screen.getByText("Sep 25, 2026 • 7:55 PM CT")).toBeTruthy();
  });

  it("still selects, deletes and clears exactly as before", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    const { props } = renderList([ATTENDANCE, CORRECTIVE], { onClearAll });

    await user.click(screen.getByRole("button", { name: /^Policy Question – Attendance/ }));
    expect(props.onSelect).toHaveBeenCalledWith("conv_c");

    await user.click(
      screen.getByRole("button", { name: "Delete conversation: Employee Corrective Action Form" }),
    );
    expect(props.onDelete).toHaveBeenCalledWith("conv_b");

    await user.click(screen.getByRole("button", { name: "Clear history" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("keeps the empty state", () => {
    renderList([]);
    expect(screen.getByText(/No conversations yet/)).toBeTruthy();
  });
});
