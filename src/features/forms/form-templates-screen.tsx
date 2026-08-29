"use client";

import { useState } from "react";
import { FileText, Info, Pencil, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import { Dialog, DialogContent, Tooltip } from "@/components/ui/overlays";
import { useAppStore } from "@/lib/store/app-store";
import { formatDate } from "@/lib/utils/date";
import { formatBytes } from "@/lib/utils/format";
import { TemplateEditor } from "./template-editor";

export function FormTemplatesScreen() {
  const { templates } = useAppStore();
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = templates.find((entry) => entry.id === editingId) ?? null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Forms"
        title="Form Templates"
        description="Two layers: the document template Sunny fills, and the official fillable PDF each form prints into."
      />

      <Tabs defaultValue="document">
        <TabsList>
          <TabsTrigger value="document">Document templates</TabsTrigger>
          <TabsTrigger value="pdf">Uploaded PDF templates</TabsTrigger>
        </TabsList>

        {/* Layer 1 — document templates */}
        <TabsContent value="document">
          <Notice tone="neutral" icon={<Sparkles />} className="mb-5">
            A document template defines which fields Sunny may draft, which the
            manager completes, and which are signature lines. Open one to edit
            the layout and field rules.
          </Notice>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => {
              const aiFields = template.fields.filter(
                (field) => field.fillRule === "ai_populate",
              ).length;
              const signatureFields = template.fields.filter(
                (field) => field.type === "signature",
              ).length;
              return (
                <Card key={template.id} interactive className="flex flex-col">
                  <CardContent className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[14px] leading-snug font-semibold text-foreground">
                        {template.name}
                      </h3>
                      <Badge tone={template.active ? "ready" : "neutral"} size="sm">
                        {template.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                      {template.description}
                    </p>

                    <div className="mt-3.5 flex flex-wrap gap-1.5">
                      <Badge tone="primary" size="sm">
                        {aiFields} AI-filled
                      </Badge>
                      <Badge tone="neutral" size="sm">
                        {signatureFields} signature
                      </Badge>
                      {template.hasDocumentTemplate ? (
                        <Badge tone="accent" size="sm">
                          Overrides PDF
                        </Badge>
                      ) : null}
                    </div>

                    <p className="mt-3 text-xs text-subtle-foreground">
                      Updated {formatDate(template.updatedAt)} by {template.updatedBy}
                    </p>

                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4 w-full"
                      onClick={() => setEditingId(template.id)}
                    >
                      <Pencil />
                      Edit template
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Layer 2 — uploaded PDFs */}
        <TabsContent value="pdf">
          <Notice tone="neutral" icon={<Info />} className="mb-5">
            <p className="font-semibold text-foreground">How the two layers interact</p>
            <ul className="mt-1.5 space-y-1">
              <li>
                A saved document template takes priority over the uploaded PDF for
                that form.
              </li>
              <li>
                Replacing a PDF takes effect immediately, for every user, across
                every salon.
              </li>
              <li>Signature fields are never filled by Sunny in either layer.</li>
            </ul>
          </Notice>

          <SectionHeader
            title="Official fillable PDFs"
            description="The documents generated forms print into. Each ships with a bundled default."
          />

          <ul className="space-y-2">
            {templates.map((template) => (
              <li key={template.pdf.id}>
                <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-soft sm:flex-row sm:items-center">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted-foreground">
                    <FileText className="size-4" aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-foreground">
                      {template.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {template.pdf.fileName} ·{" "}
                      {formatBytes(template.pdf.sizeBytes)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {template.pdf.isBundledDefault ? (
                      <Badge tone="neutral" size="sm">
                        Bundled default
                      </Badge>
                    ) : (
                      <Badge tone="primary" size="sm">
                        Replaced {formatDate(template.pdf.replacedAt ?? "")}
                      </Badge>
                    )}
                    {template.hasDocumentTemplate ? (
                      <Tooltip content="A saved document template exists, so it takes priority over this PDF.">
                        <span className="inline-flex">
                          <Badge tone="accent" size="sm">
                            <ShieldCheck className="size-2.5" aria-hidden />
                            Overridden
                          </Badge>
                        </span>
                      </Tooltip>
                    ) : null}
                    <Tooltip content="Replacing the official PDF is a demo affordance in this prototype. It will upload and version the file once storage is connected.">
                      <span className="inline-flex">
                        <Button variant="secondary" size="sm" disabled>
                          <RefreshCw />
                          Replace with new PDF
                        </Button>
                      </span>
                    </Tooltip>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      {/* Editor */}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        {editing ? (
          <DialogContent
            title={`Edit — ${editing.name}`}
            description="Select a field in the page preview to change how it is completed."
            wide
            className="max-w-6xl"
          >
            <TemplateEditor template={editing} />
          </DialogContent>
        ) : null}
      </Dialog>
    </PageShell>
  );
}
