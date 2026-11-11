import { describe, expect, it } from "vitest";

import { parseFormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";
import { renderFormPdf, type RenderMeta } from "./pdf-render";
import {
  displayCalendarDate,
  normalizeRevisionReason,
  revisionLabel,
  revisionMarks,
  revisionMarkText,
  REVISION_REASON_REQUIRED_MESSAGE,
  type RevisionEntry,
  type RevisionHistory,
} from "./revision-history";

/**
 * The shared half of FORM_REVISIONS_ENABLED: the reason rule, the marks a
 * chain prints, and the PDF footer with and without them.
 */

const entry = (overrides: Partial<RevisionEntry> & Pick<RevisionEntry, "id" | "revisionNumber" | "status">): RevisionEntry => ({
  reference: overrides.id.slice(0, 8),
  kind: overrides.revisionNumber === 0 ? null : "revised",
  reason: null,
  openedAt: "2026-10-20T15:00:00Z",
  openedBy: "manager-1",
  finalizedAt: null,
  supersededAt: null,
  ...overrides,
});

const original = entry({
  id: "aaaaaaaa-0000",
  revisionNumber: 0,
  status: "revised",
  finalizedAt: "2026-10-20T19:23:00Z",
  supersededAt: "2026-10-21T15:00:00Z",
});
const first = entry({
  id: "bbbbbbbb-0000",
  revisionNumber: 1,
  status: "finalized",
  reason: "Wrong offense date.",
  finalizedAt: "2026-10-21T15:00:00Z",
});
const chain = (instanceId: string, entries: RevisionEntry[] = [original, first]): RevisionHistory => ({ instanceId, entries });
const day = (timestamp: string) => timestamp.slice(0, 10);

describe("a reason for editing a finalized form", () => {
  it("is tidied, capped and required to say something", () => {
    expect(normalizeRevisionReason("  Wrong   offense\n date.  ")).toBe("Wrong offense date.");
    expect(normalizeRevisionReason("x".repeat(600))).toHaveLength(500);
    for (const empty of [undefined, null, 4, "", "   ", " . ", "ok"]) expect(normalizeRevisionReason(empty)).toBeNull();
  });

  it("tells the manager why it is asked for, and that the new printout is signed again", () => {
    expect(REVISION_REASON_REQUIRED_MESSAGE).toContain("needs a reason");
    expect(REVISION_REASON_REQUIRED_MESSAGE).toContain("signed again");
  });
});

describe("the marks a chain prints", () => {
  it("marks the revision Revised, and the original Superseded", () => {
    const onRevision = revisionMarks(chain(first.id), day).map((mark) => revisionMarkText(mark, displayCalendarDate));
    expect(onRevision).toEqual(["Revised 10/21/2026 (supersedes aaaaaaaa)"]);
    const onOriginal = revisionMarks(chain(original.id), day).map((mark) => revisionMarkText(mark, displayCalendarDate));
    expect(onOriginal).toEqual(["Superseded 10/21/2026 by bbbbbbbb"]);
  });

  it("marks a draft revision as one, and a revised revision both ways", () => {
    const draft = entry({ id: "cccccccc-0000", revisionNumber: 2, status: "draft" });
    const revisedFirst = { ...first, status: "revised" as const, supersededAt: "2026-10-22T15:00:00Z" };
    const entries = [original, revisedFirst, draft];
    expect(revisionMarks(chain(draft.id, entries), day).map((mark) => revisionMarkText(mark, displayCalendarDate))).toEqual([
      "Revision 2 of aaaaaaaa, draft (supersedes bbbbbbbb once finalized)",
    ]);
    // Revised 10/21 is still what it supersedes; superseded on 10/22 is what replaced it.
    expect(revisionMarks(chain(first.id, entries), day).map((mark) => revisionMarkText(mark, displayCalendarDate))).toEqual([
      "Revised 10/21/2026 (supersedes aaaaaaaa)",
      "Superseded 10/22/2026 by cccccccc",
    ]);
    expect(revisionLabel(chain(draft.id, entries))).toBe("Revision 2 of aaaaaaaa");
  });

  it("leaves an original nobody revised unmarked", () => {
    const alone = entry({ id: "dddddddd-0000", revisionNumber: 0, status: "finalized" });
    expect(revisionMarks(chain(alone.id, [alone]), day)).toEqual([]);
    expect(revisionLabel(chain(alone.id, [alone]))).toBeNull();
  });
});

describe("the PDF footer", () => {
  const document = parseFormDocument(TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")!.document);
  const meta: RenderMeta = {
    templateName: "Corrective Action Form",
    templateVersion: 7,
    employeeName: "Marisol Quenby",
    formDate: "2026-10-20",
    locationName: "Invented Salon",
    reference: "aaaaaaaa",
    status: "revised",
  };
  const values = { values: { observation: "Arrived late." }, checked: {} };

  it("is byte-identical with no marks, whether the field is absent or empty", () => {
    const plain = renderFormPdf(document, null, values, meta);
    expect(Buffer.from(renderFormPdf(document, null, values, { ...meta, revisionMarks: [] })).equals(Buffer.from(plain))).toBe(true);
  });

  it("prints the mark in bold under the footer line on every page", () => {
    const marks = revisionMarks(chain(original.id), day);
    const source = Buffer.from(renderFormPdf(document, null, values, { ...meta, revisionMarks: marks })).toString("latin1");
    const drawn = [...source.matchAll(/\/F2 [\d.]+ Tf 1 0 0 1 [\d.]+ 24 Tm \((.*?)\) Tj ET/g)].map((match) => match[1]);
    const pages = (source.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(0);
    expect(drawn).toHaveLength(pages);
    for (const text of drawn) expect(text).toMatch(/^Superseded \S+ by bbbbbbbb$/);
  });
});
