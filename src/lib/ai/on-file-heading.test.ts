import { describe, expect, it } from "vitest";

import manual from "@/test/fixtures/jba-manual-production-151.json";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";

import { headingOnlyOnFile } from "./on-file-heading";

/** The production manual's chunks (the manual readers run on them, as the intent reader's index loads them). */
const CHUNKS = (manual as { chunks: { chunk_index: number; content: string; page: number; section: string; locator: unknown; metadata: unknown }[] }).chunks.map(
  (chunk) => ({ chunkIndex: chunk.chunk_index, content: chunk.content, page: chunk.page, section: chunk.section, locator: chunk.locator, metadata: chunk.metadata }),
) as unknown as ManualChunk[];

/* ON_FILE_LINE_NOT_THE_POLICY_ENABLED (Pau's morning scan, 13 Nov 2026; invented name). */
const T2 = "Write me a CA form for Briony Calloway having a black crewneck on during her shift, not a zip up jacket on 11/13 and 11/6";
const ON_FILE = "**On file in Form Monitoring for Briony Calloway:** Verbal corrective action (Tardiness/Leaving Early — Late Opening) — finalized 10/26/2026; Verbal corrective action (Attendance Policy, JBA Policy Manual p.14) — finalized 11/02/2026. I'll list them under prior coaching and corrective action on the form — remove any that shouldn't count.";
const history = [
  { role: "user", content: T2 },
  { role: "assistant", content: `I'll draft a **Corrective Action Form** for **Briony Calloway**.\n\n**Policy:** Dress Code, as you said.\n\n${ON_FILE}` },
];

describe("headingOnlyOnFile", () => {
  it("Late Opening, named only in the app's On file listing, is not the resent request's policy", () => {
    expect(headingOnlyOnFile("Late Opening", T2, history)).toBe(true);
    expect(headingOnlyOnFile("Attendance", T2, history)).toBe(true);
  });

  it("a heading the manager names is kept, even when it is also on file", () => {
    expect(headingOnlyOnFile("Late Opening", "make a ca for Briony Calloway for late opening on 11/13", history)).toBe(false);
    expect(headingOnlyOnFile("Late Opening", T2, [{ role: "user", content: "she was the late opening person again" }, ...history])).toBe(false);
  });

  it("a heading no On file listing names is not this guard's", () => {
    expect(headingOnlyOnFile("Dress Code for The Company", T2, history)).toBe(false);
    expect(headingOnlyOnFile("Late Opening", T2, [{ role: "assistant", content: "**Policy:** Late Opening, from what you described." }])).toBe(false);
  });

  it("a late opening the manager describes is theirs, even with Late Opening on file (Gate-Sunny-3, 14 Nov 2026)", () => {
    for (const said of [
      "ok CA for Briony Calloway, she opened the salon 25 minutes late on 11/12",
      "make it about her opening the salon 15 minutes late on 11/13 instead",
      "separate CA for Briony Calloway: she opened the salon 25 minutes late on 11/12",
      "change it to late openng",
    ]) {
      expect(headingOnlyOnFile("Late Opening", said, history, CHUNKS), said).toBe(false);
    }
  });

  it("the resent crewneck request carries no evidence for Late Opening or Attendance, with the manual's readers too", () => {
    expect(headingOnlyOnFile("Late Opening", T2, history, CHUNKS)).toBe(true);
    expect(headingOnlyOnFile("Attendance", T2, history, CHUNKS)).toBe(true);
  });
});
