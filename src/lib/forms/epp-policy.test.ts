import { describe, expect, it } from "vitest";

import {
  EPP_POLICY_RULES,
  EPP_POLICY_TOPICS,
  eppPolicyBlock,
  eppPolicyPassages,
  eppPolicyReference,
  eppPolicyTopics,
} from "./epp-policy";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * THE JBA MANUAL IS THE ONLY POLICY SOURCE, AND IT ANSWERS BY SECTION
 * ============================================================================
 *
 * The chunks below are the REAL SHAPE of the indexed JB & Associates Employment
 * Policy Manual — the headings it prints, on the pages it prints them, in the
 * `metadata.sections` form ingestion writes. Every page number here was read
 * off the live corpus rather than invented, which is what makes "Attendance is
 * page 14" a checkable claim rather than a number in a test.
 */
function chunk(
  chunkIndex: number,
  page: number,
  sections: { heading: string; page: number }[],
  content: string,
): ManualChunk {
  return { chunkIndex, page: page + 1, printedPage: page, sections, content };
}

const JBA_CHUNKS: ManualChunk[] = [
  chunk(0, 1, [], "JB & Associates Employment Policy Manual. Revised May 2025."),
  chunk(
    1,
    2,
    [{ heading: "Table of Contents", page: 2 }],
    "Table of Contents\nAttendance ..... 14\nStandards of Conduct ..... 12\nBonus Policy ..... 38",
  ),
  chunk(
    2,
    7,
    [{ heading: "Our Culture", page: 7 }],
    "Our Culture\nWe expect every employee to contribute to a positive, professional environment for clients and for each other.",
  ),
  chunk(
    3,
    12,
    [{ heading: "Standards of Conduct", page: 12 }],
    "Standards of Conduct\nThe following infractions may result in disciplinary action up to and including termination.",
  ),
  chunk(
    4,
    14,
    [
      { heading: "Disciplinary Action", page: 14 },
      { heading: "Attendance", page: 14 },
    ],
    "Disciplinary Action\nDiscipline is administered according to the circumstances.\nAttendance\nEmployees are expected to know their schedule and always be on time and ready to work.",
  ),
  chunk(
    5,
    15,
    [
      { heading: "Late Opening", page: 15 },
      { heading: "Texting as General Work communications", page: 15 },
    ],
    "Late Opening\nA location that opens late costs the company business.\nTexting as General Work communications\nText is not a substitute for speaking with your manager.",
  ),
  chunk(
    6,
    25,
    [{ heading: "Safety in the Workplace", page: 25 }],
    "Safety in the Workplace\nEvery employee is responsible for following safe working practices.",
  ),
  chunk(
    7,
    36,
    [{ heading: "Time Records", page: 36 }],
    "Time Records\nEmployees record their own time accurately at the start and end of every shift.",
  ),
  chunk(
    8,
    37,
    [
      { heading: "Schedule Requests/General availability Changes", page: 37 },
      { heading: "Shift Replacement", page: 37 },
    ],
    "Schedule Requests/General availability Changes\nRequests are submitted in advance.\nShift Replacement\nAn employee who cannot work a scheduled shift is responsible for arranging cover.",
  ),
  chunk(
    9,
    38,
    [{ heading: "Bonus Policy", page: 38 }],
    "Bonus Policy\nBonus is earned against the published targets for the period.",
  ),
];

const headings = (text: string) =>
  eppPolicyPassages({ chunks: JBA_CHUNKS, topics: eppPolicyTopics(text) }).map(
    (passage) => passage.section.heading,
  );

/* ==================================================== reading the topic == */

describe("the topic comes from what the manager actually reported", () => {
  it("reads punctuality out of an ordinary sentence about lateness", () => {
    expect(eppPolicyTopics("She's been late several times this month").map((t) => t.key)).toEqual([
      "punctuality",
    ]);
  });

  it("reads several topics when the manager raised several", () => {
    const keys = eppPolicyTopics(
      "Great with clients, but she has called off twice without telling anyone.",
    ).map((topic) => topic.key);
    expect(keys).toContain("call_off");
    expect(keys).toContain("client_experience");
  });

  it("raises nothing at all for an observation the manual has no policy for", () => {
    /*
     * THE CASE THE WHOLE FILE EXISTS FOR. "Not enough initiative" is a fair
     * thing for a manager to think and a fair thing to coach on, and there is
     * no JBA policy about initiative. No topic means no section, which means
     * no citation and no claim — see the reference test below.
     */
    expect(eppPolicyTopics("She doesn't have enough initiative")).toEqual([]);
    expect(eppPolicyTopics("I'd like to see more confidence from her")).toEqual([]);
  });

  it("does not raise the disciplinary section unless the manager named a formal step", () => {
    // An EPP is a development document. The manual's Disciplinary Action
    // section arrives only when the manager has raised one themselves.
    expect(eppPolicyTopics("She's been late several times").map((t) => t.key)).not.toContain(
      "corrective_history",
    );
    expect(
      eppPolicyTopics("She had a written warning for this in June").map((t) => t.key),
    ).toContain("corrective_history");
  });
});

/* ================================================= resolving the section == */

describe("a topic resolves to the section the JBA manual actually prints", () => {
  it("sends punctuality to Attendance, Time Records and Late Opening", () => {
    expect(headings("Paulyne needs to improve her punctuality")).toEqual([
      "Attendance",
      "Time Records",
      "Late Opening",
    ]);
  });

  it("sends a call-off to Attendance, Shift Replacement and the texting policy", () => {
    expect(headings("She called off on Saturday and nobody heard from her")).toEqual([
      "Attendance",
      "Shift Replacement",
      "Texting as General Work communications",
    ]);
  });

  it("sends a schedule-communication problem to the schedule and cover sections", () => {
    expect(headings("She keeps changing her availability at the last minute")).toContain(
      "Schedule Requests/General availability Changes",
    );
    expect(headings("She keeps changing her availability at the last minute")).toContain(
      "Shift Replacement",
    );
  });

  it("sends a general performance concern to Standards of Conduct", () => {
    expect(headings("Her closing duties are not being completed")).toContain(
      "Standards of Conduct",
    );
  });

  it("sends client service to the culture section, and safety to the safety section", () => {
    expect(headings("She's excellent with clients")).toContain("Our Culture");
    expect(headings("She left a chemical spill unattended")).toContain("Safety in the Workplace");
  });

  it("cites the page the MANUAL prints, not the PDF sheet", () => {
    const passages = eppPolicyPassages({
      chunks: JBA_CHUNKS,
      topics: eppPolicyTopics("she has been late"),
    });
    expect(passages[0]!.section.page).toBe(14);
    expect(passages.find((p) => p.section.heading === "Time Records")!.section.page).toBe(36);
  });

  it("never cites a section twice, however many topics point at it", () => {
    const passages = eppPolicyPassages({
      chunks: JBA_CHUNKS,
      topics: eppPolicyTopics("She is late and she calls off without telling anyone"),
    });
    const cited = passages.map((passage) => passage.section.heading);
    expect(new Set(cited).size).toBe(cited.length);
  });

  it("fails closed where the manual does not state the section", () => {
    // A manual with no Attendance sheet cites nothing for punctuality rather
    // than reaching for the nearest heading it does have.
    const thin = JBA_CHUNKS.filter((entry) => entry.printedPage !== 14 && entry.printedPage !== 36 && entry.printedPage !== 15);
    expect(
      eppPolicyPassages({ chunks: thin, topics: eppPolicyTopics("she has been late") }),
    ).toEqual([]);
  });
});

/* ====================================================== what gets printed == */

describe("the reference line, and what it refuses to say", () => {
  it("names the manual, its sections and their pages, and composes nothing", () => {
    const passages = eppPolicyPassages({
      chunks: JBA_CHUNKS,
      topics: eppPolicyTopics("she has been late"),
    });
    expect(eppPolicyReference("JBA Policy Manual Edited 5.2025", passages)).toBe(
      "JBA Policy Manual — Attendance — Page 14; Time Records — Page 36; Late Opening — Page 15",
    );
  });

  it("is null when nothing resolved, so the line stays blank", () => {
    expect(eppPolicyReference("JBA Policy Manual Edited 5.2025", [])).toBeNull();
  });

  it("puts only the retrieved sections in front of the model, never the manual", () => {
    const passages = eppPolicyPassages({
      chunks: JBA_CHUNKS,
      topics: eppPolicyTopics("she has been late"),
    });
    const block = eppPolicyBlock("JBA Policy Manual Edited 5.2025", passages);

    expect(block).toContain("Attendance — Page 14");
    expect(block).toContain("always be on time");
    // Sections nobody raised stay out of the prompt entirely.
    expect(block).not.toContain("Bonus Policy");
    expect(block).not.toContain("Safety in the Workplace");
    expect(eppPolicyBlock("JBA Policy Manual Edited 5.2025", [])).toBe("");
  });
});

/* ============================================================ the source == */

describe("the authoritative manual is the JBA one, and there is no other", () => {
  it("names no other policy manual anywhere in the topic map or the rules", () => {
    /*
     * THE LEGACY MANUAL IS NOT A SOURCE HERE. Ask Sunny cannot read it, so a
     * reference to it would be a citation of a document nobody checked.
     */
    const serialized = JSON.stringify([
      EPP_POLICY_TOPICS.map((topic) => ({ key: topic.key, headings: topic.headings })),
      EPP_POLICY_RULES,
    ]);
    expect(serialized.toLowerCase()).not.toContain("driven to shine");
    expect(serialized.toLowerCase()).not.toContain("driven-to-shine");
  });

  it("states the five-way separation the plan has to keep", () => {
    const rules = EPP_POLICY_RULES.join(" ").toLowerCase();
    for (const word of ["observed", "policy", "expectation", "coaching", "productivity"]) {
      expect(rules, word).toContain(word);
    }
    // And that a plan is not a warning.
    expect(rules).toContain("not a warning");
  });
});
