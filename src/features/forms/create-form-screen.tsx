"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCheck2,
  Info,
  Printer,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckboxField } from "@/components/ui/controls";
import { FieldGroup, Input, Select, Textarea } from "@/components/ui/field";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { DEMO_LOCATIONS } from "@/data/demo/locations";
import { FORM_CAUTION } from "@/data/demo/templates";
import { getAIProvider } from "@/lib/ai";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { DEMO_ANCHOR, isoDaysFromAnchor, nowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
import type { FormTemplate, GeneratedForm } from "@/types";
import { deriveStatus } from "@/data/demo/forms";
import { FormDocument } from "./form-document";
import { takeFormHandoff } from "../chat/handoff";

const STEPS = [
  { id: 1, label: "Select form" },
  { id: 2, label: "Employee details" },
  { id: 3, label: "Reason / topic" },
  { id: 4, label: "Details" },
  { id: 5, label: "AI draft preview" },
  { id: 6, label: "Review & save" },
];

const TOPIC_PRESETS = [
  "Attendance / punctuality",
  "Dress code",
  "Sales performance",
  "Client experience",
  "Cleanliness standards",
  "Policy adherence",
  "Teamwork / communication",
  "Development plan",
];

export function CreateFormScreen() {
  const searchParams = useSearchParams();
  const { primaryLocationName, managerDisplayName, can } = useSession();
  const { templates, saveForm } = useAppStore();

  const provider = useMemo(() => getAIProvider(), []);

  const [step, setStep] = useState(1);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saved, setSaved] = useState<GeneratedForm | null>(null);

  const [employeeName, setEmployeeName] = useState("");
  const [employeeRole, setEmployeeRole] = useState("Tanning Consultant");
  const [locationName, setLocationName] = useState(primaryLocationName);
  const [formDate, setFormDate] = useState(DEMO_ANCHOR.slice(0, 10));
  const [managerName, setManagerName] = useState(managerDisplayName);
  const [topic, setTopic] = useState("");
  const [incidentDetails, setIncidentDetails] = useState("");
  const [followUpDate, setFollowUpDate] = useState(isoDaysFromAnchor(14));
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  const [values, setValues] = useState<Record<string, string>>({});
  const [checkedOptions, setCheckedOptions] = useState<Record<string, string[]>>({});

  const template = templates.find((entry) => entry.id === templateId) ?? null;

  const fromChat = searchParams.get("from") === "chat";
  const [entryResolved, setEntryResolved] = useState(false);

  /**
   * Resolve how the workspace was entered: a chat handoff (opens pre-filled at
   * the draft step) or ?template= (opens at employee details).
   *
   * Scheduled rather than run inline so nothing is written to state
   * synchronously inside the effect body.
   */
  useEffect(() => {
    const templateParam = searchParams.get("template");

    const timer = window.setTimeout(() => {
      if (fromChat) {
        const handoff = takeFormHandoff();
        if (handoff) {
          setTemplateId(handoff.templateId);
          setValues(handoff.values);
          setCheckedOptions(handoff.checkedOptions);
          setEmployeeName(handoff.values.employee_name ?? "");
          setEmployeeRole(handoff.values.employee_role ?? "Tanning Consultant");
          setLocationName(handoff.values.location ?? primaryLocationName);
          setManagerName(handoff.values.manager ?? managerDisplayName);
          setFormDate(handoff.values.form_date ?? DEMO_ANCHOR.slice(0, 10));
          setTopic(handoff.values.topic ?? "");
          setIncidentDetails(handoff.values.details ?? "");
          setFollowUpDate(handoff.values.follow_up_date ?? isoDaysFromAnchor(14));
          setStep(5);
          setEntryResolved(true);
          return;
        }
      }
      if (templateParam) {
        setTemplateId(templateParam);
        setStep(2);
      }
      setEntryResolved(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [searchParams, fromChat, primaryLocationName, managerDisplayName]);

  const availableTemplates = templates.filter((entry) => can(entry.permission));

  const generateDraft = async (selected: FormTemplate) => {
    setDrafting(true);
    const response = await provider.draftForm({
      templateId: selected.id,
      templateName: selected.name,
      fields: selected.fields,
      input: {
        employeeName,
        employeeRole,
        locationName,
        managerName,
        formDate,
        topic,
        incidentDetails,
        followUpDate,
        selections,
      },
    });
    setValues((current) => ({ ...current, ...response.values }));
    setCheckedOptions((current) => ({ ...current, ...response.checkedOptions }));
    setDrafting(false);
    setStep(5);
  };

  const handleSave = () => {
    if (!template) return;
    const followUp = values.follow_up_date || followUpDate || null;
    const form: GeneratedForm = {
      id: createId("form"),
      templateId: template.id,
      templateName: template.name,
      employeeName: values.employee_name || employeeName || "Unnamed employee",
      employeeRole: values.employee_role || employeeRole,
      locationId:
        DEMO_LOCATIONS.find((location) => location.name === (values.location ?? locationName))
          ?.id ?? "loc-101",
      locationName: values.location || locationName,
      createdBy: values.manager || managerName,
      createdAt: nowIso(),
      formDate: values.form_date || formDate,
      followUpDate: followUp,
      status: deriveStatus(followUp),
      values,
      checkedOptions,
      archived: false,
    };
    saveForm(form);
    setSaved(form);
  };

  const canAdvance = () => {
    if (step === 1) return Boolean(template);
    if (step === 2) return employeeName.trim().length > 1 && locationName.trim().length > 0;
    if (step === 3) return topic.trim().length > 1;
    return true;
  };

  /* -------------------------------------------------------------- loading -- */

  // A chat handoff resolves on the next tick; show the frame rather than
  // flashing step 1 before jumping to the draft.
  if (fromChat && !entryResolved) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Forms"
          title="Create a form"
          description="Bringing across the draft Sunny prepared in your conversation…"
        />
        <div className="space-y-4">
          <Skeleton className="h-9 w-full max-w-xl" />
          <Skeleton className="h-96 w-full" />
        </div>
      </PageShell>
    );
  }

  /* ---------------------------------------------------------------- saved -- */

  if (saved && template) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Forms"
          title="Form saved"
          description={`${saved.templateName} for ${saved.employeeName} is saved and now appears in Form Monitoring.`}
          actions={
            <>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer />
                Print
              </Button>
              <Button asChild>
                <Link href="/forms/monitoring">Open Form Monitoring</Link>
              </Button>
            </>
          }
        />

        <Notice tone="accent" icon={<Check />} className="mb-5 no-print">
          <p className="font-semibold">Follow-up set for {saved.followUpDate ?? "—"}</p>
          <p className="mt-0.5">
            It will appear in Form Monitoring and on your Overview until you mark
            it followed up or move the date.
          </p>
        </Notice>

        <FormDocument
          template={template}
          values={saved.values}
          checkedOptions={saved.checkedOptions}
        />

        <div className="mt-5 flex flex-wrap gap-2 no-print">
          <Button
            variant="secondary"
            onClick={() => {
              setSaved(null);
              setStep(1);
              setTemplateId(null);
              setValues({});
              setCheckedOptions({});
              setEmployeeName("");
              setTopic("");
              setIncidentDetails("");
            }}
          >
            Create another form
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/">Back to Overview</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  /* ------------------------------------------------------------- wizard --- */

  return (
    <PageShell>
      <PageHeader
        eyebrow="Forms"
        title="Create a form"
        description="Answer a few questions, Sunny drafts the form, and you edit every field directly before you save."
      />

      {/* Stepper */}
      <ol className="mb-7 flex flex-wrap items-center gap-x-1 gap-y-2">
        {STEPS.map((entry, index) => {
          const state =
            entry.id < step ? "done" : entry.id === step ? "current" : "todo";
          return (
            <li key={entry.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (entry.id < step) setStep(entry.id);
                }}
                disabled={entry.id > step}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  state === "current" &&
                    "border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-primary-soft text-primary-soft-foreground",
                  state === "done" &&
                    "cursor-pointer border-border-strong bg-surface text-muted-foreground hover:text-foreground",
                  state === "todo" && "border-border bg-surface-muted text-subtle-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full text-[10px] font-semibold",
                    state === "current"
                      ? "bg-primary text-primary-foreground"
                      : state === "done"
                        ? "bg-accent text-accent-foreground"
                        : "bg-border-strong text-white",
                  )}
                >
                  {state === "done" ? <Check className="size-2.5" strokeWidth={3} /> : entry.id}
                </span>
                <span className="hidden sm:inline">{entry.label}</span>
              </button>
              {index < STEPS.length - 1 ? (
                <span aria-hidden className="hidden h-px w-3 bg-border sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Step 1 — template */}
      {step === 1 ? (
        <section>
          <p className="mb-4 text-[13px] text-muted-foreground">
            Choose the form you need. Templates you cannot see are restricted by
            your access level.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {availableTemplates.map((entry) => {
              const selected = entry.id === templateId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTemplateId(entry.id)}
                  className={cn(
                    "flex h-full flex-col rounded-[var(--radius-lg)] border bg-surface p-4 text-left shadow-soft transition-[border-color,box-shadow,transform] duration-200",
                    selected
                      ? "border-primary shadow-raised"
                      : "border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised",
                  )}
                  aria-pressed={selected}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[14px] leading-snug font-semibold text-foreground">
                      {entry.name}
                    </span>
                    {selected ? (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                    {entry.description}
                  </span>
                  <span className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={entry.hasDocumentTemplate ? "accent" : "neutral"} size="sm">
                      {entry.hasDocumentTemplate ? "Document template" : "PDF template"}
                    </Badge>
                    <Badge tone="outline" size="sm">
                      {entry.fields.filter((field) => field.fillRule === "ai_populate").length}{" "}
                      AI fields
                    </Badge>
                  </span>
                </button>
              );
            })}
          </div>
          {availableTemplates.length === 0 ? (
            <Notice tone="attention" icon={<Info />} className="mt-4">
              Your access level does not include form creation. Ask an Owner or
              Administrator to adjust your permissions.
            </Notice>
          ) : null}
        </section>
      ) : null}

      {/* Step 2 — employee details */}
      {step === 2 ? (
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <FieldGroup label="Employee name" htmlFor="employee-name" required>
              <Input
                id="employee-name"
                value={employeeName}
                onChange={(event) => setEmployeeName(event.target.value)}
                placeholder="e.g. Jane Kowalski"
              />
            </FieldGroup>
            <FieldGroup label="Position" htmlFor="employee-role">
              <Input
                id="employee-role"
                value={employeeRole}
                onChange={(event) => setEmployeeRole(event.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="Location" htmlFor="location" required>
              <Select
                id="location"
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
              >
                {!DEMO_LOCATIONS.some((entry) => entry.name === locationName) ? (
                  <option value={locationName}>{locationName}</option>
                ) : null}
                {DEMO_LOCATIONS.map((entry) => (
                  <option key={entry.id} value={entry.name}>
                    {entry.name} — {entry.city}, {entry.state}
                  </option>
                ))}
              </Select>
            </FieldGroup>
            <FieldGroup label="Manager" htmlFor="manager" required>
              <Input
                id="manager"
                value={managerName}
                onChange={(event) => setManagerName(event.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="Form date" htmlFor="form-date" required>
              <Input
                id="form-date"
                type="date"
                value={formDate}
                onChange={(event) => setFormDate(event.target.value)}
              />
            </FieldGroup>
            <FieldGroup
              label="Follow-up date"
              htmlFor="follow-up"
              hint="Every documented conversation gets a follow-up date."
            >
              <Input
                id="follow-up"
                type="date"
                value={followUpDate}
                onChange={(event) => setFollowUpDate(event.target.value)}
              />
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      {/* Step 3 — topic */}
      {step === 3 ? (
        <Card>
          <CardContent className="space-y-5 p-5">
            <FieldGroup
              label="What is this conversation about?"
              htmlFor="topic"
              required
              hint="One line naming the gap or the focus. Sunny writes the rest around it."
            >
              <Input
                id="topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="e.g. Repeated tardiness"
              />
            </FieldGroup>

            <div>
              <p className="eyebrow mb-2">Common topics</p>
              <div className="flex flex-wrap gap-1.5">
                {TOPIC_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTopic(preset)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors",
                      topic === preset
                        ? "border-primary bg-primary-soft text-primary-soft-foreground"
                        : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {template?.fields
              .filter((field) => field.type === "checkbox_group")
              .map((field) => (
                <div key={field.id}>
                  <p className="eyebrow mb-2">{field.label}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(field.options ?? []).map((option) => (
                      <CheckboxField
                        key={option}
                        id={`select-${field.id}-${option.replace(/\W+/g, "-")}`}
                        label={option}
                        checked={(selections[field.id] ?? []).includes(option)}
                        onCheckedChange={(checked) =>
                          setSelections((current) => {
                            const list = current[field.id] ?? [];
                            return {
                              ...current,
                              [field.id]: checked
                                ? [...list, option]
                                : list.filter((entry) => entry !== option),
                            };
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Step 4 — details */}
      {step === 4 ? (
        <Card>
          <CardContent className="space-y-4 p-5">
            <FieldGroup
              label="What happened?"
              htmlFor="details"
              hint="Specific, observed behaviour with dates. Leave it blank and Sunny will draft a starting point you can edit."
            >
              <Textarea
                id="details"
                value={incidentDetails}
                onChange={(event) => setIncidentDetails(event.target.value)}
                className="min-h-36"
                placeholder="e.g. Arrived 10–20 minutes after shift start on the 12th, 15th and 19th. Each instance was noted on the day."
              />
            </FieldGroup>
            <Notice tone="neutral" icon={<Info />}>
              Record what was observed, not what you concluded about the cause.
              Speculation in a written record creates problems later.
            </Notice>
          </CardContent>
        </Card>
      ) : null}

      {/* Step 5 — editable draft */}
      {step === 5 && template ? (
        <section>
          <Notice tone="primary" icon={<Sparkles />} className="mb-5">
            <p className="font-semibold">Sunny drafted the highlighted fields</p>
            <p className="mt-0.5">
              Every field below is editable right here — change the wording,
              rewrite a section, tick a different box. You do not have to go back
              to chat to make a correction.
            </p>
          </Notice>

          <FormDocument
            template={template}
            values={values}
            checkedOptions={checkedOptions}
            editable
            onValueChange={(fieldId, value) =>
              setValues((current) => ({ ...current, [fieldId]: value }))
            }
            onToggleOption={(fieldId, option) =>
              setCheckedOptions((current) => {
                const list = current[fieldId] ?? [];
                return {
                  ...current,
                  [fieldId]: list.includes(option)
                    ? list.filter((entry) => entry !== option)
                    : [...list, option],
                };
              })
            }
          />
        </section>
      ) : null}

      {/* Step 6 — review & save */}
      {step === 6 && template ? (
        <section>
          <Notice tone="attention" icon={<Info />} className="mb-5">
            <p className="font-semibold">Before you print or have this conversation</p>
            <p className="mt-0.5">{FORM_CAUTION}</p>
          </Notice>

          <FormDocument
            template={template}
            values={values}
            checkedOptions={checkedOptions}
          />

          <Card className="mt-5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="text-[13px] font-semibold text-foreground">
                  Saving adds this to Form Monitoring
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  The follow-up date drives the reminder — you will see it until
                  it is marked followed up or moved.
                </p>
              </div>
              <Button onClick={handleSave}>
                <FileCheck2 />
                Save form
              </Button>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* Wizard controls */}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => setStep((current) => Math.max(1, current - 1))}
          disabled={step === 1}
        >
          <ArrowLeft />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {step === 4 ? (
            <Button
              onClick={() => template && void generateDraft(template)}
              disabled={!template || drafting}
            >
              <Sparkles />
              {drafting ? "Drafting…" : "Generate draft with Sunny"}
            </Button>
          ) : step < 6 ? (
            <Button
              onClick={() => setStep((current) => current + 1)}
              disabled={!canAdvance()}
            >
              Continue
              <ArrowRight />
            </Button>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
