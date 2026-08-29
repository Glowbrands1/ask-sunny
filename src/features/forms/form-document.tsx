"use client";

import { Sparkles } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/controls";
import { ACTIVE_BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils/cn";
import { formatLongDate } from "@/lib/utils/date";
import type { FormTemplate, TemplateField } from "@/types";

/**
 * The printed-form view.
 *
 * This is the single biggest improvement over the reference platform: when
 * `editable` is true every AI-drafted field is a real input rendered inside the
 * document, so a manager corrects the draft directly instead of asking chat to
 * change it.
 *
 * Signature lines are always rendered blank and are never editable here — they
 * are signed in person on the printed form.
 */
export function FormDocument({
  template,
  values,
  checkedOptions,
  editable,
  onValueChange,
  onToggleOption,
  className,
}: {
  template: FormTemplate;
  values: Record<string, string>;
  checkedOptions: Record<string, string[]>;
  editable?: boolean;
  onValueChange?: (fieldId: string, value: string) => void;
  onToggleOption?: (fieldId: string, option: string) => void;
  className?: string;
}) {
  const sections = template.fields.reduce<Record<string, TemplateField[]>>(
    (acc, field) => {
      acc[field.section] = acc[field.section] ?? [];
      acc[field.section].push(field);
      return acc;
    },
    {},
  );

  return (
    <article
      className={cn(
        "rounded-[var(--radius-lg)] border border-border bg-surface shadow-soft",
        className,
      )}
    >
      {/* Form header block */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-foreground/80 px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <SunMark className="size-7" />
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {ACTIVE_BRAND.brandName}
            </p>
            <h2 className="text-[19px] leading-tight font-semibold text-foreground">
              {template.name}
            </h2>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Form date
          </p>
          <p className="mt-0.5 text-[13px] font-medium text-foreground">
            {values.form_date ? formatLongDate(values.form_date) : "—"}
          </p>
        </div>
      </header>

      <div className="space-y-7 px-6 py-6 sm:px-8">
        {Object.entries(sections).map(([sectionName, fields]) => {
          if (sectionName === "Acknowledgement") return null;
          return (
            <section key={sectionName}>
              <h3 className="mb-3.5 border-b border-border pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {sectionName}
              </h3>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {fields
                  .filter((field) => field.type !== "signature")
                  .map((field) => (
                    <FormFieldRow
                      key={field.id}
                      field={field}
                      value={values[field.id] ?? ""}
                      selected={checkedOptions[field.id] ?? []}
                      editable={editable}
                      onValueChange={onValueChange}
                      onToggleOption={onToggleOption}
                    />
                  ))}
              </div>
            </section>
          );
        })}

        {/* Acknowledgement + signatures */}
        <section>
          <h3 className="mb-3.5 border-b border-border pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Acknowledgement
          </h3>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {template.acknowledgement}
          </p>

          <div className="mt-7 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {["Employee signature", "Manager signature"].map((label) => (
              <div key={label}>
                <div className="h-9 border-b border-foreground/60" aria-hidden />
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Date</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-subtle-foreground">
            Signature lines are never filled by Sunny. They are signed in person
            on the printed form.
          </p>
        </section>
      </div>
    </article>
  );
}

function FormFieldRow({
  field,
  value,
  selected,
  editable,
  onValueChange,
  onToggleOption,
}: {
  field: TemplateField;
  value: string;
  selected: string[];
  editable?: boolean;
  onValueChange?: (fieldId: string, value: string) => void;
  onToggleOption?: (fieldId: string, option: string) => void;
}) {
  const wide = field.type === "long_text" || field.type === "checkbox_group";
  const aiFilled = field.fillRule === "ai_populate";

  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label
          htmlFor={`doc-${field.id}`}
          className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
        >
          {field.label}
        </label>
        {editable && aiFilled ? (
          <Badge tone="primary" size="sm">
            <Sparkles className="size-2.5" aria-hidden />
            Sunny drafted
          </Badge>
        ) : null}
        {editable && field.fillRule === "manager_completes" ? (
          <Badge tone="neutral" size="sm">
            You complete
          </Badge>
        ) : null}
      </div>

      {field.type === "checkbox_group" ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-0.5">
          {(field.options ?? []).map((option) => {
            const checked = selected.includes(option);
            const id = `doc-${field.id}-${option.replace(/\W+/g, "-")}`;
            return (
              <div key={option} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={!editable}
                  onCheckedChange={() => onToggleOption?.(field.id, option)}
                  className="size-4 rounded-[3px]"
                />
                <label
                  htmlFor={id}
                  className={cn(
                    "text-[13px] text-foreground",
                    editable ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  {option}
                </label>
              </div>
            );
          })}
        </div>
      ) : field.type === "long_text" ? (
        editable ? (
          <textarea
            id={`doc-${field.id}`}
            value={value}
            onChange={(event) => onValueChange?.(field.id, event.target.value)}
            rows={4}
            placeholder={field.helpText ?? `Enter ${field.label.toLowerCase()}`}
            className="scroll-slim w-full resize-y rounded-[var(--radius-xs)] border border-dashed border-border-strong bg-surface-muted/60 px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-subtle-foreground transition-colors hover:border-primary focus-visible:border-primary focus-visible:bg-surface"
          />
        ) : (
          <p className="min-h-16 rounded-[var(--radius-xs)] border-b border-border px-0.5 pb-2 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
            {value || <span className="text-subtle-foreground">—</span>}
          </p>
        )
      ) : editable ? (
        <input
          id={`doc-${field.id}`}
          type={field.type === "date" ? "date" : "text"}
          value={value}
          onChange={(event) => onValueChange?.(field.id, event.target.value)}
          placeholder={`Enter ${field.label.toLowerCase()}`}
          className="w-full rounded-[var(--radius-xs)] border border-dashed border-border-strong bg-surface-muted/60 px-3 py-1.5 text-[13px] text-foreground placeholder:text-subtle-foreground transition-colors hover:border-primary focus-visible:border-primary focus-visible:bg-surface"
        />
      ) : (
        <p className="border-b border-border pb-1.5 text-[13px] text-foreground">
          {field.type === "date" && value ? (
            formatLongDate(value)
          ) : (
            value || <span className="text-subtle-foreground">—</span>
          )}
        </p>
      )}

      {editable && field.helpText && field.type !== "long_text" ? (
        <p className="mt-1 text-[11px] leading-relaxed text-subtle-foreground">
          {field.helpText}
        </p>
      ) : null}
    </div>
  );
}
