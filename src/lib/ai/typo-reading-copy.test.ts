import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nameWords, withTypoReadingCopy } from "./typo-reading-copy";
import type { AskRequest } from "./types";

const FLAG = "TYPO_READING_COPY_ENABLED";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[FLAG];
  process.env[FLAG] = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function ask(question: string, history: AskRequest["history"] = []): AskRequest {
  return { question, history } as unknown as AskRequest;
}

describe("withTypoReadingCopy", () => {
  it("reads the variation report's typos as the words they can only be", () => {
    const read = withTypoReadingCopy(ask("she was coahed about it and the amont was $25, she is a Manger"), new Set());
    expect(read.question).toBe("she was coached about it and the amount was $25, she is a manager");
  });

  it("reads the manager's earlier turns too, never the assistant's", () => {
    const read = withTypoReadingCopy(
      ask("ok", [
        { role: "user", content: "she gave her notcie" },
        { role: "assistant", content: "notcie" },
      ] as AskRequest["history"]),
      new Set(),
    );
    expect(read.history[0]!.content).toBe("she gave her notice");
    expect(read.history[1]!.content).toBe("notcie");
  });

  it("never corrects an employee's name", () => {
    // "Notise Varnell" is invented; "notise" is one letter from "notice".
    const names = nameWords([{ firstName: "Notise", lastName: "Varnell", preferredFirstName: null }]);
    const read = withTypoReadingCopy(ask("create a ca for notise varnell"), names);
    expect(read.question).toBe("create a ca for notise varnell");
  });

  it("leaves numbers, dates and short words alone", () => {
    const request = ask("late on 10/20 by 15 mins, $25");
    expect(withTypoReadingCopy(request, new Set())).toBe(request);
  });

  it("corrects nothing when the directory could not be read", () => {
    const request = ask("she was coahed");
    expect(withTypoReadingCopy(request, new Set(["*"]))).toBe(request);
  });

  it("off: the request as given", () => {
    delete process.env[FLAG];
    const request = ask("she was coahed");
    expect(withTypoReadingCopy(request, new Set())).toBe(request);
  });
});
