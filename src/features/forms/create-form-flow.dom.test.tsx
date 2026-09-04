// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EMPLOYEE_NAME_MAX } from "@/lib/forms/limits";
import { CreateFormFlow } from "./create-form-flow";

/**
 * THE EMPLOYEE FIELD IS FREE TEXT NOW.
 *
 * It used to be an input backed by a `datalist` of four invented names, which
 * presented a fixed cast of test people as though they were the only ones
 * available. Whoever is testing knows which name they want.
 *
 * What has to stay true of the replacement:
 *   whatever is typed reaches the server EXACTLY, minus surrounding whitespace;
 *   there is a cap, and it is the same cap the chat handoff uses;
 *   a blank name starts nothing — and in particular nothing is invented to
 *   stand in for it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const mockSession = vi.hoisted(() => ({
  value: { role: "owner", user: { name: "QA" } } as unknown,
}));
vi.mock("@/lib/session/session-context", () => ({
  useSession: () => mockSession.value,
}));

/** Captures what `start()` actually posts, which is the thing under test. */
const posted = vi.hoisted(() => ({ bodies: [] as Record<string, unknown>[] }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(() => {
  cleanup();
  posted.bodies = [];
});

const TEMPLATES = [
  { key: "coaching", name: "Coaching Form", description: "The everyday one.", variants: [] },
];
const LOCATIONS = [{ id: "loc-1", name: "Riverbend Commons" }];

function renderFlow(props: Partial<React.ComponentProps<typeof CreateFormFlow>> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) posted.bodies.push(JSON.parse(String(init.body)));
      // Enough of a reply to keep `start()` from throwing; the assertions are
      // all about the REQUEST.
      return {
        ok: true,
        json: async () => ({ instance: { id: "inst-1" } }),
      } as unknown as Response;
    }),
  );

  return render(
    <CreateFormFlow templates={TEMPLATES} notice={null} locations={LOCATIONS} {...props} />,
  );
}

describe("the Employee field", () => {
  it("is a plain text box with no picklist attached", () => {
    const { container } = renderFlow();
    const input = screen.getByLabelText("Employee") as HTMLInputElement;

    expect(input.tagName).toBe("INPUT");
    // The two things that made it a picker.
    expect(input.getAttribute("list")).toBeNull();
    expect(container.querySelector("datalist")).toBeNull();
  });

  it("offers no pre-baked names anywhere on the screen", () => {
    renderFlow();
    // The four inventions the picklist used to carry.
    for (const name of ["Jordan Vance", "Sam Okafor", "Riley Chen", "Alex Moreau"]) {
      expect(screen.queryByText(new RegExp(name)), name).toBeNull();
    }
  });

  it("accepts any typed name and keeps it exactly", async () => {
    const user = userEvent.setup();
    renderFlow();
    const input = screen.getByLabelText("Employee") as HTMLInputElement;

    // Punctuation, an apostrophe and a hyphen — all of which a real name has.
    await user.type(input, "Mary-Jane O'Brien (test)");
    expect(input.value).toBe("Mary-Jane O'Brien (test)");

    await user.click(screen.getByRole("button", { name: /Start this form/ }));
    await waitFor(() => expect(posted.bodies).toHaveLength(1));
    expect(posted.bodies[0]!.employeeName).toBe("Mary-Jane O'Brien (test)");
  });

  it("trims surrounding whitespace, and only that", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.type(screen.getByLabelText("Employee"), "   Dana  Reyes (test)   ");
    await user.click(screen.getByRole("button", { name: /Start this form/ }));

    await waitFor(() => expect(posted.bodies).toHaveLength(1));
    // The double space INSIDE the name survives: it is what was typed, and
    // silently rewriting somebody's name is not this field's job.
    expect(posted.bodies[0]!.employeeName).toBe("Dana  Reyes (test)");
  });

  it("caps the length at the same number the chat handoff uses", () => {
    renderFlow();
    const input = screen.getByLabelText("Employee") as HTMLInputElement;
    expect(input.maxLength).toBe(EMPLOYEE_NAME_MAX);
  });

  it("starts nothing on a blank name, and invents nothing to replace it", async () => {
    const user = userEvent.setup();
    renderFlow();

    // `toBeDisabled` needs jest-dom, which this project does not load; the
    // DOM property is the same assertion without the dependency.
    const start = screen.getByRole("button", { name: /Start this form/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    // Whitespace is not a name either.
    await user.type(screen.getByLabelText("Employee"), "    ");
    expect(start.disabled).toBe(true);
    expect(posted.bodies).toHaveLength(0);
  });
});

describe("the handoff from chat", () => {
  it("arrives already filled in when a name came with it", () => {
    renderFlow({
      fromChat: true,
      initialTemplateKey: "coaching",
      initialEmployeeName: "Jordan Vance (test)",
    });
    expect((screen.getByLabelText("Employee") as HTMLInputElement).value).toBe(
      "Jordan Vance (test)",
    );
  });

  it("leaves the field empty when the conversation named nobody", () => {
    // `extractEmployeeName` returns null rather than guessing, and the handoff
    // omits the parameter — so the field must stay blank rather than filling in
    // something plausible.
    renderFlow({ fromChat: true, initialTemplateKey: "coaching", initialEmployeeName: null });
    expect((screen.getByLabelText("Employee") as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByRole("button", { name: /Start this form/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("truncates an over-long name from the URL to the cap", () => {
    const long = "X".repeat(400);
    renderFlow({ fromChat: true, initialTemplateKey: "coaching", initialEmployeeName: long });
    expect((screen.getByLabelText("Employee") as HTMLInputElement).value).toHaveLength(
      EMPLOYEE_NAME_MAX,
    );
  });
});

describe("Location", () => {
  it("stays a dropdown", () => {
    renderFlow();
    const location = screen.getByLabelText("Location");
    expect(location.tagName).toBe("SELECT");
  });
});
