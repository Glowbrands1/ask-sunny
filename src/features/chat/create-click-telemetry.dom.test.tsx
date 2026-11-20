// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./message-bubble";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";

/*
 * QA, f073 (20 Nov 2026): a "Create draft" press did nothing and nothing reached any log. Every press now sends its
 * events to the server log: the click (and why it started nothing, when it did not), the create leaving, and how it
 * ended. Ids, the build's deployment id and timings only: never the employee, the account or the form.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "DW", name: "Dana Whitlock" }, role: "salon_director", isAdmin: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ACCOUNT: ChatMessage = { id: "msg-account", role: "user", content: "Corin Vale was late twice this week.", createdAt: "2026-11-20T16:24:00Z" };
const PROPOSAL: ChatFormProposal = {
  proposalId: "prop-f073",
  templateKey: "coaching",
  templateName: "Coaching Form",
  supportsInlineDraft: true,
  variantKey: null,
  employeeRole: null,
  employeeName: "Corin Vale",
  locationId: "loc-0101",
  locationName: null,
  locationResolution: "resolved",
  authorizedLocationIds: [],
  status: "ready",
  sourceMessageIds: ["msg-account"],
};
const TURN: ChatMessage = {
  id: "msg-answer",
  role: "assistant",
  content: "Here is what I would put on a **Coaching Form**.",
  createdAt: "2026-11-20T16:24:10Z",
  mode: "standard",
  coverage: "not_applicable",
  citations: [],
  recommendedVideoIds: [],
  formProposal: PROPOSAL,
};

let events: Record<string, unknown>[] = [];
let createAnswers: "hang" | "refuse" | "ok" = "ok";

beforeEach(() => {
  events = [];
  vi.stubEnv("NEXT_PUBLIC_BUILD_DEPLOYMENT_ID", "dpl_7hB9old");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  globalThis.fetch = vi.fn().mockImplementation(async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    if (url === "/api/telemetry/client-form") {
      events.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, status: 204, json: async () => ({}) } as unknown as Response;
    }
    if (url === "/api/forms/instances" && init.method === "POST") {
      if (createAnswers === "hang") return new Promise(() => {});
      if (createAnswers === "refuse") return { ok: false, json: async () => ({ error: "You can't create this form." }) } as unknown as Response;
      return { ok: true, json: async () => ({ instance: { id: "inst-73" } }) } as unknown as Response;
    }
    if (url.endsWith("/draft")) return { ok: true, json: async () => ({ values: {}, checked: {}, withheld: [] }) } as unknown as Response;
    return { ok: false, json: async () => ({ error: "not in this test" }) } as unknown as Response;
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function press(onFormCreated = vi.fn<(messageId: string, reference: ChatFormInstanceRef) => void>(), times = 1) {
  render(<MessageBubble message={TURN} conversation={[ACCOUNT, TURN]} onSuggestion={() => {}} onFormCreated={onFormCreated} />);
  const button = screen.getByRole("button", { name: /create draft/i });
  if (times === 1) fireEvent.click(button);
  // Both presses before React re-renders the button as disabled: the race the in-flight guard exists for.
  else act(() => Array.from({ length: times }, () => button.click()));
  return { button, onFormCreated };
}

describe("f073: every Create press reaches the server log", () => {
  it("a create that works: clicked, sent, answered, with the page's deploy and no names", async () => {
    createAnswers = "ok";
    const { onFormCreated } = press();
    await waitFor(() => expect(onFormCreated).toHaveBeenCalled());
    expect(events.map((event) => event.event)).toEqual(["form.create.clicked", "form.create.sent", "form.create.answered"]);
    for (const event of events) {
      expect(event.proposalId).toBe("prop-f073");
      expect(event.deploymentId).toBe("dpl_7hB9old");
      expect(JSON.stringify(event)).not.toMatch(/Corin|Vale|late|Coaching/);
    }
  });

  it("a press while a create is still running says so: clicked, ignored in_flight", async () => {
    createAnswers = "hang";
    press(undefined, 2);
    await waitFor(() => expect(events.filter((event) => event.event === "form.create.clicked")).toHaveLength(2));
    expect(events.at(-1)).toMatchObject({ event: "form.create.clicked", ignored: "in_flight" });
  });

  it("a refused create: failed, kind refused, never the route's words", async () => {
    createAnswers = "refuse";
    press();
    await waitFor(() => expect(events.some((event) => event.event === "form.create.failed")).toBe(true));
    const failed = events.find((event) => event.event === "form.create.failed")!;
    expect(failed.failure).toBe("refused");
    expect(JSON.stringify(failed)).not.toMatch(/can't create/);
  });
});
