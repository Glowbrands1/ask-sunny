import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CASES } from "./index";

/** The pack reads every case file itself; this checks none is skipped and no id is used twice. */
describe("the replay pack's case files register themselves", () => {
  const files = readdirSync(path.join(process.cwd(), "src/app/api/chat/replay-pack")).filter((name) => name.endsWith("-cases.ts"));

  it("every case file is read", async () => {
    for (const file of files) {
      const exported = (await import(`./${file.replace(/\.ts$/, "")}`)) as Record<string, unknown>;
      const ids = Object.values(exported)
        .filter(Array.isArray)
        .flatMap((list) => (list as { id?: unknown }[]).map((entry) => entry.id))
        .filter((id): id is string => typeof id === "string");
      expect(ids.length, `${file} exports no case`).toBeGreaterThan(0);
      for (const id of ids) expect(CASES.map((entry) => entry.id), `${file}: ${id} is not in the pack`).toContain(id);
    }
  });

  it("no id is used twice", () => {
    const ids = CASES.map((entry) => entry.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });
});
