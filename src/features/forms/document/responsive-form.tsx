"use client";

import * as React from "react";

import { Checkbox } from "@/components/ui/controls";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  blockAppliesToVariant,
  interpolate,
  RESPONSIBILITY_LABEL,
  type FormBlock,
  type FormDocument,
  type FormField,
  type FormVariant,
} from "@/lib/forms/document";
import { canPersonEdit } from "@/lib/forms/responsibility";
import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * THE FORM AS AN APPLICATION SCREEN, NOT AS A SHEET OF PAPER
 * ============================================================================
 *
 * `DocumentSurface` renders the same document at Letter geometry — a fixed
 * 816px `Sheet`, scaled with a transform rather than reflowed, because the
 * point of the template editor is seeing whether the printed page fits.
 *
 * That is exactly wrong inside a chat thread. Marissa named the horizontal
 * scrollbar specifically and asked for the on-screen version to be built
 * fresh rather than the paper replica dropped into the conversation. So this is
 * a second RENDERER, not a second MODEL: same `FormDocument`, same blocks, same
 * field keys, same variant filtering, same responsibility rules — laid out as a
 * form you fill in on a phone.
 *
 *   no fixed width          every container is fluid, `min-w-0` throughout
 *   one column on mobile    `field_row` becomes `sm:grid-cols-2`, not a row
 *   no pagination           `page_break` renders nothing; there is no page
 *   no letterhead           the card above it already says which form this is
 *
 * The PDF renderer is untouched and still prints from the same document, so the
 * page a manager signs is unchanged by anything here.
 *
 * ============================================================================
 * WHAT IT REFUSES TO LET A PERSON TYPE INTO
 * ============================================================================
 *
 * `canPersonEdit` is the same predicate the SERVER applies in
 * `enforcePersonEdit`, imported rather than restated. A signature line gets no
 * control at all — not a disabled one — because there is nothing to type into
 * it: it is signed on paper. A `manual` line is shown and not editable, because
 * it is answered by hand in the conversation itself.
 *
 * This is presentation. The server rejects a value for a field it does not own
 * whatever this component renders, which is why the two are allowed to be
 * separate functions rather than one shared branch.
 */

export interface ResponsiveFormValues {
  values: Record<string, string>;
  checked: Record<string, string[]>;
}

export function ResponsiveForm({
  document: doc,
  variant,
  values,
  readOnly = false,
  onValue,
  onToggle,
  className,
}: {
  document: FormDocument;
  variant: FormVariant | null;
  values: ResponsiveFormValues;
  /** True for a finalized form: everything renders, nothing accepts input. */
  readOnly?: boolean;
  onValue?: (key: string, value: string) => void;
  onToggle?: (key: string, option: string) => void;
  className?: string;
}) {
  const visible = React.useMemo(
    () => doc.blocks.filter((block) => blockAppliesToVariant(block, variant?.key ?? null)),
    [doc.blocks, variant?.key],
  );

  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {visible.map((block, index) => (
        <BlockField
          key={`${block.kind}-${index}`}
          block={block}
          variant={variant}
          values={values}
          readOnly={readOnly}
          onValue={onValue}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function BlockField({
  block,
  variant,
  values,
  readOnly,
  onValue,
  onToggle,
}: {
  block: FormBlock;
  variant: FormVariant | null;
  values: ResponsiveFormValues;
  readOnly: boolean;
  onValue?: (key: string, value: string) => void;
  onToggle?: (key: string, option: string) => void;
}) {
  const text = (value: string) => interpolate(value, variant);

  switch (block.kind) {
    /*
     * The letterhead is the printed page's masthead — brand, form title. The
     * card this renders inside already names the form and its status, so
     * repeating it would be a second heading saying the same thing.
     */
    case "letterhead":
      return null;

    /* There is no page here, so there is nothing to break. */
    case "page_break":
      return null;

    case "section":
      return (
        <h4 className="border-b border-border pt-2 pb-1.5 text-[13px] font-semibold tracking-tight text-foreground">
          {text(block.label)}
        </h4>
      );

    case "paragraph":
      return (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{text(block.text)}</p>
      );

    case "note":
      return (
        <p className="text-xs leading-relaxed text-subtle-foreground italic">{text(block.text)}</p>
      );

    case "acknowledgement":
      return (
        <p className="rounded-[var(--radius-sm)] bg-surface-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {text(block.text)}
        </p>
      );

    case "reference":
      return (
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-foreground">{text(block.label)}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            {block.body.map((line, index) => (
              <li key={index}>{text(line)}</li>
            ))}
          </ul>
        </div>
      );

    case "field":
      return (
        <FieldControl
          field={block.field}
          variant={variant}
          value={values.values[block.field.key] ?? ""}
          readOnly={readOnly}
          onValue={onValue}
        />
      );

    /*
     * THE ROW THAT IS NOT A ROW ON A PHONE. Two-up on the printed page and at
     * `sm` and above; stacked below it. A grid rather than a flex row so the
     * two halves share the width evenly without either being able to force the
     * container wider than its parent.
     */
    case "field_row":
      return (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {block.fields.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              variant={variant}
              value={values.values[field.key] ?? ""}
              readOnly={readOnly}
              onValue={onValue}
            />
          ))}
        </div>
      );

    case "checkbox_group": {
      const mayTick = !readOnly && canPersonEdit(block.responsibility);
      const selected = values.checked[block.key] ?? [];
      return (
        <fieldset className="min-w-0 space-y-2">
          {block.label ? (
            <legend className="text-[13px] font-medium text-foreground">
              {text(block.label)}
            </legend>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {block.options.map((option) => (
              <label
                key={option.key}
                className={cn(
                  "flex min-w-0 items-start gap-2 text-[13px] leading-snug",
                  mayTick ? "cursor-pointer text-foreground" : "text-muted-foreground",
                )}
              >
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={selected.includes(option.key)}
                  disabled={!mayTick}
                  onCheckedChange={() => onToggle?.(block.key, option.key)}
                />
                <span className="min-w-0 break-words">{text(option.label)}</span>
              </label>
            ))}
          </div>
          {mayTick ? null : <ResponsibilityNote responsibility={block.responsibility} />}
        </fieldset>
      );
    }

    /*
     * The numbered list stores one value per line under `<key>_<n>`, which is
     * the same key shape the PDF renderer and the drafting endpoint use. Read
     * from the document rather than re-derived, so a template that changes its
     * count changes here too.
     */
    case "numbered_list": {
      const mayType = !readOnly && canPersonEdit(block.responsibility);
      return (
        <div className="min-w-0 space-y-2">
          <p className="text-[13px] font-medium text-foreground">{text(block.label)}</p>
          {block.help ? (
            <p className="text-xs text-subtle-foreground">{text(block.help)}</p>
          ) : null}
          <div className="space-y-1.5">
            {Array.from({ length: block.count }, (_unused, index) => {
              const key = `${block.key}_${index + 1}`;
              return (
                <div key={key} className="flex min-w-0 items-center gap-2">
                  <span className="w-4 shrink-0 text-right text-xs text-subtle-foreground">
                    {index + 1}.
                  </span>
                  <Input
                    className="min-w-0 flex-1"
                    aria-label={`${text(block.label)} ${index + 1}`}
                    value={values.values[key] ?? ""}
                    readOnly={!mayType}
                    disabled={!mayType}
                    onChange={(event) => onValue?.(key, event.target.value)}
                  />
                </div>
              );
            })}
          </div>
          {mayType ? null : <ResponsibilityNote responsibility={block.responsibility} />}
        </div>
      );
    }

    /*
     * NO CONTROL AT ALL, not a disabled one. A signature line is signed on
     * paper; there is nothing here to type into, and a greyed-out box would
     * suggest there might be under some circumstance.
     */
    case "signature_row":
      return (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
          {[text(block.label), text(block.dateLabel)].map((label) => (
            <div key={label} className="min-w-0">
              <div className="h-8 rounded-[var(--radius-sm)] border border-dashed border-border bg-surface-muted" />
              <p className="mt-1 text-[11px] text-subtle-foreground">
                {label} — {RESPONSIBILITY_LABEL.signature}
              </p>
            </div>
          ))}
        </div>
      );
  }
}

function FieldControl({
  field,
  variant,
  value,
  readOnly,
  onValue,
}: {
  field: FormField;
  variant: FormVariant | null;
  value: string;
  readOnly: boolean;
  onValue?: (key: string, value: string) => void;
}) {
  const mayType = !readOnly && canPersonEdit(field.responsibility);
  const label = interpolate(field.label, variant);
  const id = `form-field-${field.key}`;

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {field.input === "long_text" ? (
        <Textarea
          id={id}
          className="min-w-0"
          rows={4}
          value={value}
          readOnly={!mayType}
          disabled={!mayType}
          onChange={(event) => onValue?.(field.key, event.target.value)}
        />
      ) : (
        <Input
          id={id}
          className="min-w-0"
          type={field.input === "date" ? "date" : "text"}
          value={value}
          readOnly={!mayType}
          disabled={!mayType}
          onChange={(event) => onValue?.(field.key, event.target.value)}
        />
      )}
      {field.help ? (
        <p className="text-xs leading-snug text-subtle-foreground">{field.help}</p>
      ) : null}
      {mayType ? null : <ResponsibilityNote responsibility={field.responsibility} />}
    </div>
  );
}

/** Why a control is not editable, in the words the rest of Forms uses. */
function ResponsibilityNote({
  responsibility,
}: {
  responsibility: FormField["responsibility"];
}) {
  return (
    <p className="text-[11px] text-subtle-foreground">{RESPONSIBILITY_LABEL[responsibility]}</p>
  );
}
