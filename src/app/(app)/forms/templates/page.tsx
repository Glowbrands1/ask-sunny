import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/ui/layout";
import { FormsAccessNotice } from "@/features/forms/forms-gate";
import { Notice } from "@/components/ui/feedback";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import { fieldsForVariant } from "@/lib/forms/document";
import {
  ensureTemplateLibrary,
  listTemplateSummaries,
  type TemplateSummary,
} from "@/lib/forms/repository";
import { TemplateLibrary, type TemplateSummaryView } from "@/features/forms/template-library";
import type { SourceFormat } from "@/lib/forms/source-format";
import { proposalNeedsAttention } from "@/lib/forms/ingest/proposal";
import { requirePagePermission } from "@/lib/auth/page";

/**
 * FORM TEMPLATES — the authorized administration screen.
 *
 * Read on the server, from the database, with the privileged key that never
 * reaches a browser. The library installs itself on first visit: an empty
 * database gets the thirteen templates, and one that already has them is left
 * exactly as it is — except where the business has re-issued a form, which is
 * published as a NEW version rather than as an edit to the old one. See
 * `ensureTemplateLibrary`.
 *
 * If the database cannot be reached at all the screen says so rather than
 * falling back to seeded cards — a template list that looks right but is not
 * the one forms are being filled from is worse than an error.
 */
export const metadata: Metadata = { title: "Form Templates" };
export const dynamic = "force-dynamic";

/**
 * WHERE THE LAST UPLOADED DOCUMENT GOT TO.
 *
 * Derived here rather than stored, because it is a reading of three facts the
 * database already holds — is there an upload, is there a draft proposed from
 * it, and did the version now live come from one. A fourth column recording
 * "the state" would be a fourth thing that can disagree with the other three.
 */
function documentState(summary: TemplateSummary): {
  documentState: TemplateSummaryView["documentState"];
  documentProblem: string | null;
  proposalFlags: number;
} {
  const draftProposal = summary.draftVersion?.proposal ?? null;
  if (draftProposal) {
    const flags =
      draftProposal.warnings.length +
      draftProposal.unresolved.length +
      draftProposal.alignment.added.length +
      draftProposal.alignment.removed.length;
    return {
      documentState: proposalNeedsAttention(draftProposal) ? "review" : "proposed",
      documentProblem: null,
      proposalFlags: flags,
    };
  }
  if (summary.currentVersion?.proposal) {
    return { documentState: "published", documentProblem: null, proposalFlags: 0 };
  }
  if (summary.activeAsset?.kind === "upload") {
    const validation = summary.activeAsset.validation as { rejected?: unknown };
    return {
      documentState: "stored",
      documentProblem: typeof validation.rejected === "string" ? validation.rejected : null,
      proposalFlags: 0,
    };
  }
  return { documentState: "none", documentProblem: null, proposalFlags: 0 };
}

export default async function FormTemplatesPage() {
  await requirePagePermission("manage_form_templates");

  let templates: TemplateSummaryView[] = [];
  let failure: string | null = null;

  try {
    await ensureTemplateLibrary("system");
    const summaries = await listTemplateSummaries();
    templates = summaries.map((summary) => {
      const version = summary.currentVersion ?? summary.draftVersion;
      const variantKey = version?.variants[0]?.key ?? null;
      const fields = version ? fieldsForVariant(version.document, variantKey) : [];
      const counts = { ai: 0, manager: 0, employee: 0, manual: 0, signature: 0 };
      for (const field of fields) {
        if (field.responsibility in counts) {
          counts[field.responsibility as keyof typeof counts] += 1;
        }
      }
      // Signature lines have no field key, so they are counted from the blocks.
      counts.signature = version
        ? version.document.blocks.filter((block) => block.kind === "signature_row").length
        : 0;

      return {
        id: summary.id,
        key: summary.key,
        name: summary.name,
        shortName: summary.shortName,
        description: summary.description,
        category: summary.category,
        layoutFamily: summary.layoutFamily,
        requiredPermission: summary.requiredPermission,
        currentVersion: summary.currentVersion
          ? {
              version: summary.currentVersion.version,
              publishedAt: summary.currentVersion.publishedAt,
              publishedBy: summary.currentVersion.publishedBy,
            }
          : null,
        draftVersion: summary.draftVersion
          ? { id: summary.draftVersion.id, version: summary.draftVersion.version }
          : null,
        versionCount: summary.versionCount,
        variantLabels: (version?.variants ?? []).map((variant) => variant.label),
        fieldCounts: counts,
        activeAsset: summary.activeAsset
          ? {
              id: summary.activeAsset.id,
              version: summary.activeAsset.version,
              kind: summary.activeAsset.kind,
              fileName: summary.activeAsset.fileName,
              sizeBytes: summary.activeAsset.sizeBytes,
              pageCount: summary.activeAsset.pageCount,
              hasFields: Boolean(
                (summary.activeAsset.acroform as { hasFields?: boolean }).hasFields,
              ),
              /*
               * Read from the inspection the upload was accepted on, not
               * re-derived from the MIME type: an asset stored before the app
               * accepted anything but PDF has no recorded format, and saying
               * nothing is more honest than assuming.
               */
              format:
                (summary.activeAsset.validation as { format?: SourceFormat | null }).format ??
                null,
              createdAt: summary.activeAsset.createdAt,
            }
          : null,
        assetCount: summary.assetCount,
        ...documentState(summary),
      };
    });
  } catch (error) {
    failure = (error as Error).message;
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Authorized admin"
        title="Form Templates"
        description="Two layers: the document template Ask Sunny fills, and the official PDF or Word copy each form was issued as."
      />

      {/*
        NOT `PermissionGate`. Roles have not been configured, so the default
        matrix was replacing this page with "not available for your access
        level" for a Salon Director — an invented restriction in front of the
        owner's own templates, enforced against a role the browser asserts. The
        notice says what the permission will be; see `forms-gate.tsx`.
      */}
      <FormsAccessNotice permission="manage_form_templates" />

      {failure ? (
        <Notice tone="attention" title="The template library could not be read">
          {failure}
        </Notice>
      ) : (
        <TemplateLibrary
          templates={templates}
          canManage
          notice={formsIdentityIsUnverified() ? SYNTHETIC_DATA_NOTICE : null}
        />
      )}
    </PageShell>
  );
}
