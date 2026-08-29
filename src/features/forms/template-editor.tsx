"use client";

import { useState } from "react";
import { Info, Lock, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import { Tooltip } from "@/components/ui/overlays";
import { FILL_RULE_LABEL } from "@/data/demo/templates";
import { ACTIVE_BRAND } from "@/lib/brand";
import { useAppStore } from "@/lib/store/app-store";
import { nowIso } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { FieldFillRule, FormTemplate, TemplateField } from "@/types";

const FILL_RULES: FieldFillRule[] = [
  "ai_populate",
  "manager_completes",
  "signature_never_ai",
];

/**
 * Document template editor.
 *
 * LEFT — live page preview with "AI fills: [field]" placeholder chips, laid out
 * the way the printed form reads.
 * RIGHT — field configuration.
 *
 * Hard rule enforced in the UI: a signature field can never be set to
 * "Sunny can populate". The control for it is disabled and explains why, and
 * the change is rejected in the handler as well — not only visually.
 */
export function TemplateEditor({ template }: { template: FormTemplate }) {
  const { updateTemplate } = useAppStore();
  const [selectedFieldId, setSelectedFieldId] = useState(template.fields[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);

  const selectedField =
    template.fields.find((field) => field.id === selectedFieldId) ??
    template.fields[0];

  const patchField = (fieldId: string, patch: Partial<TemplateField>) => {
    const target = template.fields.find((field) => field.id === fieldId);
    if (!target) return;

    // Signature fields are never AI-populated, whatever the caller asks for.
    if (target.type === "signature" && patch.fillRule && patch.fillRule !== "signature_never_ai") {
      return;
    }

    updateTemplate(template.id, {
      fields: template.fields.map((field) =>
        field.id === fieldId ? { ...field, ...patch } : field,
      ),
    });
    setDirty(true);
  };

  const sections = template.fields.reduce<Record<string, TemplateField[]>>(
    (acc, field) => {
      acc[field.section] = acc[field.section] ?? [];
      acc[field.section].push(field);
      return acc;
    },
    {},
  );

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {/* Left — page preview */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-foreground/80 px-6 py-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {ACTIVE_BRAND.brandName}
              </p>
              <h3 className="text-[17px] font-semibold text-foreground">
                {template.name}
              </h3>
            </div>
            <Badge tone="accent">Document template</Badge>
          </div>

          <div className="space-y-6 px-6 py-5">
            {Object.entries(sections).map(([sectionName, fields]) => (
              <section key={sectionName}>
                <h4 className="mb-3 border-b border-border pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {sectionName}
                </h4>
                <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
                  {fields.map((field) => {
                    const isSelected = field.id === selectedFieldId;
                    const wide =
                      field.type === "long_text" || field.type === "checkbox_group";
                    return (
                      <button
                        key={field.id}
                        type="button"
                        onClick={() => setSelectedFieldId(field.id)}
                        aria-pressed={isSelected}
                        className={cn(
                          "rounded-[var(--radius-sm)] border p-2.5 text-left transition-colors",
                          wide && "sm:col-span-2",
                          isSelected
                            ? "border-primary bg-primary-soft/40"
                            : "border-transparent hover:border-border-strong hover:bg-surface-muted",
                        )}
                      >
                        <span className="block text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                          {field.label}
                          {field.required ? (
                            <span className="ml-1 text-highlight-deep">*</span>
                          ) : null}
                        </span>

                        {field.type === "signature" ? (
                          <span className="mt-2 block">
                            <span className="block h-7 border-b border-foreground/60" />
                            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Lock className="size-2.5" aria-hidden />
                              Signed in person — never filled by Sunny
                            </span>
                          </span>
                        ) : field.type === "checkbox_group" ? (
                          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                            {(field.options ?? []).map((option) => (
                              <span
                                key={option}
                                className="flex items-center gap-1.5 text-[12px] text-foreground"
                              >
                                <span
                                  aria-hidden
                                  className="size-3 rounded-[3px] border border-border-strong"
                                />
                                {option}
                              </span>
                            ))}
                          </span>
                        ) : field.fillRule === "ai_populate" ? (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--primary)_26%,transparent)] bg-primary-soft px-2.5 py-1 text-[11px] font-medium text-primary-soft-foreground">
                            <Sparkles className="size-2.5" aria-hidden />
                            AI fills: {field.label.toLowerCase()}
                          </span>
                        ) : (
                          <span className="mt-1.5 block border-b border-dashed border-border-strong pb-1.5 text-[12px] text-subtle-foreground">
                            Manager completes
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}

            <section>
              <h4 className="mb-2 border-b border-border pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Acknowledgement text
              </h4>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {template.acknowledgement}
              </p>
            </section>
          </div>
        </CardContent>
      </Card>

      {/* Right — field configuration */}
      <div>
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              title="Field configuration"
              description="Select a field in the preview to configure how it is completed."
            />

            {selectedField ? (
              <div className="space-y-5">
                <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted p-3.5">
                  <p className="text-[13px] font-semibold text-foreground">
                    {selectedField.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {selectedField.section} ·{" "}
                    {selectedField.type.replace(/_/g, " ")}
                  </p>
                </div>

                <fieldset>
                  <legend className="eyebrow mb-2.5">How is it completed?</legend>
                  <div className="space-y-2">
                    {FILL_RULES.map((rule) => {
                      const isSignature = selectedField.type === "signature";
                      const locked =
                        isSignature && rule !== "signature_never_ai"
                          ? true
                          : !isSignature && rule === "signature_never_ai";
                      const checked = selectedField.fillRule === rule;

                      const control = (
                        <label
                          className={cn(
                            "flex items-start gap-2.5 rounded-[var(--radius-sm)] border p-3 transition-colors",
                            locked
                              ? "cursor-not-allowed border-border bg-surface-muted opacity-60"
                              : checked
                                ? "cursor-pointer border-primary bg-primary-soft/40"
                                : "cursor-pointer border-border hover:border-border-strong",
                          )}
                        >
                          <input
                            type="radio"
                            name={`fill-rule-${selectedField.id}`}
                            value={rule}
                            checked={checked}
                            disabled={locked}
                            onChange={() =>
                              patchField(selectedField.id, { fillRule: rule })
                            }
                            className="mt-0.5 size-4 accent-[var(--primary)]"
                          />
                          <span>
                            <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                              {rule === "ai_populate" ? (
                                <Sparkles className="size-3 text-primary" aria-hidden />
                              ) : null}
                              {rule === "signature_never_ai" ? (
                                <Lock className="size-3" aria-hidden />
                              ) : null}
                              {FILL_RULE_LABEL[rule]}
                            </span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                              {rule === "ai_populate"
                                ? "Sunny drafts this field. The manager can still edit it before saving."
                                : rule === "manager_completes"
                                  ? "Left blank for the manager to complete."
                                  : "Signature line. Never populated by Sunny, under any configuration."}
                            </span>
                          </span>
                        </label>
                      );

                      return (
                        <div key={rule}>
                          {locked ? (
                            <Tooltip
                              content={
                                isSignature
                                  ? "Signature fields can never be AI-populated. This is enforced, not a default."
                                  : "Only signature fields can use this rule."
                              }
                            >
                              <span className="block">{control}</span>
                            </Tooltip>
                          ) : (
                            control
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id={`required-${selectedField.id}`}
                    checked={selectedField.required}
                    disabled={selectedField.type === "signature"}
                    onCheckedChange={(value) =>
                      patchField(selectedField.id, { required: value === true })
                    }
                    className="mt-0.5"
                  />
                  <label
                    htmlFor={`required-${selectedField.id}`}
                    className="cursor-pointer text-[13px] text-foreground"
                  >
                    Required
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      The form cannot be saved until this field has a value.
                    </span>
                  </label>
                </div>

                {selectedField.options?.length ? (
                  <div>
                    <p className="eyebrow mb-2">Options</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedField.options.map((option) => (
                        <Badge key={option} tone="neutral" size="sm">
                          {option}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                {dirty ? "Changes saved to this browser." : "No changes yet."}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  updateTemplate(template.id, {
                    updatedAt: nowIso(),
                    hasDocumentTemplate: true,
                  });
                  setDirty(false);
                }}
              >
                Save template
              </Button>
            </div>
          </CardContent>
        </Card>

        <Notice tone="neutral" icon={<Info />} className="mt-4">
          A saved document template takes priority over the uploaded PDF for this
          form. Signature fields are excluded from AI population at the data
          layer, so no configuration can turn them on.
        </Notice>
      </div>
    </div>
  );
}
