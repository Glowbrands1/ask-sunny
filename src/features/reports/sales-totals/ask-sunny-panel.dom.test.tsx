// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AskSunnyReportPanel, type AskSunnyReportView } from "./ask-sunny-panel";

/**
 * ============================================================================
 * THE PANEL SENDS WHICH VIEW, NEVER WHAT IT SAYS
 * ============================================================================
 *
 * These tests render the real component and read what it actually PUT ON THE
 * WIRE, because the property that matters cannot be seen in the markup: a panel
 * that quietly posted the rendered figures alongside the filters would look
 * identical on screen and would have handed the server its own output to
 * believe.
 *
 * So `fetch` is replaced with a recorder, and the request body is asserted
 * field by field.
 */

const VIEW: AskSunnyReportView = {
  reportDate: "2026-09-02",
  window: "daily",
  estateSummaryKey: "all_salons",
  metric: "grand_total",
  salonIds: ["1001", "1002"],
};

const ANSWER = {
  content: "Aurora leads on Grand Total.\n\nInterpretation: worth checking staffing.",
  provenance: {
    reportType: "Sales Totals" as const,
    reportDate: "2026-09-02",
    reportDateLabel: "Wed, Sep 2, 2026",
    window: "daily" as const,
    windowLabel: "Previous Day",
    salonCount: 2,
    isAllSalons: false,
    selectedMetric: "Grand Total",
    estateSummaryLabel: "All Salons",
  },
};

let sent: { url: string; body: Record<string, unknown> }[] = [];

beforeAll(() => {
  // Radix measures and animates; jsdom implements neither.
  window.HTMLElement.prototype.scrollIntoView = () => {};
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  }
});

beforeEach(() => {
  sent = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Records every request and replies with `reply`. */
function stubFetch(
  reply: { ok?: boolean; status?: number; payload?: unknown } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        json: async () => reply.payload ?? ANSWER,
      } as Response;
    }),
  );
}

async function openPanel(view: AskSunnyReportView = VIEW) {
  const user = userEvent.setup();
  render(<AskSunnyReportPanel view={view} />);
  await user.click(screen.getByRole("button", { name: /ask sunny about this report/i }));
  const panel = await screen.findByRole("dialog");
  return { user, panel };
}

/* ------------------------------------------------------------- opening -- */

describe("opening the panel", () => {
  it("offers a trigger on the report", () => {
    render(<AskSunnyReportPanel view={VIEW} />);
    expect(
      screen.getByRole("button", { name: /ask sunny about this report/i }),
    ).toBeTruthy();
  });

  it("opens a dialog with an accessible name", async () => {
    const { panel } = await openPanel();
    expect(within(panel).getByText(/ask sunny about this report/i)).toBeTruthy();
  });

  it("says where answers come from before anything is asked", async () => {
    const { panel } = await openPanel();
    expect(panel.textContent).toMatch(/read from the report in the database/i);
  });

  it("summarises the view that will be analysed", async () => {
    const { panel } = await openPanel();
    expect(panel.textContent).toContain("2026-09-02");
    expect(panel.textContent).toMatch(/2 selected salons/);
  });

  it("describes an empty salon filter as all salons in the delivery", async () => {
    const { panel } = await openPanel({ ...VIEW, salonIds: [] });
    expect(panel.textContent).toMatch(/all salons in this delivery/i);
  });

  it("closes on Escape", async () => {
    const { user } = await openPanel();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

/* ------------------------------------------------------ what it sends -- */

describe("what the panel puts on the wire", () => {
  it("sends the filters, and only the filters", async () => {
    stubFetch();
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe("/api/reporting/sales-totals/analyze");
    expect(Object.keys(sent[0].body).sort()).toEqual([
      "estateSummaryKey",
      "metric",
      "question",
      "reportDate",
      "salonIds",
      "window",
    ]);
    expect(sent[0].body).toMatchObject({
      reportDate: "2026-09-02",
      window: "daily",
      estateSummaryKey: "all_salons",
      metric: "grand_total",
      salonIds: ["1001", "1002"],
    });
  });

  it("sends a typed question", async () => {
    stubFetch();
    const { user, panel } = await openPanel();
    await user.type(
      within(panel).getByLabelText(/ask a question about this report/i),
      "Which salon is lowest?",
    );
    await user.click(within(panel).getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body.question).toBe("Which salon is lowest?");
  });

  it("sends on Enter and does not send on Shift+Enter", async () => {
    stubFetch();
    const { user, panel } = await openPanel();
    const box = within(panel).getByLabelText(/ask a question about this report/i);

    await user.type(box, "First line{Shift>}{Enter}{/Shift}second line");
    expect(sent).toHaveLength(0);

    await user.type(box, "{Enter}");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(String(sent[0].body.question)).toContain("First line");
  });
});

/* --------------------------------------------------------- the answer -- */

describe("the answer", () => {
  it("shows the question and then the answer", async () => {
    stubFetch();
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    await waitFor(() =>
      expect(within(panel).getByText(/Aurora leads on Grand Total/)).toBeTruthy(),
    );
    expect(within(panel).getByText("Summarise this report for me.")).toBeTruthy();
  });

  it("shows a live-region loading state while the report is read", async () => {
    let release: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true, status: 200, json: async () => ANSWER } as Response;
      }),
    );

    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    const status = await within(panel).findByRole("status");
    expect(status.textContent).toMatch(/reading the report/i);

    release!();
    await waitFor(() =>
      expect(within(panel).getByText(/Aurora leads on Grand Total/)).toBeTruthy(),
    );
  });

  it("shows the server's provenance rather than document citations", async () => {
    stubFetch();
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    // Exact, not a regex: the panel description also contains "are read from
    // the report", and a loose match would find that sentence instead of the
    // provenance heading it is meant to be checking.
    await waitFor(() => expect(within(panel).getByText("Read from")).toBeTruthy());
    expect(within(panel).getByText("Wed, Sep 2, 2026")).toBeTruthy();
    expect(within(panel).getByText("Previous Day")).toBeTruthy();
    expect(within(panel).getByText("Metric: Grand Total")).toBeTruthy();
    // No source cards, no page numbers, no document titles.
    expect(panel.textContent).not.toMatch(/source \d/i);
  });

  it("reports the provenance the server returned, not the filters it sent", async () => {
    // The server says it read all 249-salon estate summary and a DIFFERENT
    // date. The panel must report what was read, so a reader is never shown
    // one date's analysis under another date's heading.
    stubFetch({
      payload: {
        ...ANSWER,
        provenance: { ...ANSWER.provenance, reportDateLabel: "Tue, Sep 1, 2026" },
      },
    });
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    await waitFor(() => expect(within(panel).getByText("Tue, Sep 1, 2026")).toBeTruthy());
  });
});

/* ---------------------------------------------------------- failure -- */

describe("failure is retryable and says nothing it should not", () => {
  it("shows the server's message and a retry", async () => {
    stubFetch({
      ok: false,
      status: 502,
      payload: { error: "Sunny could not reach the language model. No answer was generated." },
    });
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toMatch(/could not reach the language model/i);
    expect(within(alert).getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("re-asks the same question on retry", async () => {
    stubFetch({ ok: false, status: 502, payload: { error: "Temporarily unavailable." } });
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    const alert = await within(panel).findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].body.question).toBe(sent[0].body.question);
  });

  it("survives a network failure without exposing anything internal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:443");
      }),
    );
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this report/i }));

    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toMatch(/did not reach the server/i);
    expect(alert.textContent).not.toContain("ECONNREFUSED");
    expect(alert.textContent).not.toContain("10.0.0.5");
  });
});

/* ------------------------------------------ never sends report figures -- */

describe("the component has no way to send a figure", () => {
  it("takes no figure-carrying prop", () => {
    const source = readSource();
    // The only prop is `view`, and every field on it is an identifier.
    expect(source).toMatch(/export interface AskSunnyReportView \{[^}]*\}/);
    const shape = source.slice(
      source.indexOf("export interface AskSunnyReportView"),
      source.indexOf("}", source.indexOf("export interface AskSunnyReportView")),
    );
    expect(shape).not.toMatch(/number/);
    expect(shape).not.toMatch(/figure|value|total|amount/i);
  });

  it("does not read rendered values out of the DOM", () => {
    const code = readSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/document\.querySelector/);
    expect(code).not.toMatch(/textContent/);
    expect(code).not.toMatch(/innerText/);
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(
    "src/features/reports/sales-totals/ask-sunny-panel.tsx",
    "utf8",
  );
}
