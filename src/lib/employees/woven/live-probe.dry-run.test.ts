import { describe, expect, it } from "vitest";

import { extractPage, WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { EMPLOYEE_LIST_PASSES, FIELD, QUERY_SKIP, QUERY_STATUS, QUERY_TAKE } from "./contract";
import { MemoryDirectoryStore } from "./memory-store";
import { runWovenEmployeeSync } from "./sync";

/**
 * ============================================================================
 * LIVE WOVEN PROBE — READ ONLY, FOR THE DAY THE SUBSCRIPTION IS APPROVED
 * ============================================================================
 *
 * Skipped unless WOVEN_LIVE_PROBE=1. With the three credential variables set
 * in the shell (never in a file that is committed):
 *
 *   WOVEN_LIVE_PROBE=1 WOVEN_SYNC_ENABLED=true \
 *   WOVEN_SUBSCRIPTION_KEY=… WOVEN_USERNAME=… WOVEN_PASSWORD=… \
 *   npm run probe:woven
 *
 * WHAT IT DOES: the token exchange, a handful of GETs, and one DRY-RUN sync
 * against an in-memory directory. It writes nothing to Woven and nothing to
 * Supabase — it does not even need Supabase configured.
 *
 * WHAT IT PRINTS: the KEY NAMES Woven returns (so `contract.ts` can be checked
 * against reality), the distinct status VALUES, page-size behaviour, and the
 * dry run's counts, field coverage and issue codes. It never prints a name, an
 * email, an id, a date or any other field value.
 */

const enabled = process.env.WOVEN_LIVE_PROBE === "1";

function keysOf(records: unknown[], limit = 25): string[] {
  const keys = new Set<string>();
  for (const record of records.slice(0, limit)) {
    if (record && typeof record === "object" && !Array.isArray(record)) {
      for (const key of Object.keys(record)) keys.add(key);
    }
  }
  return [...keys].sort();
}

const MAPPED_KEYS = new Set<string>(Object.values(FIELD).flat());

describe.skipIf(!enabled)("live Woven probe (read-only)", () => {
  it("authenticates, reads, and dry-runs the sync", { timeout: 600_000 }, async () => {
    const config = readWovenConfig();
    expect(config.missingCredentials, "credential variables missing").toEqual([]);

    const client = new WovenClient({ baseUrl: config.baseUrl, credentials: config.credentials! });
    const report: Record<string, unknown> = { baseUrl: config.baseUrl };

    /* 1. One small page per pass: shape, keys, statuses, whether querytake is honoured. */
    for (const pass of EMPLOYEE_LIST_PASSES) {
      const body = await client.get("/employees", { [QUERY_STATUS]: pass.status, [QUERY_SKIP]: 0, [QUERY_TAKE]: 5 });
      const page = extractPage(body);
      const records = page?.items ?? [];
      const statuses: Record<string, number> = {};
      for (const r of records as Record<string, unknown>[]) {
        const s = FIELD.status.map((k) => r?.[k]).find((v) => typeof v === "string") as string | undefined;
        statuses[s ?? "(none)"] = (statuses[s ?? "(none)"] ?? 0) + 1;
      }
      const keys = keysOf(records);
      report[`pass_${pass.label}`] = {
        shape: Array.isArray(body) ? "array" : page ? "envelope" : "UNRECOGNISED",
        envelopeKeys: !Array.isArray(body) && body && typeof body === "object" ? Object.keys(body) : null,
        reportedTotal: page?.total ?? null,
        askedFor: 5,
        received: records.length,
        statusValues: statuses,
        keysReturned: keys,
        keysNotMappedByContract: keys.filter((k) => !MAPPED_KEYS.has(k)),
        contractKeysAbsent: Object.entries(FIELD)
          .filter(([, aliases]) => !aliases.some((a) => keys.includes(a)))
          .map(([field]) => field),
      };
    }

    /* 2. One details response: its keys and its Locations[] entry keys. */
    const firstList = extractPage(await client.get("/employees", { [QUERY_SKIP]: 0, [QUERY_TAKE]: 1 }));
    const first = firstList?.items[0] as Record<string, unknown> | undefined;
    const firstId = first ? FIELD.employeeId.map((k) => first[k]).find((v) => typeof v === "string" || typeof v === "number") : undefined;
    if (firstId !== undefined) {
      const details = (await client.getEmployeeDetails(String(firstId))) as Record<string, unknown>;
      const locations = Array.isArray(details?.Locations) ? details.Locations : Array.isArray(details?.locations) ? details.locations : null;
      report.details = {
        keysReturned: details && typeof details === "object" ? Object.keys(details).sort() : null,
        locationsArray: locations ? "present" : "ABSENT",
        locationEntryKeys: locations ? keysOf(locations) : null,
      };
    }

    /* 3. A full dry run against an empty in-memory directory. Writes nothing anywhere. */
    const outcome = await runWovenEmployeeSync({
      requestedBy: "live-probe",
      dryRun: true,
      config,
      store: new MemoryDirectoryStore(),
    });
    report.dryRun = outcome;

    console.log(JSON.stringify(report, null, 2));
    expect(outcome.status).toBe("succeeded");
  });
});
