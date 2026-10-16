import type { GbpClient } from "./client";
import { discoverMappings, type LocationDiscovery, type LocationProposal } from "./locations";
import type { GbpStore } from "./store";

/**
 * ASK GOOGLE WHICH LOCATIONS THE CONNECTED ACCOUNT CAN SEE, and propose a
 * mapping for each Sun Tan City listing. Read-only: three kinds of GET, and
 * nothing is written. Used by the admin screen's automatic discovery and by the
 * confirm actions, which re-run it so a confirmation is always judged on fresh
 * evidence, never on what a browser says it saw earlier.
 */

export interface DiscoveryResult extends LocationDiscovery {
  accounts: { name: string; accountName: string | null; type: string | null; locations: number }[];
  /** Every proposal carries the account that holds its location. */
  proposals: (LocationProposal & { accountName: string })[];
}

export async function discoverFromGoogle(client: GbpClient, store: GbpStore): Promise<DiscoveryResult> {
  const listings = await store.readListings();
  const accounts = await client.listAccounts();

  const found: { accountName: string; location: Awaited<ReturnType<GbpClient["listLocations"]>>[number] }[] = [];
  const summary: DiscoveryResult["accounts"] = [];
  for (const account of accounts) {
    const locations = await client.listLocations(account.name);
    summary.push({ name: account.name, accountName: account.accountName ?? null, type: account.type ?? null, locations: locations.length });
    for (const location of locations) found.push({ accountName: account.name, location });
  }

  const discovery = discoverMappings(
    found.map((f) => f.location),
    listings,
  );
  const owner = new Map(found.map((f) => [f.location.name, f.accountName] as const));

  return {
    ...discovery,
    accounts: summary,
    proposals: discovery.proposals.map((p) => ({ ...p, accountName: owner.get(p.googleLocationName) ?? "" })),
  };
}
