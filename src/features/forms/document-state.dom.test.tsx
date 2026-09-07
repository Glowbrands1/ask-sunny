// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { TemplateLibrary, type TemplateSummaryView } from "./template-library";

/**
 * WHAT THE ADMINISTRATOR IS TOLD ABOUT AN UPLOADED DOCUMENT.
 *
 * The reported defect was not that the app did the wrong thing — the upload was
 * stored correctly and the form was, correctly, left alone. It was that nothing
 * said so. Now that an upload really does read into a draft, the screen has
 * four states to keep apart, and the one sentence it must never imply is that
 * the live form changed before somebody published it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ role: "owner", user: { name: "QA" }, demoMode: true, can: () => true }),
}));

function template(overrides: Partial<TemplateSummaryView> = {}): TemplateSummaryView {
  return {
    id: "t-1",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "The everyday one.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    currentVersion: { version: 2, publishedAt: "2026-09-07T00:00:00.000Z", publishedBy: "dana" },
    draftVersion: null,
    versionCount: 2,
    variantLabels: [],
    fieldCounts: { ai: 4, manager: 0, employee: 0, manual: 0, signature: 2 },
    activeAsset: null,
    assetCount: 1,
    documentState: "none",
    documentProblem: null,
    proposalFlags: 0,
    ...overrides,
  };
}

const upload: TemplateSummaryView["activeAsset"] = {
  id: "asset-1",
  version: 2,
  kind: "upload",
  fileName: "01. Coaching Form.pdf",
  sizeBytes: 69779,
  pageCount: 1,
  hasFields: false,
  format: "pdf",
  createdAt: "2026-09-07T00:00:00.000Z",
};

function renderOne(overrides: Partial<TemplateSummaryView>) {
  return render(
    <TemplateLibrary templates={[template(overrides)]} canManage notice={null} />,
  );
}

/** The uploaded-documents panel is the second one on the page. */
function uploadCard(): HTMLElement {
  const headings = screen.getAllByRole("heading", { name: "Coaching Form", level: 3 });
  return headings[1]!.closest("div")!.parentElement as HTMLElement;
}

afterEach(cleanup);

describe("the four states an uploaded document can be in", () => {
  it("invites an upload when there is no document", () => {
    renderOne({ documentState: "none" });
    expect(screen.getByText("No document")).toBeTruthy();
    expect(
      screen.getByText(/Ask Sunny reads it into a draft of this form for you to review/),
    ).toBeTruthy();
  });

  it("says a document is stored but nothing was read out of it", () => {
    renderOne({
      documentState: "stored",
      activeAsset: upload,
      documentProblem: "This is a Word 97-2003 (.doc) file.",
    });
    expect(screen.getByText("Stored only")).toBeTruthy();
    expect(screen.getByText(/No form could be read out of it/)).toBeTruthy();
    expect(screen.getByText(/Word 97-2003/)).toBeTruthy();
  });

  it("says a draft was proposed, and that the live form has NOT changed", () => {
    renderOne({
      documentState: "proposed",
      activeAsset: upload,
      draftVersion: { id: "v3", version: 3 },
    });
    expect(screen.getByText("Draft proposed")).toBeTruthy();
    expect(screen.getByText(/Read into draft v3, with nothing flagged/)).toBeTruthy();
    expect(screen.getByText(/The live form has not changed until you publish it/)).toBeTruthy();
  });

  it("counts what needs checking, and still says the live form has not moved", () => {
    renderOne({
      documentState: "review",
      activeAsset: upload,
      draftVersion: { id: "v3", version: 3 },
      proposalFlags: 3,
    });
    expect(screen.getByText("Needs review")).toBeTruthy();
    expect(screen.getByText(/3 things to check/)).toBeTruthy();
    expect(screen.getByText(/The live form has not changed\./)).toBeTruthy();
  });

  it("says when the live form did come from this document", () => {
    renderOne({ documentState: "published", activeAsset: upload });
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText(/The live form was published from this document/)).toBeTruthy();
    // Even here, the next upload is described as a draft.
    expect(screen.getByText(/it does not change the live form until you publish it/)).toBeTruthy();
  });

  it("offers a way to read the proposal only while there is one", () => {
    renderOne({
      documentState: "review",
      activeAsset: upload,
      draftVersion: { id: "v3", version: 3 },
      proposalFlags: 1,
    });
    const review = screen.getByRole("link", { name: /Review the proposed form/ });
    expect(review.getAttribute("href")).toBe("/forms/templates/coaching");

    cleanup();
    renderOne({ documentState: "stored", activeAsset: upload });
    expect(screen.queryByRole("link", { name: /Review the proposed form/ })).toBeNull();
  });

  it("never tells anyone that replacing the file changes nothing", () => {
    // The previous wording, now wrong: an upload DOES read into a draft.
    for (const state of ["none", "stored", "proposed", "review", "published"] as const) {
      cleanup();
      renderOne({ documentState: state, activeAsset: upload, draftVersion: { id: "v3", version: 3 } });
      expect(
        screen.queryByText(/Replacing this file does not change the form/),
        state,
      ).toBeNull();
    }
  });

  it("offers Word as well as PDF on the upload control", () => {
    const { container } = renderOne({ documentState: "none" });
    const input = container.querySelector("input[type=file]");
    const accept = input?.getAttribute("accept") ?? "";
    for (const token of [".pdf", ".docx", ".doc"]) expect(accept).toContain(token);
    expect(within(uploadCard()).getByText("Upload PDF or Word")).toBeTruthy();
  });
});

describe("the endpoints that write a form", () => {
  /*
   * A FAKE CANNOT PROVE AN AUTHORIZATION. Both routes that can change what a
   * form asks are asserted against their own source, because "who may do this"
   * is the one property of this feature that a wrong answer makes dangerous:
   * being allowed to upload a file is not the same right as being allowed to
   * change the questions on an HR record.
   */
  it("gate extraction and upload on managing templates", () => {
    for (const route of [
      "src/app/api/forms/templates/[key]/extract/route.ts",
      "src/app/api/forms/templates/[key]/pdf/route.ts",
    ]) {
      const source = readFileSync(route, "utf8");
      expect(source, route).toContain('authorizeForms(request, "manage_form_templates")');
    }
  });

  it("never publish from the upload or extraction path", () => {
    for (const route of [
      "src/app/api/forms/templates/[key]/extract/route.ts",
      "src/app/api/forms/templates/[key]/pdf/route.ts",
    ]) {
      const source = readFileSync(route, "utf8");
      expect(source, route).not.toContain("publishDraft");
      expect(source, route).not.toContain("form_template_current");
    }
  });
});
