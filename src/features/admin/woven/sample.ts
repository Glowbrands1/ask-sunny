import "server-only";

import { isDemoMode, isProductionDeployment } from "@/lib/config/runtime";
import { demoRuntime } from "@/lib/demo/runtime";
import type { WovenSampleDataset } from "@/lib/employees/woven/view-types";

/**
 * ============================================================================
 * THE WOVEN SAMPLE DATA GATE — three locks, and the first is the build
 * ============================================================================
 *
 *   1. THE BUILD. The sample set lives behind the demo boundary
 *      (`lib/demo/runtime.demo.ts` → `data/demo/woven.ts`). A production build
 *      compiles `lib/demo/runtime.ts`, whose `loadWovenSample()` returns null
 *      and names no sample record — so the data is not in the bundle for any
 *      setting to reveal.
 *   2. DEMO MODE. Even a demo build shows it only while `isDemoMode()` is on.
 *   3. NEVER ON VERCEL PRODUCTION. A deployment Vercel built for Production
 *      never shows it, whatever else is set — including the deliberate
 *      demo-in-production escape hatch.
 *
 * While it is shown, the screens read NOTHING from Supabase, write nothing,
 * disable every action, and carry a "Sample data — not from Woven" banner.
 * Sample rows are never written to any table.
 */
export async function wovenSampleForThisDeployment(): Promise<WovenSampleDataset | null> {
  if (isProductionDeployment()) return null;
  if (process.env.VERCEL_ENV === "production") return null;
  if (!isDemoMode()) return null;
  return demoRuntime.loadWovenSample();
}
