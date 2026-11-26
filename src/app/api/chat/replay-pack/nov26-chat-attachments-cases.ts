import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FILES ATTACHED IN THE MAIN CHAT REACH THE MODEL (Pau, 26 Nov 2026)
 * ============================================================================
 *
 * Managers attach files in the main chat "just like the Leadership Hub assistant": the composer's paperclip sends this
 * turn's files (the DM L10 panel's mechanism), and the agent loop reads them. The loop used to send any turn with
 * attachments to the older path (AGENT_LOOP_SKIPPED "attachments"); that reason is gone. These cases run the real route
 * with production's flags: "summarize this file" with a PDF, a text file and a Word document attached, and the file's
 * content is in what the loop's model was given. The last runs the older path (the manager not on the loop) and the
 * file reaches that model too. The file's people are invented.
 */
const REPORT = `Pau, 26 Nov 2026: "let managers attach files in the main chat" — the AI reads and summarizes them like the DM L10 assistant`;
const SAID = "summarize this file";
const PLAN = "Coaching plan for Tamsin Hollowell, front desk. Week 1: greet every guest within ten seconds. Week 2: offer the upgrade on every visit.";

const dataUrl = (mediaType: string, bytes: Buffer | string) => `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
const PDF_BYTES = Buffer.from(`%PDF-1.7\n${PLAN}\n%%EOF`);
const PDF = { filename: "Tamsin coaching plan.pdf", mediaType: "application/pdf", url: dataUrl("application/pdf", PDF_BYTES) };
const TEXT = { filename: "coaching-plan.txt", mediaType: "text/plain", url: dataUrl("text/plain", PLAN) };
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const docx = () => ({ filename: "coaching-form.docx", mediaType: DOCX_TYPE, url: dataUrl(DOCX_TYPE, readFileSync(join(process.cwd(), "src/test/fixtures/forms/coaching-form.docx"))) });

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-26T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

type PromptPart = { type?: string; text?: string; data?: unknown; mediaType?: string; filename?: string };
/** The manager's message as the loop's model received it (the provider's prompt: text and file parts). */
function managerMessage(prompt: unknown): PromptPart[] {
  const messages = prompt as { role: string; content: string | PromptPart[] }[];
  const last = [...messages].reverse().find((message) => message.role === "user");
  return !last ? [] : typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
}
const bytesOf = (data: unknown): Buffer =>
  data instanceof Uint8Array ? Buffer.from(data) : typeof data === "string" ? Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64") : data instanceof URL ? Buffer.from(data.href.replace(/^data:[^,]*,/, ""), "base64") : Buffer.alloc(0);
const lastUserText = (view: LoopView | undefined) => [...(view?.turns ?? [])].reverse().find((turn) => turn.role === "user")?.text ?? "";

export const NOV26_CHAT_ATTACHMENTS_CASES: ReplayCase[] = [
  {
    id: "nov26-chat-attach-pdf-reaches-the-loop",
    title: `"${SAID}" with a PDF attached: the agent loop answers, and its model is given the PDF itself, by name`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn(() => ({ text: "Here is a summary of the coaching plan." }));
      t.loopModel!(model);
      const reply = await thread.say(SAID, {}, { attachments: [PDF] });
      expect(model.calls, "a turn with a file went to the older path, not the loop").toBeGreaterThan(0);
      expect(reply.content).toBe("Here is a summary of the coaching plan.");
      const parts = managerMessage(model.prompts[0]);
      const file = parts.find((part) => part.type === "file");
      expect(file, "the PDF did not reach the loop's model").toBeDefined();
      expect(file!.mediaType).toBe("application/pdf");
      expect(file!.filename).toBe("Tamsin coaching plan.pdf");
      expect(bytesOf(file!.data).toString("utf8"), "the model was given other bytes than the file's").toContain(PLAN);
      // The manager's words and the files' names are on the same message, the files first.
      const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      expect(text).toContain(SAID);
      expect(text).toContain("The manager attached a file to this message: Tamsin coaching plan.pdf.");
      expect(parts.findIndex((part) => part.type === "file")).toBeLessThan(parts.findIndex((part) => (part.text ?? "").includes(SAID)));
    },
  },
  {
    id: "nov26-chat-attach-text-file-content-reaches-the-loop",
    title: `"${SAID}" with a text file attached: the file's words are in what the loop's model reads`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn(() => ({ text: "The plan has two weeks of goals." }));
      t.loopModel!(model);
      await thread.say(SAID, {}, { attachments: [TEXT] });
      const read = lastUserText(model.views[0]);
      expect(read, "the text file's content did not reach the model").toContain(PLAN);
      expect(read).toContain("ATTACHED FILE: coaching-plan.txt (text file)");
    },
  },
  {
    id: "nov26-chat-attach-word-document-read-as-text",
    title: `"${SAID}" with a Word document attached: the server reads the .docx and its text reaches the loop's model`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn(() => ({ text: "It is a coaching form with an acknowledgement section." }));
      t.loopModel!(model);
      await thread.say(SAID, {}, { attachments: [docx()] });
      const read = lastUserText(model.views[0]);
      expect(read).toContain("ATTACHED FILE: coaching-form.docx (Word document)");
      expect(read, "the Word document's text did not reach the model").toContain("Acknowledgement of Coaching");
      expect(read).not.toContain("could not be read");
    },
  },
  {
    id: "nov26-chat-attach-older-path-reads-the-file",
    title: `"${SAID}" from a manager not on the loop: the older path's model is given the PDF too`,
    report: REPORT,
    status: "fixed",
    async run(t) {
      if (!t.lastAttachments) return;
      // No stand-in for the loop: this manager is not on AGENT_LOOP_USERS, so the older path answers.
      const thread = start(t);
      await thread.say(SAID, {}, { attachments: [PDF] });
      const blocks = t.lastAttachments() as { type: string; source?: { media_type?: string; data?: string }; title?: string; text?: string }[];
      const document = blocks.find((block) => block.type === "document");
      expect(document, "the PDF did not reach the older path's model").toBeDefined();
      expect(document!.source?.media_type).toBe("application/pdf");
      expect(document!.title).toBe("Tamsin coaching plan.pdf");
      expect(Buffer.from(document!.source?.data ?? "", "base64").toString("utf8")).toContain(PLAN);
      expect(blocks.some((block) => block.type === "text" && (block.text ?? "").includes("The manager attached a file to this message: Tamsin coaching plan.pdf."))).toBe(true);
    },
  },
];
