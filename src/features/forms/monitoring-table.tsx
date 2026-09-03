"use client";

import * as React from "react";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import { Select } from "@/components/ui/field";
import { useSession } from "@/lib/session/session-context";
import { formatDate } from "@/lib/utils/date";
import { downloadFormPdf } from "./forms-fetch";

/**
 * FORM MONITORING — the system of record, not a list of what this browser did.
 *
 * Every column here answers a question somebody actually asks about a filed
 * form: which form, about whom, at which salon, who created it, when, what
 * state it is in, WHICH TEMPLATE VERSION it was filled from, whether Ask Sunny
 * drafted it or a manager typed it, and when the follow-up is due.
 *
 * The template version is the column people forget and then need: a form filled
 * from version 2 prints version 2 forever, and "why does this one look
 * different" has an answer in the table rather than an investigation.
 */

export interface MonitoredForm {
  id: string;
  templateName: string;
  templateShortName: string;
  templateVersion: number;
  variantKey: string | null;
  employeeName: string;
  locationName: string | null;
  createdBy: string;
  createdByRole: string | null;
  source: "manual" | "ask_sunny";
  status: "draft" | "finalized" | "revised";
  formDate: string;
  followUpDate: string | null;
  finalizedAt: string | null;
  exportedAt: string | null;
  revisesInstanceId: string | null;
  updatedAt: string;
}

const STATUS_TONE = {
  draft: "attention",
  finalized: "ready",
  revised: "neutral",
} as const;

export function MonitoringTable({
  forms,
  notice,
}: {
  forms: MonitoredForm[];
  notice: string | null;
}) {
  const [status, setStatus] = React.useState<string>("all");
  const [templateName, setTemplateName] = React.useState<string>("all");
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const { role, user } = useSession();

  /*
   * The PDF is FETCHED, not linked to. A plain <a href> navigation carries none
   * of the Forms headers, so the route answers 401 and the manager downloads an
   * error message instead of the record. See downloadFormPdf.
   */
  async function download(id: string) {
    setDownloading(id);
    setProblem(null);
    try {
      await downloadFormPdf(id, role, user.name);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const templateNames = [...new Set(forms.map((form) => form.templateName))].sort();

  const shown = forms.filter(
    (form) =>
      (status === "all" || form.status === status) &&
      (templateName === "all" || form.templateName === templateName),
  );

  const overdue = shown.filter(
    (form) =>
      form.followUpDate &&
      form.status !== "revised" &&
      new Date(form.followUpDate) < new Date(),
  ).length;

  return (
    <div className="space-y-4">
      {notice ? <Notice tone="attention">{notice}</Notice> : null}
      {problem ? <Notice tone="attention">{problem}</Notice> : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 w-40"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
            <option value="revised">Revised</option>
          </Select>
          <Select
            aria-label="Form"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            className="h-9 w-56"
          >
            <option value="all">All forms</option>
            {templateNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <p className="ml-auto text-[12px] text-muted-foreground">
            {shown.length} form{shown.length === 1 ? "" : "s"}
            {overdue > 0 ? (
              <>
                {" · "}
                {/* Overdue follow-ups are the one thing on this screen that
                    needs somebody to act, so they take the follow-up colour. */}
                <span className="font-medium text-followup-attention">
                  {overdue} follow-up{overdue === 1 ? "" : "s"} overdue
                </span>
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-[13px] text-muted-foreground">
            No forms yet. Create one from{" "}
            <span className="text-foreground">Create a Form</span>.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ScrollTable>
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Form",
                      "Employee",
                      "Location",
                      "Created by",
                      "Date",
                      "Status",
                      "Version",
                      "Source",
                      "Follow-up",
                      "Updated",
                      "",
                    ].map((heading) => (
                      <th key={heading} className="eyebrow px-3 py-2 text-left whitespace-nowrap">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((form) => {
                    const late =
                      form.followUpDate &&
                      form.status !== "revised" &&
                      new Date(form.followUpDate) < new Date();
                    return (
                      <tr key={form.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap text-foreground">
                          {form.templateShortName}
                          {form.variantKey ? (
                            <span className="ml-1.5 text-[11px] text-subtle-foreground">
                              {form.variantKey}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{form.employeeName}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {form.locationName ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {form.createdBy}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {formatDate(form.formDate)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_TONE[form.status]} size="sm">
                            {form.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                          v{form.templateVersion}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={form.source === "ask_sunny" ? "primary" : "neutral"} size="sm">
                            {form.source === "ask_sunny" ? "Ask Sunny" : "Manual"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {form.followUpDate ? (
                            <span className={late ? "font-medium text-followup-attention" : ""}>
                              {formatDate(form.followUpDate)}
                            </span>
                          ) : (
                            <span className="text-subtle-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                          {formatDate(form.updatedAt)}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => download(form.id)}
                            disabled={downloading === form.id}
                            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
                          >
                            <Download className="size-3.5" />
                            {downloading === form.id ? "Preparing…" : "PDF"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
