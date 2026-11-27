import { describe, expect, it } from "vitest";

import { attachedEarlierNote, fileOnlyQuestion, historyWithAttachmentNotes, namesOf } from "./attachments";
import type { ChatMessage } from "@/types";

/*
 * A CHAT WITH FILES, REOPENED (Pau, 26 Nov 2026). The bytes go with the question that carried them and are not kept, as
 * in the DM L10 panel (`AssistantPanel.tsx`: "A file part whose bytes were not kept (a chat reopened from history)
 * becomes a short note for the model"). A later turn, or the chat reopened, names the file and says so.
 */
const at = "2026-11-26T16:00:00.000Z";

describe("files in the history sent to the model", () => {
  it("an earlier question that carried files says so, by name; the stored message is unchanged", () => {
    const history: ChatMessage[] = [
      { id: "m1", role: "user", content: "summarize this file", createdAt: at, attachments: [{ filename: "Wren plan.pdf", mediaType: "application/pdf" }] },
      { id: "m2", role: "assistant", content: "It is a two-week plan.", createdAt: at },
    ];
    const sent = historyWithAttachmentNotes(history);
    expect(sent[0]!.content).toBe(
      "summarize this file\n\n[Attached earlier: Wren plan.pdf. Its contents are no longer available in this saved chat; ask the manager to attach it again if you need it.]",
    );
    expect(sent[1]).toBe(history[1]);
    expect(history[0]!.content).toBe("summarize this file");
  });

  it("several files are named together", () => {
    expect(attachedEarlierNote([{ filename: "a.pdf", mediaType: "application/pdf" }, { filename: "b.png", mediaType: "image/png" }])).toBe(
      "[Attached earlier: a.pdf, b.png. Their contents are no longer available in this saved chat; ask the manager to attach them again if you need them.]",
    );
  });

  it("a message keeps names and types only, never the data", () => {
    expect(namesOf([{ filename: "a.pdf", mediaType: "application/pdf", url: "data:application/pdf;base64,AA==" }])).toEqual([{ filename: "a.pdf", mediaType: "application/pdf" }]);
  });

  it("a question that is only files is sent in words", () => {
    expect(fileOnlyQuestion(1)).toBe("Please read the attached file.");
    expect(fileOnlyQuestion(3)).toBe("Please read the attached files.");
  });
});
