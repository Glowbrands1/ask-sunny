// @vitest-environment jsdom
import * as React from "react";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextPanel } from "./context-panel";
import { CREATE_FORM_FROM_CONVERSATION } from "@/lib/forms/proposal-continuation";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * "CREATE A FORM FROM THIS CONVERSATION" MUST NOT LEAVE THE CONVERSATION
 * ============================================================================
 *
 * It was `<Link href="/forms/create">` — a plain navigation, left over from
 * before chat-native forms existed. Pressing it took a manager who had just
 * finished describing an incident to a separate builder, where they retyped the
 * employee and the incident. The conversation the button is named after was
 * thrown away at the moment it became useful.
 *
 * The panel is now a TRIGGER only. It does not read the manager's turns, choose
 * a template or create an instance — `ChatScreen` owns all of that, through the
 * same send path a typed request uses. A second orchestrator here would be a
 * second thing to keep correct.
 */

vi.mock("@/lib/ai", () => ({
  aiProviderStatus: () => ({ name: "Claude", connected: true, detail: "Answering live." }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const answer: ChatMessage = {
  id: "m2",
  role: "assistant",
  content: "Arriving late is a documented coaching matter.",
  createdAt: "2026-09-07T12:00:00Z",
  mode: "standard",
  coverage: "grounded",
  citations: [],
  recommendedVideoIds: [],
};

function panel(onCreateForm?: () => void) {
  return render(<ContextPanel messages={[answer]} onCreateForm={onCreateForm} />);
}

describe("RR-A/B. the action never navigates to the standalone builder", () => {
  it("renders a button, not a link", () => {
    const { container } = panel(() => {});
    const control = screen.getByRole("button", { name: /create a form from this conversation/i });

    expect(control.tagName).toBe("BUTTON");
    // Nothing in the rail points at the builder any more.
    for (const anchor of container.querySelectorAll("a")) {
      expect(anchor.getAttribute("href")).not.toBe("/forms/create");
    }
  });

  it("holds no /forms/create reference at all", () => {
    /*
     * The rendered assertion above covers this panel's own markup; the source
     * scan covers the mechanism, so a redirect cannot return behind a condition
     * this fixture happens not to hit.
     */
    const source = readFileSync("src/features/chat/context-panel.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(source).not.toContain("/forms/create");
  });

  it("routes nowhere when pressed", () => {
    const onCreateForm = vi.fn();
    panel(onCreateForm);

    fireEvent.click(screen.getByRole("button", { name: /create a form from this conversation/i }));

    expect(onCreateForm).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves the other rail links alone", () => {
    // Knowledge and Videos are genuinely elsewhere; only the form action was
    // standing in the wrong place.
    panel(() => {});
    expect(screen.getByRole("link", { name: /browse the knowledge base/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /browse training videos/i })).toBeTruthy();
  });
});

describe("RR-C. the panel is a trigger and nothing more", () => {
  it("creates no form, reads no template library and parses no context", () => {
    const source = readFileSync("src/features/chat/context-panel.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const forbidden of [
      "/api/forms",
      "createInlineForm",
      "formsFetch",
      "managerContext",
      "detectTemplateIntent",
      "listTemplateSummaries",
      "TEMPLATE_SEEDS",
      "DEMO_FORM_TEMPLATES",
    ]) {
      expect(source, `context-panel names ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("is inert rather than misleading when no handler is supplied", () => {
    panel(undefined);
    const control = screen.getByRole("button", { name: /create a form from this conversation/i });
    expect(control.hasAttribute("disabled")).toBe(true);
  });
});

describe("RR-D. the request it sends is deliberately unspecified", () => {
  it("asks for 'a form', so the server decides which", () => {
    /*
     * Wording matters here. `detectTemplateIntent` reads this as AMBIGUOUS, so
     * with nothing established the server lists the templates this manager may
     * actually create and asks. A phrase naming a coaching form would default
     * an unspecified request to the disciplinary-adjacent one, which is the
     * failure this workstream removed.
     */
    expect(CREATE_FORM_FROM_CONVERSATION).toMatch(/create a form/i);
    expect(CREATE_FORM_FROM_CONVERSATION).not.toMatch(/coaching|dpoa|policy|epp/i);
  });

  it("is sent through ChatScreen's ordinary send path", () => {
    const chat = readFileSync("src/features/chat/chat-screen.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // The whole existing pipeline runs: bounded manager context, template
    // intent, continuation hint, authorized list, permission check.
    expect(chat).toContain("send(CREATE_FORM_FROM_CONVERSATION)");
    expect(chat).toContain("onCreateForm={createFormFromConversation}");
  });
});
