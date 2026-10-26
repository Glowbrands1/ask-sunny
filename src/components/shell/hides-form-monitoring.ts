"use client";

import { asdNoFormMonitoringEnabled } from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";

/**
 * ASD_NO_FORM_MONITORING: whether this reader is kept out of Form Monitoring,
 * so search offers neither the screen nor the form hits that open it. Always
 * false with the flag off. Salon names are not touched (see
 * `global-search-scope.test.ts`).
 */
export function useHidesFormMonitoring(): boolean {
  const { can } = useSession();
  return asdNoFormMonitoringEnabled() && !can("view_form_monitoring");
}
