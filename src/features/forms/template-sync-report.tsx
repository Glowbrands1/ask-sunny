import { Notice } from "@/components/ui/feedback";
import type { LibrarySeedResult } from "@/lib/forms/repository";

/**
 * WHAT THE TEMPLATE SYNC DID ON THIS VISIT, SAID TO THE ADMINISTRATOR.
 *
 * Opening Forms → Form Templates runs the sync (`ensureTemplateLibrary`). Its
 * result used to be thrown away, so a run that published a new version, held a
 * template back or failed looked identical to one that did nothing. This
 * reports all of it: installed, revised (a new version published, the old one
 * archived), renamed, held back (an administrator authored a version or has a
 * draft open, so the code did not publish over it), failed (with a redacted
 * reason) and already up to date.
 *
 * Nothing here is a secret: keys are template keys and reasons were redacted
 * and truncated before they reached the result.
 *
 * A Preview's refusal has its own notice ("Template sync is off on this
 * deployment"); this component says nothing for a skipped run.
 */
export function TemplateSyncReport({ result }: { result: LibrarySeedResult }) {
  if (result.skipped) return null;

  const changed =
    result.created.length + result.revised.length + result.renamed.length;
  const needsAttention = result.failed.length > 0 || result.heldBack.length > 0;
  const tone = needsAttention ? "attention" : changed > 0 ? "accent" : "neutral";

  const summary = [
    result.created.length > 0 ? `${result.created.length} installed` : null,
    result.revised.length > 0 ? `${result.revised.length} revised` : null,
    result.renamed.length > 0 ? `${result.renamed.length} renamed` : null,
    result.heldBack.length > 0 ? `${result.heldBack.length} held back` : null,
    result.failed.length > 0 ? `${result.failed.length} failed` : null,
    `${result.existing.length} already up to date`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Notice tone={tone} title="Template library sync">
      <div className="space-y-1.5" data-testid="template-sync-report">
        <p>{summary}</p>
        {result.revised.length > 0 ? (
          <p>
            Revised, as a new published version with the previous one archived: {result.revised.join(", ")}.
          </p>
        ) : null}
        {result.created.length > 0 ? <p>Installed: {result.created.join(", ")}.</p> : null}
        {result.renamed.length > 0 ? <p>Name or description updated: {result.renamed.join(", ")}.</p> : null}
        {result.heldBack.length > 0 ? (
          <ul className="list-disc pl-5">
            {result.heldBack.map((entry) => (
              <li key={entry.key}>
                <strong>{entry.key}</strong> held back: {entry.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {result.failed.length > 0 ? (
          <>
            <p className="font-semibold">
              Failed. Nothing was repaired automatically; the same lines are in the server log.
            </p>
            <ul className="list-disc pl-5">
              {result.failed.map((entry) => (
                <li key={entry.key}>
                  <strong>{entry.key}</strong>: {entry.reason}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Notice>
  );
}
