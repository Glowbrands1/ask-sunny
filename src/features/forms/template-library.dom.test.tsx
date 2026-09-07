// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { fieldsForVariant } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

import { TemplateLibrary, type TemplateSummaryView } from "./template-library";

/**
 * THE FORMS PAGE, WITH THE WHOLE LIBRARY ON IT.
 *
 * Rendered from the real seeds rather than from a fixture, because the things
 * worth asserting are all statements about the LIBRARY:
 *
 *   both categories appear, and the existing one is not disturbed;
 *   the new one holds the four supplied forms and nothing else;
 *   Coaching appears once — in the HR section, not moved and not duplicated;
 *   every template gets a card, in both panels.
 *
 * A fixture would let this pass while the page showed something else.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ role: "owner", user: { name: "QA" }, demoMode: true, can: () => true }),
}));

/** The same counts the page computes, from the same documents. */
function summarize(seed: (typeof TEMPLATE_SEEDS)[number], index: number): TemplateSummaryView {
  const counts = { ai: 0, manager: 0, employee: 0, manual: 0, signature: 0 };
  for (const field of fieldsForVariant(seed.document, seed.variants[0]?.key ?? null)) {
    if (field.responsibility in counts) counts[field.responsibility as keyof typeof counts] += 1;
  }
  counts.signature = seed.document.blocks.filter((block) => block.kind === "signature_row").length;

  return {
    id: `t-${index}`,
    key: seed.key,
    name: seed.name,
    shortName: seed.shortName,
    description: seed.description,
    category: seed.category,
    layoutFamily: seed.layoutFamily,
    requiredPermission: seed.requiredPermission,
    currentVersion: { version: 1, publishedAt: "2026-09-07T00:00:00.000Z", publishedBy: "system" },
    draftVersion: null,
    versionCount: 1,
    variantLabels: seed.variants.map((variant) => variant.label),
    fieldCounts: counts,
    activeAsset: null,
    assetCount: 1,
  };
}

const TEMPLATES = TEMPLATE_SEEDS.map(summarize);

function renderLibrary() {
  return render(<TemplateLibrary templates={TEMPLATES} canManage notice={null} />);
}

/**
 * The CARD GRID under one category heading, in one of the two panels.
 *
 * The grid rather than the whole `<section>`, because the category heading is
 * an `h3` too and would otherwise be counted as a card.
 */
function sectionFor(label: string, panel: 0 | 1): HTMLElement {
  const headings = screen.getAllByRole("heading", { name: label, level: 3 });
  const grid = headings[panel].closest("section")?.querySelector("div.grid");
  if (!grid) throw new Error(`no card grid for ${label}`);
  return grid as HTMLElement;
}

afterEach(cleanup);

describe("the Forms page", () => {
  it("renders", () => {
    renderLibrary();
    expect(screen.getByText("Document templates")).toBeTruthy();
    expect(screen.getByText("Uploaded source documents")).toBeTruthy();
  });

  it("shows both categories, in category order, in both panels", () => {
    const { container } = renderLibrary();
    // The category headings are the `h3`s that head a section; the rest are
    // card titles.
    const headings = Array.from(container.querySelectorAll("section > h3")).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual([
      "HR & Performance Forms",
      "Hiring & Interview Forms",
      "HR & Performance Forms",
      "Hiring & Interview Forms",
    ]);
  });

  it("keeps the existing forms where they were", () => {
    renderLibrary();
    const hr = sectionFor("HR & Performance Forms", 0);
    for (const name of [
      "Coaching Form",
      "Disciplinary Plan of Action",
      "Policy Review",
      "SDIT EPP",
      "TSD EPP",
      "ASD-SDIT Performance EPP",
      "FTTC Performance EPP",
      "DMIT EPP — TSD Review",
      "DMIT EPP — DMIT Review",
    ]) {
      expect(within(hr).getByRole("heading", { name, level: 3 }), name).toBeTruthy();
    }
  });

  it("puts the four supplied recruiting forms in Hiring & Interview Forms", () => {
    renderLibrary();
    const hiring = sectionFor("Hiring & Interview Forms", 0);
    const names = within(hiring)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(names).toEqual([
      "Prescreen / Phone Interview Form",
      "Tanning Consultant Interview Form",
      "First Round Management Interview Form",
      "Second Round Management Interview Form",
    ]);
  });

  it("shows Coaching once, and not under Hiring", () => {
    renderLibrary();
    // Once per panel — the document template and the uploaded copy — and no more.
    expect(screen.getAllByRole("heading", { name: "Coaching Form", level: 3 })).toHaveLength(2);
    const hiring = sectionFor("Hiring & Interview Forms", 0);
    expect(within(hiring).queryByRole("heading", { name: "Coaching Form" })).toBeNull();
  });

  it("opens each form at its own route, with no collisions", () => {
    const { container } = renderLibrary();
    const links = Array.from(container.querySelectorAll("a[href^='/forms/templates/']")).map(
      (link) => link.getAttribute("href"),
    );
    expect(links).toHaveLength(TEMPLATE_SEEDS.length);
    expect(new Set(links).size).toBe(links.length);
    expect(links).toContain("/forms/templates/coaching");
    expect(links).toContain("/forms/templates/management-interview-round-1");
  });

  it("offers PDF and Word on every replace control", () => {
    const { container } = renderLibrary();
    const inputs = Array.from(container.querySelectorAll("input[type=file]"));
    expect(inputs).toHaveLength(TEMPLATE_SEEDS.length);
    for (const input of inputs) {
      const accept = input.getAttribute("accept") ?? "";
      expect(accept).toContain(".pdf");
      expect(accept).toContain(".docx");
      expect(accept).toContain(".doc");
    }
    expect(screen.getAllByText("Replace (PDF or Word)")).toHaveLength(TEMPLATE_SEEDS.length);
  });

  it("does not print a chip for a count of none", () => {
    /*
     * An interview form has no AI fields and, mostly, no signature line. "0 AI"
     * against it says nothing and reads as a defect.
     */
    renderLibrary();
    const hiring = sectionFor("Hiring & Interview Forms", 0);
    expect(within(hiring).queryByText("0 AI")).toBeNull();
    expect(within(hiring).queryByText("0 signature")).toBeNull();
    // What it does say: how much of it a person fills in.
    expect(within(hiring).getByText("22 by the manager")).toBeTruthy();
  });
});
