"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/controls";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import {
  DialogActions,
  DialogContent,
  Dialog,
} from "@/components/ui/overlays";
import {
  FIELD_RESPONSIBILITIES,
  RESPONSIBILITY_LABEL,
  type FieldResponsibility,
  type FormBlock,
  type FormField,
  type FormVariant,
} from "@/lib/forms/document";

/**
 * THE METADATA, BEHIND A GEAR.
 *
 * Responsibility, field key, assistant guidance, policy grounding and the
 * variant condition all still matter — they are what the whole engine turns on.
 * What was wrong was making an administrator read them instead of the form.
 *
 * So they live here, one block at a time, opened from the block's gear. The
 * document stays the editing surface; this is the drawer you pull out when you
 * need to change what a field MEANS rather than what it says.
 *
 * TWO THINGS ARE DELIBERATELY NOT EDITABLE HERE.
 *
 *   A SIGNATURE BLOCK HAS NO RESPONSIBILITY CONTROL. There is nothing to
 *   choose: a signature line is always blank and always signed by hand. Showing
 *   a dropdown set to "signature" would imply it could be set to something
 *   else.
 *
 *   A FIELD KEY CANNOT BE RENAMED ONCE THE VERSION IS PUBLISHED, and this
 *   editor only ever edits a draft, so renaming here is safe — but the warning
 *   stays, because the key is what already-filled forms are stored against.
 */

export function BlockSettingsDialog({
  block,
  variants,
  onChange,
  onClose,
}: {
  block: { block: FormBlock; index: number } | null;
  variants: FormVariant[];
  onChange: (index: number, next: FormBlock) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={block !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={block ? TITLE[block.block.kind] : "Block settings"}>
        {block ? (
          <BlockSettingsBody
            block={block.block}
            variants={variants}
            onChange={(next) => onChange(block.index, next)}
          />
        ) : null}
        <DialogActions>
          <Button onClick={onClose}>Done</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

const TITLE: Record<FormBlock["kind"], string> = {
  letterhead: "Letterhead",
  section: "Section heading",
  paragraph: "Paragraph",
  note: "Note",
  field: "Field",
  field_row: "Field row",
  checkbox_group: "Checkbox group",
  numbered_list: "Numbered list",
  signature_row: "Signature line",
  page_break: "Page break",
  reference: "Position description",
  acknowledgement: "Acknowledgement",
};

function BlockSettingsBody({
  block,
  variants,
  onChange,
}: {
  block: FormBlock;
  variants: FormVariant[];
  onChange: (next: FormBlock) => void;
}) {
  return (
    <div className="space-y-5">
      {block.kind === "field" ? (
        <FieldSettings
          field={block.field}
          onChange={(field) => onChange({ ...block, field })}
        />
      ) : null}

      {block.kind === "field_row" ? (
        <div className="space-y-5">
          {block.fields.map((field, index) => (
            <FieldSettings
              key={field.key}
              field={field}
              heading={`Field ${index + 1}`}
              onChange={(next) => {
                const fields = [...block.fields];
                fields[index] = next;
                onChange({ ...block, fields });
              }}
            />
          ))}
        </div>
      ) : null}

      {block.kind === "checkbox_group" ? (
        <div className="space-y-3">
          <ResponsibilityPicker
            value={block.responsibility}
            onChange={(responsibility) => onChange({ ...block, responsibility })}
          />
          <KeyField value={block.key} onChange={(key) => onChange({ ...block, key })} />
          <div className="space-y-1.5">
            <Label htmlFor="columns">Columns on the printed page</Label>
            <Select
              id="columns"
              value={String(block.columns)}
              onChange={(event) =>
                onChange({ ...block, columns: Number(event.target.value) === 3 ? 3 : 2 })
              }
            >
              <option value="2">Two</option>
              <option value="3">Three</option>
            </Select>
          </div>
          <OptionEditor
            options={block.options}
            onChange={(options) => onChange({ ...block, options })}
          />
        </div>
      ) : null}

      {block.kind === "numbered_list" ? (
        <div className="space-y-3">
          <ResponsibilityPicker
            value={block.responsibility}
            onChange={(responsibility) => onChange({ ...block, responsibility })}
          />
          <KeyField value={block.key} onChange={(key) => onChange({ ...block, key })} />
          <div className="space-y-1.5">
            <Label htmlFor="count">How many numbered lines</Label>
            <Input
              id="count"
              type="number"
              min={1}
              max={12}
              value={block.count}
              onChange={(event) =>
                onChange({
                  ...block,
                  count: Math.min(12, Math.max(1, Number(event.target.value) || 1)),
                })
              }
            />
          </div>
          <HelpField
            value={block.help ?? ""}
            onChange={(help) => onChange({ ...block, help })}
          />
        </div>
      ) : null}

      {block.kind === "signature_row" ? (
        <Notice tone="neutral">
          A signature line is always blank and always signed by hand. There is no
          responsibility to choose — nothing may ever write here, which is why the
          block carries no field key at all.
        </Notice>
      ) : null}

      {block.kind === "page_break" ? (
        <Notice tone="neutral">
          The printed form starts a new sheet here. Everything after this break is on
          the next page, in the editor and in the PDF alike.
        </Notice>
      ) : null}

      <VariantCondition
        value={block.variantKey}
        variants={variants}
        onChange={(variantKey) =>
          onChange({ ...block, ...(variantKey ? { variantKey } : { variantKey: undefined }) } as FormBlock)
        }
      />
    </div>
  );
}

function FieldSettings({
  field,
  heading,
  onChange,
}: {
  field: FormField;
  heading?: string;
  onChange: (next: FormField) => void;
}) {
  return (
    <div className="space-y-3">
      {heading ? <p className="eyebrow">{heading}</p> : null}
      <ResponsibilityPicker
        value={field.responsibility}
        onChange={(responsibility) => onChange({ ...field, responsibility })}
      />
      <KeyField value={field.key} onChange={(key) => onChange({ ...field, key })} />
      <div className="space-y-1.5">
        <Label htmlFor={`input-${field.key}`}>How it prints</Label>
        <Select
          id={`input-${field.key}`}
          value={field.input}
          onChange={(event) =>
            onChange({ ...field, input: event.target.value as FormField["input"] })
          }
        >
          <option value="text">One line on a rule</option>
          <option value="long_text">Several ruled lines</option>
          <option value="date">A date</option>
        </Select>
      </div>
      <HelpField value={field.help ?? ""} onChange={(help) => onChange({ ...field, help })} />
      <CheckboxField
        id={`grounded-${field.key}`}
        label="Must quote approved policy"
        description="Ask Sunny may only fill this from a knowledge-base match, and leaves it blank for the manager when it cannot find one. Use it for 'Policy Violated' and the manual quotation."
        checked={field.policyGrounded === true}
        onCheckedChange={(checked) =>
          onChange({ ...field, ...(checked ? { policyGrounded: true } : { policyGrounded: undefined }) })
        }
      />
    </div>
  );
}

function ResponsibilityPicker({
  value,
  onChange,
}: {
  value: FieldResponsibility;
  onChange: (next: FieldResponsibility) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`responsibility-${value}`}>Who fills this</Label>
      <Select
        id={`responsibility-${value}`}
        value={value}
        onChange={(event) => onChange(event.target.value as FieldResponsibility)}
      >
        {FIELD_RESPONSIBILITIES.filter((entry) => entry !== "signature").map((entry) => (
          <option key={entry} value={entry}>
            {RESPONSIBILITY_LABEL[entry]}
          </option>
        ))}
      </Select>
      <p className="text-[11px] leading-snug text-subtle-foreground">
        Only <span className="text-foreground">Ask Sunny drafts</span> is written by the
        assistant. The server enforces that against whatever the model returns, so this
        is the setting, not a hint.
      </p>
    </div>
  );
}

function KeyField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`key-${value}`}>Field key</Label>
      <Input
        id={`key-${value}`}
        value={value}
        onChange={(event) =>
          onChange(event.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"))
        }
      />
      <p className="text-[11px] leading-snug text-subtle-foreground">
        What already-filled forms are stored against. Safe to change in a draft;
        forms filled from a published version keep printing that version.
      </p>
    </div>
  );
}

function HelpField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="help">Guidance</Label>
      <Textarea
        id="help"
        rows={2}
        value={value}
        placeholder="Shown to the manager, and given to Ask Sunny as context for this field."
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function OptionEditor({
  options,
  onChange,
}: {
  options: { key: string; label: string }[];
  onChange: (next: { key: string; label: string }[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Options</Label>
      {options.map((option, index) => (
        <div key={option.key} className="flex items-center gap-2">
          <Input
            value={option.label}
            aria-label={`Option ${index + 1}`}
            onChange={(event) => {
              const next = [...options];
              next[index] = { ...option, label: event.target.value };
              onChange(next);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(options.filter((_, at) => at !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([...options, { key: `option_${options.length + 1}`, label: "New option" }])
        }
      >
        Add option
      </Button>
    </div>
  );
}

function VariantCondition({
  value,
  variants,
  onChange,
}: {
  value: string | undefined;
  variants: FormVariant[];
  onChange: (next: string | null) => void;
}) {
  if (variants.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="variant">Print this block for</Label>
      <Select
        id="variant"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">Every reading of this form</option>
        {variants.map((variant) => (
          <option key={variant.key} value={variant.key}>
            {variant.label} only
          </option>
        ))}
      </Select>
      <p className="text-[11px] leading-snug text-subtle-foreground">
        How one document reads two ways. The DMIT EPP&apos;s position description is
        scoped this way, so the TSD review and the DMIT review print different copy from
        the same version.
      </p>
    </div>
  );
}
