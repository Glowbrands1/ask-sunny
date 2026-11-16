import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { unwrapReplyEnvelope } from "./run";

/** QA's live finding (16 Nov 2026, conv_mwin8fc82kk8c7i): the reply shown was the response object as JSON. */
const SAID = "This looks like a coaching topic but I need to know who it's for. Who is this Coaching Form for?";

describe("unwrapReplyEnvelope: never JSON to a manager", () => {
  it("a response object as the whole text is its content, bare, fenced or in the streamed shape", () => {
    expect(unwrapReplyEnvelope(JSON.stringify({ content: SAID, citations: [], coverage: "not_applicable", recommendedVideoIds: [] }))).toBe(SAID);
    expect(unwrapReplyEnvelope(`\`\`\`json\n${JSON.stringify({ content: SAID, citations: [] }, null, 2)}\n\`\`\``)).toBe(SAID);
    expect(unwrapReplyEnvelope(`  ${JSON.stringify({ status: 200, body: { content: SAID } })}  `)).toBe(SAID);
  });

  it("any other text is left alone: a plain reply, a reply with braces, JSON with no string content, broken JSON", () => {
    expect(unwrapReplyEnvelope(SAID)).toBeNull();
    expect(unwrapReplyEnvelope("Type the name as {first} {last}, and I'll look them up.")).toBeNull();
    expect(unwrapReplyEnvelope(JSON.stringify({ content: 3 }))).toBeNull();
    expect(unwrapReplyEnvelope(JSON.stringify({ content: "  " }))).toBeNull();
    expect(unwrapReplyEnvelope('{"content": "unfinished')).toBeNull();
    expect(unwrapReplyEnvelope("")).toBeNull();
  });
});
