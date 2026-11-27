// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/overlays";
import { Composer } from "./composer";
import type { AnswerMode } from "@/types";

/**
 * ============================================================================
 * THE ATTACH BUTTON IS BACK, AND IT WORKS (Pau, 26 Nov 2026)
 * ============================================================================
 *
 * "let managers attach files in the main chat ... just like the Leadership Hub assistant". The composer's header says
 * the dead attach button went away "until it works"; these pin that it now does: one paperclip in the pill, files as
 * chips with a remove button, the DM L10 panel's limits and refusals, and a question that may be only files.
 */

function Harness({ onSubmit = vi.fn(), initial = [] as File[], value = "" }: { onSubmit?: () => void; initial?: File[]; value?: string }) {
  const [files, setFiles] = React.useState<File[]>(initial);
  return (
    <TooltipProvider>
      <Composer value={value} onChange={() => {}} onSubmit={onSubmit} mode={"standard" as AnswerMode} onModeChange={() => {}} busy={false} files={files} onFilesChange={setFiles} />
    </TooltipProvider>
  );
}

const pdf = (name = "Coaching plan.pdf") => new File(["%PDF-1.7 test"], name, { type: "application/pdf" });
const pick = (...files: File[]) => fireEvent.change(screen.getByTestId("chat-attach-input"), { target: { files } });
const chips = () => screen.queryAllByTestId("chat-attachment-chip");

afterEach(cleanup);

describe("attaching files in the main chat", () => {
  it("shows one working attach button inside the input pill, and no chips row until a file is picked", () => {
    render(<Harness />);
    // The owner's wording (26 Nov 2026): an "Attach a file" button next to the text box.
    const attach = screen.getByRole("button", { name: "Attach a file" });
    expect(attach.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("list", { name: "Files to send" })).toBeNull();
    expect((screen.getByTestId("chat-attach-input") as HTMLInputElement).accept).toMatch(/application\/pdf.*\.docx.*\.xlsx.*text\/plain/);
  });

  it("a picked file becomes a chip, and its remove button takes it off again", () => {
    render(<Harness />);
    pick(pdf());
    expect(chips()).toHaveLength(1);
    expect(chips()[0]!.textContent).toContain("Coaching plan.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Remove Coaching plan.pdf" }));
    expect(chips()).toHaveLength(0);
  });

  it("takes images, PDFs, Word, Excel and text files, a .md the browser gave no type included", () => {
    render(<Harness />);
    pick(
      new File(["x"], "week-47.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      pdf(),
      new File(["x"], "board.png", { type: "image/png" }),
      new File(["x"], "Notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      new File(["Week 1"], "plan.md", { type: "" }),
    );
    expect(chips().map((chip) => chip.textContent)).toEqual(["week-47.xlsx", "Coaching plan.pdf", "board.png", "Notes.docx", "plan.md"]);
    expect(screen.queryByTestId("chat-attachment-error")).toBeNull();
  });

  it("refuses a file of another kind, by name, and keeps the rest", () => {
    render(<Harness />);
    pick(new File(["x"], "payroll.zip", { type: "application/zip" }), pdf());
    expect(chips()).toHaveLength(1);
    expect(screen.getByTestId("chat-attachment-error").textContent).toMatch(/payroll\.zip: only images .*PDFs, Word \(\.docx\), Excel \(\.xlsx\) and text files can be attached/);
  });

  it("an old .doc gets a clear message: re-save as .docx or PDF and attach it again", () => {
    render(<Harness />);
    pick(new File(["x"], "Plan.doc", { type: "application/msword" }), new File(["x"], "Stats.xls", { type: "" }));
    expect(chips()).toHaveLength(0);
    expect(screen.getByTestId("chat-attachment-error").textContent).toBe(
      "Plan.doc is an older Word file (.doc), which can't be read. Re-save it as .docx or PDF and attach it again. Stats.xls is an older Excel file (.xls), which can't be read. Re-save it as .xlsx or PDF and attach it again.",
    );
  });

  it("stops at the panel's five files, says so, and disables the button at the limit", () => {
    render(<Harness />);
    pick(...Array.from({ length: 6 }, (_, index) => pdf(`page-${index + 1}.pdf`)));
    expect(chips()).toHaveLength(5);
    expect(screen.getByTestId("chat-attachment-error").textContent).toContain("Limit of 5 files reached.");
    expect(screen.getByRole("button", { name: "Limit of 5 files reached" }).hasAttribute("disabled")).toBe(true);
  });

  it("refuses a file over 10 MB", () => {
    render(<Harness />);
    const big = pdf("big.pdf");
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    pick(big);
    expect(chips()).toHaveLength(0);
    expect(screen.getByTestId("chat-attachment-error").textContent).toBe("big.pdf is larger than 10 MB.");
  });

  it("a question that is only files can be sent", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} initial={[pdf()]} />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.hasAttribute("disabled")).toBe(false);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("with nothing typed and nothing attached, Send stays disabled", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
  });
});
