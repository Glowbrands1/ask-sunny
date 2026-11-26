import "server-only";

import {
  liveWovenAddressDeps,
  WOVEN_EXIT_ADDRESS_BUDGET_MS,
  withinBudget,
  wovenAddressLine,
  type WovenExitAddressDeps,
} from "@/lib/forms/exit-woven-address";

/**
 * THE EMPLOYEE DIRECTORY'S "SHOW HOME ADDRESS" (Pau, 26 Nov 2026, approved by Curt; admins only —
 * `home-address-access.ts`). One employee's `Address` from their Woven details, read live when an admin asks, and
 * returned to that admin. Nothing is stored or logged but the outcome.
 *
 *   found        a street and a city were on Woven's record
 *   none         Woven answered, and has no address for this person
 *   unavailable  no credentials, no such directory row, an error or a slow answer — try again later
 */
export type HomeAddressLookup = { status: "found"; address: string } | { status: "none" } | { status: "unavailable" };

export type HomeAddressLookupDeps = Pick<WovenExitAddressDeps, "wovenIdOf" | "readDetails">;

export async function lookUpWovenHomeAddress(directoryId: string, deps?: HomeAddressLookupDeps): Promise<HomeAddressLookup> {
  try {
    const result = await withinBudget(
      (async (): Promise<HomeAddressLookup> => {
        const live = deps ?? (await liveWovenAddressDeps());
        if (!live) return { status: "unavailable" };
        const wovenId = await live.wovenIdOf(directoryId);
        if (!wovenId) return { status: "unavailable" };
        const address = wovenAddressLine(await live.readDetails(wovenId));
        return address ? { status: "found", address } : { status: "none" };
      })(),
      WOVEN_EXIT_ADDRESS_BUDGET_MS,
    );
    return result ?? { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
