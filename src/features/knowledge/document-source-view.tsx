"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { isDemoMode } from "@/lib/config/runtime";
import { useAppStore } from "@/lib/store/app-store";
import type { KnowledgeDocument } from "@/types";
import { DocumentDetail } from "./document-detail";

/**
 * ============================================================================
 * ONE DOCUMENT, BECAUSE SUNNY CITED IT — NOT A WAY INTO THE LIBRARY
 * ============================================================================
 *
 * The Knowledge Base SCREEN is administrators-only: the inventory, the counts,
 * the processing and failure queues, upload, delete, re-index. That is
 * administration of the corpus.
 *
 * This is the other thing people were doing on that screen, and the reason
 * locking it would otherwise have broken Ask Sunny for everyone below Admin: a
 * citation under an answer is a promise that the quote came from somewhere, and
 * a citation nobody can open is a claim they have to take on trust. Every role
 * that can be given an answer can open the document behind it.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE, and why each absence is load-bearing:
 *
 *   NO LIST, and no route to one. The document is fetched BY ID — there is no
 *   call here that returns more than one, so this page cannot be used to
 *   discover what else the company holds. That is the whole distinction being
 *   drawn, and it is drawn in the data this component asks for rather than in
 *   what it chooses to render.
 *
 *   NO "back to the knowledge base" LINK. Offering one to somebody who will be
 *   redirected out of it is how a permission boundary gets reported as a broken
 *   link.
 *
 *   NO MANAGEMENT CONTROLS. `canManage={false}` is passed as a constant, not
 *   read from the session: upload, delete, re-index, retry and re-categorize
 *   are not decisions this page makes. The server refuses them independently —
 *   every one of those routes is behind the admin console now — so this is the
 *   UI agreeing with a boundary rather than being one.
 *
 * PREVIEW AND DOWNLOAD STAY. They run through the original-file route, which
 * asks for `view_knowledge` and always has. Somebody who may read the policy
 * through Sunny is not given anything new by being able to open the page it was
 * quoted from.
 */
/**
 * What one fetch settled on, TAGGED WITH THE ID IT WAS FOR.
 *
 * Carrying the id is what removes the "reset the state, then fetch" dance: a
 * result for a previous document simply is not a result for this one, so
 * "still loading" is derived rather than assigned. That keeps every setState in
 * this component on the far side of an await, which is the rule an effect owes
 * the renderer.
 */
interface LoadedSource {
  id: string;
  document: KnowledgeDocument | null;
  problem: string | null;
}

export function DocumentSourceView({ documentId }: { documentId: string }) {
  // Seeded demo documents live in the browser store and have no server behind
  // them, exactly as the Knowledge Base screen treats them.
  const demo = isDemoMode();
  const { documents, ready } = useAppStore();

  const [loaded, setLoaded] = useState<LoadedSource | null>(null);

  useEffect(() => {
    if (demo) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/knowledge/documents/${encodeURIComponent(documentId)}`,
        );
        const payload = (await response.json().catch(() => ({}))) as {
          document?: KnowledgeDocument;
          error?: string;
        };
        if (cancelled) return;

        setLoaded({
          id: documentId,
          document: payload.document ?? null,
          problem:
            response.ok && payload.document
              ? null
              : (payload.error ?? "That document could not be opened."),
        });
      } catch {
        if (cancelled) return;
        setLoaded({
          id: documentId,
          document: null,
          problem: "That document could not be opened.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [demo, documentId]);

  // A result for a DIFFERENT document is not a result for this one.
  const settled = loaded?.id === documentId ? loaded : null;
  const resolved = demo
    ? (documents.find((entry) => entry.id === documentId) ?? null)
    : (settled?.document ?? null);
  const pending = demo ? !ready : settled === null;
  const problem = demo ? null : (settled?.problem ?? null);

  if (pending) {
    return (
      <PageShell>
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Opening the document…
        </div>
      </PageShell>
    );
  }

  if (!resolved) {
    return (
      <PageShell>
        <EmptyState
          icon={<FileText />}
          title="That document could not be opened"
          /*
           * The SAME sentence whether the id is unknown, belongs to another
           * corpus, or was removed. Distinguishing them here would turn this
           * page into a way to test ids.
           */
          description={
            problem ??
            "The source behind this citation is no longer available. Ask Sunny the question again and the answer will cite what is in the library now."
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Source document"
        title={resolved.title}
        description="The document behind a citation in Sunny's answer."
      />
      <Card>
        <CardContent>
          <DocumentDetail document={resolved} canManage={false} live={!demo} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
