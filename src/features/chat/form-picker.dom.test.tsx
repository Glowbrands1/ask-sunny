// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./message-bubble";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { formRequestPhrase } from "@/lib/forms/template-intent";
import type { ChatFormChoice, ChatFormSelection, ChatMessage } from "@/types";

/**
 * ============================================================================
 * ONE FORM ON SCREEN, THE LIBRARY ON REQUEST
 * ============================================================================
 *
 * An unnamed form request was answered with every permitted template written
 * into the message — thirteen forms of prose where a question belongs. The
 * question itself was right and stays; only the wall goes.
 *
 * Rendered rather than source-scanned, following the convention this directory
 * already sets: a scan cannot see that a disclosure is present but inert, or
 * that a card sends a sentence nothing will read.
 *
 * The choices come from the SERVER's projection of the published library, so
 * these fixtures are built from `TEMPLATE_SEEDS` — the same seeds the DB is
 * populated from. Hard-coding thirteen names here would be the second registry
 * this whole design exists to avoid.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC" }, isAdmin: false }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

function choiceFor(key: string): ChatFormChoice {
  const seed = TEMPLATE_SEEDS.find((entry) => entry.key === key);
  if (!seed) throw new Error(`${key} is not a seeded template`);
  return { templateKey: seed.key, templateName: seed.name, description: seed.description };
}

/** Everything the library seeds, as the server would offer it to an owner. */
const WHOLE_LIBRARY: ChatFormSelection = {
  primary: choiceFor("coaching"),
  additional: TEMPLATE_SEEDS.filter((seed) => seed.key !== "coaching").map((seed) => ({
    templateKey: seed.key,
    templateName: seed.name,
    description: seed.description,
  })),
};

const COACHING = WHOLE_LIBRARY.primary;
const OTHERS = WHOLE_LIBRARY.additional;

function message(selection: ChatFormSelection = WHOLE_LIBRARY): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "Which form do you need? I won't pick one for you.",
    createdAt: "2026-09-07T12:00:00Z",
    formSelection: selection,
  };
}

function renderPicker(selection?: ChatFormSelection) {
  const onSuggestion = vi.fn();
  render(
    <MessageBubble message={message(selection)} onSuggestion={onSuggestion} />,
  );
  return { onSuggestion, user: userEvent.setup() };
}

/** The disclosure, whichever way round it currently reads. */
function expander() {
  return screen.getByRole("button", { name: /(see more|show less) forms/i });
}

/**
 * One form's card, by the name it leads with.
 *
 * MATCHED FROM THE START, because one template's name contains another's: the
 * library publishes both a "Coaching Form" and a "Follow-Up Coaching Form", and
 * a substring match would find two cards and call it a duplicate.
 */
function card(name: string) {
  return screen.queryByRole("button", { name: leadsWith(name) });
}

/** Every card leading with this exact name. One, or the picker has a bug. */
function cards(name: string) {
  return screen.getAllByRole("button", { name: leadsWith(name) });
}

/** A card's accessible name is its form's name, then the description. */
function leadsWith(name: string) {
  return (accessibleName: string) => accessibleName.trim().startsWith(name);
}

describe("collapsed — the everyday form, and a way to the rest", () => {
  it("shows the Coaching Form", () => {
    renderPicker();
    expect(card(COACHING.templateName)).not.toBeNull();
  });

  it("shows the library's own description, not copy written in the component", () => {
    renderPicker();
    expect(screen.getByText(COACHING.description)).toBeDefined();
  });

  it("shows no other form", () => {
    renderPicker();
    for (const choice of OTHERS) {
      expect(card(choice.templateName), choice.templateName).toBeNull();
      expect(screen.queryByText(choice.description), choice.templateName).toBeNull();
    }
  });

  it("says it is collapsed, to a screen reader too", () => {
    renderPicker();
    expect(expander()).toBeDefined();
    expect(expander().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("expanded — the remaining permitted forms", () => {
  it("reveals every other form with its description", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    for (const choice of OTHERS) {
      expect(card(choice.templateName), choice.templateName).not.toBeNull();
      expect(screen.getByText(choice.description), choice.templateName).toBeDefined();
    }
  });

  it("reveals every form behind the Coaching Form, and nothing else", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    /*
     * Counted from the seeds rather than written down, so publishing a
     * template moves this number instead of making the test wrong — it has
     * already moved once, when the Follow-Up Coaching Form was published.
     */
    expect(OTHERS).toHaveLength(TEMPLATE_SEEDS.length - 1);
    // Every other form, the primary, and the disclosure. No stragglers.
    expect(screen.getAllByRole("button")).toHaveLength(OTHERS.length + 2);
  });

  it("does not repeat the Coaching Form", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    expect(cards(COACHING.templateName)).toHaveLength(1);
  });

  it("refuses to repeat it even if a stored turn carried it in both places", async () => {
    const { user } = renderPicker({
      primary: COACHING,
      additional: [COACHING, choiceFor("policy-review")],
    });
    await user.click(expander());

    expect(cards(COACHING.templateName)).toHaveLength(1);
  });

  it("turns the control into a way back", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    expect(screen.getByRole("button", { name: /show less forms/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /see more forms/i })).toBeNull();
    expect(expander().getAttribute("aria-expanded")).toBe("true");
  });

  it("stacks in one column on a phone and two from the small breakpoint up", async () => {
    /*
     * A layout assertion rather than a screenshot: the picker only renders in
     * live mode, which needs the privileged key this suite does not have. What
     * it pins is what keeps the thread safe on a narrow screen — the list
     * starts at one column and the cards carry no fixed width, so nothing can
     * push the conversation sideways.
     */
    const { user } = renderPicker();
    await user.click(expander());

    const group = screen.getByRole("group", { name: /more forms/i });
    expect(group.className).toContain("grid-cols-1");
    expect(group.className).toContain("sm:grid-cols-2");
    for (const button of Array.from(group.querySelectorAll("button"))) {
      expect(button.className).toContain("w-full");
    }
  });
});

describe("collapsing again", () => {
  it("hides the rest and keeps the Coaching Form", async () => {
    const { user } = renderPicker();
    await user.click(expander());
    await user.click(expander());

    expect(card(COACHING.templateName)).not.toBeNull();
    expect(screen.getByRole("button", { name: /see more forms/i })).toBeDefined();
    for (const choice of OTHERS) {
      expect(card(choice.templateName), choice.templateName).toBeNull();
    }
  });
});

describe("choosing a form", () => {
  it("asks for the Coaching Form the way a manager would type it", async () => {
    const { onSuggestion, user } = renderPicker();
    await user.click(card(COACHING.templateName)!);

    /*
     * THE SAME SENTENCE, BY A DIFFERENT ROUTE. It goes through the composer, so
     * the server reads it with `detectTemplateIntent` and builds the proposal
     * exactly as it does for a typed request — one creation path, and the
     * permission check is on it.
     */
    expect(onSuggestion).toHaveBeenCalledTimes(1);
    expect(onSuggestion).toHaveBeenCalledWith(formRequestPhrase("Coaching Form"));
  });

  it("asks for a form chosen from the expanded list", async () => {
    const { onSuggestion, user } = renderPicker();
    await user.click(expander());
    await user.click(card("Policy Review")!);

    expect(onSuggestion).toHaveBeenCalledWith(formRequestPhrase("Policy Review"));
  });

  it("calls no API of its own, and navigates nowhere", async () => {
    const { user } = renderPicker();
    await user.click(card(COACHING.templateName)!);

    // A card that created a form directly would be a second creation path,
    // reachable without the checks the proposal flow applies.
    expect(push).not.toHaveBeenCalled();
  });

  it("chooses nothing on its own", () => {
    const { onSuggestion } = renderPicker();
    expect(onSuggestion).not.toHaveBeenCalled();
  });
});

describe("a turn with no choices", () => {
  it("renders the message and no picker", () => {
    const onSuggestion = vi.fn();
    render(
      <MessageBubble
        message={{
          id: "m2",
          role: "assistant",
          content: "There are no published forms available to you right now.",
          createdAt: "2026-09-07T12:00:00Z",
        }}
        onSuggestion={onSuggestion}
      />,
    );

    expect(screen.queryByRole("button", { name: /see more forms/i })).toBeNull();
    expect(screen.getByText(/no published forms/i)).toBeDefined();
  });
});

