import { z } from "zod";

import { checkboxGroupsForVariant, fieldsForVariant } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { PAYROLL_DEDUCT_KEY } from "@/lib/forms/payroll-deduct";
import type { ChatFormProposal } from "@/types";

import type { AskResponse } from "./types";

/**
 * Required fields on the published template, checked before the reply goes out.
 *
 * A typed employee name fills Employee Name. The check never asks whether
 * that person is in Woven. Off, the caller does not use this and the reply
 * stays as the form path wrote it. The date is not required here: a form
 * with no stated date is dated today.
 */

export interface MissingTemplateField {
  readonly key: string;
  readonly label: string;
}

export function missingRequiredFields(proposal: ChatFormProposal): MissingTemplateField[] {
  const seed = TEMPLATE_SEEDS.find((item) => item.key === proposal.templateKey);
  if (!seed) return [];

  const fields = fieldsForVariant(seed.document, proposal.variantKey);
  const groups = checkboxGroupsForVariant(seed.document, proposal.variantKey);
  const shape: Record<string, z.ZodString> = {};
  const values: Record<string, string> = {};
  const labels = new Map<string, string>();

  for (const field of fields) {
    if (field.responsibility !== "system") continue;
    if (field.key === "form_date" || field.key === "date") continue;
    shape[field.key] = z.string().trim().min(1);
    labels.set(field.key, field.label);
    values[field.key] = systemValue(field.key, proposal);
  }

  for (const group of groups) {
    if (group.responsibility !== "manager" || !group.single) continue;
    shape[group.key] = z.string().trim().min(1);
    labels.set(group.key, group.label ?? group.key);
    values[group.key] = group.key === PAYROLL_DEDUCT_KEY ? (proposal.payrollDeduct ?? "") : "";
  }

  if (proposal.awaitingIncident) {
    const observation = fields.find((field) => field.key === "observation");
    if (observation) {
      shape.observation = z.string().trim().min(1);
      labels.set("observation", observation.label);
      values.observation = "";
    }
  }

  const parsed = z.object(shape).safeParse(values);
  if (parsed.success) return [];

  const missing: MissingTemplateField[] = [];
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (!key || missing.some((item) => item.key === key)) continue;
    missing.push({ key, label: labels.get(key) ?? key });
  }
  return missing;
}

export function withRequiredFieldList(response: AskResponse): AskResponse {
  const proposal = response.formProposal;
  if (!proposal) return response;
  const missing = missingRequiredFields(proposal);
  if (missing.length === 0) return response;
  const line = `Still needed: ${missing.map((item) => item.label).join(", ")}.`;
  if (response.content.includes(line)) return response;
  const content = response.content.trim() ? `${response.content.trim()}\n\n${line}` : line;
  return { ...response, content };
}

function systemValue(key: string, proposal: ChatFormProposal): string {
  if (key === "employee_name") return proposal.employeeName?.trim() ?? "";
  if (key === "job_title" || key === "employee_role") return proposal.employeeRole?.trim() ?? "";
  if (key === "location") return locationValue(proposal);
  return "";
}

function locationValue(proposal: ChatFormProposal): string {
  if (proposal.locationResolution === "not_applicable") return "not applicable";
  return proposal.locationName?.trim() || proposal.locationId?.trim() || "";
}
