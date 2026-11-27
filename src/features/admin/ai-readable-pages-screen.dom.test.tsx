// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { AI_READABLE_PAGES } from "@/config/ai-readable-pages";

import { AiReadablePagesScreen } from "./ai-readable-pages-screen";

/**
 * QA, 24 Nov 2026: "the list of every page the AI can read" could not be found in the app. The admin screen renders the
 * page registry itself: one row per entry, Yes with the tool for a readable page, No with the reason for the rest.
 */
afterEach(cleanup);

describe("AI-readable pages (admin)", () => {
  it("shows every page in the registry, with its tool or why the AI cannot read it", () => {
    render(<AiReadablePagesScreen pages={AI_READABLE_PAGES} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(AI_READABLE_PAGES.length);
    AI_READABLE_PAGES.forEach((page, index) => {
      const row = within(rows[index]!);
      expect(row.getByText(page.route)).toBeTruthy();
      if (page.reader) {
        expect(row.getByText("Yes")).toBeTruthy();
        expect(row.getByText(page.reader.tool)).toBeTruthy();
      } else {
        expect(row.getByText("No")).toBeTruthy();
        expect(rows[index]!.textContent).toContain(page.notReadable);
      }
    });
    const readable = AI_READABLE_PAGES.filter((page) => page.reader).length;
    expect(screen.getByText(new RegExp(`${readable} of ${AI_READABLE_PAGES.length} can`))).toBeTruthy();
  });
});
