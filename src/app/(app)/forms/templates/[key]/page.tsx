import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PermissionGate } from "@/components/permission-gate";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import {
  getCurrentVersion,
  getTemplateByKey,
  listAssets,
  listVersions,
} from "@/lib/forms/repository";
import { TemplateEditorScreen } from "@/features/forms/template-editor-screen";

export const metadata: Metadata = { title: "Edit template" };
export const dynamic = "force-dynamic";

/**
 * The editor's server half: it reads the template, its versions and its PDF
 * assets with the privileged key and hands the client only what the screen
 * shows. No employee data is involved — a template is company content — but the
 * read still goes through the same server-only path everything else in Forms
 * uses.
 */
export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const template = await getTemplateByKey(key);
  if (!template) notFound();

  const [versions, current, assets] = await Promise.all([
    listVersions(template.id),
    getCurrentVersion(template.id),
    listAssets(template.id),
  ]);

  return (
    <PermissionGate permission="manage_form_templates">
      <TemplateEditorScreen
        template={{
          key: template.key,
          name: template.name,
          description: template.description,
          layoutFamily: template.layoutFamily,
        }}
        initialVersions={versions.map((version) => ({
          id: version.id,
          version: version.version,
          status: version.status,
          document: version.document,
          variants: version.variants,
          notes: version.notes,
          publishedAt: version.publishedAt,
          publishedBy: version.publishedBy,
        }))}
        initialCurrent={
          current
            ? {
                id: current.id,
                version: current.version,
                status: current.status,
                document: current.document,
                variants: current.variants,
                notes: current.notes,
                publishedAt: current.publishedAt,
                publishedBy: current.publishedBy,
              }
            : null
        }
        assets={assets.map((asset) => ({
          id: asset.id,
          version: asset.version,
          kind: asset.kind,
          status: asset.status,
          fileName: asset.fileName,
          sizeBytes: asset.sizeBytes,
          pageCount: asset.pageCount,
          acroform: asset.acroform as { hasFields?: boolean; fieldCount?: number },
          validation: asset.validation as { rejected?: string; notes?: string[] },
          createdAt: asset.createdAt,
        }))}
        notice={formsIdentityIsUnverified() ? SYNTHETIC_DATA_NOTICE : null}
      />
    </PermissionGate>
  );
}
