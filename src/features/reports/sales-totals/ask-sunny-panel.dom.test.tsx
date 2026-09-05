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

const FINGERPRINT =
  "date=2026-09-02|window=daily|estate=all_salons|metric=grand_total|salons=1001+1002";

const ANSWER = {
  content: "Aurora leads on Grand Total.\n\nInterpretation: worth checking staffing.",
  fingerprint: FINGERPRINT,
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
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe("/api/reporting/sales-totals/analyze");
    expect(Object.keys(sent[0].body).sort()).toEqual([
      "estateSummaryKey",
      "history",
      "historyFingerprint",
      "metric",
      "question",
      "reportDate",
      "salonIds",
      "window",
    ]);
    // Nothing to remember yet, and nothing to pin it to.
    expect(sent[0].body.history).toEqual([]);
    expect(sent[0].body.historyFingerprint).toBeNull();
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
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

    await waitFor(() =>
      expect(within(panel).getByText(/Aurora leads on Grand Total/)).toBeTruthy(),
    );
    expect(within(panel).getByText("Summarise this view.")).toBeTruthy();
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
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

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
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

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
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

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
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toMatch(/could not reach the language model/i);
    expect(within(alert).getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("re-asks the same question on retry", async () => {
    stubFetch({ ok: false, status: 502, payload: { error: "Temporarily unavailable." } });
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

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
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

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


/* --------------------------------------------------------- conversation -- */

describe("the panel is a conversation, pinned to one view", () => {
  /** Replies with a distinct answer per call so turns can be told apart. */
  function stubConversation(fingerprint = FINGERPRINT) {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        call += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...ANSWER,
            fingerprint,
            content: `Answer number ${call}.`,
          }),
        } as Response;
      }),
    );
  }

  it("keeps both exchanges on screen", async () => {
    stubConversation();
    const { user, panel } = await openPanel();

    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(within(panel).getByText("Answer number 1.")).toBeTruthy());

    await user.type(
      within(panel).getByLabelText(/ask a question about this report/i),
      "What about EFTs for those stores?{Enter}",
    );
    await waitFor(() => expect(within(panel).getByText("Answer number 2.")).toBeTruthy());

    expect(within(panel).getByText("Summarise this view.")).toBeTruthy();
    expect(within(panel).getByText("What about EFTs for those stores?")).toBeTruthy();
    expect(within(panel).getByText("Answer number 1.")).toBeTruthy();
  });

  it("sends the earlier turns and the server's own fingerprint with a follow-up", async () => {
    stubConversation();
    const { user, panel } = await openPanel();

    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(within(panel).getByText("Answer number 1.")).toBeTruthy());

    await user.type(
      within(panel).getByLabelText(/ask a question about this report/i),
      "And EFTs?{Enter}",
    );
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[1].body.history).toEqual([
      { role: "user", content: "Summarise this view." },
      { role: "assistant", content: "Answer number 1." },
    ]);
    // The value the SERVER returned, not one the panel computed for itself.
    expect(sent[1].body.historyFingerprint).toBe(FINGERPRINT);
  });

  it("sends prose only — no provenance and no figures", async () => {
    stubConversation();
    const { user, panel } = await openPanel();

    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(within(panel).getByText("Answer number 1.")).toBeTruthy());
    await user.type(
      within(panel).getByLabelText(/ask a question about this report/i),
      "And EFTs?{Enter}",
    );
    await waitFor(() => expect(sent).toHaveLength(2));

    for (const turn of sent[1].body.history as { role: string; content: string }[]) {
      expect(Object.keys(turn).sort()).toEqual(["content", "role"]);
    }
  });

  it("discards the transcript when the view changes, and says so", async () => {
    stubConversation();
    const user = userEvent.setup();
    const { rerender } = render(<AskSunnyReportPanel view={VIEW} />);
    await user.click(screen.getByRole("button", { name: /ask sunny about this report/i }));

    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(within(panel).getByText("Answer number 1.")).toBeTruthy());

    // The reader changes the report date underneath the open panel.
    rerender(<AskSunnyReportPanel view={{ ...VIEW, reportDate: "2026-09-01" }} />);

    await waitFor(() => expect(within(panel).queryByText("Answer number 1.")).toBeNull());
    expect(within(panel).getByText(/this is a new conversation/i)).toBeTruthy();
  });

  it("sends no history after a view change", async () => {
    stubConversation();
    const user = userEvent.setup();
    const { rerender } = render(<AskSunnyReportPanel view={VIEW} />);
    await user.click(screen.getByRole("button", { name: /ask sunny about this report/i }));

    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(sent).toHaveLength(1));

    rerender(<AskSunnyReportPanel view={{ ...VIEW, metric: "tans" }} />);

    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[1].body.history).toEqual([]);
    expect(sent[1].body.historyFingerprint).toBeNull();
    expect(sent[1].body.metric).toBe("tans");

    // And the new conversation works: the answer lands rather than being
    // dropped as belonging to a view the panel has left.
    await waitFor(() => expect(within(panel).getByText("Answer number 2.")).toBeTruthy());
    expect(within(panel).queryByText("Answer number 1.")).toBeNull();
  });

  it("keeps the conversation when the view is re-rendered unchanged", async () => {
    stubConversation();
    const user = userEvent.setup();
    const { rerender } = render(<AskSunnyReportPanel view={VIEW} />);
    await user.click(screen.getByRole("button", { name: /ask sunny about this report/i }));

    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(within(panel).getByText("Answer number 1.")).toBeTruthy());

    // Same salons, opposite order — the same view, so the same conversation.
    rerender(<AskSunnyReportPanel view={{ ...VIEW, salonIds: ["1002", "1001"] }} />);

    expect(within(panel).getByText("Answer number 1.")).toBeTruthy();
    expect(within(panel).queryByText(/this is a new conversation/i)).toBeNull();
  });

  it("a retry after a failure does not send the failed question twice", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        call += 1;
        if (call === 1) {
          return { ok: false, status: 502, json: async () => ({ error: "Temporary." }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ANSWER } as Response;
      }),
    );

    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));

    const alert = await within(panel).findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(sent).toHaveLength(2));

    // The failed turn never entered the transcript, so the retry carries the
    // same (empty) history rather than the question it is about to ask again.
    expect(sent[1].body.history).toEqual([]);
    expect(sent[1].body.question).toBe("Summarise this view.");
  });
});


function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(
    "src/features/reports/sales-totals/ask-sunny-panel.tsx",
    "utf8",
  );
}

/* ------------------------------------------------------- answer rendering -- */

describe("the answer is rendered, not printed", () => {
  /**
   * ==========================================================================
   * WHAT LIVE QA SAW
   * ==========================================================================
   *
   * The panel rendered `{answer.content}` inside a `whitespace-pre-wrap` div,
   * so the model's light markdown arrived on screen as syntax:
   *
   *     **Start with the limitation:**
   *     ### Grand Total — the measure you have selected
   *     - Median...
   *
   * Asterisks and hashes visible, one dense block, nothing to scan. The fix is
   * the renderer the normal Ask Sunny chat has always used — which also means
   * the two surfaces cannot drift into different ideas of what an answer looks
   * like.
   */
  const FORMATTED = [
    "### What this report can tell us",
    "",
    "This is a one-day snapshot, so it can show where results **differ** but not what is underperforming.",
    "",
    "### Grand Total",
    "",
    "- Median of the 14 reporting salons: **$612.40**",
    "- Highest: **Liberty**, rank 1 of 14",
    "- Lowest: **Grand Island**, rank 14 of 14",
    "",
    "### What you can check next",
    "",
    "1. Switch to EFTs for membership growth.",
    "2. Switch to New Customers for acquisition.",
  ].join("\n");

  function stubFormatted() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...ANSWER, content: FORMATTED }),
        } as Response;
      }),
    );
  }

  async function answered() {
    stubFormatted();
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(within(panel).getByText(/one-day snapshot/)).toBeTruthy());
    return panel;
  }

  it("renders **bold** as a real strong element", async () => {
    const panel = await answered();
    const strong = within(panel).getByText("$612.40");

    expect(strong.tagName).toBe("STRONG");
  });

  it("shows no literal asterisks anywhere in the answer", async () => {
    const panel = await answered();
    expect(panel.textContent).toContain("$612.40");
    expect(panel.textContent).not.toContain("**");
  });

  it("shows no literal heading hashes", async () => {
    const panel = await answered();
    expect(panel.textContent).toContain("What this report can tell us");
    expect(panel.textContent).not.toContain("###");
  });

  it("renders headings as headings", async () => {
    const panel = await answered();
    const headings = within(panel).getAllByRole("heading");
    const titles = headings.map((heading) => heading.textContent);

    expect(titles).toContain("What this report can tell us");
    expect(titles).toContain("Grand Total");
    expect(titles).toContain("What you can check next");
  });

  it("renders bullets as a semantic list", async () => {
    const panel = await answered();
    const lists = within(panel).getAllByRole("list");
    const items = within(panel).getAllByRole("listitem");

    expect(lists.length).toBeGreaterThan(0);
    expect(items.map((item) => item.textContent).join(" ")).toContain(
      "Median of the 14 reporting salons",
    );
  });

  it("renders a numbered list as an ordered list", async () => {
    const panel = await answered();
    const ordered = within(panel)
      .getAllByRole("list")
      .filter((list) => list.tagName === "OL");

    expect(ordered.length).toBeGreaterThan(0);
    expect(ordered[0].textContent).toContain("Switch to EFTs");
  });

  it("leaves the bullet marker out of the text, since the list supplies it", async () => {
    const panel = await answered();
    const items = within(panel).getAllByRole("listitem");
    for (const item of items) {
      expect(item.textContent?.trimStart().startsWith("- ")).toBe(false);
    }
  });

  it("escapes anything that looks like markup rather than rendering it", async () => {
    /*
     * The renderer builds React elements, so a model that emitted HTML would
     * have it shown as text. Asserted rather than assumed: this is the
     * property that makes reusing the chat renderer safe for report answers.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...ANSWER,
            content: "Aurora <script>alert(1)</script> and <b>bold</b> tags.",
          }),
        } as Response;
      }),
    );

    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole("button", { name: /summarise this view/i }));
    await waitFor(() => expect(within(panel).getByText(/Aurora/)).toBeTruthy());

    expect(panel.querySelector("script")).toBeNull();
    expect(panel.querySelector("b")).toBeNull();
    expect(panel.textContent).toContain("<script>alert(1)</script>");
  });

  it("still shows the provenance beneath the rendered answer", async () => {
    const panel = await answered();
    expect(within(panel).getByText("Read from")).toBeTruthy();
    expect(within(panel).getByText("Wed, Sep 2, 2026")).toBeTruthy();
    expect(within(panel).getByText("Metric: Grand Total")).toBeTruthy();
  });

  it("keeps the question visually distinct from the answer", async () => {
    const panel = await answered();
    const question = within(panel).getByText("Summarise this view.");
    const heading = within(panel).getAllByRole("heading")[0];

    // Different containers: the question bubble is not inside the answer block.
    expect(question.parentElement).not.toBe(heading.parentElement);
  });
});

describe("the panel introduces no unsafe HTML path", () => {
  it("uses no dangerouslySetInnerHTML", () => {
    // Comments stripped: the component EXPLAINS that it avoids this API, so
    // matching the raw file would fail on the explanation rather than on a use.
    const code = readSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("dangerouslySetInnerHTML");
  });

  it("is backed by a renderer that uses none either", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const renderer = require("node:fs").readFileSync("src/components/rich-text.tsx", "utf8");
    const code = renderer
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders answers through the shared RichText component", () => {
    const source = readSource();
    expect(source).toMatch(/import \{ RichText \} from "@\/components\/rich-text"/);
    expect(source).toMatch(/<RichText\s+content=\{answer\.content\}/);
  });
});
