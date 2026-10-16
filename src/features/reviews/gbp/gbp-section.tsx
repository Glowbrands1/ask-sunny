import { Notice } from "@/components/ui/feedback";
import { readApifySourceStatus } from "@/lib/reviews/apify/status";
import { apifyGlance, loadGbpOverview } from "@/lib/reviews/gbp/overview-load";

import { GbpManager } from "./gbp-manager";

/** Server wrapper: reads the overview (no Google call, no secret) and hands it to the client island. */
export async function GbpSection({ flash }: { flash?: string | null }) {
  const overview = await loadGbpOverview(apifyGlance(await readApifySourceStatus())).catch(() => null);
  if (overview) return <GbpManager initial={overview} flash={flash} />;
  {
    return (
      <div className="px-5 pt-5 sm:px-6">
        <Notice tone="attention" title="Google Business Profile status could not be read">
          <p>Reload the page. The Apify source below is unaffected.</p>
        </Notice>
      </div>
    );
  }
}
