import type { Integration } from "@/types";

/**
 * ============================================================================
 * THE INTEGRATION THAT IS REAL — PRODUCTION CONFIGURATION
 * ============================================================================
 *
 * Browser storage. It describes a genuine capability of the running app, and
 * unlike every other entry on the Integrations screen its status is MEASURED
 * rather than declared: the screen overrides `status` from `storageAvailable`,
 * which is the store reporting whether IndexedDB actually works here.
 *
 * WHY IT MOVED OUT OF `data/demo/integrations.ts`. It was the one connected
 * entry in a list of seven, the other six being a roadmap. Keeping it there
 * meant the screen imported the whole seeded list — and the fabricated AI
 * spend figures in the same file — to render one real card.
 */
export const BROWSER_STORAGE_INTEGRATION: Integration = {
  id: "int-local-storage",
  name: "Local prototype storage",
  vendor: "Browser (IndexedDB)",
  description:
    "Stores uploaded documents, generated forms, and settings in this browser so work survives a refresh.",
  status: "connected",
  unlocks: "Working uploads and persistence with no server, database, or account.",
  category: "storage",
  iconKey: "hard-drive",
  notes:
    "Browser-local. The system of record for live data is Supabase; this holds local UI state.",
};
