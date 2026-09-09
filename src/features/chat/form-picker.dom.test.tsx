// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_FORM_TEMPLATES } from "@/data/demo/templates";
import { buildFormSelectionModel } from "@/lib/forms/chat-flow";
import type { FormTemplate } from "@/types";

import { FormPicker } from "./form-picker";

/**
 * ============================================================================
 * ONE FORM, THEN THE LIBRARY IF YOU ASK FOR IT
 * ============================================================================
 *
 * Asking Sunny to "create a form from this conversation" used to answer with
 * every form at once — thirteen cards for a manager who, nine times out of ten,
 * wanted the Coaching Form. These tests hold the shape of the fix:
 *
 *   collapsed  the Coaching Form and nothing else, plus a way to see the rest;
 *   expanded   the other twelve, each with the description from the registry,
 *              and the Coaching Form NOT repeated;
 *   collapsed  again, with the Coaching Form still there.
 *
 * And in every state, clicking a card asks for THAT form — the picker offers,
 * it never chooses.
 */

const SELECTION = buildFormSelectionModel();

function byId(id: string): FormTemplate {
  const template = DEMO_FORM_TEMPLATES.find((entry) => entry.id === id);
  if (!template) throw new Error(`${id} is not in the template registry`);
  return template;
}

const COACHING = byId("tpl-coaching");
const OTHERS = DEMO_FORM_TEMPLATES.filter((entry) => entry.id !== COACHING.id);

function renderPicker(onSelect = vi.fn()) {
  render(
    <FormPicker
      selection={SELECTION}
      templates={DEMO_FORM_TEMPLATES}
      onSelect={onSelect}
    />,
  );
  return { onSelect, user: userEvent.setup() };
}

/** The disclosure control, whichever way round it currently reads. */
function expander() {
  return screen.getByRole("button", { name: /(see more|show less) forms/i });
}

afterEach(cleanup);

describe("collapsed", () => {
  it("shows the Coaching Form and the way to see the rest", () => {
    renderPicker();

    expect(screen.getByRole("button", { name: /coaching form/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /see more forms/i })).toBeDefined();
  });

  it("shows the Coaching Form's description, from the registry", () => {
    renderPicker();
    expect(screen.getByText(COACHING.description)).toBeDefined();
  });

  it("shows no other form at all", () => {
    renderPicker();

    for (const template of OTHERS) {
      expect(
        screen.queryByRole("button", { name: new RegExp(escapeForRegExp(template.name), "i") }),
        `${template.name} should be collapsed`,
      ).toBeNull();
      expect(screen.queryByText(template.description), template.name).toBeNull();
    }
  });

  it("reports itself collapsed to a screen reader", () => {
    renderPicker();
    expect(expander().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("expanding", () => {
  it("reveals every other form, with its registry description", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    for (const template of OTHERS) {
      expect(
        screen.getByRole("button", { name: new RegExp(escapeForRegExp(template.name), "i") }),
        template.name,
      ).toBeDefined();
      expect(screen.getByText(template.description), template.name).toBeDefined();
    }
  });

  it("reveals the twelve forms behind the Coaching Form", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    // The registry is the source of the count, so registering a form adds it
    // here rather than making this test wrong.
    expect(OTHERS).toHaveLength(12);
    expect(screen.getAllByRole("button")).toHaveLength(OTHERS.length + 2);
  });

  it("does not repeat the Coaching Form in the expanded list", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    expect(screen.getAllByRole("button", { name: /coaching form/i })).toHaveLength(1);
  });

  it("turns the control into a way back", async () => {
    const { user } = renderPicker();
    await user.click(expander());

    expect(screen.getByRole("button", { name: /show less forms/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /see more forms/i })).toBeNull();
    expect(expander().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("collapsing again", () => {
  it("hides the other forms and keeps the Coaching Form", async () => {
    const { user } = renderPicker();
    await user.click(expander());
    await user.click(expander());

    expect(screen.getByRole("button", { name: /coaching form/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /see more forms/i })).toBeDefined();

    for (const template of OTHERS) {
      expect(
        screen.queryByRole("button", { name: new RegExp(escapeForRegExp(template.name), "i") }),
        template.name,
      ).toBeNull();
    }
  });
});

describe("choosing a form", () => {
  it("asks for the Coaching Form when the Coaching Form is clicked", async () => {
    const { onSelect, user } = renderPicker();
    await user.click(screen.getByRole("button", { name: /coaching form/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "tpl-coaching" });
  });

  it("asks for the form that was clicked in the expanded list", async () => {
    const { onSelect, user } = renderPicker();
    await user.click(expander());
    await user.click(screen.getByRole("button", { name: /policy review/i }));

    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "tpl-policy-review" });
  });

  it("chooses nothing on its own", () => {
    const { onSelect } = renderPicker();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("nothing to offer", () => {
  it("renders no picker rather than an empty one", () => {
    const { container } = render(
      <FormPicker
        selection={{ primaryTemplateId: "tpl-missing", additionalTemplateIds: [] }}
        templates={DEMO_FORM_TEMPLATES}
        onSelect={vi.fn()}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("offers the rest even if the primary form has been deactivated", () => {
    render(
      <FormPicker
        selection={SELECTION}
        templates={DEMO_FORM_TEMPLATES.map((entry) =>
          entry.id === "tpl-coaching" ? { ...entry, active: false } : entry,
        )}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /coaching form/i })).toBeNull();
    expect(screen.getByRole("button", { name: /see more forms/i })).toBeDefined();
  });
});

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
