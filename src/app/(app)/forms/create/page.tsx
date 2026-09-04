import type { Metadata } from "next";

import { FormsAccessNotice } from "@/features/forms/forms-gate";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { DEMO_LOCATIONS } from "@/data/demo/locations";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import { ensureTemplateLibrary, listTemplateSummaries } from "@/lib/forms/repository";
import { EMPLOYEE_NAME_MAX } from "@/lib/forms/limits";
import { CreateFormFlow, type CreatableTemplate } from "@/features/forms/create-form-flow";

export const metadata: Metadata = { title: "Create a Form" };
export const dynamic = "force-dynamic";


/**
 * The two facts a chat handoff carries, read on the server.
 *
 * `template` is checked against the published library before it is used — a
 * key in the URL is a request, not a fact, and one that names nothing simply
 * falls back to the first form rather than rendering an empty picker.
 */
export default async function CreateFormPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; template?: string; employee?: string }>;
}) {
  const params = await searchParams;
  let templates: CreatableTemplate[] = [];
  let failure: string | null = null;

  try {
    await ensureTemplateLibrary("system");
    const summaries = await listTemplateSummaries();
    templates = summaries
      .filter((summary) => summary.active && summary.currentVersion)
      .map((summary) => ({
        key: summary.key,
        name: summary.name,
        description: summary.description,
        variants: summary.currentVersion?.variants ?? [],
      }));
  } catch (error) {
    failure = (error as Error).message;
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Forms"
        title="Create a Form"
        description="Start from a published template, fill it with Ask Sunny's help, finalize it and download the PDF."
      />

      <FormsAccessNotice permission="create_coaching_form" />

      {failure ? (
        <Notice tone="attention" title="The form templates could not be read">
          {failure}
        </Notice>
      ) : (
        <CreateFormFlow
          templates={templates}
          notice={formsIdentityIsUnverified() ? SYNTHETIC_DATA_NOTICE : null}
          fromChat={params.from === "chat"}
          initialTemplateKey={
            templates.some((entry) => entry.key === params.template)
              ? (params.template ?? null)
              : null
          }
          initialEmployeeName={params.employee?.slice(0, EMPLOYEE_NAME_MAX) ?? null}
          locations={DEMO_LOCATIONS.map((location) => ({
            id: location.id,
            name: location.name,
          }))}
        />
      )}
    </PageShell>
  );
}
