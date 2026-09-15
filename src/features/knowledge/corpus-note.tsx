import { Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";

/**
 * ============================================================================
 * WHAT THE SEEDED CORPUS IS — IN THE DEMO BUILD, AND ONLY THERE
 * ============================================================================
 *
 * THE 15 SEPTEMBER PRODUCTION QA found this note on the LIVE Knowledge screen,
 * printed above 57 of the customer's own documents with 56 indexed. Every
 * clause of it is a statement about the demo build: a "seeded set", a corpus
 * that "mirrors" the real one, and a "prototype" with no SharePoint or Woven
 * sync. Read over a real library it tells a Salon Director their knowledge base
 * is not real content.
 *
 * NOT DELETED, because it is true and useful in the demo build, where somebody
 * being shown the product should know the corpus is seeded and why it is only
 * part of the Woven library.
 *
 * A COMPONENT RATHER THAN AN INLINE TERNARY, so the rule "live mode says
 * nothing here" is a thing a test can hold rather than a condition somebody has
 * to notice while editing the screen around it.
 */
export function KnowledgeCorpusNote({
  live,
  className,
}: {
  /** True in a live deployment; false in the seeded demo build. */
  live: boolean;
  className?: string;
}) {
  if (live) return null;

  return (
    <Notice tone="neutral" icon={<Info />} className={className ?? "mt-8"}>
      <p className="font-semibold text-foreground">About this corpus</p>
      <p className="mt-1">
        The seeded set mirrors the focused corpus in use today — roughly 58
        documents across 10 libraries — rather than the full Woven library (600+
        documents, much of it maintenance and SDS material that should not be
        ingested). SharePoint and Woven sync are not connected in this prototype.
      </p>
    </Notice>
  );
}
