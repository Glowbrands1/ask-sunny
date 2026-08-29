"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  CalendarClock,
  CheckCheck,
  Download,
  Ellipsis,
  FileStack,
  Info,
  Pencil,
  Search,
} from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/field";
import { DemoDataNote, EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/overlays";
import { FORM_STATUS_LABEL, deriveStatus } from "@/data/demo/forms";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { daysFromNow, formatDate, relativeDay } from "@/lib/utils/date";
import { pluralize } from "@/lib/utils/format";
import type { GeneratedForm, GeneratedFormStatus } from "@/types";
import { FormDocument } from "./form-document";

const TABS: { id: GeneratedFormStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "open", label: "Open" },
  { id: "due_soon", label: "Due soon" },
  { id: "overdue", label: "Overdue" },
  { id: "followed_up", label: "Followed up" },
  { id: "completed", label: "Completed" },
];

const STATUS_TONE: Record<GeneratedFormStatus, "neutral" | "primary" | "attention" | "ready" | "processing"> = {
  draft: "neutral",
  open: "processing",
  due_soon: "primary",
  overdue: "attention",
  followed_up: "ready",
  completed: "ready",
};

export function FormMonitoringScreen() {
  const searchParams = useSearchParams();
  const { forms, templates, updateForm } = useAppStore();

  const [query, setQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");

  // Deep link (?form=…) derived during render; `undefined` = no local override.
  const [detailOverride, setDetailOverride] = useState<string | null | undefined>();
  const detailId =
    detailOverride === undefined ? searchParams.get("form") : detailOverride;
  const setDetailId = (next: string | null) => setDetailOverride(next);

  const active = useMemo(() => forms.filter((form) => !form.archived), [forms]);

  const locations = useMemo(
    () => Array.from(new Set(active.map((form) => form.locationName))).sort(),
    [active],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return active
      .filter((form) =>
        locationFilter === "all" ? true : form.locationName === locationFilter,
      )
      .filter((form) => {
        if (!q) return true;
        return (
          form.employeeName.toLowerCase().includes(q) ||
          form.templateName.toLowerCase().includes(q) ||
          form.createdBy.toLowerCase().includes(q) ||
          form.locationName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aDays = a.followUpDate ? daysFromNow(a.followUpDate) : 9999;
        const bDays = b.followUpDate ? daysFromNow(b.followUpDate) : 9999;
        return aDays - bDays;
      });
  }, [active, query, locationFilter]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: filtered.length };
    TABS.slice(1).forEach((tab) => {
      map[tab.id] = filtered.filter((form) => form.status === tab.id).length;
    });
    return map;
  }, [filtered]);

  const needsAttention = active.filter(
    (form) => form.status === "overdue" || form.status === "due_soon",
  );

  const detailForm = forms.find((form) => form.id === detailId) ?? null;
  const detailTemplate = detailForm
    ? (templates.find((entry) => entry.id === detailForm.templateId) ?? null)
    : null;

  const setFollowUp = (form: GeneratedForm, next: string) => {
    updateForm(form.id, {
      followUpDate: next || null,
      status: deriveStatus(next || null),
      values: { ...form.values, follow_up_date: next },
    });
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Forms"
        title="Form Monitoring"
        description="Every documented conversation and where it stands. Nothing quietly lapses."
        actions={
          <Button asChild>
            <Link href="/forms/create">Create a form</Link>
          </Button>
        }
      />

      {needsAttention.length > 0 ? (
        <Notice tone="attention" icon={<CalendarClock />} className="mb-6">
          <span className="font-semibold">
            {needsAttention.length}{" "}
            {pluralize(needsAttention.length, "follow-up")}{" "}
            {needsAttention.length === 1 ? "needs" : "need"} attention
          </span>{" "}
          — have the conversation, then mark the item followed up or move its
          date.
        </Notice>
      ) : null}

      <Tabs defaultValue="all">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
                <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] tabular-nums">
                  {counts[tab.id] ?? 0}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee, form, manager…"
                aria-label="Search forms"
                className="pl-9 sm:w-64"
              />
            </div>
            <Select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
              aria-label="Filter by location"
              className="sm:w-52"
            >
              <option value="all">All locations</option>
              {locations.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {TABS.map((tab) => {
          const rows =
            tab.id === "all"
              ? filtered
              : filtered.filter((form) => form.status === tab.id);
          return (
            <TabsContent key={tab.id} value={tab.id}>
              {rows.length === 0 ? (
                <EmptyState
                  icon={<FileStack />}
                  title={`No ${tab.label.toLowerCase()} forms`}
                  description="Forms you create appear here with their follow-up date and status."
                  action={
                    <Button asChild variant="secondary">
                      <Link href="/forms/create">Create a form</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-2">
                  {rows.map((form) => (
                    <FormRow
                      key={form.id}
                      form={form}
                      onOpen={() => setDetailId(form.id)}
                      onFollowUpChange={(next) => setFollowUp(form, next)}
                      onMarkFollowedUp={() =>
                        updateForm(form.id, { status: "followed_up" })
                      }
                      onArchive={() => updateForm(form.id, { archived: true })}
                    />
                  ))}
                </ul>
              )}
              <DemoDataNote className="mt-4" />
            </TabsContent>
          );
        })}
      </Tabs>

      <Dialog
        open={Boolean(detailForm)}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        {detailForm && detailTemplate ? (
          <DialogContent
            title={`${detailForm.templateName} — ${detailForm.employeeName}`}
            description={`${detailForm.locationName} · created by ${detailForm.createdBy} on ${formatDate(detailForm.createdAt)}`}
            wide
          >
            <FormDocument
              template={detailTemplate}
              values={detailForm.values}
              checkedOptions={detailForm.checkedOptions}
              className="border-0 shadow-none"
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </PageShell>
  );
}

function FormRow({
  form,
  onOpen,
  onFollowUpChange,
  onMarkFollowedUp,
  onArchive,
}: {
  form: GeneratedForm;
  onOpen: () => void;
  onFollowUpChange: (value: string) => void;
  onMarkFollowedUp: () => void;
  onArchive: () => void;
}) {
  return (
    <li>
      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-3.5 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[14px] font-medium text-foreground">
                {form.employeeName}
              </span>
              <Badge tone={STATUS_TONE[form.status]} size="sm">
                <StatusDot />
                {FORM_STATUS_LABEL[form.status]}
              </Badge>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {form.templateName} · {form.locationName} · created by{" "}
              {form.createdBy} · {formatDate(form.formDate)}
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor={`followup-${form.id}`}
                className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                Follow-up
              </label>
              <Input
                id={`followup-${form.id}`}
                type="date"
                value={form.followUpDate ?? ""}
                onChange={(event) => onFollowUpChange(event.target.value)}
                className="h-8 w-38 px-2 text-[13px]"
              />
              {form.followUpDate ? (
                <span
                  className={cn(
                    "hidden w-20 text-xs sm:block",
                    daysFromNow(form.followUpDate) < 0
                      ? "text-status-attention"
                      : "text-muted-foreground",
                  )}
                >
                  {relativeDay(form.followUpDate)}
                </span>
              ) : null}
            </div>

            <Tooltip content="Mark this follow-up as done">
              <span className="inline-flex">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onMarkFollowedUp}
                  disabled={form.status === "followed_up" || form.status === "completed"}
                >
                  <CheckCheck />
                  <span className="hidden sm:inline">Mark followed up</span>
                </Button>
              </span>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Actions for ${form.employeeName}`}
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onOpen}>
                  <FileStack />
                  View form
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/forms/create?template=${form.templateId}`}>
                    <Pencil />
                    Create a follow-up form
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Download />
                  Download PDF (coming later)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onArchive} tone="danger">
                  <Archive />
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </li>
  );
}

export function MonitoringNote() {
  return (
    <Notice tone="neutral" icon={<Info />}>
      PDF download is a placeholder in this prototype. Print styling produces a
      clean printable form today.
    </Notice>
  );
}
