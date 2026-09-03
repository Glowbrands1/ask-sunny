"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, Plus, Save, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { formsFetch } from "./forms-fetch";
import {
  FIELD_RESPONSIBILITIES,
  RESPONSIBILITY_CHIP,
  RESPONSIBILITY_LABEL,
  type FieldResponsibility,
  type FormBlock,
  type FormDocument,
  type FormVariant,
} from "@/lib/forms/document";

/**
 * THE STRUCTURED TEMPLATE EDITOR.
 *
 * The document is edited as what it IS — an ordered list of blocks — rather
 * than as free text that a parser then has to guess at. That is the difference
 * between an editor and a word processor here: every field carries a
 * RESPONSIBILITY, and responsibility is the thing the whole feature turns on.
 * A rich-text surface would let somebody type a field that nothing owns.
 *
 * WHAT THE EDITOR MAKES OBVIOUS, because these are the mistakes that matter:
 *
 *   the chip on every field says who fills it, in the same words the fill
 *   screen and the audit trail use;
 *
 *   a signature block has no responsibility control at all — there is nothing
 *   to choose, because nothing may ever write there;
 *
 *   editing a published version is not possible. The page opens a DRAFT, says
 *   so, and publishing is a separate, explicit action that creates a new
 *   immutable version. Forms already finalized keep printing the version they
 *   were signed against, and the screen says that too.
 */

export interface EditorTemplate {
  key: string;
  name: string;
  description: string;
  layoutFamily: string;
}

export interface EditorVersion {
  id: string;
  version: number;
  status: "draft" | "published" | "archived";
  document: FormDocument;
  variants: FormVariant[];
  notes: string;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface EditorAsset {
  id: string;
  version: number;
  kind: string;
  status: string;
  fileName: string;
  sizeBytes: number | null;
  pageCount: number | null;
  acroform: { hasFields?: boolean; fieldCount?: number };
  validation: { rejected?: string; notes?: string[] };
  createdAt: string;
}

function blockLabel(block: FormBlock): string {
  switch (block.kind) {
    case "letterhead":
      return `Letterhead — ${block.title}`;
    case "section":
      return `Section — ${block.label}`;
    case "field":
      return block.field.label;
    case "field_row":
      return block.fields.map((field) => field.label).join("  /  ");
    case "checkbox_group":
      return `${block.label ?? "Checkboxes"} (${block.options.length})`;
    case "numbered_list":
      return `${block.label} (${block.count} lines)`;
    case "signature_row":
      return `${block.label} + ${block.dateLabel}`;
    case "page_break":
      return "Page break";
    case "reference":
      return `Reference — ${block.label}`;
    case "paragraph":
    case "note":
    case "acknowledgement":
      return block.text.slice(0, 70);
    default:
      return "Block";
  }
}

/** Every responsibility a block carries, for the chip row. */
function blockResponsibilities(block: FormBlock): FieldResponsibility[] {
  switch (block.kind) {
    case "field":
      return [block.field.responsibility];
    case "field_row":
      return block.fields.map((field) => field.responsibility);
    case "checkbox_group":
    case "numbered_list":
      return [block.responsibility];
    case "signature_row":
      return ["signature"];
    default:
      return [];
  }
}

const CHIP_TONE: Record<FieldResponsibility, string> = {
  system: "bg-surface-muted text-muted-foreground",
  ai: "bg-primary-soft text-primary-soft-foreground",
  manager: "bg-accent-soft text-accent-soft-foreground",
  employee: "bg-accent-soft text-accent-soft-foreground",
  manual: "bg-surface-muted text-muted-foreground",
  signature: "bg-surface-muted text-subtle-foreground",
};

export function TemplateEditorScreen({
  template,
  initialVersions,
  initialCurrent,
  assets,
  notice,
}: {
  template: EditorTemplate;
  initialVersions: EditorVersion[];
  initialCurrent: EditorVersion | null;
  assets: EditorAsset[];
  notice: string | null;
}) {
  const router = useRouter();
  const [versions, setVersions] = React.useState(initialVersions);
  const [draft, setDraft] = React.useState<EditorVersion | null>(
    initialVersions.find((version) => version.status === "draft") ?? null,
  );
  const [document, setDocument] = React.useState<FormDocument | null>(draft?.document ?? null);
  const [variantKey, setVariantKey] = React.useState<string | null>(
    (draft ?? initialCurrent)?.variants[0]?.key ?? null,
  );
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const { role, user } = useSession();

  const current = initialCurrent;
  const shown = document ?? current?.document ?? null;
  const variants = (draft ?? current)?.variants ?? [];

  const call = React.useCallback(
    <T,>(url: string, init: RequestInit = {}) => formsFetch<T>(url, role, user.name, init),
    [role, user.name],
  );

  async function openDraft() {
    setBusy(true);
    setProblem(null);
    try {
      const result = await call<{ draft: EditorVersion; clonedFrom: number | null }>(
        `/api/forms/templates/${template.key}/draft`,
        { method: "POST" },
      );
      setDraft(result.draft);
      setDocument(result.draft.document);
      setVersions((existing) => [result.draft, ...existing.filter((v) => v.id !== result.draft.id)]);
      setMessage(
        result.clonedFrom
          ? `Draft opened as version ${result.draft.version}, cloned from version ${result.clonedFrom}. The published version is untouched.`
          : `Continuing the open draft, version ${result.draft.version}.`,
      );
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft || !document) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await call<{ draft: EditorVersion }>(
        `/api/forms/templates/${template.key}/draft`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            versionId: draft.id,
            document,
            variants: draft.variants,
            notes: draft.notes,
          }),
        },
      );
      setDraft(result.draft);
      setDirty(false);
      setMessage("Draft saved. It is not live until you publish it.");
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setBusy(true);
    setProblem(null);
    try {
      await call(`/api/forms/templates/${template.key}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: draft.id }),
      });
      setMessage(`Version ${draft.version} published. New forms use it from now on.`);
      router.refresh();
      window.location.reload();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!draft) return;
    setBusy(true);
    try {
      await call(`/api/forms/templates/${template.key}/draft?versionId=${draft.id}`, {
        method: "DELETE",
      });
      setDraft(null);
      setDocument(null);
      setDirty(false);
      setMessage("Draft discarded. The published version is unchanged.");
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateBlock(index: number, next: FormBlock) {
    if (!document) return;
    const blocks = [...document.blocks];
    blocks[index] = next;
    setDocument({ ...document, blocks });
    setDirty(true);
  }

  function removeBlock(index: number) {
    if (!document) return;
    setDocument({ ...document, blocks: document.blocks.filter((_, i) => i !== index) });
    setDirty(true);
  }

  /*
   * A counter rather than a timestamp for the new field's key. React's purity
   * rule is right to object to `Date.now()` here, and a counter is the better
   * answer anyway: keys stay stable across a re-render, and two fields added in
   * the same millisecond cannot collide.
   */
  const nextKey = React.useRef(1);

  function addBlock(kind: FormBlock["kind"]) {
    if (!document) return;
    const suffix = `${nextKey.current++}`;
    const created: FormBlock =
      kind === "section"
        ? { kind: "section", label: "New section" }
        : kind === "paragraph"
          ? { kind: "paragraph", text: "New paragraph" }
          : kind === "page_break"
            ? { kind: "page_break" }
            : kind === "signature_row"
              ? { kind: "signature_row", label: "Signature", dateLabel: "Date" }
              : {
                  kind: "field",
                  field: {
                    key: `field_${suffix}`,
                    label: "New field",
                    input: "text",
                    responsibility: "manager",
                  },
                };
    setDocument({ ...document, blocks: [...document.blocks, created] });
    setDirty(true);
  }

  const editing = Boolean(draft && document);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Authorized admin"
        title={template.name}
        description={template.description}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/forms/templates">
            <ArrowLeft />
            All templates
          </Link>
        </Button>
        {current ? (
          <Badge tone="ready">Published v{current.version}</Badge>
        ) : (
          <Badge tone="attention">No published version</Badge>
        )}
        {draft ? <Badge tone="attention">Draft v{draft.version}</Badge> : null}
        {variants.length > 1 ? (
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="variant" className="text-[11px]">
              Preview as
            </Label>
            <Select
              id="variant"
              value={variantKey ?? ""}
              onChange={(event) => setVariantKey(event.target.value || null)}
              className="h-8 w-44"
            >
              {variants.map((variant) => (
                <option key={variant.key} value={variant.key}>
                  {variant.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {notice ? (
        <Notice tone="attention" className="mb-4">
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

      <Notice tone="neutral" className="mb-5">
        A published version is immutable. Editing opens a draft cloned from it; publishing
        the draft creates the next version and archives the last. Forms that were already
        finalized keep printing the version they were signed against — a change here never
        rewrites yesterday&rsquo;s paperwork.
      </Notice>

      <div className="mb-5 flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="sm" onClick={saveDraft} disabled={busy || !dirty}>
              <Save />
              {dirty ? "Save draft" : "Saved"}
            </Button>
            <Button size="sm" variant="secondary" onClick={publish} disabled={busy || dirty}>
              <Check />
              Publish version {draft?.version}
            </Button>
            <Button size="sm" variant="ghost" onClick={discard} disabled={busy}>
              <Trash2 />
              Discard draft
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={openDraft} disabled={busy}>
            <Plus />
            Edit template
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <a
            href={`/api/forms/templates/${template.key}/preview${variantKey ? `?variant=${variantKey}` : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            <Eye />
            Preview PDF
          </a>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2">
          {(shown?.blocks ?? []).map((block, index) => {
            const hidden = Boolean(block.variantKey && block.variantKey !== variantKey);
            return (
              <Card
                key={`${block.kind}-${index}`}
                className={cn(hidden && "opacity-45")}
              >
                <CardContent className="space-y-2 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="eyebrow">{block.kind.replace(/_/g, " ")}</p>
                      <p className="truncate text-[13px] text-foreground">{blockLabel(block)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {blockResponsibilities(block).map((responsibility, chipIndex) => (
                        <span
                          key={`${responsibility}-${chipIndex}`}
                          title={RESPONSIBILITY_LABEL[responsibility]}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                            CHIP_TONE[responsibility],
                          )}
                        >
                          {RESPONSIBILITY_CHIP[responsibility]}
                        </span>
                      ))}
                      {editing ? (
                        <button
                          type="button"
                          aria-label="Remove block"
                          onClick={() => removeBlock(index)}
                          className="rounded-[var(--radius-xs)] p-1 text-subtle-foreground transition-colors hover:bg-hover-surface hover:text-status-failed"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {hidden ? (
                    <p className="text-[11px] text-subtle-foreground">
                      Prints only on the {block.variantKey} reading.
                    </p>
                  ) : null}

                  {editing ? <BlockEditor block={block} onChange={(next) => updateBlock(index, next)} /> : null}
                </CardContent>
              </Card>
            );
          })}

          {editing ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {(["section", "field", "paragraph", "signature_row", "page_break"] as const).map(
                (kind) => (
                  <Button key={kind} size="sm" variant="outline" onClick={() => addBlock(kind)}>
                    <Plus />
                    {kind.replace(/_/g, " ")}
                  </Button>
                ),
              )}
            </div>
          ) : null}
        </div>

        <aside className="space-y-3">
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="eyebrow">Version history</p>
              {versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-foreground">v{version.version}</span>
                  <Badge
                    tone={
                      version.status === "published"
                        ? "ready"
                        : version.status === "draft"
                          ? "attention"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {version.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="eyebrow">PDF versions</p>
              {assets.map((asset) => (
                <div key={asset.id} className="space-y-0.5 border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate text-foreground">
                      v{asset.version} · {asset.fileName}
                    </span>
                    <Badge
                      tone={
                        asset.status === "active"
                          ? "ready"
                          : asset.status === "rejected"
                            ? "failed"
                            : "neutral"
                      }
                      size="sm"
                    >
                      {asset.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-subtle-foreground">
                    {asset.validation.rejected
                      ? asset.validation.rejected
                      : asset.acroform.hasFields
                        ? `${asset.acroform.fieldCount} fillable fields — mapping required`
                        : "No fillable fields — reference copy"}
                  </p>
                </div>
              ))}
              <p className="pt-1 text-[11px] leading-snug text-subtle-foreground">
                <Upload className="mr-1 inline size-3" />
                Replace a PDF from the template library. Nothing is ever overwritten.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}

/** The controls for one block. Only the parts of a block that may change. */
function BlockEditor({
  block,
  onChange,
}: {
  block: FormBlock;
  onChange: (block: FormBlock) => void;
}) {
  if (block.kind === "section") {
    return (
      <Input
        value={block.label}
        onChange={(event) => onChange({ ...block, label: event.target.value })}
        className="h-8"
      />
    );
  }

  if (block.kind === "paragraph" || block.kind === "note" || block.kind === "acknowledgement") {
    return (
      <Textarea
        value={block.text}
        rows={2}
        onChange={(event) => onChange({ ...block, text: event.target.value })}
      />
    );
  }

  if (block.kind === "field") {
    return (
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
        <Input
          value={block.field.label}
          onChange={(event) =>
            onChange({ ...block, field: { ...block.field, label: event.target.value } })
          }
          className="h-8"
        />
        <Select
          value={block.field.responsibility}
          onChange={(event) =>
            onChange({
              ...block,
              field: { ...block.field, responsibility: event.target.value as FieldResponsibility },
            })
          }
          className="h-8"
        >
          {FIELD_RESPONSIBILITIES.filter((responsibility) => responsibility !== "signature").map(
            (responsibility) => (
              <option key={responsibility} value={responsibility}>
                {RESPONSIBILITY_LABEL[responsibility]}
              </option>
            ),
          )}
        </Select>
      </div>
    );
  }

  if (block.kind === "checkbox_group" || block.kind === "numbered_list") {
    return (
      <Select
        value={block.responsibility}
        onChange={(event) =>
          onChange({ ...block, responsibility: event.target.value as FieldResponsibility })
        }
        className="h-8 w-56"
      >
        {FIELD_RESPONSIBILITIES.filter((responsibility) => responsibility !== "signature").map(
          (responsibility) => (
            <option key={responsibility} value={responsibility}>
              {RESPONSIBILITY_LABEL[responsibility]}
            </option>
          ),
        )}
      </Select>
    );
  }

  /*
   * A signature row has no editable responsibility, deliberately. There is
   * nothing to choose: it is always blank, always signed by hand, and offering
   * a control here would imply otherwise.
   */
  return null;
}
