// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "@/features/chat/message-bubble";
import type { ChatMessage } from "@/types";

import { groundFormSlots, type FormRemapSlots } from "./form-full-remap";
import { historyForRemap } from "./form-remap-scope";

/**
 * An earlier chat set payroll deduct $40 at KS Lawrence. Each failed chat
 * is a new conversation. Nothing from that chat may fill a field the manager
 * did not type again.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC" }, isAdmin: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const tables = vi.hoisted(() => ({
  conversations: [] as { id: string; user_id: string; client_conversation_id: string }[],
  messages: [] as {
    user_id: string;
    conversation_id: string;
    client_message_id: string;
    role: string;
    content: string;
    position: number;
  }[],
  traces: [] as { user_id: string; conversation_id: string; slots: unknown }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const filters: Record<string, string> = {};
      let ids: string[] = [];
      const rows = () => {
        if (table === "chat_conversations") {
          return tables.conversations.filter(
            (row) => row.user_id === filters.user_id && row.client_conversation_id === filters.client_conversation_id,
          );
        }
        if (table === "chat_messages") {
          return tables.messages.filter((row) => {
            if (filters.user_id && row.user_id !== filters.user_id) return false;
            if (filters.conversation_id && row.conversation_id !== filters.conversation_id) return false;
            if (ids.length > 0 && !ids.includes(row.client_message_id)) return false;
            return true;
          });
        }
        return tables.traces.filter(
          (row) => row.user_id === filters.user_id && row.conversation_id === filters.conversation_id,
        );
      };
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        is() {
          return api;
        },
        in(_column: string, values: string[]) {
          ids = values;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => ({ data: rows().at(-1) ?? null, error: null }),
        then(resolve: (value: unknown) => void) {
          resolve({ data: rows(), error: null });
        },
      };
      return api;
    },
  }),
}));

const TODAY = "2026-10-24";
const USER = "user-1";
const PAYROLL =
  "corrective action for Test Employee at Lawrence, payroll deduct $40. She left the register drawer open on October 1. Verbal warning.";

const KEARNEY = [
  "CA for Test Employee at Kearney, out of dress code 10/11",
  "verbal, prior = manual ack 9/01, no payroll",
  "Use Kearney as the location",
] as const;

const GRAND_ISLAND = [
  "Test Employee at Grand Island out of dress code 3 shifts, coached on 2nd",
  "Create a Coaching Form",
  "Yes",
] as const;

const CELL = ["verbal CA for Test Employee, on cell phone 30+ min 10-20"] as const;

const INVENTED = {
  templateKey: "coaching",
  employeeName: null,
  observation: "invented unicorn incident",
  store: "Omaha",
  warningLevel: null,
  payrollDeduct: "yes",
  payrollAmount: "$40",
};

beforeEach(() => {
  cleanup();
  tables.conversations.length = 0;
  tables.messages.length = 0;
  tables.traces.length = 0;
  tables.conversations.push({ id: "uuid-payroll", user_id: USER, client_conversation_id: "conv-payroll" });
  tables.messages.push({
    user_id: USER,
    conversation_id: "uuid-payroll",
    client_message_id: "msg-payroll",
    role: "user",
    content: PAYROLL,
    position: 0,
  });
  tables.traces.push({
    user_id: USER,
    conversation_id: "conv-payroll",
    slots: {
      payrollDeduct: "yes",
      payrollAmount: "$40",
      store: "KS Lawrence",
      locationId: "loc-0468",
      incidentDateIso: "2026-10-01",
      observation: "Left the register drawer open.",
      warningLevel: "verbal",
    },
  });
});

function freshReplay(turns: readonly string[]): ReturnType<typeof groundFormSlots>[] {
  let history: { role: string; content: string }[] = [];
  let saved: FormRemapSlots | null = null;
  const steps: ReturnType<typeof groundFormSlots>[] = [];
  for (const question of turns) {
    const step = groundFormSlots({
      raw: INVENTED,
      history,
      question,
      today: TODAY,
      people: [],
      saved,
    });
    steps.push(step);
    history = [...history, { role: "user", content: question }];
    saved = step.slots;
  }
  return steps;
}

async function scopedReplay(conversationId: string, turns: readonly string[]) {
  tables.conversations.push({ id: `uuid-${conversationId}`, user_id: USER, client_conversation_id: conversationId });
  const steps: ReturnType<typeof groundFormSlots>[] = [];
  const prior: { id: string; role: string; content: string }[] = [];
  for (const [index, question] of turns.entries()) {
    const scoped = await historyForRemap({
      userId: USER,
      conversationId,
      history: [{ id: "msg-payroll", role: "user", content: PAYROLL }, ...prior],
    });
    expect(scoped.history.map((turn) => turn.content)).toEqual(prior.map((turn) => turn.content));
    expect(scoped.saved?.payrollAmount ?? null).not.toBe("$40");
    expect(scoped.saved?.locationId ?? null).not.toBe("loc-0468");
    const step = groundFormSlots({
      raw: INVENTED,
      history: scoped.history,
      question,
      today: TODAY,
      people: [],
      saved: scoped.saved,
    });
    steps.push(step);
    const id = `${conversationId}-${index}`;
    prior.push({ id, role: "user", content: question });
    tables.messages.push({
      user_id: USER,
      conversation_id: `uuid-${conversationId}`,
      client_message_id: id,
      role: "user",
      content: question,
      position: index,
    });
    tables.traces.push({
      user_id: USER,
      conversation_id: conversationId,
      slots: step.slots,
    });
  }
  return steps;
}

function cardOf(step: ReturnType<typeof groundFormSlots>): string {
  cleanup();
  const message: ChatMessage = {
    id: "m1",
    role: "assistant",
    content: step.response.content,
    createdAt: "2026-10-24T15:06:00Z",
    mode: "standard",
    coverage: "not_applicable",
    citations: [],
    recommendedVideoIds: [],
    formProposal: step.response.formProposal,
  };
  const view = render(<MessageBubble message={message} onSuggestion={() => {}} />);
  return view.container.textContent ?? "";
}

function expectNoCarry(step: ReturnType<typeof groundFormSlots>, label: string) {
  const shown = cardOf(step);
  const packed = `${JSON.stringify(step.slots)}\n${step.response.content}\n${shown}`;
  expect(packed, label).not.toMatch(/\$40|Lawrence|loc-0468|2026-10-01|register drawer/);
}

describe("a $40 payroll chat does not carry into the next conversation", () => {
  it("keeps the deduction and KS Lawrence on the chat that stated them", () => {
    const [step] = freshReplay([PAYROLL]);
    expect(step!.slots.templateKey).toBe("dpoa");
    expect(step!.slots.payrollDeduct).toBe("yes");
    expect(step!.slots.payrollAmount).toBe("$40");
    expect(step!.slots.store).toBe("KS Lawrence");
    expect(step!.slots.locationId).toBe("loc-0468");
    expect(step!.slots.incidentDateIso).toBe("2026-10-01");
    expect(step!.slots.warningLevel).toBe("verbal");
    const shown = cardOf(step!);
    expect(shown).toContain("$40");
    expect(shown).toContain("Lawrence");
    expect(shown).toContain("2026-10-01");
  });

  it("replays Kearney, Grand Island, and the cell-phone chat with none of those fields", async () => {
    const kearney = await scopedReplay("conv_mvmj6v1t250hfij", KEARNEY);
    const lastKearney = kearney.at(-1)!;
    expect(lastKearney.slots.templateKey).toBe("dpoa");
    expect(lastKearney.slots.locationId).toBe("loc-0309");
    expect(lastKearney.slots.store).toBe("NE Kearney");
    expect(lastKearney.slots.incidentDateIso).toBe("2026-10-11");
    expect(lastKearney.slots.warningLevel).toBe("verbal");
    expect(lastKearney.slots.priorActions).toBe("manual acknowledgement 9/01");
    expect(lastKearney.slots.payrollDeduct).toBe("no");
    expect(lastKearney.slots.payrollAmount).toBeNull();
    expect(lastKearney.slots.observation).toMatch(/dress code/);
    for (const step of kearney) expectNoCarry(step, "kearney");
    expect(screen.getByText("Corrective Action Form")).toBeTruthy();

    const island = await scopedReplay("conv_mvmj7ifs9oosat5", GRAND_ISLAND);
    const lastIsland = island.at(-1)!;
    expect(lastIsland.slots.templateKey).toBe("coaching");
    expect(lastIsland.slots.locationId).toBe("loc-0307");
    expect(lastIsland.slots.store).toBe("NE Grand Island");
    expect(lastIsland.slots.observation).toBe("dress code, 3 shifts");
    expect(lastIsland.slots.priorActions).toBe("coached on 2nd");
    expect(lastIsland.slots.warningLevel).toBeNull();
    expect(lastIsland.slots.payrollDeduct).toBeNull();
    expect(lastIsland.slots.payrollAmount).toBeNull();
    for (const step of island) expectNoCarry(step, "grand island");
    expect(screen.getByText("Coaching Form")).toBeTruthy();
    expect(screen.queryByText("Corrective Action Form")).toBeNull();

    const cell = await scopedReplay("conv_mvmj8a26gtq901w", CELL);
    const only = cell[0]!;
    expect(only.slots.templateKey).toBe("dpoa");
    expect(only.slots.warningLevel).toBe("verbal");
    expect(only.slots.incidentDateIso).toBe("2026-10-20");
    expect(only.slots.incidentTime).toBeNull();
    expect(only.slots.store).toBeNull();
    expect(only.slots.locationId).toBeNull();
    expect(only.slots.payrollDeduct).toBeNull();
    expect(only.slots.payrollAmount).toBeNull();
    expect(only.slots.observation).toBe("cell phone use 30+ min");
    expect(only.response.content).toContain("Which salon?");
    expectNoCarry(only, "cell");
    expect(screen.getByText("Corrective Action Form")).toBeTruthy();
    expect(screen.queryByText("Coaching Form")).toBeNull();
  });
});
