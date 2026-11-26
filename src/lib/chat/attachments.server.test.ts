import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ATTACHMENT_TEXT_LIMIT, attachmentAnthropicBlocks, attachmentModelParts, attachmentsLead, parseChatAttachments, readAttachments } from "./attachments.server";
import { withAttachedFiles } from "@/lib/ai/agent-loop/run";
import { withAttachmentBlocks } from "@/lib/ai/call-claude";
import { safeMetadata } from "./payload";

/*
 * FILES ATTACHED IN THE MAIN CHAT (Pau, 26 Nov 2026): the route's checks (the DM L10 panel's guard: types, five files,
 * 10 MB, inline data only) and how each kind is read for the model. Invented people only.
 */
const data = (mediaType: string, bytes: Buffer | string) => `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function workbook(): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Week 47");
  sheet.addRow(["Location", "Guests", "Sales"]);
  sheet.addRow(["North", 120, 3450.5]);
  sheet.addRow(["South", 98, 2875]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const pdf = { filename: "plan.pdf", mediaType: "application/pdf", url: data("application/pdf", "%PDF-1.7 Wren Ashdown") };

describe("the route's check of attached files", () => {
  it("no attachments is no files", () => {
    expect(parseChatAttachments(undefined)).toBeUndefined();
    expect(parseChatAttachments([])).toBeUndefined();
  });

  it("takes images, PDFs, Word and text files as inline data", () => {
    const files = [pdf, { filename: "a.png", mediaType: "image/png", url: data("image/png", "x") }, { filename: "b.docx", mediaType: DOCX, url: data(DOCX, "x") }, { filename: "c.md", mediaType: "text/markdown", url: data("text/markdown", "# x") }];
    expect(parseChatAttachments(files)?.map((file) => file.filename)).toEqual(["plan.pdf", "a.png", "b.docx", "c.md"]);
  });

  it("refuses a remote address: the server or model provider would fetch what the browser chose", () => {
    expect(() => parseChatAttachments([{ ...pdf, url: "https://example.test/plan.pdf" }])).toThrow("Attachments must be uploaded from your device.");
    // A data URL that says another type than the file is refused too.
    expect(() => parseChatAttachments([{ ...pdf, url: data("image/png", "x") }])).toThrow("Attachments must be uploaded from your device.");
  });

  it("refuses other kinds, more than five files, and a file over 10 MB", () => {
    expect(() => parseChatAttachments([{ filename: "x.zip", mediaType: "application/zip", url: data("application/zip", "x") }])).toThrow(/Only images .* text files can be attached/);
    expect(() => parseChatAttachments(Array.from({ length: 6 }, () => pdf))).toThrow("Attach at most 5 files per message.");
    expect(() => parseChatAttachments([{ ...pdf, url: `data:application/pdf;base64,${"A".repeat(15 * 1024 * 1024)}` }])).toThrow("Each file must be 10 MB or smaller.");
    expect(() => parseChatAttachments("plan.pdf")).toThrow("Attachments must be uploaded from your device.");
  });

  it("a name is one bounded line", () => {
    expect(parseChatAttachments([{ ...pdf, filename: "a\nb" }])![0]!.filename).toBe("a b");
    expect(parseChatAttachments([{ ...pdf, filename: "" }])![0]!.filename).toBe("attachment");
  });
});

describe("older Office files are refused with how to re-save them", () => {
  it("a .doc and a .xls name the file and the format to use", () => {
    expect(() => parseChatAttachments([{ filename: "Plan.doc", mediaType: "application/msword", url: data("application/msword", "x") }])).toThrow("Plan.doc is an older Word file (.doc), which can't be read. Re-save it as .docx or PDF and attach it again.");
    expect(() => parseChatAttachments([{ filename: "Stats.xls", mediaType: "application/vnd.ms-excel", url: data("application/vnd.ms-excel", "x") }])).toThrow("Stats.xls is an older Excel file (.xls), which can't be read. Re-save it as .xlsx or PDF and attach it again.");
  });
});

describe("how each file is read for the model", () => {
  it("an Excel workbook is read sheet by sheet, row by row, with its figures as shown", async () => {
    const [read] = await readAttachments(parseChatAttachments([{ filename: "week-47.xlsx", mediaType: XLSX, url: data(XLSX, await workbook()) }]));
    expect(read).toEqual({ kind: "text", filename: "week-47.xlsx", text: "ATTACHED FILE: week-47.xlsx (Excel workbook)\n\nSheet: Week 47\nLocation | Guests | Sales\nNorth | 120 | 3450.5\nSouth | 98 | 2875" });
  });

  it("a damaged workbook is said to be unreadable, not dropped", async () => {
    const [read] = await readAttachments([{ filename: "bad.xlsx", mediaType: XLSX, url: data(XLSX, "not a zip") }]);
    expect(read!.kind === "text" && read!.text).toContain("This file could not be read.");
  });

  it("an image and a PDF go as they are; a text file and a Word document as text", async () => {
    const word = readFileSync(join(process.cwd(), "src/test/fixtures/forms/coaching-form.docx"));
    const read = await readAttachments([
      pdf,
      { filename: "notes.txt", mediaType: "text/plain", url: data("text/plain", "Wren Ashdown closes on Fridays.") },
      { filename: "coaching-form.docx", mediaType: DOCX, url: data(DOCX, word) },
    ]);
    expect(read[0]).toEqual({ kind: "native", filename: "plan.pdf", mediaType: "application/pdf", base64: Buffer.from("%PDF-1.7 Wren Ashdown").toString("base64") });
    expect(read[1]).toEqual({ kind: "text", filename: "notes.txt", text: "ATTACHED FILE: notes.txt (text file)\n\nWren Ashdown closes on Fridays." });
    expect(read[2]!.kind === "text" && read[2]!.text).toMatch(/^ATTACHED FILE: coaching-form\.docx \(Word document\)\n\n[\s\S]*Acknowledgement of Coaching/);
  });

  it("a damaged Word document is said to be unreadable, not dropped", async () => {
    const [read] = await readAttachments([{ filename: "old.docx", mediaType: DOCX, url: data(DOCX, "not a zip") }]);
    expect(read).toMatchObject({ kind: "text" });
    expect(read!.kind === "text" && read!.text).toContain("This file could not be read.");
  });

  it("a very long text file is cut, and the model is told so", async () => {
    const [read] = await readAttachments([{ filename: "log.txt", mediaType: "text/plain", url: data("text/plain", "x".repeat(ATTACHMENT_TEXT_LIMIT + 10)) }]);
    expect(read!.kind === "text" && read!.text).toMatch(/\[The rest of log\.txt was left out: it is longer than 60,000 characters\.\]$/);
  });

  it("the loop's parts and the older path's blocks carry the same files", async () => {
    const read = await readAttachments([pdf, { filename: "a.png", mediaType: "image/png", url: data("image/png", "png") }, { filename: "n.txt", mediaType: "text/plain", url: data("text/plain", "hi") }]);
    expect(attachmentModelParts(read)).toEqual([
      { type: "file", data: Buffer.from("%PDF-1.7 Wren Ashdown").toString("base64"), mediaType: "application/pdf", filename: "plan.pdf" },
      { type: "file", data: Buffer.from("png").toString("base64"), mediaType: "image/png", filename: "a.png" },
      { type: "text", text: "ATTACHED FILE: n.txt (text file)\n\nhi" },
    ]);
    expect(attachmentAnthropicBlocks(read)).toEqual([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.7 Wren Ashdown").toString("base64") }, title: "plan.pdf" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png").toString("base64") } },
      { type: "text", text: "ATTACHED FILE: n.txt (text file)\n\nhi" },
    ]);
    expect(attachmentsLead(read)).toBe("The manager attached 3 files to this message: plan.pdf, a.png, n.txt. They are included above; read them to answer.");
  });
});

describe("the files go on the manager's message, ahead of their words", () => {
  it("the loop: only the last message, and only a manager's", () => {
    const parts = [{ type: "file", data: "AA==", mediaType: "application/pdf", filename: "plan.pdf" }];
    expect(withAttachedFiles([{ role: "user", content: "earlier" }, { role: "assistant", content: "ok" }, { role: "user", content: "summarize this file" }], parts)).toEqual([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "ok" },
      { role: "user", content: [...parts, { type: "text", text: "summarize this file" }] },
    ]);
    const without = [{ role: "user" as const, content: "hi" }];
    expect(withAttachedFiles(without, [])).toBe(without);
  });

  it("the older path: no files, the content exactly as before", () => {
    expect(withAttachmentBlocks("QUESTION\n\nhi", undefined)).toBe("QUESTION\n\nhi");
    expect(withAttachmentBlocks("QUESTION\n\nhi", [{ type: "text", text: "ATTACHED FILE: n.txt" }])).toEqual([{ type: "text", text: "ATTACHED FILE: n.txt" }, { type: "text", text: "QUESTION\n\nhi" }]);
  });
});

describe("a synced chat keeps the files' names, never their bytes", () => {
  it("attachments are on the metadata allowlist", () => {
    expect(safeMetadata({ attachments: [{ filename: "plan.pdf", mediaType: "application/pdf" }] })).toEqual({ attachments: [{ filename: "plan.pdf", mediaType: "application/pdf" }] });
  });
});
