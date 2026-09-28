// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineForm } from "./inline-form";
import { parseFormDocument } from "@/lib/forms/document";
import { EXIT_YES_NO_QUESTIONS } from "@/lib/forms/exit-library";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * ============================================================================
 * REVIEWING A RESIGNATION/EXIT FORM DRAFT IN CHAT
 * ============================================================================
 *
 * The real inline editor, mounted on the real seeded exit document with the
 * values a draft actually stores. What a manager must see: the facts Sunny
 * filled, every yes/no question present and UNANSWERED (the source's pre-ticked
 * "Written notice attached? No" included), signature lines with nothing to type
 * into, and — once finalized — a Download PDF that asks the canonical route.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { avatarInitials: "PC", name: "Paulyne" },
    role: "salon_director",
    isAdmin: false,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const EXIT = TEMPLATE_SEEDS.find((entry) => entry.key === "stc-exit")!;

function loaded(status: "draft" | "finalized") {
  return {
    instance: {
      id: "inst-exit",
      templateName: EXIT.name,
      templateVersion: 1,
      templateVersionId: "ver-exit",
      variantKey: null,
      employeeName: "Jane Smith",
      locationId: "loc-0311",
      locationName: "NE Lincoln O Street",
      source: "ask_sunny",
      status,
      followUpDate: null,
    },
    version: { document: parseFormDocument(EXIT.document), variants: [] },
    values: [
      { fieldKey: "employee_name", value: "Jane Smith", checked: [], filledBy: "system" },
      { fieldKey: "form_date", value: "2026-09-28", checked: [], filledBy: "system" },
      { fieldKey: "location", value: "NE Lincoln O Street", checked: [], filledBy: "system" },
      { fieldKey: "last_day_worked", value: "2026-09-26", checked: [], filledBy: "ai" },
      { fieldKey: "notice_given_date", value: "2026-09-14", checked: [], filledBy: "ai" },
      { fieldKey: "resignation_notice", value: null, checked: ["submitted_fulfilled_notice"], filledBy: "ai" },
      {
        fieldKey: "details",
        value: "Jane Smith gave two weeks notice on 9/14 and worked out her notice.",
        checked: [],
        filledBy: "ai",
      },
    ],
    events: [
      { kind: "created", actor: "user-1", createdAt: "2026-09-28T15:00:00Z" },
      { kind: "drafted", actor: "user-1", createdAt: "2026-09-28T15:00:05Z" },
    ],
  };
}

let requested: string[] = [];

function serve(status: "draft" | "finalized") {
  requested = [];
  globalThis.fetch = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/pdf")) {
      return {
        ok: true,
        headers: new Headers({ "content-disposition": 'attachment; filename="exit.pdf"' }),
        blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }),
        json: async () => ({}),
      } as unknown as Response;
    }
    return { ok: true, json: async () => loaded(status) } as unknown as Response;
  }) as typeof fetch;
}

function mount() {
  return render(
    <InlineForm
      reference={{ instanceId: "inst-exit", proposalId: "prop-exit", templateName: EXIT.name }}
      prefill={{ kind: "complete" }}
      onStartAnother={() => {}}
    />,
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:exit");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

/** The group whose question is `label`, as the manager sees it. */
function group(container: HTMLElement, label: string): HTMLElement {
  const legend = [...container.querySelectorAll("fieldset > legend")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!legend) throw new Error(`no question "${label}" on screen`);
  return legend.closest("fieldset") as HTMLElement;
}

/** A Radix checkbox reports its state on the button it renders. */
const isTicked = (element: Element) => element.getAttribute("aria-checked") === "true";

describe("the draft, as the manager reviews it", () => {
  it("shows what Sunny filled", async () => {
    serve("draft");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    const values = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map(
      (input) => input.value,
    );
    for (const value of ["Jane Smith", "NE Lincoln O Street", "2026-09-26", "2026-09-14"]) {
      expect(values, value).toContain(value);
    }
    expect(container.textContent).toContain("worked out her notice");
  });

  it("prints every yes/no question, and leaves every one of them unanswered", async () => {
    serve("draft");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("Resignation Details"));
    for (const question of EXIT_YES_NO_QUESTIONS) {
      const box = group(container, question.label);
      const ticks = within(box).getAllByRole("checkbox");
      expect(ticks, question.label).toHaveLength(2);
      expect(ticks.map(isTicked), question.label).toEqual([false, false]);
      expect(box.textContent, question.label).toMatch(/Yes.*No/);
    }
  });

  it("ticks only the separation the manager described, never the involuntary box", async () => {
    serve("draft");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("Resignation Details"));
    const byLabel = (text: string) =>
      [...container.querySelectorAll("label")].find((node) => node.textContent?.includes(text))!
        .querySelector('[role="checkbox"]')!;
    expect(isTicked(byLabel("Submitted & Fulfilled Notice"))).toBe(true);
    for (const text of [
      "Immediate Voluntary Resignation",
      "Immediate involuntary separation",
      "Did not fulfill required 14 day / 30 day notice",
      "No Call No Show",
    ]) {
      expect(isTicked(byLabel(text)), text).toBe(false);
    }
  });

  it("has nothing to type into on a signature line, and says so", async () => {
    serve("draft");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("Acknowledgement of Receipt"));
    for (const line of [
      "Employee Signature",
      "Supervisor Signature",
      "District Manager/Witness Signature (when required)",
    ]) {
      expect(container.textContent).toContain(`${line} — Always blank — signed by hand`);
    }
    const inputs = [...container.querySelectorAll("input, textarea")].map(
      (input) => `${input.getAttribute("name") ?? ""}${input.id}`,
    );
    expect(inputs.join(" ")).not.toMatch(/signature/i);
  });

  it("offers editing and finalizing a draft, never a download of an unreviewed one here", async () => {
    serve("draft");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("Employee Information"));
    expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^finalize$/i })).toBeTruthy();
  });
});

describe("the finalized form downloads", () => {
  it("from the canonical PDF route", async () => {
    serve("finalized");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("Finalized"));
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    await waitFor(() => expect(requested).toContain("/api/forms/instances/inst-exit/pdf"));
  });
});
