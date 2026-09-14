// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { RichText } from "./rich-text";

afterEach(cleanup);

/**
 * The 14 September review, from the restricted session:
 *
 *   "Markdown tables are rendering as raw text. The salon list appeared with
 *    literal pipes — `| Salon | PPTA | |---|---|` — instead of displaying as a
 *    formatted table."
 */

const SALON_TABLE = [
  "Here are the salons:",
  "",
  "| Salon | PPTA | Tans |",
  "|---|---:|---:|",
  "| MO Kansas City Wornall | $3.54 | 150 |",
  "| NE Kearney | $0.19 | 105 |",
  "",
  "That is the whole list.",
].join("\n");

describe("markdown tables render as tables", () => {
  it("renders a table element rather than a paragraph of pipes", () => {
    render(<RichText content={SALON_TABLE} />);

    const table = screen.getByRole("table");
    expect(table).toBeTruthy();
    // The literal source must not survive anywhere on screen.
    expect(document.body.textContent).not.toContain("|---|");
    expect(document.body.textContent).not.toContain("| Salon |");
  });

  it("puts the header row in column headers", () => {
    render(<RichText content={SALON_TABLE} />);
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Salon", "PPTA", "Tans"]);
  });

  it("puts every body row in the table", () => {
    render(<RichText content={SALON_TABLE} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    // One header row plus two salons.
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain("MO Kansas City Wornall");
    expect(rows[1].textContent).toContain("$3.54");
    expect(rows[2].textContent).toContain("NE Kearney");
  });

  it("keeps the prose around it as prose", () => {
    render(<RichText content={SALON_TABLE} />);
    expect(screen.getByText("Here are the salons:")).toBeTruthy();
    expect(screen.getByText("That is the whole list.")).toBeTruthy();
  });

  it("honours the delimiter row's alignment", () => {
    render(<RichText content={SALON_TABLE} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0].className).toContain("text-left");
    expect(headers[1].className).toContain("text-right");
    expect(headers[2].className).toContain("text-right");
  });

  it("renders a table written without the outer pipes", () => {
    render(
      <RichText
        content={["Salon | PPTA", "--- | ---", "KS Lawrence | $3.25"].join("\n")}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Salon",
      "PPTA",
    ]);
    expect(screen.getByRole("table").textContent).toContain("KS Lawrence");
  });

  it("still renders bold inside a cell", () => {
    render(
      <RichText
        content={["| Salon | Note |", "|---|---|", "| KS Lawrence | **check this** |"].join("\n")}
      />,
    );
    expect(screen.getByText("check this").tagName).toBe("STRONG");
  });

  it("pads a short row so cells never shift into the wrong column", () => {
    render(
      <RichText
        content={[
          "| Salon | PPTA | Tans |",
          "|---|---|---|",
          "| KS Lawrence | $3.25 |",
        ].join("\n")}
      />,
    );
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells).toHaveLength(3);
    expect(cells[0].textContent).toBe("KS Lawrence");
    expect(cells[1].textContent).toBe("$3.25");
    expect(cells[2].textContent).toBe("");
  });
});

describe("a table is a table, and a sentence with a pipe is not", () => {
  it("leaves prose containing a pipe alone", () => {
    render(<RichText content="Revenue | PPTA is not a table without a delimiter row." />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.getByText("Revenue | PPTA is not a table without a delimiter row."),
    ).toBeTruthy();
  });

  it("does not promote a lone delimiter-looking line", () => {
    render(<RichText content="Some text\n---\nMore text" />);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps an escaped pipe inside its own cell", () => {
    render(
      <RichText content={["| Measure | Formula |", "|---|---|", "| PPTA | a \\| b |"].join("\n")}
      />,
    );
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells).toHaveLength(2);
    expect(cells[1].textContent).toBe("a | b");
  });
});

describe("no raw HTML path exists", () => {
  it("renders markup in the assistant's text as text", () => {
    render(
      <RichText
        content={[
          "| Salon | Note |",
          "|---|---|",
          "| <img src=x onerror=alert(1)> | <b>bold?</b> |",
        ].join("\n")}
      />,
    );

    const table = screen.getByRole("table");
    // Escaped, not parsed: the text is on screen and no element was created.
    expect(table.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(table.querySelector("img")).toBeNull();
    expect(table.querySelector("b")).toBeNull();
  });

  it("escapes markup in ordinary prose too", () => {
    render(<RichText content="<script>alert(1)</script>" />);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  });

  it("does not use dangerouslySetInnerHTML anywhere in the module", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/rich-text.tsx", "utf8");
    /*
     * The PROP, not the word — the module's own header names it to say it is
     * not used, and a bare substring check would fail on the explanation while
     * passing on a comment that removed it.
     */
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*[=:]/);
  });
});

/**
 * ============================================================================
 * A WHOLE ASK SUNNY ANSWER, NOT A FEATURE AT A TIME
 * ============================================================================
 *
 * Every test above exercises one construct in isolation, and all of them passed
 * while the reported defect was live: "The salon list appeared with literal
 * pipes." A real answer is a heading, then prose, then a table, then bullets,
 * then prose again — and the bugs in this module have always been at the
 * BOUNDARIES between those, where a block ends and the next begins.
 *
 * So this renders one answer of the shape the report briefing actually
 * produces, and asserts the whole thing: the table is a table, the bullets are
 * a list, the prose either side survives, and no pipe or asterisk is left on
 * screen for a reader to see.
 */
describe("a complete assistant answer", () => {
  const ANSWER = [
    "### Sales Totals — 12 September",
    "",
    "Across your salons PPTA came in at **$2.25**, weighted by each salon's own tans.",
    "",
    "| Salon | PPTA | Tans |",
    "| --- | ---: | ---: |",
    "| MO Kansas City Wornall | $2.38 | 102 |",
    "| NE Kearney | $1.28 | 65 |",
    "| NE Omaha 132nd and Maple | n/a | 74 |",
    "",
    "Two things stand out:",
    "",
    "- **NE Omaha 132nd and Maple** reports a PPTA of zero, which is a data question rather than a performance finding.",
    "- The spread between the strongest and weakest salon is **$1.10**.",
    "",
    "Product attachment is the behaviour behind that gap.",
  ].join("\n");

  it("renders the table as a table, with every salon in it", () => {
    render(<RichText content={ANSWER} />);

    const table = screen.getByRole("table");
    expect(table).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Salon" })).toBeTruthy();
    for (const salon of [
      "MO Kansas City Wornall",
      "NE Kearney",
      "NE Omaha 132nd and Maple",
    ]) {
      expect(screen.getByRole("cell", { name: salon })).toBeTruthy();
    }
  });

  it("renders the bullets as a list rather than as dashed prose", () => {
    render(<RichText content={ANSWER} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("NE Omaha 132nd and Maple");
    expect(items[1].textContent).toContain("$1.10");
  });

  it("renders the heading as a heading", () => {
    render(<RichText content={ANSWER} />);

    expect(screen.getByRole("heading", { name: /Sales Totals — 12 September/ })).toBeTruthy();
  });

  it("keeps the prose on both sides of the table", () => {
    const { container } = render(<RichText content={ANSWER} />);
    const text = container.textContent ?? "";

    expect(text).toContain("weighted by each salon's own tans");
    expect(text).toContain("Product attachment is the behaviour behind that gap.");
  });

  it("leaves NO markdown punctuation on screen", () => {
    /*
     * THE REPORTED DEFECT, stated as the assertion it always should have been.
     * A reader must not see a pipe, an asterisk, a hash or a leading dash
     * anywhere in a rendered answer — those are instructions to the renderer,
     * and every one of them on screen is a renderer that did not run.
     */
    const { container } = render(<RichText content={ANSWER} />);
    const text = container.textContent ?? "";

    expect(text).not.toContain("|");
    expect(text).not.toContain("**");
    expect(text).not.toContain("###");
    expect(text).not.toMatch(/(^|\n)\s*-\s/);
  });
});
