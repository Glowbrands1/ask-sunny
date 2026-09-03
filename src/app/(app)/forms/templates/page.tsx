import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { Notice } from "@/components/ui/feedback";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import { fieldsForVariant } from "@/lib/forms/document";
import { ensureTemplateLibrary, listTemplateSummaries } from "@/lib/forms/repository";
import { TemplateLibrary, type TemplateSummaryView } from "@/features/forms/template-library";

/**
 * FORM TEMPLATES — the authorized administration screen.
 *
 * Read on the server, from the database, with the privileged key that never
 * reaches a browser. The library installs itself on first visit: an empty
 * database gets the nine templates, and one that already has them is left
 * exactly as it is, including versions an administrator has published since.
 *
 * If the database cannot be reached at all the screen says so rather than
 * falling back to seeded cards — a template list that looks right but is not
 * the one forms are being filled from is worse than an error.
 */
export const metadata: Metadata = { title: "Form Templates" };
export const dynamic = "force-dynamic";

export default async function FormTemplatesPage() {
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
              createdAt: summary.activeAsset.createdAt,
            }
          : null,
        assetCount: summary.assetCount,
      };
    });
  } catch (error) {
    failure = (error as Error).message;
  }

  return (
    <PermissionGate permission="manage_form_templates">
      <PageShell>
        <PageHeader
          eyebrow="Authorized admin"
          title="Form Templates"
          description="Two layers: the document template Ask Sunny fills, and the official PDF each form prints into."
        />

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
    </PermissionGate>
  );
}
