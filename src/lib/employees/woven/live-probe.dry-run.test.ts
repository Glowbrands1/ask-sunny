import { describe, expect, it } from "vitest";

import { readWovenConfig } from "./config";
import { runWovenLiveValidation } from "./validate";

/**
 * ============================================================================
 * LIVE WOVEN CHECK FROM A TERMINAL — READ ONLY
 * ============================================================================
 *
 * The same check as the admin screen's "Run read-only check" button
 * (`validate.ts`), for running from a developer's machine. Skipped unless
 * WOVEN_LIVE_PROBE=1.
 *
 * Put the credentials in the SHELL, not in a file that could be committed,
 * and not on the command line where they would land in shell history:
 *
 *   read -rs WOVEN_SUBSCRIPTION_KEY && export WOVEN_SUBSCRIPTION_KEY
 *   read -r  WOVEN_USERNAME         && export WOVEN_USERNAME
 *   read -rs WOVEN_PASSWORD         && export WOVEN_PASSWORD
 *   WOVEN_LIVE_PROBE=1 npm run probe:woven
 *
 * Writes nothing to Woven and nothing to Supabase, and needs no Supabase at
 * all. Prints the report: counts, KEY NAMES, status values, email DOMAINS and
 * findings — never an employee record, id, name, email, or a credential.
 */

const enabled = process.env.WOVEN_LIVE_PROBE === "1";

describe.skipIf(!enabled)("live Woven check (read-only)", () => {
  it("validates the Operations API against contract.ts", { timeout: 600_000 }, async () => {
    const config = readWovenConfig();
    expect(config.missingCredentials, "credential variables missing").toEqual([]);

    const report = await runWovenLiveValidation({ config });
    console.log(JSON.stringify(report, null, 2));
    expect(report.token.ok, "sign-in").toBe(true);
  });
});
