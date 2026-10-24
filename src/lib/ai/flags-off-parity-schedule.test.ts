import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The flags-off child used to start while the main suite was still running.
 * Two copies of the chat and form tests then shared the machine, and tests
 * with the default 5s timeout failed. The child is a later Vitest project.
 */
describe("flags-off parity runs after the rest of the suite", () => {
  const config = readFileSync("vitest.config.mts", "utf8");
  const child = readFileSync("src/lib/ai/flags-off-parity.test.ts", "utf8");

  it("keeps the nested suite in a project that starts after the unit project", () => {
    const unit = config.indexOf('name: "unit"');
    const parity = config.indexOf('name: "flags-off-parity"');
    expect(unit).toBeGreaterThan(-1);
    expect(parity).toBeGreaterThan(unit);
    expect(config.slice(unit, parity)).toContain("groupOrder: 0");
    expect(config.slice(unit, parity)).toContain("src/lib/ai/flags-off-parity.test.ts");
    expect(config.slice(parity)).toContain("groupOrder: 1");
    expect(config.slice(parity)).toContain('include: ["src/lib/ai/flags-off-parity.test.ts"]');
  });

  it("tells the nested Vitest to stay on the unit project with two workers", () => {
    expect(child).toContain('"--project"');
    expect(child).toContain('"unit"');
    expect(child).toContain('"--maxWorkers=2"');
  });
});
