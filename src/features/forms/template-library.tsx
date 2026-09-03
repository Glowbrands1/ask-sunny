"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, RefreshCw, ShieldCheck, Sparkles, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { formatBytes } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/date";
import { useSession } from "@/lib/session/session-context";
import { formsHeaders } from "./forms-fetch";

/**
 * TEMPLATE MANAGEMENT — the two layers, kept visibly separate.
 *
 * DOCUMENT TEMPLATES are what Ask Sunny fills and what the generated PDF is
 * drawn from. UPLOADED PDF TEMPLATES are the official copies an administrator
 * replaces. The reference system showed the same split, and the reason it
 * matters is the precedence rule: a published document template is what a
 * download prints, so an uploaded PDF that carries no fillable fields is the
 * reference copy rather than the output. That sentence appears on the card
 * itself, because it is the thing an administrator most needs to know before
 * pressing Replace.
 *
 * Every action is a server call. Nothing about a template lives in this
 * component's state except which tab is open.
 */

export interface TemplateSummaryView {
  id: string;
  key: string;
  name: string;
  shortName: string;
  description: string;
  layoutFamily: string;
  requiredPermission: string;
  currentVersion: { version: number; publishedAt: string | null; publishedBy: string | null } | null;
  draftVersion: { id: string; version: number } | null;
  versionCount: number;
  variantLabels: string[];
  fieldCounts: { ai: number; manager: number; employee: number; manual: number; signature: number };
  activeAsset: {
    id: string;
    version: number;
    kind: string;
    fileName: string;
    sizeBytes: number | null;
    pageCount: number | null;
    hasFields: boolean;
    createdAt: string;
  } | null;
  assetCount: number;
}

const FAMILY_LABEL: Record<string, string> = {
  coaching: "Coaching",
  corrective: "Corrective",
  epp: "EPP",
  dmit_epp: "DMIT EPP",
};

export function TemplateLibrary({
  templates,
  canManage,
  notice,
}: {
  templates: TemplateSummaryView[];
  canManage: boolean;
  notice: string | null;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const { role, user } = useSession();
  const router = useRouter();

  async function replacePdf(key: string, file: File) {
    setBusy(key);
    setProblem(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/forms/templates/${key}/pdf`, {
        method: "POST",
        headers: formsHeaders(role, user.name),
        body,
      });
      const payload = (await response.json()) as {
        accepted?: boolean;
        reason?: string;
        error?: string;
        inspection?: { acroform?: { fieldCount?: number }; notes?: string[] };
      };
      if (!response.ok || payload.accepted === false) {
        // A refused upload is reported in full: the previous version is still
        // active, which is the thing an administrator needs to hear.
        setProblem(
          payload.reason ??
            payload.error ??
            "That PDF was not accepted. The previous version is still active.",
        );
        return;
      }
      setMessage(payload.inspection?.notes?.[0] ?? "New PDF version stored and activated.");
      /*
       * router.refresh(), not window.location.reload(). A full reload threw
       * away the answer the administrator was waiting for: the success notice
       * went with it, and the Tabs reset to Document templates, so the new
       * version they had just uploaded was on a tab they were no longer
       * looking at. This re-renders the server component in place — the card
       * shows the new version, on the tab they are still on, under the notice
       * saying what happened.
       */
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {notice ? (
        <Notice tone="attention" icon={<ShieldCheck />} className="mb-5">
          {notice}
        </Notice>
      ) : null}

      {problem ? (
        <Notice tone="attention" className="mb-4">
          {problem}
        </Notice>
      ) : null}
      {message ? (
        <Notice tone="accent" className="mb-4">
          {message}
        </Notice>
      ) : null}

      <Tabs defaultValue="document">
        <TabsList>
          <TabsTrigger value="document">Document templates</TabsTrigger>
          <TabsTrigger value="pdf">Uploaded PDF templates</TabsTrigger>
        </TabsList>

        <TabsContent value="document">
          <Notice tone="neutral" icon={<Sparkles />} className="mb-5">
            A document template decides which fields Ask Sunny may draft, which the
            manager completes, which are filled by hand on the printed page, and which are
            signature lines. Publishing creates a new immutable version — forms already
            finalized keep printing the version they were signed against.
          </Notice>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <Card key={template.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[14px] leading-snug font-semibold text-foreground">
                      {template.name}
                    </h3>
                    <Badge tone={template.draftVersion ? "attention" : "ready"} size="sm">
                      {template.draftVersion ? "Draft open" : `v${template.currentVersion?.version ?? 1}`}
                    </Badge>
                  </div>

                  <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                    {template.description}
                  </p>

                  <div className="mt-3.5 flex flex-wrap gap-1.5">
                    <Badge tone="neutral" size="sm">
                      {FAMILY_LABEL[template.layoutFamily] ?? template.layoutFamily}
                    </Badge>
                    <Badge tone="primary" size="sm">
                      {template.fieldCounts.ai} AI
                    </Badge>
                    {template.fieldCounts.manual > 0 ? (
                      <Badge tone="neutral" size="sm">
                        {template.fieldCounts.manual} by hand
                      </Badge>
                    ) : null}
                    <Badge tone="neutral" size="sm">
                      {template.fieldCounts.signature} signature
                    </Badge>
                  </div>

                  {template.variantLabels.length > 1 ? (
                    <p className="mt-2.5 text-[11px] text-subtle-foreground">
                      Role variants: {template.variantLabels.join(" · ")}
                    </p>
                  ) : null}

                  <p className="mt-2.5 text-[11px] text-subtle-foreground">
                    {template.versionCount} version{template.versionCount === 1 ? "" : "s"}
                    {template.currentVersion?.publishedAt
                      ? ` · published ${formatDate(template.currentVersion.publishedAt)}`
                      : ""}
                  </p>

                  <div className="mt-4 flex gap-2">
                    <Button asChild variant="secondary" size="sm" disabled={!canManage}>
                      <Link href={`/forms/templates/${template.key}`}>
                        <FileText />
                        Edit template
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pdf">
          <Notice tone="neutral" icon={<Upload />} className="mb-5">
            These are the official PDF copies. Replacing one adds a new version and keeps
            every earlier one — nothing is overwritten, and reverting is a click. An
            uploaded PDF is inspected first: if it carries no fillable fields it is stored
            as the reference copy, and generated downloads keep coming from the published
            document template. Signature fields are never filled by Ask Sunny.
          </Notice>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <Card key={`${template.id}-pdf`} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[14px] leading-snug font-semibold text-foreground">
                      {template.name}
                    </h3>
                    <Badge
                      tone={template.activeAsset?.kind === "upload" ? "primary" : "neutral"}
                      size="sm"
                    >
                      {template.activeAsset?.kind === "upload"
                        ? `Upload v${template.activeAsset.version}`
                        : "Bundled default"}
                    </Badge>
                  </div>

                  <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                    {template.activeAsset?.kind === "upload" ? (
                      <>
                        {template.activeAsset.fileName}
                        {template.activeAsset.sizeBytes
                          ? ` · ${formatBytes(template.activeAsset.sizeBytes)}`
                          : ""}
                        {template.activeAsset.pageCount
                          ? ` · ${template.activeAsset.pageCount} pages`
                          : ""}
                      </>
                    ) : (
                      "Generated by the structured renderer from the published document template."
                    )}
                  </p>

                  {template.activeAsset?.kind === "upload" ? (
                    <p className="mt-2 text-[11px] leading-snug text-subtle-foreground">
                      {template.activeAsset.hasFields
                        ? "Carries fillable fields — map them to template fields before Ask Sunny can fill this PDF."
                        : "No fillable fields, so this is the reference copy. Downloads use the structured renderer."}
                    </p>
                  ) : null}

                  <p className="mt-2.5 text-[11px] text-subtle-foreground">
                    {template.assetCount} version{template.assetCount === 1 ? "" : "s"} kept
                  </p>

                  <div className="mt-4">
                    <label className="inline-flex">
                      <input
                        type="file"
                        accept="application/pdf"
                        className="sr-only"
                        disabled={!canManage || busy === template.key}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void replacePdf(template.key, file);
                        }}
                      />
                      <span
                        className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-[13px] transition-colors hover:bg-hover-surface ${
                          canManage ? "" : "pointer-events-none opacity-50"
                        }`}
                      >
                        <RefreshCw className="size-3.5" />
                        {busy === template.key ? "Checking…" : "Replace with new PDF"}
                      </span>
                    </label>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
