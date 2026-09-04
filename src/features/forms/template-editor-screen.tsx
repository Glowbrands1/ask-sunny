"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, Loader2, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/overlays";
import { useSession } from "@/lib/session/session-context";
import { formsFetch, previewTemplatePdf } from "./forms-fetch";
import {
  type FormBlock,
  type FormDocument,
  type FormVariant,
} from "@/lib/forms/document";

import { FormsAccessNotice } from "./forms-gate";
import { BlockSettingsDialog } from "./document/block-settings";
import { DocumentSurface } from "./document/document-surface";
import { DocumentToolbar } from "./document/toolbar";

/**
 * THE TEMPLATE EDITOR — the document, not a settings form.
 *
 * WHAT WAS WRONG BEFORE. This screen used to be a stack of cards, one per
 * block, each showing "Field name / Field type / Responsibility / Label". Every
 * fact about the template was on screen and the FORM was nowhere: you could not
 * see the black section bars, the two-up rows, where a page broke, or what the
 * acknowledgement actually said. Editing the Policy Review meant reading a
 * description of the Policy Review.
 *
 * WHAT IT IS NOW. The published document opens on paper. Click any wording and
 * type it. Every fillable area wears the chip that says who fills it. Page
 * breaks are visible as the seam between two sheets. The toolbar inserts the
 * blocks these nine forms are made of, and a block's gear opens the metadata
 * that used to be the whole screen.
 *
 * WHAT DID NOT CHANGE, deliberately. Every action is still the same server
 * call, against the same immutable version model: opening the editor CLONES a
 * draft, the published version is untouched, and publishing creates a new
 * version that forms already finalized never see. The correction was to the
 * surface, not to the engine underneath it.
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

/** How many steps of undo the editor keeps. Enough to recover a mistake. */
const HISTORY_LIMIT = 60;

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
  const { role, user } = useSession();

  const [draft, setDraft] = React.useState<EditorVersion | null>(
    initialVersions.find((version) => version.status === "draft") ?? null,
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [settingsAt, setSettingsAt] = React.useState<number | null>(null);
  const [pageSetupOpen, setPageSetupOpen] = React.useState(false);

  const current = initialCurrent;
  const variants = (draft ?? current)?.variants ?? [];
  const [variantKey, setVariantKey] = React.useState<string | null>(
    variants[0]?.key ?? null,
  );

  /*
   * UNDO IS A STACK OF DOCUMENTS, not a stack of operations. Inverting an
   * operation is where undo bugs live — "un-delete this block at index 7" is
   * wrong the moment anything else moved — and a form document is small enough
   * that keeping whole copies costs nothing.
   *
   * `past` holds states before the current one; `future` holds states undone.
   * Editing clears the future, which is the behaviour every editor has.
   */
  const [past, setPast] = React.useState<FormDocument[]>([]);
  const [future, setFuture] = React.useState<FormDocument[]>([]);
  const [edited, setEdited] = React.useState<FormDocument | null>(draft?.document ?? null);

  const shown = edited ?? draft?.document ?? current?.document ?? null;
  const editing = draft !== null && edited !== null;
  const dirty = past.length > 0;

  const call = React.useCallback(
    <T,>(url: string, init: RequestInit = {}) => formsFetch<T>(url, role, user.name, init),
    [role, user.name],
  );

  function commit(next: FormDocument) {
    if (!edited) return;
    setPast((stack) => [...stack, edited].slice(-HISTORY_LIMIT));
    setFuture([]);
    setEdited(next);
  }

  function undo() {
    setPast((stack) => {
      if (stack.length === 0 || !edited) return stack;
      const previous = stack[stack.length - 1]!;
      setFuture((ahead) => [edited, ...ahead]);
      setEdited(previous);
      return stack.slice(0, -1);
    });
  }

  function redo() {
    setFuture((stack) => {
      if (stack.length === 0 || !edited) return stack;
      const next = stack[0]!;
      setPast((behind) => [...behind, edited].slice(-HISTORY_LIMIT));
      setEdited(next);
      return stack.slice(1);
    });
  }

  /* ------------------------------------------------------ server actions -- */

  async function openDraft() {
    setBusy("draft");
    setProblem(null);
    try {
      const result = await call<{ draft: EditorVersion; clonedFrom: number | null }>(
        `/api/forms/templates/${template.key}/draft`,
        { method: "POST" },
      );
      setDraft(result.draft);
      setEdited(result.draft.document);
      setPast([]);
      setFuture([]);
      setMessage(
        result.clonedFrom
          ? `Draft opened as version ${result.draft.version}, cloned from version ${result.clonedFrom}. The published version is untouched.`
          : `Continuing the open draft, version ${result.draft.version}.`,
      );
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!draft || !edited) return;
    setBusy("save");
    setProblem(null);
    try {
      const result = await call<{ draft: EditorVersion }>(
        `/api/forms/templates/${template.key}/draft`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            versionId: draft.id,
            document: edited,
            variants: draft.variants,
            notes: draft.notes,
          }),
        },
      );
      setDraft(result.draft);
      setPast([]);
      setFuture([]);
      setMessage("Draft saved. It is not live until you publish it.");
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!draft) return;
    /*
     * A DRAFT WITH NOTHING CHANGED IS NOT A NEW VERSION. Publishing one would
     * archive a perfectly good version and add a number that means nothing, and
     * the version history is the audit trail — padding it makes it useless.
     */
    if (dirty) {
      setProblem("Save the draft first, so the version that gets published is what you can see.");
      return;
    }
    setBusy("publish");
    setProblem(null);
    try {
      await call(`/api/forms/templates/${template.key}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: draft.id }),
      });
      setMessage(`Version ${draft.version} published. New forms use it from now on.`);
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!draft) return;
    setBusy("discard");
    try {
      await call(`/api/forms/templates/${template.key}/draft?versionId=${draft.id}`, {
        method: "DELETE",
      });
      setDraft(null);
      setEdited(null);
      setPast([]);
      setFuture([]);
      setMessage("Draft discarded. The published version is unchanged.");
      router.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /* -------------------------------------------------- document mutations -- */

  function editBlock(index: number, next: FormBlock) {
    if (!edited) return;
    const blocks = [...edited.blocks];
    blocks[index] = next;
    commit({ ...edited, blocks });
  }

  function moveBlock(index: number, direction: -1 | 1) {
    if (!edited) return;
    const target = index + direction;
    if (target < 0 || target >= edited.blocks.length) return;
    const blocks = [...edited.blocks];
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    commit({ ...edited, blocks });
    setSelected(target);
  }

  function deleteBlock(index: number) {
    if (!edited) return;
    commit({ ...edited, blocks: edited.blocks.filter((_, at) => at !== index) });
    setSelected(null);
  }

  /** Insert lands after the selection, or at the end when nothing is selected. */
  function insertBlock(block: FormBlock) {
    if (!edited) return;
    const at = selected === null ? edited.blocks.length : selected + 1;
    const blocks = [...edited.blocks];

    // A new field's key has to be unique or the document refuses to parse, and
    // "new_field" is the key the toolbar hands over every time.
    const withKey = uniquifyKeys(block, collectKeys(edited.blocks));
    blocks.splice(at, 0, withKey);
    commit({ ...edited, blocks });
    setSelected(at);
  }

  const selectionLabel =
    selected === null || !shown
      ? "the end"
      : describeBlock(shown.blocks[selected]);

  async function preview() {
    setBusy("preview");
    setProblem(null);
    try {
      await previewTemplatePdf(template.key, variantKey, role, user.name);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Authorized admin"
        title={`${template.name} template`}
        description="Edit the document this form prints from. Click any wording and type; the chips show where Ask Sunny fills the draft."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/forms/templates">
              <ArrowLeft />
              All templates
            </Link>
          </Button>
        }
      />

      <FormsAccessNotice permission="manage_form_templates" />

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

      {/* ------------------------------------------------------- the bar -- */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-2">
            {current ? (
              <Badge tone="ready" size="sm">
                Published v{current.version}
              </Badge>
            ) : (
              <Badge tone="neutral" size="sm">
                Never published
              </Badge>
            )}
            {draft ? (
              <Badge tone="attention" size="sm">
                Draft v{draft.version}
                {dirty ? " · unsaved" : ""}
              </Badge>
            ) : null}
          </div>

          {variants.length > 1 ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="variant-switch" className="text-[12px] whitespace-nowrap">
                Reading
              </Label>
              <Select
                id="variant-switch"
                value={variantKey ?? ""}
                onChange={(event) => setVariantKey(event.target.value || null)}
                className="h-8 w-64"
              >
                {variants.map((variant) => (
                  <option key={variant.key} value={variant.key}>
                    {variant.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!editing ? (
              <Button size="sm" onClick={openDraft} disabled={busy !== null}>
                {busy === "draft" ? <Loader2 className="animate-spin" /> : null}
                Edit template
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={saveDraft}
                  disabled={busy !== null || !dirty}
                >
                  {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
                  Save draft
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={preview}
                  disabled={busy !== null}
                >
                  {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
                  Preview PDF
                </Button>
                <Button size="sm" onClick={publish} disabled={busy !== null}>
                  {busy === "publish" ? <Loader2 className="animate-spin" /> : <Check />}
                  Publish v{draft?.version}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={discard}
                  disabled={busy !== null}
                >
                  {busy === "discard" ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Discard
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {!editing ? (
        <Notice tone="neutral" className="mb-4">
          This is the published version, exactly as it prints. Press{" "}
          <span className="text-foreground">Edit template</span> to open a draft — the
          published version stays untouched, and forms already finalized keep printing
          the version they were signed against.
        </Notice>
      ) : (
        <Notice tone="neutral" className="mb-4">
          You are editing <span className="text-foreground">draft v{draft?.version}</span>.
          The chips are editor markings and never print. Signature lines are always blank.
        </Notice>
      )}

      {/* ----------------------------------------------------- the paper -- */}
      {shown ? (
        <>
          {editing ? (
            <DocumentToolbar
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              onUndo={undo}
              onRedo={redo}
              onInsert={insertBlock}
              onPageSetup={() => setPageSetupOpen(true)}
              selectionLabel={selectionLabel}
              className="mb-4"
            />
          ) : null}

          <DocumentSurface
            document={shown}
            mode={editing ? "edit" : "read"}
            variant={variants.find((entry) => entry.key === variantKey) ?? null}
            selectedIndex={selected}
            onSelect={setSelected}
            onEditBlock={editBlock}
            onMove={moveBlock}
            onDelete={deleteBlock}
            onSettings={setSettingsAt}
          />
        </>
      ) : (
        <Notice tone="attention">This template has no version to show.</Notice>
      )}

      <BlockSettingsDialog
        block={
          settingsAt !== null && shown
            ? { block: shown.blocks[settingsAt]!, index: settingsAt }
            : null
        }
        variants={variants}
        onChange={editBlock}
        onClose={() => setSettingsAt(null)}
      />

      <PageSetupDialog
        open={pageSetupOpen}
        onClose={() => setPageSetupOpen(false)}
        template={template}
        variants={variants}
        assets={assets}
      />
    </PageShell>
  );
}

/* ------------------------------------------------------------- page setup - */

/**
 * PAGE SETUP, and the honest scope of it.
 *
 * Paper is Letter and orientation is portrait because the PDF renderer draws
 * one page size and the nine reference forms are all Letter portrait. Offering
 * A4 or landscape here would be a control that changes the screen and not the
 * print, which is worse than not offering it — so the dialog SAYS the paper is
 * fixed, and shows the geometry the page is actually laid out to.
 */
function PageSetupDialog({
  open,
  onClose,
  template,
  variants,
  assets,
}: {
  open: boolean;
  onClose: () => void;
  template: EditorTemplate;
  variants: FormVariant[];
  assets: EditorAsset[];
}) {
  const activeAsset = assets.find((asset) => asset.status === "active") ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent title="Page setup">
        <div className="space-y-4 text-[13px] leading-relaxed">
          <div>
            <p className="eyebrow">Paper</p>
            <p className="mt-1 text-muted-foreground">
              US Letter, portrait, 54pt margins. Fixed: this is the geometry the PDF is
              drawn to, and the on-screen page is laid out from the same numbers, so what
              fits here fits there.
            </p>
          </div>

          <div>
            <p className="eyebrow">Role readings</p>
            {variants.length > 0 ? (
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {variants.map((variant) => (
                  <li key={variant.key}>
                    <span className="text-foreground">{variant.label}</span> —{" "}
                    <code className="text-[12px]">{"{{role}}"}</code> becomes{" "}
                    {variant.role}, <code className="text-[12px]">{"{{roleAbbr}}"}</code>{" "}
                    becomes {variant.roleAbbr}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted-foreground">
                This form reads one way, so <code className="text-[12px]">{"{{role}}"}</code>{" "}
                is not used in it.
              </p>
            )}
          </div>

          <div>
            <p className="eyebrow">Official PDF</p>
            <p className="mt-1 text-muted-foreground">
              {activeAsset?.kind === "upload"
                ? `${activeAsset.fileName} — upload v${activeAsset.version}, kept as the reference copy. Downloads are drawn from this document template.`
                : "No replacement uploaded, so downloads are drawn from this document template."}{" "}
              Replace it from{" "}
              <Link href="/forms/templates" className="text-foreground underline">
                Form Templates
              </Link>
              .
            </p>
          </div>

          <div>
            <p className="eyebrow">Layout family</p>
            <p className="mt-1 text-muted-foreground">{template.layoutFamily}</p>
          </div>
        </div>
        <DialogActions>
          <Button onClick={onClose}>Done</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------- helpers -- */

function describeBlock(block: FormBlock | undefined): string {
  if (!block) return "the end";
  switch (block.kind) {
    case "letterhead":
      return "the letterhead";
    case "section":
      return `“${block.label}”`;
    case "field":
      return `“${block.field.label}”`;
    case "field_row":
      return `“${block.fields.map((field) => field.label).join(" / ")}”`;
    case "checkbox_group":
      return `“${block.label ?? "checkboxes"}”`;
    case "numbered_list":
      return `“${block.label}”`;
    case "signature_row":
      return `“${block.label}”`;
    case "page_break":
      return "the page break";
    case "reference":
      return `“${block.label}”`;
    case "paragraph":
    case "note":
    case "acknowledgement":
      return `“${block.text.slice(0, 28)}…”`;
  }
}

/** Every field and group key already in the document. */
function collectKeys(blocks: readonly FormBlock[]): Set<string> {
  const keys = new Set<string>();
  for (const block of blocks) {
    if (block.kind === "field") keys.add(block.field.key);
    if (block.kind === "field_row") block.fields.forEach((field) => keys.add(field.key));
    if (block.kind === "checkbox_group" || block.kind === "numbered_list") keys.add(block.key);
  }
  return keys;
}

/**
 * Renames an inserted block's keys until they are unique.
 *
 * `parseFormDocument` refuses a document with a duplicate key — correctly, since
 * two fields sharing a key would overwrite each other's values — so inserting a
 * second "New field" has to not produce one.
 */
function uniquifyKeys(block: FormBlock, taken: Set<string>): FormBlock {
  const fresh = (key: string) => {
    if (!taken.has(key)) {
      taken.add(key);
      return key;
    }
    let counter = 2;
    while (taken.has(`${key}_${counter}`)) counter += 1;
    const next = `${key}_${counter}`;
    taken.add(next);
    return next;
  };

  if (block.kind === "field") {
    return { ...block, field: { ...block.field, key: fresh(block.field.key) } };
  }
  if (block.kind === "field_row") {
    return { ...block, fields: block.fields.map((field) => ({ ...field, key: fresh(field.key) })) };
  }
  if (block.kind === "checkbox_group" || block.kind === "numbered_list") {
    return { ...block, key: fresh(block.key) };
  }
  return block;
}
