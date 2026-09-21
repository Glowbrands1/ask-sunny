"use client";

import { Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import { DEMO_INTEGRATIONS } from "@/data/demo/integrations";
import type { Integration } from "@/types";

import { IntegrationCard } from "./integration-card";

/**
 * ============================================================================
 * THE INTEGRATION ROADMAP — DEMO ONLY, AND A DEMO-ONLY DOWNLOAD
 * ============================================================================
 *
 * A list of tools the product intends to connect to. Worth being precise
 * about what is and is not wrong with it: these are NOT fabricated statuses.
 * Every card honestly reports "Not connected", which is true.
 *
 * What makes it demo content is the framing. A roadmap rendered as status
 * cards, on an administration screen, beside the genuine `/api/health` panel,
 * invites an administrator to read "Microsoft SharePoint — Not connected" as a
 * finding about their own tenancy rather than as a plan. The two are
 * indistinguishable at a glance, and only one of them is about this
 * deployment.
 *
 * ITS OWN MODULE SO IT IS NOT SHIPPED. The parent keeps everything real — the
 * service-status panel, the Google Reviews source screen, and the browser
 * storage card whose status is measured — and a static import would have made
 * it carry seven seeded entries, plus the fabricated AI spend figures sharing
 * that file, to do so.
 */
export function IntegrationsRoadmapDemo({
  onOpen,
}: {
  onOpen: (integration: Integration) => void;
}) {
  const pending = DEMO_INTEGRATIONS.filter(
    (integration) => integration.status !== "connected",
  );

  return (
    <>
      <Notice tone="neutral" icon={<Info />} className="mb-6">
        The list below is the integration roadmap. Exactly one item is connected
        today: the browser storage that makes uploads and saved forms survive a
        refresh. Everything else honestly reports &ldquo;Not connected&rdquo;.
      </Notice>

      <SectionHeader
        title="Available to connect"
        description="Each one needs an account, access, or credentials that the client will provide."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pending.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  );
}
