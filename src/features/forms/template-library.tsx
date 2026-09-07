"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, RefreshCw, ShieldCheck, Sparkles, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { groupTemplatesByCategory } from "@/lib/forms/catalog";
import { ACCEPTED_UPLOAD_TYPES, FORMAT_LABEL, type SourceFormat } from "@/lib/forms/source-format";
import { formatBytes } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/date";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { formsHeaders } from "./forms-fetch";

/**
 * TEMPLATE MANAGEMENT — the two layers, both on the page.
 *
 * TWO LAYERS, STACKED RATHER THAN TABBED. Both sections are on the page at
 * once, the way the approved reference shows them, because the precedence rule
 * between them is the thing an administrator most needs to understand and it
 * cannot be understood one tab at a time:
 *
 *   DOCUMENT TEMPLATES are what Ask Sunny fills and what a generated PDF is
 *   drawn from. Editing one is editing the form.
 *
 *   UPLOADED PDF TEMPLATES are the official copies an administrator replaces.
 *   Because every supplied reference PDF carries no fillable fields, an upload
 *   is the REFERENCE copy — the published document template is still what a
 *   download prints. That sentence is on the card itself, because it is the
 *   thing most likely to be assumed the other way round.
 *
 * They were tabs. Tabs hid half the answer, and hid it in a way that made the
 * result of an upload land on a panel the administrator was no longer looking
 * at.
 *
 * THE REFERENCE'S LAYOUT, NOT ITS COLOURS. The supplied screenshot is a black
 * administration surface; what was being asked for there is the ARRANGEMENT —
 * two headed sections, a two-column grid, one line of status per card, one
 * action. Ask Sunny keeps its own approved palette, so the same structure
 * arrives on the cream canvas.
 */

export interface TemplateSummaryView {
  id: string;
  key: string;
  name: string;
  shortName: string;
  description: string;
  category: string;
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
    /** Null for an upload stored before the app accepted anything but PDF. */
    format: SourceFormat | null;
    createdAt: string;
  } | null;
  assetCount: number;
}

const FAMILY_LABEL: Record<string, string> = {
  coaching: "Coaching",
  corrective: "Corrective",
  epp: "EPP",
  dmit_epp: "DMIT EPP",
  interview: "Interview",
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

  async function replaceSourceDocument(key: string, file: File) {
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
            "That file was not accepted. The previous version is still active.",
        );
        return;
      }
      setMessage(payload.inspection?.notes?.[0] ?? "New version stored and activated.");
      /*
       * router.refresh(), not window.location.reload(). A full reload threw
       * away the answer the administrator was waiting for: the success notice
       * went with it, and the new version appeared only after they went
       * looking. This re-renders the server component in place, so the card
       * updates under the notice saying what happened.
       */
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {notice ? (
        <Notice tone="attention" icon={<ShieldCheck />} className="mb-6">
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

      {/* ------------------------------------------- DOCUMENT TEMPLATES --- */}
      <PanelHeading
        title="Document templates"
        blurb="Edit these forms like a document — the page itself opens, and chips show where Ask Sunny fills the draft. Publishing creates a new immutable version; forms already finalized keep printing the version they were signed against."
      />

      {groupTemplatesByCategory(templates).map((category) => (
        <CategorySection key={category.key} label={category.label} blurb={category.blurb}>
        {category.templates.map((template) => (
          <TemplateCard key={template.id}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] leading-snug font-semibold text-foreground">
                {template.name}
              </h3>
              <Badge tone={template.draftVersion ? "attention" : "neutral"} size="sm">
                {template.draftVersion
                  ? `Draft v${template.draftVersion.version}`
                  : `Published v${template.currentVersion?.version ?? 1}`}
              </Badge>
            </div>

            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {template.description}
            </p>

            {/*
              A COUNT OF NONE IS NOT WORTH A CHIP. Every one of the nine HR
              forms has AI fields and two signature lines, so these always read
              as a number of something; an interview form has neither, and
              printing "0 AI · 0 signature" against it says nothing while
              looking like a defect. What an interview form DOES have is a long
              run of areas the interviewer writes in, so the manager count earns
              a chip on any form where it is the answer.
            */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="neutral" size="sm">
                {FAMILY_LABEL[template.layoutFamily] ?? template.layoutFamily}
              </Badge>
              {template.fieldCounts.ai > 0 ? (
                <Badge tone="primary" size="sm">
                  {template.fieldCounts.ai} AI
                </Badge>
              ) : null}
              {template.fieldCounts.manager > 0 ? (
                <Badge tone="neutral" size="sm">
                  {template.fieldCounts.manager} by the manager
                </Badge>
              ) : null}
              {template.fieldCounts.manual > 0 ? (
                <Badge tone="neutral" size="sm">
                  {template.fieldCounts.manual} by hand
                </Badge>
              ) : null}
              {template.fieldCounts.signature > 0 ? (
                <Badge tone="neutral" size="sm">
                  {template.fieldCounts.signature} signature
                </Badge>
              ) : null}
            </div>

            {template.variantLabels.length > 1 ? (
              <p className="mt-2.5 text-[11px] text-subtle-foreground">
                Role readings: {template.variantLabels.join(" · ")}
              </p>
            ) : null}

            <p className="mt-2.5 text-[11px] text-subtle-foreground">
              {template.versionCount} version{template.versionCount === 1 ? "" : "s"}
              {template.currentVersion?.publishedAt
                ? ` · published ${formatDate(template.currentVersion.publishedAt)}`
                : ""}
            </p>

            <div className="mt-4">
              <Button asChild size="sm">
                <Link href={`/forms/templates/${template.key}`}>
                  <FileText />
                  Edit template
                </Link>
              </Button>
            </div>
          </TemplateCard>
        ))}
        </CategorySection>
      ))}

      {/* --------------------------------------- UPLOADED PDF TEMPLATES --- */}
      <div className="mt-10">
        <PanelHeading
          title="Uploaded source documents"
          blurb="The official copies, as PDF or as Word — the file the business issued, kept alongside the form. REPLACING ONE DOES NOT CHANGE THE FORM ABOVE: an upload is stored, versioned and downloadable, and the form people fill is the document template, which is edited on its own page. Nothing here reads a PDF and rewrites the form from it, because almost every business PDF — and every Word file — is a picture of a form with no fillable fields in it to read. Uploads are inspected on arrival, stored byte for byte in the format they came in, and never overwrite an earlier version."
          icon={<Upload className="size-3.5" />}
        />

        {groupTemplatesByCategory(templates).map((category) => (
          <CategorySection key={category.key} label={category.label} blurb={category.blurb}>
          {category.templates.map((template) => (
            <TemplateCard key={`${template.id}-pdf`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[15px] leading-snug font-semibold text-foreground">
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

              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {template.activeAsset?.kind === "upload" ? (
                  <>
                    {template.activeAsset.fileName}
                    {template.activeAsset.format
                      ? ` · ${FORMAT_LABEL[template.activeAsset.format]}`
                      : ""}
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

              {/*
                SAID ON EVERY CARD, NOT ONLY AFTER AN UPLOAD.
                "I replaced the PDF and the form did not change" is the report
                this line exists to prevent, and it was reported. The panel
                blurb said it; a blurb above two columns of cards is not where
                somebody about to click a button is looking.
              */}
              <p className="mt-2 text-[11px] leading-snug text-subtle-foreground">
                {template.activeAsset?.kind === "upload" && template.activeAsset.hasFields
                  ? "Carries fillable fields — map them to template fields before Ask Sunny can fill this PDF."
                  : "Replacing this file does not change the form. To change what people fill in, edit the document template above."}
              </p>

              <p className="mt-2.5 text-[11px] text-subtle-foreground">
                {template.assetCount} version{template.assetCount === 1 ? "" : "s"} kept
              </p>

              <div className="mt-4">
                <label className="inline-flex">
                  <input
                    type="file"
                    /*
                      A HINT TO THE PICKER, NOT A CHECK. `accept` only decides
                      which files the operating system greys out; the server
                      sniffs the bytes and refuses anything that is not a PDF or
                      a Word document, whatever it was called. Both are listed
                      because a browser matches on either the extension or the
                      MIME type, and Windows sends neither reliably for .doc.
                    */
                    accept={ACCEPTED_UPLOAD_TYPES}
                    className="sr-only"
                    disabled={!canManage || busy === template.key}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void replaceSourceDocument(template.key, file);
                    }}
                  />
                  {/*
                    THE APP'S OWN PRIMARY BUTTON, borrowed rather than
                    re-drawn. It cannot be a <Button> element: the control has
                    to be a <label> wrapping a hidden file input, and nesting a
                    button inside a label breaks the click that opens the file
                    picker. So it takes `buttonVariants` — the same navy fill,
                    the same size, the same hover — which means a change to the
                    button system reaches here too instead of leaving a
                    Forms-only lookalike behind.
                  */}
                  <span
                    className={cn(
                      buttonVariants({ variant: "primary", size: "sm" }),
                      "cursor-pointer",
                      canManage ? "" : "pointer-events-none opacity-50",
                    )}
                  >
                    <RefreshCw className="size-3.5" />
                    {busy === template.key ? "Checking…" : "Replace (PDF or Word)"}
                  </span>
                </label>
              </div>
            </TemplateCard>
          ))}
          </CategorySection>
        ))}
      </div>
    </div>
  );
}

/**
 * One category of the library, headed.
 *
 * A quieter heading than `PanelHeading` on purpose: the two PANELS are the
 * distinction that changes what an action does — editing a document versus
 * replacing a file — and the categories inside them only say what kind of form
 * this is. Sub-headings that shouted as loudly as the panels made the page read
 * as four sections of equal weight, which is not what it is.
 */
function CategorySection({
  label,
  blurb,
  children,
}: {
  label: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="text-[13px] font-semibold text-foreground">{label}</h3>
      <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
        {blurb}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

/** The yellow caps heading the reference uses to separate the two layers. */
function PanelHeading({
  title,
  blurb,
  icon,
}: {
  title: string;
  blurb: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[0.1em] text-foreground uppercase">
        <span className="text-primary">{icon ?? <Sparkles className="size-3.5" />}</span>
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
  );
}

function TemplateCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="flex flex-col transition-colors hover:border-border-strong">
      <CardContent className="flex flex-1 flex-col p-5">{children}</CardContent>
    </Card>
  );
}
