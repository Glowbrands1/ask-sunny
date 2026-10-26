import { ACTIVE_BRAND } from "@/lib/brand";
import { DEFAULT_PERMISSION_MATRIX, ROLE_LABEL, ROLES, hasPermission } from "@/lib/permissions";
import type { AskResponse } from "@/lib/ai/types";
import type { Permission, Role } from "@/types";

import {
  buildFormsGuideAnswer,
  readFormsGuideQuestion,
  type GuideAccess,
  type GuideTemplate,
} from "./forms-guide";
import { TEMPLATE_SEEDS } from "./library";
import { listTemplateSummaries, type TemplateSummary } from "./repository";

/**
 * THE SERVER HALF OF THE FORMS GUIDE (FORMS_GUIDE_ENABLED).
 *
 * The templates are the live library: `form_templates` and each one's
 * published current version, the same rows and the same "active and
 * published" filter the form proposal uses, so "which forms can I create
 * here?" lists exactly what the picker would let this person start. Who may
 * create a form is the app's own matrix (`DEFAULT_PERMISSION_MATRIX`), the
 * one `form-proposal.ts` checks.
 *
 * IF THE LIBRARY CANNOT BE READ the bundled seeds stand in — this app's own
 * templates, the ones the database is seeded from — rather than the question
 * going to the knowledge base and coming back as a miss.
 */

export function summaryToGuideTemplate(summary: TemplateSummary): GuideTemplate | null {
  if (!summary.active || summary.currentVersion?.status !== "published") return null;
  return {
    key: summary.key,
    name: summary.name,
    shortName: summary.shortName,
    description: summary.description ?? "",
    category: summary.category,
    layoutFamily: summary.layoutFamily,
    requiredPermission: summary.requiredPermission,
    document: summary.currentVersion.document ?? null,
    variants: summary.currentVersion.variants ?? [],
  };
}

/** This app's bundled templates, in display order. */
export function seedTemplates(): GuideTemplate[] {
  return [...TEMPLATE_SEEDS]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((seed) => ({
      key: seed.key,
      name: seed.name,
      shortName: seed.shortName,
      description: seed.description,
      category: seed.category,
      layoutFamily: seed.layoutFamily,
      requiredPermission: seed.requiredPermission,
      document: seed.document,
      variants: seed.variants,
    }));
}

async function guideTemplates(): Promise<GuideTemplate[]> {
  try {
    const summaries = await listTemplateSummaries();
    return summaries
      .map(summaryToGuideTemplate)
      .filter((template): template is GuideTemplate => template !== null);
  } catch {
    return seedTemplates();
  }
}

/** This app's roles and matrix, as the guide reads them. Developer accounts are build/support, not a creator to name. */
export function guideAccess(role: Role | null | undefined): GuideAccess<Role> {
  return {
    role: role ?? null,
    roles: ROLES,
    roleLabel: (entry) => ROLE_LABEL[entry] ?? entry,
    may: (entry, permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, entry, permission as Permission),
    hiddenRoles: ["developer"],
  };
}

/** A forms-guide answer for this turn, or null so the turn is answered as before. */
export async function answerFormsGuide(input: {
  question: string;
  role: Role | null | undefined;
}): Promise<AskResponse | null> {
  const reading = readFormsGuideQuestion(input.question);
  if (!reading) return null;
  const content = buildFormsGuideAnswer<Role>({
    reading,
    templates: await guideTemplates(),
    access: guideAccess(input.role),
    productName: ACTIVE_BRAND.productName,
  });
  if (!content) return null;
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
