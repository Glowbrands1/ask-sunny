// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardChangePanel } from "./card-change-panel";
import { MessageBubble } from "./message-bubble";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * NEXT_PUBLIC_CARD_CHANGE_ENABLED: the card's "Change something" panel sends
 * the manager's choices as one chat turn, through the same path a suggestion
 * chip uses. Rendered, so an inert control cannot pass. The turn's wording is
 * proven read by the chat in `card-change-e2e.test.ts`.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC" }, isAdmin: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const FLAG = "NEXT_PUBLIC_CARD_CHANGE_ENABLED";

beforeEach(() => vi.stubEnv(FLAG, "true"));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function proposal(overrides: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "prop-1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: false,
    variantKey: null,
    employeeRole: null,
    employeeName: "Dale Ferris",
    locationId: "loc-0101",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds: ["msg-1"],
    formDate: "2026-10-20",
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "Here is the **Corrective Action Form**.",
    createdAt: "2026-10-27T12:00:00Z",
    mode: "standard",
    coverage: "not_applicable",
    citations: [],
    recommendedVideoIds: [],
    formProposal: proposal(),
    ...overrides,
  };
}

function bubble(overrides: Partial<ChatMessage> = {}, conversation?: ChatMessage[]) {
  const onSuggestion = vi.fn();
  const msg = message(overrides);
  render(<MessageBubble message={msg} conversation={conversation ?? [msg]} onSuggestion={onSuggestion} />);
  return onSuggestion;
}

describe("flag off", () => {
  it("the card shows no Change something", () => {
    vi.stubEnv(FLAG, "");
    bubble();
    expect(screen.queryByRole("button", { name: /change something/i })).toBeNull();
  });
});

describe("flag on", () => {
  it("sends the date and the warning as one turn the chat reads", async () => {
    const onSuggestion = bubble();
    await userEvent.click(screen.getByRole("button", { name: /change something/i }));
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    expect(date.value).toBe("2026-10-20");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-10-19");
    await userEvent.selectOptions(screen.getByLabelText("Type of warning"), "written");
    await userEvent.click(screen.getByRole("button", { name: "Send change" }));
    expect(onSuggestion).toHaveBeenCalledWith("Change the date to 10/19/2026. This is a written warning.");
    expect(screen.queryByRole("button", { name: "Send change" })).toBeNull();
  });

  it("payroll, salon and job title, without a date", async () => {
    const onSuggestion = bubble();
    await userEvent.click(screen.getByRole("button", { name: /change something/i }));
    await userEvent.selectOptions(screen.getByLabelText("Payroll deduct"), "no");
    await userEvent.type(screen.getByLabelText("Salon"), "Lawrence");
    await userEvent.type(screen.getByLabelText("Job title"), "Salon Director");
    await userEvent.click(screen.getByRole("button", { name: "Send change" }));
    expect(onSuggestion).toHaveBeenCalledWith("Change: Payroll deduct no. Salon: Lawrence. Job title: Salon Director.");
  });

  it("nothing changed sends nothing and says so", async () => {
    const onSuggestion = bubble();
    await userEvent.click(screen.getByRole("button", { name: /change something/i }));
    await userEvent.click(screen.getByRole("button", { name: "Send change" }));
    expect(onSuggestion).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Nothing is changed yet.");
  });

  it("the date picker stops at the end of next year", async () => {
    bubble();
    await userEvent.click(screen.getByRole("button", { name: /change something/i }));
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    expect(date.max).toBe(`${new Date().getFullYear() + 1}-12-31`);
    expect(date.type).toBe("date");
  });

  it("a form that is not a Corrective Action has no warning or payroll fields", async () => {
    bubble({ formProposal: proposal({ templateKey: "coaching", templateName: "Coaching Form" }) });
    await userEvent.click(screen.getByRole("button", { name: /change something/i }));
    expect(screen.queryByLabelText("Type of warning")).toBeNull();
    expect(screen.queryByLabelText("Payroll deduct")).toBeNull();
  });

  it("not offered once a form exists, or on a card a newer proposal replaced", () => {
    const msg = message();
    render(<CardChangePanel proposal={msg.formProposal} created conversation={[msg]} placeLabel="Salon" onSend={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /change something/i })).toBeNull();
    cleanup();
    const old = message();
    const newer = message({ id: "m2", formProposal: proposal({ proposalId: "prop-2" }) });
    bubble({}, [old, newer]);
    expect(screen.queryByRole("button", { name: /change something/i })).toBeNull();
  });
});
