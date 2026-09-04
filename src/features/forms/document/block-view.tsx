"use client";

import * as React from "react";

import { LEADING, SIZE, px } from "@/lib/forms/paper";
import {
  interpolate,
  type CheckboxOption,
  type FieldResponsibility,
  type FormBlock,
  type FormField,
  type FormVariant,
} from "@/lib/forms/document";
import { cn } from "@/lib/utils/cn";

import { ResponsibilityChip } from "./chips";
import { EditableText } from "./editable-text";

/**
 * ONE BLOCK, RENDERED THREE WAYS.
 *
 * `edit`  the administrator's document. Static wording is directly editable,
 *         every fillable area wears its AI FILLS / FILLED BY HAND chip, and
 *         nothing accepts a value — a template has no values.
 * `fill`  the manager's document. The same page, with real inputs where the
 *         chips were, working checkboxes, and blank signature rules.
 * `read`  the finalized document. Values as text on rules, nothing editable.
 *
 * ONE COMPONENT RATHER THAN THREE is the load-bearing decision. The previous
 * implementation had a settings form for editing and a field list for filling,
 * and the printed PDF was a third thing again; the only way to know what a form
 * looked like was to download it. Here the three modes differ in what you can
 * DO to a block, never in what a block IS, so the page cannot drift from the
 * page that prints.
 *
 * Sizes come from `lib/forms/paper.ts` — the same points the PDF is drawn in.
 */

export type DocumentMode = "edit" | "fill" | "read";

export interface BlockValues {
  values: Record<string, string>;
  checked: Record<string, string[]>;
  /** Who actually filled each key, so a drafted value can say so. */
  filledBy: Record<string, FieldResponsibility>;
}

export interface BlockViewProps {
  block: FormBlock;
  mode: DocumentMode;
  variant: FormVariant | null;
  values?: BlockValues;
  /** Responsibilities a person may type into, in `fill` mode. */
  editable?: readonly FieldResponsibility[];
  onValue?: (key: string, value: string) => void;
  onToggle?: (key: string, option: string) => void;
  /** `edit` mode: change the block's own static content. */
  onEditBlock?: (next: FormBlock) => void;
}

const EMPTY: BlockValues = { values: {}, checked: {}, filledBy: {} };

/* ------------------------------------------------------------- fragments -- */

/** The black bar. Centred white caps, exactly as the PDF draws it. */
function SectionBar({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: DocumentMode;
  onChange?: (value: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-center bg-black px-3 text-white"
      style={{ minHeight: px(18), fontSize: px(SIZE.section) }}
    >
      <EditableText
        value={label}
        editable={mode === "edit"}
        onChange={onChange}
        placeholder="Section heading"
        className="text-center font-semibold tracking-[0.04em] uppercase"
      />
    </div>
  );
}

/** A label above a rule, with whatever belongs on the rule. */
function ValueLine({
  label,
  children,
  chip,
  inline,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  chip?: React.ReactNode;
  /** Label on the same line as the rule — the "Employee Name ____" rows. */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 whitespace-nowrap" style={{ fontSize: px(SIZE.label) }}>
          {label}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 border-b border-black/45 pb-[2px]">
          <span className="min-w-0 flex-1">{children}</span>
          {chip}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-[3px]">
      <div className="flex items-baseline justify-between gap-2">
        <span style={{ fontSize: px(SIZE.label) }}>{label}</span>
        {chip}
      </div>
      <div className="border-b border-black/45 pb-[2px]">{children}</div>
    </div>
  );
}

/** What sits on the rule for one field, per mode. */
function FieldSlot({
  field,
  mode,
  variant,
  values,
  editable,
  onValue,
}: {
  field: FormField;
  mode: DocumentMode;
  variant: FormVariant | null;
  values: BlockValues;
  editable: readonly FieldResponsibility[];
  onValue?: (key: string, value: string) => void;
}) {
  const value = values.values[field.key] ?? "";
  const lines = field.input === "long_text" ? 3 : 1;

  if (mode === "edit") {
    // A template has no values, so the slot shows what WILL fill it. An empty
    // rule with a chip beside it is the honest picture of a blank form.
    return (
      <span
        className="block text-black/30 italic"
        style={{ fontSize: px(SIZE.body), minHeight: px(LEADING) * lines }}
      >
        {field.input === "date" ? "dd / mm / yyyy" : ""}
      </span>
    );
  }

  const mayType = mode === "fill" && editable.includes(field.responsibility);

  if (!mayType) {
    return (
      <span
        className="block whitespace-pre-wrap"
        style={{ fontSize: px(SIZE.body), minHeight: px(LEADING) * lines }}
      >
        {interpolate(value, variant)}
      </span>
    );
  }

  if (field.input === "long_text") {
    return (
      <textarea
        id={field.key}
        aria-label={interpolate(field.label, variant)}
        value={value}
        rows={3}
        onChange={(event) => onValue?.(field.key, event.target.value)}
        className="w-full resize-y bg-transparent leading-snug outline-none focus-visible:bg-[#fdf0d5]/45"
        style={{ fontSize: px(SIZE.body) }}
      />
    );
  }

  return (
    <input
      id={field.key}
      aria-label={interpolate(field.label, variant)}
      type={field.input === "date" ? "date" : "text"}
      value={value}
      onChange={(event) => onValue?.(field.key, event.target.value)}
      className="w-full bg-transparent outline-none focus-visible:bg-[#fdf0d5]/45"
      style={{ fontSize: px(SIZE.body) }}
    />
  );
}

function Tickbox({
  option,
  ticked,
  disabled,
  onToggle,
}: {
  option: CheckboxOption;
  ticked: boolean;
  disabled: boolean;
  onToggle?: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2",
        disabled ? "cursor-default" : "cursor-pointer",
      )}
      style={{ fontSize: px(SIZE.body) }}
    >
      <input
        type="checkbox"
        checked={ticked}
        disabled={disabled}
        onChange={() => onToggle?.()}
        aria-label={option.label}
        className="mt-[2px] size-[13px] shrink-0 appearance-none border border-black/70 bg-white checked:bg-black checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><path d=%22M3 8.5l3.2 3.2L13 5%22 fill=%22none%22 stroke=%22white%22 stroke-width=%222.2%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/></svg>')] checked:bg-center checked:bg-no-repeat"
      />
      <span className="leading-snug">{option.label}</span>
    </label>
  );
}

/* ------------------------------------------------------------ the block --- */

export function BlockView({
  block,
  mode,
  variant,
  values = EMPTY,
  editable = [],
  onValue,
  onToggle,
  onEditBlock,
}: BlockViewProps) {
  const text = (raw: string) => interpolate(raw, variant);
  const editing = mode === "edit";

  switch (block.kind) {
    case "letterhead":
      return (
        <div className="flex items-center gap-4">
          <span
            className="bg-black px-3 py-[6px] font-semibold tracking-[0.08em] text-white uppercase"
            style={{ fontSize: px(SIZE.small) }}
          >
            <EditableText
              value={block.brand}
              editable={editing}
              onChange={(brand) => onEditBlock?.({ ...block, brand })}
              placeholder="Brand"
            />
          </span>
          <span style={{ fontSize: px(SIZE.title) }} className="font-semibold">
            <EditableText
              value={block.title}
              editable={editing}
              onChange={(title) => onEditBlock?.({ ...block, title })}
              placeholder="Form title"
            />
          </span>
        </div>
      );

    case "section":
      return (
        <SectionBar
          label={text(block.label)}
          mode={mode}
          onChange={(label) => onEditBlock?.({ ...block, label })}
        />
      );

    case "paragraph":
      return (
        <p style={{ fontSize: px(SIZE.body), lineHeight: 1.45 }}>
          <EditableText
            value={block.text}
            display={text(block.text)}
            editable={editing}
            multiline
            onChange={(value) => onEditBlock?.({ ...block, text: value })}
            placeholder="Paragraph text"
          />
        </p>
      );

    case "note":
      return (
        <p className="text-black/55" style={{ fontSize: px(SIZE.small), lineHeight: 1.45 }}>
          <EditableText
            value={block.text}
            display={text(block.text)}
            editable={editing}
            multiline
            onChange={(value) => onEditBlock?.({ ...block, text: value })}
            placeholder="Note"
          />
        </p>
      );

    case "acknowledgement":
      return (
        <p style={{ fontSize: px(SIZE.body), lineHeight: 1.5 }}>
          <EditableText
            value={block.text}
            display={text(block.text)}
            editable={editing}
            multiline
            onChange={(value) => onEditBlock?.({ ...block, text: value })}
            placeholder="Acknowledgement wording"
          />
        </p>
      );

    case "field": {
      const inline = block.field.input !== "long_text";
      return (
        <ValueLine
          inline={inline}
          label={
            <EditableText
              value={block.field.label}
              display={text(block.field.label)}
              editable={editing}
              onChange={(label) =>
                onEditBlock?.({ ...block, field: { ...block.field, label } })
              }
              placeholder="Field label"
            />
          }
          chip={
            editing ? (
              <ResponsibilityChip
                responsibility={block.field.responsibility}
                name={text(block.field.label)}
              />
            ) : values.filledBy[block.field.key] === "ai" ? (
              <span className="shrink-0 text-[9px] tracking-wide text-black/40 uppercase">
                drafted
              </span>
            ) : undefined
          }
        >
          <FieldSlot
            field={block.field}
            mode={mode}
            variant={variant}
            values={values}
            editable={editable}
            onValue={onValue}
          />
        </ValueLine>
      );
    }

    case "field_row":
      return (
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {block.fields.map((field, index) => (
            <ValueLine
              key={field.key}
              inline={field.input !== "long_text"}
              label={
                <EditableText
                  value={field.label}
                  display={text(field.label)}
                  editable={editing}
                  onChange={(label) => {
                    const fields = [...block.fields];
                    fields[index] = { ...field, label };
                    onEditBlock?.({ ...block, fields });
                  }}
                  placeholder="Field label"
                />
              }
              chip={
                editing ? (
                  <ResponsibilityChip
                    responsibility={field.responsibility}
                    name={text(field.label)}
                  />
                ) : undefined
              }
            >
              <FieldSlot
                field={field}
                mode={mode}
                variant={variant}
                values={values}
                editable={editable}
                onValue={onValue}
              />
            </ValueLine>
          ))}
        </div>
      );

    case "checkbox_group": {
      const mayTick = mode === "fill" && editable.includes(block.responsibility);
      const ticked = new Set(values.checked[block.key] ?? []);
      return (
        <div className="space-y-2">
          {block.label || editing ? (
            <div className="flex items-baseline justify-between gap-2">
              <span style={{ fontSize: px(SIZE.label) }}>
                <EditableText
                  value={block.label ?? ""}
                  display={text(block.label ?? "")}
                  editable={editing}
                  onChange={(label) => onEditBlock?.({ ...block, label })}
                  placeholder="Group label (optional)"
                />
              </span>
              {editing ? <ResponsibilityChip responsibility={block.responsibility} /> : null}
            </div>
          ) : null}
          <div
            className={cn(
              "grid gap-x-6 gap-y-[6px]",
              block.columns === 3 ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            {block.options.map((option, index) => (
              <div key={option.key} className="min-w-0">
                {editing ? (
                  <label className="flex items-start gap-2" style={{ fontSize: px(SIZE.body) }}>
                    <span className="mt-[2px] size-[13px] shrink-0 border border-black/70 bg-white" />
                    <EditableText
                      value={option.label}
                      display={text(option.label)}
                      editable
                      onChange={(label) => {
                        const options = [...block.options];
                        options[index] = { ...option, label };
                        onEditBlock?.({ ...block, options });
                      }}
                      placeholder="Option"
                      className="leading-snug"
                    />
                  </label>
                ) : (
                  <Tickbox
                    option={{ ...option, label: text(option.label) }}
                    ticked={ticked.has(option.key)}
                    disabled={!mayTick}
                    onToggle={() => onToggle?.(block.key, option.key)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "numbered_list": {
      const mayType = mode === "fill" && editable.includes(block.responsibility);
      return (
        <div className="space-y-[6px]">
          <div className="flex items-baseline justify-between gap-2">
            <span style={{ fontSize: px(SIZE.label) }}>
              <EditableText
                value={block.label}
                display={text(block.label)}
                editable={editing}
                onChange={(label) => onEditBlock?.({ ...block, label })}
                placeholder="List label"
              />
            </span>
            {editing ? <ResponsibilityChip responsibility={block.responsibility} /> : null}
          </div>
          {Array.from({ length: block.count }, (_, index) => {
            const key = `${block.key}_${index + 1}`;
            return (
              <div key={key} className="flex items-baseline gap-2">
                <span className="w-4 shrink-0 text-right" style={{ fontSize: px(SIZE.body) }}>
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 border-b border-black/45 pb-[2px]">
                  {mayType ? (
                    <input
                      value={values.values[key] ?? ""}
                      aria-label={`${text(block.label)} ${index + 1}`}
                      onChange={(event) => onValue?.(key, event.target.value)}
                      className="w-full bg-transparent outline-none focus-visible:bg-[#fdf0d5]/45"
                      style={{ fontSize: px(SIZE.body) }}
                    />
                  ) : (
                    <span
                      className="block"
                      style={{ fontSize: px(SIZE.body), minHeight: px(LEADING) }}
                    >
                      {values.values[key] ?? ""}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    case "signature_row":
      return (
        <div className="flex items-end gap-8 pt-3">
          <div className="flex-1 space-y-[3px]">
            <div className="border-b border-black/70" style={{ height: px(LEADING) }} />
            <div className="flex items-baseline justify-between gap-2">
              <span style={{ fontSize: px(SIZE.small) }}>
                <EditableText
                  value={block.label}
                  display={text(block.label)}
                  editable={editing}
                  onChange={(label) => onEditBlock?.({ ...block, label })}
                  placeholder="Signature label"
                />
              </span>
              {editing ? <ResponsibilityChip responsibility="signature" /> : null}
            </div>
          </div>
          <div className="w-40 space-y-[3px]">
            <div className="border-b border-black/70" style={{ height: px(LEADING) }} />
            <span style={{ fontSize: px(SIZE.small) }}>
              <EditableText
                value={block.dateLabel}
                display={text(block.dateLabel)}
                editable={editing}
                onChange={(dateLabel) => onEditBlock?.({ ...block, dateLabel })}
                placeholder="Date"
              />
            </span>
          </div>
        </div>
      );

    case "reference":
      return (
        <div className="border border-black/20 bg-black/[0.02] px-4 py-3">
          <p
            className="mb-2 font-semibold tracking-[0.08em] uppercase"
            style={{ fontSize: px(SIZE.small) }}
          >
            <EditableText
              value={block.label}
              display={text(block.label)}
              editable={editing}
              onChange={(label) => onEditBlock?.({ ...block, label })}
              placeholder="Position block heading"
            />
          </p>
          <div className="space-y-[5px]">
            {block.body.map((line, index) => (
              <p key={index} style={{ fontSize: px(SIZE.body), lineHeight: 1.45 }}>
                <EditableText
                  value={line}
                  display={text(line)}
                  editable={editing}
                  multiline
                  onChange={(next) => {
                    const body = [...block.body];
                    // An emptied line is removed, which is how a bullet list is
                    // shortened without a separate delete control per line.
                    if (next.trim() === "") body.splice(index, 1);
                    else body[index] = next;
                    onEditBlock?.({ ...block, body });
                  }}
                  placeholder="Line"
                />
              </p>
            ))}
            {editing ? (
              <button
                type="button"
                onClick={() => onEditBlock?.({ ...block, body: [...block.body, "New line"] })}
                className="text-[10px] font-medium tracking-wide text-black/45 uppercase hover:text-black"
              >
                + add line
              </button>
            ) : null}
          </div>
        </div>
      );

    case "page_break":
      // Never rendered inside a sheet — `paginate` consumes it and the editor
      // draws the seam between two sheets instead.
      return null;
  }
}
