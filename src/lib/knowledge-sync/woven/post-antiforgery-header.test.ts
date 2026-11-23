import { describe, expect, it } from "vitest";

import type { RunOutcome } from "../engine";
import { MemoryKnowledgeSink, MemoryKnowledgeSyncStore } from "../memory-store";
import { readWovenKnowledgeConfig, WOVEN_POST_ANTIFORGERY_HEADER_ENABLED_ENV, type WovenKnowledgeConfig } from "./config";
import { WovenKnowledgeConnector } from "./connector";
import { WovenTeamClient } from "./http";
import { runWovenKnowledgeSync, type WovenRunOutcome } from "./sync";
import { COMPANY, FakeWoven, PASSWORD, USERNAME, noSleep } from "./test-support";

/**
 * ============================================================================
 * WOVEN'S CONTENT LISTS ANSWER HTTP 400 FROM 19 NOV 2026 (port from the sibling app)
 * ============================================================================
 *
 * knowledge_sync_runs: from 19 Nov every POST list (handbook, procedure,
 * file_library, knowledge_element, course) failed with woven_bad_response,
 * while the GET policy list kept working; the last full sync that read them
 * all was on 12 Nov, and the sync code did not change between. Woven now checks
 * an anti-forgery token on content POSTs, which an ASP.NET JSON post sends in a
 * header; an empty 400 is how that check refuses. The wrapper below makes the
 * fake behave so: a content POST without a token its pages served, in
 * `RequestVerificationToken`, answers an empty 400.
 */

const CONFIG: WovenKnowledgeConfig = {
  enabled: true,
  baseUrl: "https://app.woven.team",
  company: COMPANY,
  credentials: { username: USERNAME, password: PASSWORD },
  missingCredentials: [],
  problems: [],
  previewTestModeAllowed: false,
};
const PAGE_TOKEN = "fixture-page-token";
const CONTENT_POST = /^\/(KnowledgeCenter|FileLibrary|KnowledgeElement|Course)\//;
const POST_LISTED = ["handbook", "procedure", "file_library", "knowledge_element", "course"];

/** The fake as Woven answers from 19 Nov 2026 (`check`), or as before. */
function woven(check: boolean): { fake: FakeWoven; fetch: typeof fetch } {
  const fake = new FakeWoven();
  /* The tokens the pages served (the fake's own, or the one added below). */
  const served = new Set<string>();
  const fetchWithCheck: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    if (check && method === "POST" && CONTENT_POST.test(url.pathname) && !served.has(new Headers(init?.headers).get("RequestVerificationToken") ?? "")) {
      return new Response("", { status: 400 });
    }
    const response = await fake.fetch(input, init);
    if (!check || method !== "GET" || response.status !== 200 || !(response.headers.get("content-type") ?? "").includes("html") || url.pathname.toLowerCase().startsWith("/login")) return response;
    const text = await response.text();
    const own = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(text)?.[1];
    if (own) {
      served.add(own);
      return new Response(text, { status: 200, headers: response.headers });
    }
    served.add(PAGE_TOKEN);
    const token = `<input name="__RequestVerificationToken" type="hidden" value="${PAGE_TOKEN}">`;
    return new Response(text.includes("</body>") ? text.replace("</body>", `${token}</body>`) : `${text}${token}`, { status: 200, headers: response.headers });
  };
  return { fake, fetch: fetchWithCheck };
}

async function preview(check: boolean, antiforgeryHeader: boolean) {
  const { fake, fetch } = woven(check);
  const clock = new Date("2026-11-23T12:00:00Z");
  const connector = new WovenKnowledgeConnector({
    client: new WovenTeamClient({ baseUrl: CONFIG.baseUrl, fetch, sleep: noSleep, transport: { minIntervalMs: 0, baseBackoffMs: 0 }, antiforgeryHeader }),
    credentials: CONFIG.credentials!,
    company: COMPANY,
  });
  const outcome: WovenRunOutcome = await runWovenKnowledgeSync(
    { mode: "preview", trigger: "manual", requestedBy: "admin:test" },
    { config: { ...CONFIG, postAntiforgeryHeader: antiforgeryHeader }, store: new MemoryKnowledgeSyncStore({ now: () => clock }), sink: new MemoryKnowledgeSink(), connector, now: () => clock },
  );
  if (!("report" in outcome)) throw new Error(`no report: ${JSON.stringify(outcome)}`);
  const report = (outcome as Extract<RunOutcome, { report: unknown }>).report as unknown as { byType: Record<string, { listing: string; discovered: number }> };
  return { fake, byType: report.byType };
}

const listings = (byType: Record<string, { listing: string }>) => Object.fromEntries(Object.entries(byType).map(([type, entry]) => [type, entry.listing]));

describe("Woven's content lists answer HTTP 400 from 19 Nov 2026", () => {
  it("the switch is WOVEN_POST_ANTIFORGERY_HEADER_ENABLED, off by default", () => {
    expect(readWovenKnowledgeConfig({}).postAntiforgeryHeader).toBe(false);
    expect(readWovenKnowledgeConfig({ [WOVEN_POST_ANTIFORGERY_HEADER_ENABLED_ENV]: "true" }).postAntiforgeryHeader).toBe(true);
  });

  it("switch off (production today): every POST list fails as the runs recorded; the policy list still reads", async () => {
    const { byType } = await preview(true, false);
    for (const type of POST_LISTED) expect(byType[type]?.listing, type).toBe("failed");
    expect(byType.policy?.listing).toBe("ok");
  });

  it("switch on: every list reads, with the same items as before the check", async () => {
    const before = await preview(false, false);
    const after = await preview(true, true);
    expect(listings(after.byType)).toEqual(listings(before.byType));
    for (const type of Object.keys(before.byType)) expect(after.byType[type]?.discovered, type).toBe(before.byType[type]?.discovered);
  });
});
