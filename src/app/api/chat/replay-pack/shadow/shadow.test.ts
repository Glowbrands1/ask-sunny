import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { packRoster, packScope, readShadowInput, readShadowRoster, replyLine, scriptedStandIn, shadowCases } from "./shadow";

/* The shadow replay's own pieces, on the INVENTED self-test conversations (scripts/agent-loop-shadow/selftest-input.jsonl). */
const INPUT = join(process.cwd(), "scripts/agent-loop-shadow/selftest-input.jsonl");
const ROSTER = join(process.cwd(), "scripts/agent-loop-shadow/selftest-roster.json");

describe("the shadow replay of the agent loop (dev harness)", () => {
  it("reads one conversation per line, SHADOW_LIMIT keeping the first n", () => {
    const shared = readShadowRoster(ROSTER);
    expect(readShadowInput(INPUT, 0, shared).map((row) => row.conv)).toEqual(["selftest-ca", "selftest-coaching", "selftest-off-roster"]);
    expect(readShadowInput(INPUT, 2, shared)).toHaveLength(2);
    expect(shadowCases(INPUT, undefined, 1, ROSTER).map((entry) => entry.id)).toEqual(["shadow-selftest-ca"]);
  });

  it("a line with no roster uses the shared one (SHADOW_ROSTER), and needs one", () => {
    const shared = readShadowRoster(ROSTER)!;
    expect(readShadowInput(INPUT, 0, shared)[2]!.roster).toEqual(shared);
    expect(() => readShadowInput(INPUT, 0, null)).toThrow(/selftest-input\.jsonl:3: needs .*SHADOW_ROSTER/);
  });

  it("maps the manager's scope and roster to the replay pack's", () => {
    const [first] = readShadowInput(INPUT, 0, readShadowRoster(ROSTER));
    expect(packScope({ role: "district_manager", level: "district", salonIds: ["loc-1", "loc-2"] })).toEqual({ level: "district", primaryAreaId: "loc-1", alsoCoversAreaIds: ["loc-2"] });
    expect(packRoster(first!.roster)[0]).toMatchObject({ firstName: "Odalys", employmentStatus: "active", salonIds: ["loc-0309"] });
  });

  it("reads a card line from a reply by its label", () => {
    expect(replyLine("x\n\n**Policy:** Attendance — read from this request.\n", "Policy")).toBe("Attendance — read from this request.");
    expect(replyLine("no card here", "Policy")).toBeNull();
  });

  it("the scripted stand-in never states a level or a date that was not typed", () => {
    const [first] = readShadowInput(INPUT, 0, readShadowRoster(ROSTER));
    const decide = scriptedStandIn(first!.roster);
    const view = (text: string, results: { tool: string; output: Record<string, unknown> }[] = []) => ({ system: "", turns: [{ role: "user" as const, text }], results, step: results.length });
    expect(decide(view("ca for Odalys Brackwen, late"))).toEqual({ tool: "find_staff", input: { name: "Odalys Brackwen" } });
    const proposed = decide(view("ca for Odalys Brackwen, late", [{ tool: "find_staff", output: { matches: [{ employee_id: "e-shadow-1", name: "Odalys Brackwen" }] } }]));
    expect(proposed).toMatchObject({ tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-shadow-1" } });
    expect((proposed as { input: Record<string, unknown> }).input).not.toHaveProperty("warning_level");
    expect((proposed as { input: Record<string, unknown> }).input).not.toHaveProperty("incident_date");
    expect(decide(view("ca for somebody else"))).toEqual({ text: "Who is this form for?" });
  });
});
