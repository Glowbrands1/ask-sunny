// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The Hub's composer attachments in the DM L10 assistant: attach / paste / drop, the Hub's limits and words, file parts. */
vi.mock("@/features/l10/actions", () => ({ meetingPeopleAction: async () => [] }));

import { AssistantPanel, withoutDroppedFiles } from "./AssistantPanel";
import { loadConversation, saveConversation } from "./storage";

const SCOPE = "sunny-user-1:stc-dm";
const posts: { messages: { role: string; parts: { type: string; mediaType?: string; url?: string; filename?: string; text?: string }[] }[] }[] = [];

beforeEach(() => {
  window.localStorage.clear();
  posts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ error: "x" }), { status: 500 });
      }
      return new Response(JSON.stringify({ configured: true }), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pdf = (name = "Plan.pdf", size?: number) => {
  const f = new File(["%PDF-1.7 test"], name, { type: "application/pdf" });
  if (size) Object.defineProperty(f, "size", { value: size });
  return f;
};

async function openPanel() {
  render(<AssistantPanel open onClose={() => {}} meetingKey="stc-dm" scope={SCOPE} />);
  await act(async () => {
    await Promise.resolve();
  });
  return screen.getByTestId("attach-input") as HTMLInputElement;
}

describe("attachments in the composer", () => {
  it("takes Word, Excel, CSV and Markdown files as chips too (a .md with no type is read by its extension)", async () => {
    const input = await openPanel();
    fireEvent.change(input, {
      target: {
        files: [
          new File(["x"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
          new File(["x"], "week.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          new File(["a,b"], "south.csv", { type: "text/csv" }),
          new File(["# x"], "agenda.md", { type: "" }),
        ],
      },
    });
    expect(screen.getAllByTestId("attachment-chip").map((c) => c.textContent)).toEqual(["notes.docx", "week.xlsx", "south.csv", "agenda.md"]);
    expect(screen.queryByTestId("attachment-error")).toBeNull();
    expect(input.getAttribute("accept")).toContain(".docx");
  });

  it("takes images and PDFs as chips that can be removed", async () => {
    const input = await openPanel();
    fireEvent.change(input, { target: { files: [pdf(), new File(["x"], "board.png", { type: "image/png" })] } });
    expect(screen.getAllByTestId("attachment-chip").map((c) => c.textContent)).toEqual(["Plan.pdf", "board.png"]);
    fireEvent.click(within(screen.getAllByTestId("attachment-chip")[1]).getByRole("button", { name: "Remove attachment" }));
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1);
  });

  // Since 27 Nov 2026 the panel takes Word, Excel, CSV and text as the Hub does (Hub PR #128); .doc/.xls are refused by name.
  it("refuses a wrong type, an older Word file and a file over 10 MB in the browser", async () => {
    const input = await openPanel();
    fireEvent.change(input, { target: { files: [new File(["x"], "clip.zip", { type: "application/zip" }), new File(["x"], "Plan.doc", { type: "application/msword" }), pdf("Big.pdf", 10 * 1024 * 1024 + 1)] } });
    expect(screen.getByTestId("attachment-error").textContent).toBe("clip.zip: only images (PNG, JPG, GIF, WebP), PDFs, Word (.docx), Excel (.xlsx) and text files can be attached. Plan.doc is an older Word file (.doc), which can't be read. Re-save it as .docx or PDF and attach it again. Big.pdf is larger than 10 MB.");
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("takes at most 5 files: the sixth is refused and the attach button says the limit is reached", async () => {
    const input = await openPanel();
    fireEvent.change(input, { target: { files: Array.from({ length: 6 }, (_, i) => pdf(`File ${i + 1}.pdf`)) } });
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(5);
    expect(screen.getByTestId("attachment-error").textContent).toBe("Limit of 5 files reached.");
    expect((screen.getByRole("button", { name: "Limit of 5 files reached" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("paste and drop attach too", async () => {
    await openPanel();
    const box = screen.getByLabelText("Message the Leadership Assistant");
    fireEvent.paste(box, { clipboardData: { files: [pdf("Pasted.pdf")] } });
    fireEvent.drop(box.closest("form")!, { dataTransfer: { files: [pdf("Dropped.pdf")], types: ["Files"] } });
    expect(screen.getAllByTestId("attachment-chip").map((c) => c.textContent)).toEqual(["Pasted.pdf", "Dropped.pdf"]);
  });

  it("sends the files as file parts with the message (a file alone can be sent), and shows them as chips above it", async () => {
    const input = await openPanel();
    fireEvent.change(input, { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const parts = posts[0].messages.at(-1)!.parts;
    expect(parts.map((p) => [p.type, p.mediaType ?? null, p.filename ?? null])).toEqual([
      ["file", "application/pdf", "Plan.pdf"],
    ]);
    expect(parts[0].url).toMatch(/^data:application\/pdf;base64,/);
    expect(screen.getByTestId("sent-attachment").textContent).toBe("Plan.pdf");
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });
});

describe("attachments and saved chats", () => {
  it("the saved chat keeps the file's name but never its data URL", () => {
    saveConversation([{ id: "u", role: "user", parts: [{ type: "text", text: "Read this" }, { type: "file", mediaType: "application/pdf", url: "data:application/pdf;base64,QUJD", filename: "Plan.pdf" }] }], SCOPE);
    expect(window.localStorage.getItem(Object.keys(window.localStorage).find((k) => k.includes(SCOPE))!)).not.toContain("data:");
    expect(loadConversation(SCOPE)[0].parts[1]).toMatchObject({ type: "file", filename: "Plan.pdf", url: "" });
  });

  it("a reopened chat sends a note for a file whose bytes were not kept, never an empty file", () => {
    const m = withoutDroppedFiles({ id: "u", role: "user", parts: [{ type: "text", text: "Read this" }, { type: "file", mediaType: "application/pdf", url: "", filename: "Plan.pdf" }] });
    expect(m.parts).toEqual([
      { type: "text", text: "Read this" },
      { type: "text", text: "[Attached earlier: Plan.pdf. Its contents are no longer available in this saved chat.]" },
    ]);
  });
});
