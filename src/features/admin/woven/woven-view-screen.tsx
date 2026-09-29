import { Database } from "lucide-react";

import { EmptyState } from "@/components/ui/feedback";
import { PageShell } from "@/components/ui/layout";
import { parseChangeQuery, parseDirectoryQuery } from "@/lib/employees/woven/views";
import { AccessPreview } from "./access-preview";
import { ChangeFeed } from "./change-feed";
import { DirectoryTable } from "./directory-table";
import type { WovenViewProps } from "./load";
import { MappingReview } from "./mapping-review";
import { SyncHistory } from "./sync-history";
import { WovenHeader } from "./tabs";

/**
 * One Woven tab: the shared header, then the tab's content — or an honest
 * account of why it cannot be shown. "The migration has not been applied" and
 * "the database did not answer" are different facts and are said differently.
 *
 * ACTIONS ARE DISABLED on sample data, and in demo mode, where every route
 * behind them refuses by design.
 */

type Params = Record<string, string | string[] | undefined>;

export function WovenViewScreen({ props, params }: { props: WovenViewProps; params: Params }) {
  const actionsDisabled = props.sampleLabel !== null || !props.liveMode;
  const { content } = props;

  return (
    <PageShell>
      <WovenHeader current={props.view} sampleLabel={props.sampleLabel} />
      {content.state === "missing" ? (
        <EmptyState
          icon={<Database />}
          title="The Woven directory has not been created yet"
          description="The migration is prepared and is applied only with approval. Until then there is nothing to show here."
        />
      ) : content.state === "unavailable" ? (
        <EmptyState
          icon={<Database />}
          title="The Woven directory could not be read"
          description={`The database did not answer${content.code ? ` (${content.code})` : ""}. This is not the same as the directory being missing.`}
        />
      ) : content.state === "unconfigured" ? (
        <EmptyState icon={<Database />} title="Supabase is not configured for this deployment" description="The Woven directory lives in Supabase." />
      ) : content.data.view === "directory" ? (
        <DirectoryTable page={content.data.page} query={parseDirectoryQuery(params)} sample={props.sampleLabel !== null} />
      ) : content.data.view === "changes" ? (
        <ChangeFeed page={content.data.page} query={parseChangeQuery(params)} actionsDisabled={actionsDisabled} />
      ) : content.data.view === "runs" ? (
        <SyncHistory runs={content.data.runs} />
      ) : content.data.view === "mappings" ? (
        <MappingReview locations={content.data.locations} positions={content.data.positions} actionsDisabled={actionsDisabled} />
      ) : (
        <AccessPreview
          rows={content.data.rows}
          drift={content.data.drift}
          loginEmailDomains={content.data.loginEmailDomains}
          sampleRows={content.data.sampleRows}
          actionsDisabled={actionsDisabled}
        />
      )}
    </PageShell>
  );
}
