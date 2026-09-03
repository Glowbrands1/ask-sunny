"use client";

import * as React from "react";
import { Check, Download, FileText, Loader2, Sparkles, WandSparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { useSession } from "@/lib/session/session-context";
import { downloadFormPdf, formsFetch } from "./forms-fetch";
import { cn } from "@/lib/utils/cn";
import {
  RESPONSIBILITY_CHIP,
  RESPONSIBILITY_LABEL,
  type FieldResponsibility,
  type FormBlock,
  type FormDocument,
  type FormVariant,
} from "@/lib/forms/document";

/**
 * CREATE A FORM.
 *
 * Four steps, and the third is the one this whole feature exists for:
 *
 *   1  which form, and — where the form has readings — which one
 *   2  who it is about
 *   3  fill it: type it, or describe what happened and let Ask Sunny draft the
 *      fields it is allowed to draft
 *   4  finalize and download
 *
 * WHAT THE MANAGER CAN SEE AT EVERY POINT: who owns each field. An AI-drafted
 * field is editable and says it was drafted; a hand-filled line is shown but not
 * editable, because it is answered on the printed page in the conversation; a
 * signature line has no input at all. The chips are the same words the template
 * editor and the audit trail use, so nobody has to learn two vocabularies.
 *
 * Nothing is stored in this component that the server does not already have.
 * Every save is a request, and finalizing freezes the record.
 */

export interface CreatableTemplate {
  key: string;
  name: string;
  description: string;
  variants: FormVariant[];
}

export interface LoadedForm {
  instance: {
    id: string;
    templateName: string;
    templateVersion: number;
    variantKey: string | null;
    employeeName: string;
    status: "draft" | "finalized" | "revised";
    followUpDate: string | null;
  };
  document: FormDocument;
  variants: FormVariant[];
  values: Record<string, string>;
  checked: Record<string, string[]>;
  filledBy: Record<string, FieldResponsibility>;
}

const EDITABLE: FieldResponsibility[] = ["ai", "manager", "employee", "system"];

export function CreateFormFlow({
  templates,
  notice,
  employees,
  locations,
  fromChat = false,
  initialTemplateKey = null,
  initialEmployeeName = null,
}: {
  templates: CreatableTemplate[];
  notice: string | null;
  employees: string[];
  locations: { id: string; name: string }[];
  /** True when the manager arrived from a conversation with Sunny. */
  fromChat?: boolean;
  /** Already checked against the published library by the page. */
  initialTemplateKey?: string | null;
  initialEmployeeName?: string | null;
}) {
  /*
   * THE HANDOFF ARRIVES AS INITIAL STATE, NOT AS AN EFFECT.
   *
   * Both values are read on the server from the URL and handed down, so the
   * first render is already the right one — no effect that sets state after the
   * fact, no flash of the wrong form, and nothing left in browser storage to go
   * stale between visits.
   */
  const opening = initialTemplateKey
    ? (templates.find((entry) => entry.key === initialTemplateKey) ?? templates[0])
    : templates[0];

  const [templateKey, setTemplateKey] = React.useState(opening?.key ?? "");
  const [variantKey, setVariantKey] = React.useState<string>(
    initialTemplateKey ? (opening?.variants[0]?.key ?? "") : "",
  );
  const [employeeName, setEmployeeName] = React.useState(initialEmployeeName ?? "");
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [form, setForm] = React.useState<LoadedForm | null>(null);
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [withheld, setWithheld] = React.useState<string[]>([]);
  const { role, user } = useSession();

  const template = templates.find((entry) => entry.key === templateKey) ?? null;

  /*
   * The reading follows the form, without an effect. Choosing a template resets
   * the variant in the same handler that changed the template — an effect that
   * calls setState after the fact renders once with a variant belonging to the
   * previous form, which is exactly the sort of glitch that puts a TSD reading
   * on a coaching form.
   */
  function chooseTemplate(key: string) {
    setTemplateKey(key);
    const next = templates.find((entry) => entry.key === key) ?? null;
    setVariantKey(next?.variants[0]?.key ?? "");
  }

  const call = React.useCallback(
    <T,>(url: string, init: RequestInit = {}) => formsFetch<T>(url, role, user.name, init),
    [role, user.name],
  );

  async function reload(id: string) {
    const loaded = await call<{
      instance: LoadedForm["instance"] & { templateVersionId: string };
      version: { document: FormDocument; variants: FormVariant[] };
      values: { fieldKey: string; value: string | null; checked: string[]; filledBy: FieldResponsibility }[];
    }>(`/api/forms/instances/${id}`);

    const values: Record<string, string> = {};
    const checked: Record<string, string[]> = {};
    const filledBy: Record<string, FieldResponsibility> = {};
    for (const row of loaded.values) {
      if (row.value !== null) values[row.fieldKey] = row.value;
      if (row.checked.length) checked[row.fieldKey] = row.checked;
      filledBy[row.fieldKey] = row.filledBy;
    }

    setForm({
      instance: loaded.instance,
      document: loaded.version.document,
      variants: loaded.version.variants,
      values,
      checked,
      filledBy,
    });
  }

  async function start() {
    if (!template || !employeeName.trim()) return;
    setBusy("start");
    setProblem(null);
    try {
      const created = await call<{ instance: { id: string } }>("/api/forms/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateKey,
          variantKey: variantKey || null,
          employeeName: employeeName.trim(),
          locationId: locationId || null,
          locationName: locations.find((entry) => entry.id === locationId)?.name ?? null,
          source: "manual",
        }),
      });
      await reload(created.instance.id);
      setMessage(null);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!form) return;
    setBusy("save");
    setProblem(null);
    try {
      await call(`/api/forms/instances/${form.instance.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: form.values, checked: form.checked }),
      });
      await reload(form.instance.id);
      setMessage("Saved.");
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function askSunny() {
    if (!form) return;
    setBusy("draft");
    setProblem(null);
    setWithheld([]);
    try {
      const result = await call<{
        withheld: string[];
        notice: string | null;
      }>(`/api/forms/instances/${form.instance.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      await reload(form.instance.id);
      setWithheld(result.withheld ?? []);
      setMessage(
        result.notice ??
          "Ask Sunny drafted the fields it is allowed to fill. Review every one before finalizing.",
      );
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function finalize() {
    if (!form) return;
    setBusy("finalize");
    setProblem(null);
    try {
      await call(`/api/forms/instances/${form.instance.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "finalize",
          followUpDate: form.values.follow_up_week || form.values.follow_up_date || null,
        }),
      });
      await reload(form.instance.id);
      setMessage("Finalized. Its values are frozen — a correction is a revision.");
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!form) {
    return (
      <div className="space-y-4">
        {notice ? <Notice tone="attention">{notice}</Notice> : null}
        {problem ? <Notice tone="attention">{problem}</Notice> : null}
        {fromChat && initialTemplateKey ? (
          <Notice tone="accent" title={`Carried over from your conversation: ${opening?.name}`}>
            The form and the employee came across. The wording Sunny drafted in chat did
            not — it was written against the old template, not the published version this
            form prints from. Start the form and use{" "}
            <span className="font-medium">Ask Sunny to draft</span> to fill it from the
            version itself.
          </Notice>
        ) : null}

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="template">Form</Label>
                <Select
                  id="template"
                  value={templateKey}
                  onChange={(event) => chooseTemplate(event.target.value)}
                >
                  {templates.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
                {template ? (
                  <p className="text-[12px] leading-snug text-muted-foreground">
                    {template.description}
                  </p>
                ) : null}
              </div>

              {template && template.variants.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="variant">Reading</Label>
                  <Select
                    id="variant"
                    value={variantKey}
                    onChange={(event) => setVariantKey(event.target.value)}
                  >
                    {template.variants.map((variant) => (
                      <option key={variant.key} value={variant.key}>
                        {variant.label} — reviewed with {variant.role}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="employee">Employee</Label>
                <Input
                  id="employee"
                  list="synthetic-employees"
                  value={employeeName}
                  placeholder="Synthetic name for testing"
                  onChange={(event) => setEmployeeName(event.target.value)}
                />
                <datalist id="synthetic-employees">
                  {employees.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="location">Location</Label>
                <Select
                  id="location"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  {locations.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <Button onClick={start} disabled={!employeeName.trim() || busy === "start"}>
              {busy === "start" ? <Loader2 className="animate-spin" /> : <FileText />}
              Start this form
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const variant = form.variants.find((entry) => entry.key === form.instance.variantKey) ?? null;
  const readOnly = form.instance.status !== "draft";

  return (
    <div className="space-y-4">
      {notice ? <Notice tone="attention">{notice}</Notice> : null}
      {problem ? <Notice tone="attention">{problem}</Notice> : null}
      {message ? <Notice tone="accent">{message}</Notice> : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{form.instance.templateName}</p>
            <p className="text-[15px] font-semibold text-foreground">
              {form.instance.employeeName}
            </p>
          </div>
          <Badge tone={readOnly ? "ready" : "attention"}>{form.instance.status}</Badge>
          <Badge tone="neutral">Template v{form.instance.templateVersion}</Badge>
          {variant ? <Badge tone="neutral">{variant.label}</Badge> : null}
        </CardContent>
      </Card>

      {!readOnly ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="notes">Tell Ask Sunny what happened</Label>
              <Textarea
                id="notes"
                rows={3}
                value={notes}
                placeholder="What you observed, when, and what you agreed. Ask Sunny drafts only the fields this template lets it fill."
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={askSunny} disabled={notes.trim().length < 10 || busy === "draft"}>
                {busy === "draft" ? <Loader2 className="animate-spin" /> : <WandSparkles />}
                Ask Sunny to draft
              </Button>
              <Button variant="secondary" onClick={save} disabled={busy === "save"}>
                {busy === "save" ? <Loader2 className="animate-spin" /> : <Check />}
                Save draft
              </Button>
            </div>
            {withheld.length > 0 ? (
              <Notice tone="attention">
                Ask Sunny left {withheld.length} policy field
                {withheld.length === 1 ? "" : "s"} empty because no approved policy matched.
                Write them yourself — nothing is quoted that the manual does not say.
              </Notice>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        {form.document.blocks
          .filter((block) => !block.variantKey || block.variantKey === form.instance.variantKey)
          .map((block, index) => (
            <BlockFiller
              key={`${block.kind}-${index}`}
              block={block}
              variant={variant}
              form={form}
              readOnly={readOnly}
              onChange={(next) => setForm({ ...form, ...next })}
            />
          ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {!readOnly ? (
            <Button onClick={finalize} disabled={busy === "finalize"}>
              {busy === "finalize" ? <Loader2 className="animate-spin" /> : <Check />}
              Finalize
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={busy === "download"}
            onClick={async () => {
              setBusy("download");
              setProblem(null);
              try {
                await downloadFormPdf(form.instance.id, role, user.name);
              } catch (error) {
                setProblem((error as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
            Download PDF
          </Button>
          <Button variant="ghost" onClick={() => setForm(null)}>
            <Sparkles />
            Start another
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function chip(responsibility: FieldResponsibility) {
  return (
    <span
      title={RESPONSIBILITY_LABEL[responsibility]}
      className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {RESPONSIBILITY_CHIP[responsibility]}
    </span>
  );
}

function BlockFiller({
  block,
  variant,
  form,
  readOnly,
  onChange,
}: {
  block: FormBlock;
  variant: FormVariant | null;
  form: LoadedForm;
  readOnly: boolean;
  onChange: (next: Partial<LoadedForm>) => void;
}) {
  const resolve = (text: string) =>
    text
      .replace(/\{\{role\}\}/g, variant?.role ?? "the reviewer")
      .replace(/\{\{roleAbbr\}\}/g, variant?.roleAbbr ?? "the employee");

  const setValue = (key: string, value: string) =>
    onChange({ values: { ...form.values, [key]: value } });

  const toggle = (key: string, option: string) => {
    const current = new Set(form.checked[key] ?? []);
    if (current.has(option)) current.delete(option);
    else current.add(option);
    onChange({ checked: { ...form.checked, [key]: [...current] } });
  };

  if (block.kind === "section") {
    return (
      <div className="rounded-[var(--radius-sm)] bg-selected px-3 py-2 text-center text-[12px] font-semibold tracking-wide text-selected-foreground uppercase">
        {resolve(block.label)}
      </div>
    );
  }

  if (block.kind === "signature_row") {
    return (
      <div className="flex items-center gap-3 px-3 py-2 text-[12px] text-subtle-foreground">
        <span className="h-px flex-1 bg-border-strong" />
        {block.label} · signed by hand
        <span className="h-px flex-1 bg-border-strong" />
      </div>
    );
  }

  if (block.kind === "page_break") {
    return (
      <div className="flex items-center gap-3 px-3 py-1 text-[10px] tracking-widest text-subtle-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        page break
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (block.kind === "paragraph" || block.kind === "note" || block.kind === "acknowledgement") {
    return (
      <p className="px-3 text-[12px] leading-snug text-muted-foreground">{resolve(block.text)}</p>
    );
  }

  if (block.kind === "reference") {
    return (
      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="eyebrow">{resolve(block.label)}</p>
          {block.body.map((line, index) => (
            <p key={index} className="text-[12px] leading-snug text-muted-foreground">
              {resolve(line)}
            </p>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (block.kind === "checkbox_group") {
    const editable = !readOnly && EDITABLE.includes(block.responsibility);
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-muted-foreground">{resolve(block.label ?? "")}</p>
            {chip(block.responsibility)}
          </div>
          <div className={cn("grid gap-1.5", block.columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            {block.options.map((option) => {
              const ticked = (form.checked[block.key] ?? []).includes(option.key);
              return (
                <label
                  key={option.key}
                  className={cn(
                    "flex items-center gap-2 text-[13px]",
                    editable ? "cursor-pointer" : "cursor-default opacity-80",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={ticked}
                    disabled={!editable}
                    onChange={() => toggle(block.key, option.key)}
                    className="size-3.5 accent-[var(--selected)]"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (block.kind === "numbered_list") {
    const editable = !readOnly && EDITABLE.includes(block.responsibility);
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-muted-foreground">{resolve(block.label)}</p>
            {chip(block.responsibility)}
          </div>
          <Textarea
            rows={block.count}
            value={form.values[block.key] ?? ""}
            disabled={!editable}
            placeholder={editable ? "One per line" : "Completed on the printed form"}
            onChange={(event) => setValue(block.key, event.target.value)}
          />
        </CardContent>
      </Card>
    );
  }

  const fields = block.kind === "field" ? [block.field] : block.kind === "field_row" ? block.fields : [];
  if (fields.length === 0) return null;

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        {fields.map((field) => {
          const editable = !readOnly && EDITABLE.includes(field.responsibility);
          const drafted = form.filledBy[field.key] === "ai";
          return (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={field.key}>{resolve(field.label)}</Label>
                {chip(field.responsibility)}
              </div>
              {field.input === "long_text" ? (
                <Textarea
                  id={field.key}
                  rows={3}
                  value={form.values[field.key] ?? ""}
                  disabled={!editable}
                  placeholder={editable ? "" : "Completed on the printed form"}
                  onChange={(event) => setValue(field.key, event.target.value)}
                />
              ) : (
                <Input
                  id={field.key}
                  type={field.input === "date" ? "date" : "text"}
                  value={form.values[field.key] ?? ""}
                  disabled={!editable}
                  onChange={(event) => setValue(field.key, event.target.value)}
                />
              )}
              {drafted ? (
                <p className="text-[11px] text-subtle-foreground">
                  Drafted by Ask Sunny — edit before finalizing.
                </p>
              ) : null}
              {field.help ? (
                <p className="text-[11px] leading-snug text-subtle-foreground">{field.help}</p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
