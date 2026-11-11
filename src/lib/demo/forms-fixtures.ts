import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";
import { businessToday, shiftDays } from "@/lib/business-date";
import type { InstanceRow, InstanceView } from "@/lib/forms/instances";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { withholdUnpublishedDpoa } from "@/lib/forms/payroll-amount-field";
import type {
  LibrarySeedResult,
  TemplateAssetRow,
  TemplateRow,
  TemplateSummary,
  TemplateVersionRow,
} from "@/lib/forms/repository";
import type { Role } from "@/types";

/**
 * ============================================================================
 * FORMS IN A DEMO DEPLOYMENT — THE TEMPLATE LIBRARY AND A FORM HISTORY
 * ============================================================================
 *
 * A demo deployment never holds the Supabase key, so Form Monitoring said
 * "Form history could not be read" and Form Templates said "Template sync is
 * off". In demo mode those pages read this module instead.
 *
 * THE TEMPLATES ARE THE REAL LIBRARY (`TEMPLATE_SEEDS`), exactly as a healthy
 * synced deployment would hold it: each template at its current seed revision,
 * the earlier revisions archived behind it, and the bundled official copy as
 * the active asset. Only the dates and version history are invented.
 *
 * THE FORMS ARE INVENTED: fictional employees at the real fifteen salons, filed
 * by the seeded demo managers, with a spread of statuses and follow-ups so every
 * pill on the monitoring screen has something behind it.
 *
 * The monitoring buttons (follow-up dates, Mark followed up, archive, delete)
 * change an in-memory copy in this server process, so the screen responds;
 * nothing is written anywhere and a restart restores the seeded history.
 */

/* ----------------------------------------------------------- templates -- */

const SEEDS = TEMPLATE_SEEDS.map((seed) => withholdUnpublishedDpoa(seed));

function hex(n: number, width = 12): string {
  return n.toString(16).padStart(width, "0");
}

function templateId(index: number): string {
  return `7e000000-0000-4000-8000-${hex(index + 1)}`;
}

function versionId(index: number, version: number): string {
  return `7e100000-0000-4000-8000-${hex((index + 1) * 100 + version)}`;
}

function assetId(index: number, version: number): string {
  return `7e200000-0000-4000-8000-${hex((index + 1) * 100 + version)}`;
}

/** The library went in at launch; later revisions landed through the autumn. */
const INSTALLED_AT = "2026-06-02T15:10:00.000Z";

function publishedAt(version: number, revision: number, index: number): string {
  if (version === 1) return INSTALLED_AT;
  /* The current revision is the most recent; earlier ones are spaced back from it. */
  const daysAgo = (revision - version) * 19 + 6 + (index % 5) * 3;
  return `${shiftDays(businessToday(), -daysAgo)}T16:${String(10 + index).padStart(2, "0")}:00.000Z`;
}

/* Every template carries its official copy, uploaded by the administrator after install. */
const UPLOADED_OFFICIAL_COPY = new Set(TEMPLATE_SEEDS.map((seed) => seed.key));

interface DemoTemplate {
  row: TemplateRow;
  versions: TemplateVersionRow[];
  assets: TemplateAssetRow[];
}

function buildTemplates(): DemoTemplate[] {
  return SEEDS.map((seed, index) => {
    const id = templateId(index);
    const versions: TemplateVersionRow[] = [];
    for (let version = seed.revision; version >= 1; version--) {
      const current = version === seed.revision;
      const at = publishedAt(version, seed.revision, index);
      versions.push({
        id: versionId(index, version),
        templateId: id,
        version,
        status: current ? "published" : "archived",
        document: seed.document,
        variants: seed.variants,
        seedRevision: version,
        proposal: null,
        notes: current
          ? seed.revisionNote
          : version === 1
            ? "Installed from the bundled library."
            : `Revision ${version} of the library.`,
        createdBy: "system",
        createdAt: at,
        publishedAt: at,
        publishedBy: version === 1 ? "system" : "Priya Raghunathan",
      });
    }

    const assets: TemplateAssetRow[] = [];
    const uploaded = UPLOADED_OFFICIAL_COPY.has(seed.key);
    if (uploaded) {
      assets.push({
        id: assetId(index, 2),
        templateId: id,
        version: 2,
        kind: "upload",
        status: "active",
        fileName: seed.bundledPdfName,
        storagePath: `${seed.key}/v2/${seed.key}.pdf`,
        contentSha256: null,
        sizeBytes: 148_000 + index * 9_731,
        mimeType: "application/pdf",
        pageCount: seed.layoutFamily === "epp" ? 3 : seed.layoutFamily === "exit" ? 2 : 1,
        acroform: { hasFields: false, fieldCount: 0 },
        validation: { format: "pdf", notes: [] },
        uploadedBy: "Priya Raghunathan",
        createdAt: `${shiftDays(businessToday(), -(24 + index))}T18:05:00.000Z`,
      });
    }
    assets.push({
      id: assetId(index, 1),
      templateId: id,
      version: 1,
      kind: "bundled_default",
      status: uploaded ? "superseded" : "active",
      fileName: seed.bundledPdfName,
      storagePath: null,
      contentSha256: null,
      sizeBytes: 131_000 + index * 8_113,
      mimeType: "application/pdf",
      pageCount: seed.layoutFamily === "epp" ? 3 : seed.layoutFamily === "exit" ? 2 : 1,
      acroform: { hasFields: false, fieldCount: 0 },
      validation: { format: "pdf", notes: [] },
      uploadedBy: "system",
      createdAt: INSTALLED_AT,
    });

    return {
      row: {
        id,
        key: seed.key,
        name: seed.name,
        shortName: seed.shortName,
        description: seed.description,
        category: seed.category,
        layoutFamily: seed.layoutFamily,
        requiredPermission: seed.requiredPermission,
        active: true,
        displayOrder: seed.displayOrder,
      },
      versions,
      assets,
    };
  });
}

let templates: DemoTemplate[] | null = null;

function library(): DemoTemplate[] {
  templates ??= buildTemplates();
  return templates;
}

/** What a healthy sync reports on a visit: every template already current. */
export function demoTemplateSyncResult(): LibrarySeedResult {
  return {
    created: [],
    existing: SEEDS.map((seed) => seed.key),
    revised: [],
    renamed: [],
    heldBack: [],
    failed: [],
  };
}

export function demoTemplateSummaries(): TemplateSummary[] {
  return [...library()]
    .sort((a, b) => a.row.displayOrder - b.row.displayOrder)
    .map((template) => ({
      ...template.row,
      currentVersion: template.versions.find((version) => version.status === "published") ?? null,
      draftVersion: drafts.get(template.row.key) ?? null,
      versionCount: template.versions.length + (drafts.has(template.row.key) ? 1 : 0),
      activeAsset: template.assets.find((asset) => asset.status === "active") ?? null,
      assetCount: template.assets.length,
    }));
}

export function demoTemplateByKey(key: string): DemoTemplate | null {
  const template = library().find((entry) => entry.row.key === key);
  if (!template) return null;
  const draft = drafts.get(key);
  return draft ? { ...template, versions: [draft, ...template.versions] } : template;
}

/*
 * THE EDITOR WORKS IN THE DEMO, UP TO PUBLISHING. A draft can be opened,
 * edited, saved, previewed and discarded; it is held in this server process.
 * Publishing is refused with a sentence saying why — a demo must not appear to
 * change the form every manager fills.
 */
const drafts = new Map<string, TemplateVersionRow>();

export const DEMO_PUBLISH_REFUSAL =
  "This is a demo deployment, so publishing is switched off. The draft is kept for this session and can still be previewed; nothing about the live library changes.";

export const DEMO_UPLOAD_REFUSAL =
  "This is a demo deployment, so uploaded documents are not stored. The official copy shown here stays active.";

export function demoOpenDraft(key: string): { draft: TemplateVersionRow; clonedFrom: number | null } | null {
  const existing = drafts.get(key);
  if (existing) return { draft: existing, clonedFrom: null };
  const template = library().find((entry) => entry.row.key === key);
  const current = template?.versions.find((version) => version.status === "published");
  if (!template || !current) return null;
  const draft: TemplateVersionRow = {
    ...current,
    id: `7e300000-0000-4000-8000-${hex(library().indexOf(template) + 1)}`,
    version: current.version + 1,
    status: "draft",
    notes: "",
    createdBy: "demo",
    createdAt: new Date().toISOString(),
    publishedAt: null,
    publishedBy: null,
  };
  drafts.set(key, draft);
  return { draft, clonedFrom: current.version };
}

export function demoSaveDraft(
  key: string,
  change: Partial<Pick<TemplateVersionRow, "document" | "variants" | "notes">>,
): TemplateVersionRow | null {
  const draft = drafts.get(key);
  if (!draft) return null;
  const next = {
    ...draft,
    ...(change.document ? { document: change.document } : {}),
    ...(change.variants ? { variants: change.variants } : {}),
    ...(typeof change.notes === "string" ? { notes: change.notes } : {}),
  };
  drafts.set(key, next);
  return next;
}

export function demoDiscardDraft(key: string): void {
  drafts.delete(key);
}

function templateForKey(key: string) {
  const index = SEEDS.findIndex((seed) => seed.key === key);
  return index < 0 ? null : { index, seed: SEEDS[index], template: library()[index] };
}

/* --------------------------------------------------------- the forms --- */

interface Sketch {
  key: string;
  employee: string;
  employeeRole: string;
  salon: string;
  by: string;
  byRole: Role;
  source: InstanceRow["source"];
  status: InstanceRow["status"];
  /** Days before today the form is dated. */
  ago: number;
  /** Follow-up date as days from today, or null for none. */
  follow: number | null;
  /** Days before today the follow-up was marked done, or null. */
  done?: number | null;
  archived?: number | null;
  exported?: boolean;
  variant?: string | null;
  /** Index (in this list) of the form this one revises. */
  revises?: number;
}

/*
 * Fictional employees. The salons are the production roster; the people who
 * filed the forms are the seeded demo accounts (salon accounts are named after
 * their salon, as in User Management).
 */
const SKETCHES: Sketch[] = [
  { key: "dpoa", employee: "Kayla Brennan", employeeRole: "Tanning Consultant", salon: "0306", by: "MO Kansas City Wornall", byRole: "salon_director", source: "ask_sunny", status: "finalized", ago: 16, follow: -2, exported: true },
  { key: "coaching", employee: "Devon Achterberg", employeeRole: "Tanning Consultant", salon: "0306", by: "Jordan Beckley", byRole: "assistant_salon_director", source: "ask_sunny", status: "finalized", ago: 9, follow: 3 },
  { key: "follow-up-coaching", employee: "Maribel Ochoa", employeeRole: "Tanning Consultant", salon: "0314", by: "NE Omaha 144th and Center", byRole: "salon_director", source: "ask_sunny", status: "finalized", ago: 4, follow: 10 },
  { key: "dpoa", employee: "Trent Haskins", employeeRole: "Tanning Consultant", salon: "0462", by: "Alicia Moreno", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 21, follow: -6, exported: true },
  { key: "stc-exit", employee: "Lauren Pietrowski", employeeRole: "Tanning Consultant", salon: "0310", by: "NE Lincoln 27th Street", byRole: "salon_director", source: "manual", status: "finalized", ago: 12, follow: null, exported: true },
  { key: "sdit-epp", employee: "Gabriela Fontaine", employeeRole: "Salon Director in Training", salon: "0313", by: "Renata Silva", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 30, follow: 1 },
  { key: "coaching", employee: "Isaiah Mercer", employeeRole: "Tanning Consultant", salon: "0463", by: "KS Shawnee Mission Pkwy", byRole: "salon_director", source: "ask_sunny", status: "draft", ago: 1, follow: null },
  { key: "policy-review", employee: "Brooke Castellano", employeeRole: "Assistant Salon Director", salon: "0307", by: "Corey Vandenberg", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 27, follow: -11, done: 9, exported: true },
  { key: "tsd-epp", employee: "Wesley Amundsen", employeeRole: "Salon Director", salon: "0468", by: "Alicia Moreno", byRole: "district_manager", source: "manual", status: "finalized", ago: 34, follow: 5 },
  { key: "prescreen-phone-interview", employee: "Camille Duarte", employeeRole: "Candidate — Tanning Consultant", salon: "0476", by: "KS Overland Park", byRole: "salon_director", source: "manual", status: "finalized", ago: 6, follow: null },
  { key: "tanning-consultant-interview", employee: "Camille Duarte", employeeRole: "Candidate — Tanning Consultant", salon: "0476", by: "KS Overland Park", byRole: "salon_director", source: "manual", status: "draft", ago: 2, follow: null },
  { key: "coaching", employee: "Priyanka Sethi", employeeRole: "Tanning Consultant", salon: "0309", by: "Renata Silva", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 13, follow: -1 },
  { key: "dpoa", employee: "Colton Vasquez", employeeRole: "Tanning Consultant", salon: "0314", by: "Nia Okafor", byRole: "assistant_salon_director", source: "ask_sunny", status: "revised", ago: 18, follow: 4 },
  { key: "dpoa", employee: "Colton Vasquez", employeeRole: "Tanning Consultant", salon: "0314", by: "NE Omaha 144th and Center", byRole: "salon_director", source: "ask_sunny", status: "finalized", ago: 17, follow: 4, revises: 12, exported: true },
  { key: "follow-up-coaching", employee: "Ashlyn Rourke", employeeRole: "Tanning Consultant", salon: "0311", by: "Corey Vandenberg", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 22, follow: -8, done: 7 },
  { key: "asd-sdit-epp", employee: "Natalia Brandt", employeeRole: "Assistant Salon Director", salon: "0394", by: "Dana Whitfield", byRole: "regional_manager", source: "manual", status: "finalized", ago: 40, follow: 2 },
  { key: "position-transfer", employee: "Elijah Thornbury", employeeRole: "Tanning Consultant", salon: "0410", by: "Dana Whitfield", byRole: "regional_manager", source: "manual", status: "finalized", ago: 26, follow: null, exported: true },
  { key: "coaching", employee: "Hannah Kowalczyk", employeeRole: "Tanning Consultant", salon: "0312", by: "Corey Vandenberg", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 11, follow: -3 },
  { key: "fttc-epp", employee: "Jasmine Albright", employeeRole: "Full-Time Tanning Consultant", salon: "0495", by: "Renata Silva", byRole: "district_manager", source: "manual", status: "draft", ago: 3, follow: 12 },
  { key: "dpoa", employee: "Reid Callahan", employeeRole: "Tanning Consultant", salon: "0463", by: "KS Shawnee Mission Pkwy", byRole: "salon_director", source: "ask_sunny", status: "draft", ago: 0, follow: null },
  { key: "management-interview-round-1", employee: "Simone Okonkwo", employeeRole: "Candidate — Assistant Salon Director", salon: "0468", by: "Alicia Moreno", byRole: "district_manager", source: "manual", status: "finalized", ago: 8, follow: null },
  { key: "management-interview-round-2", employee: "Simone Okonkwo", employeeRole: "Candidate — Assistant Salon Director", salon: "0468", by: "Alicia Moreno", byRole: "district_manager", source: "manual", status: "draft", ago: 1, follow: null },
  { key: "coaching", employee: "Mateo Ferreira", employeeRole: "Tanning Consultant", salon: "0307", by: "NE Grand Island", byRole: "salon_director", source: "ask_sunny", status: "finalized", ago: 5, follow: 0 },
  { key: "stc-exit", employee: "Olivia Hendricks", employeeRole: "Assistant Salon Director", salon: "0313", by: "Renata Silva", byRole: "district_manager", source: "manual", status: "finalized", ago: 47, follow: null, archived: 30, exported: true },
  { key: "dpoa", employee: "Tyler Brannigan", employeeRole: "Tanning Consultant", salon: "0306", by: "MO Kansas City Wornall", byRole: "salon_director", source: "ask_sunny", status: "finalized", ago: 58, follow: -38, done: 37, archived: 20, exported: true },
  { key: "demotion", employee: "Ryan Castellanos", employeeRole: "Assistant Salon Director", salon: "0476", by: "Alicia Moreno", byRole: "district_manager", source: "manual", status: "finalized", ago: 64, follow: null, archived: 41, exported: true },
  { key: "coaching", employee: "Sadie Lundgren", employeeRole: "Tanning Consultant", salon: "0462", by: "Tessa Lindqvist", byRole: "assistant_salon_director", source: "ask_sunny", status: "finalized", ago: 15, follow: -5, done: 4 },
  { key: "policy-review", employee: "Dominic Ruiz", employeeRole: "Tanning Consultant", salon: "0310", by: "NE Lincoln 27th Street", byRole: "salon_director", source: "ask_sunny", status: "finalized", ago: 7, follow: 6 },
  { key: "dmit-epp-tsd", employee: "Avery Kingsley", employeeRole: "District Manager in Training", salon: "0394", by: "Dana Whitfield", byRole: "regional_manager", source: "manual", status: "finalized", ago: 19, follow: 14, variant: "tsd" },
  { key: "follow-up-coaching", employee: "Kayla Brennan", employeeRole: "Tanning Consultant", salon: "0306", by: "Jordan Beckley", byRole: "assistant_salon_director", source: "ask_sunny", status: "draft", ago: 0, follow: null },
  { key: "coaching", employee: "Zoe Marchetti", employeeRole: "Tanning Consultant", salon: "0311", by: "Corey Vandenberg", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 33, follow: -19, done: 18, exported: true },
  { key: "dpoa", employee: "Jalen Whitcomb", employeeRole: "Tanning Consultant", salon: "0309", by: "Renata Silva", byRole: "district_manager", source: "ask_sunny", status: "finalized", ago: 10, follow: -4 },
];

function instanceId(n: number): string {
  return `de000000-0000-4000-8000-${hex(n + 1)}`;
}

export function isDemoFormId(id: string): boolean {
  return /^de000000-0000-4000-8000-[0-9a-f]{12}$/.test(id) && forms().some((form) => form.id === id);
}

function stamp(day: string, hourUtc: number, minute = 0): string {
  return `${day}T${String(hourUtc).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function buildForms(today: string): InstanceRow[] {
  return SKETCHES.flatMap((sketch, n) => {
    const found = templateForKey(sketch.key);
    const salon = PRODUCTION_SALONS.find((entry) => entry.salonNumber === sketch.salon);
    if (!found || !salon) return [];
    const { seed, template } = found;
    const formDate = shiftDays(today, -sketch.ago);
    const created = stamp(formDate, 15 + (n % 6), (n * 7) % 60);
    const finalized = sketch.status === "draft" ? null : stamp(formDate, 21, (n * 11) % 60);
    const followUpDate = sketch.follow === null ? null : shiftDays(today, sketch.follow);
    const followedUpAt =
      sketch.done === undefined || sketch.done === null ? null : stamp(shiftDays(today, -sketch.done), 17);
    const archivedAt =
      sketch.archived === undefined || sketch.archived === null ? null : stamp(shiftDays(today, -sketch.archived), 19);
    const variant = sketch.variant ?? (seed.variants[0]?.key === "default" ? null : seed.variants[0]?.key ?? null);
    return [
      {
        id: instanceId(n),
        templateId: template.row.id,
        templateKey: seed.key,
        templateName: seed.name,
        templateShortName: seed.shortName,
        layoutFamily: seed.layoutFamily,
        templateVersionId: template.versions[0].id,
        templateVersion: template.versions[0].version,
        variantKey: variant,
        employeeName: sketch.employee,
        employeeRole: sketch.employeeRole,
        locationId: salon.id,
        locationName: salon.name,
        createdBy: sketch.by,
        createdByRole: sketch.byRole,
        source: sketch.source,
        status: sketch.status,
        formDate,
        followUpDate,
        followedUpAt,
        followedUpBy: followedUpAt ? sketch.by : null,
        finalizedAt: finalized,
        exportedAt: sketch.exported && finalized ? finalized : null,
        archivedAt,
        revisesInstanceId: sketch.revises === undefined ? null : instanceId(sketch.revises),
        createdAt: created,
        updatedAt: followedUpAt ?? archivedAt ?? finalized ?? created,
      },
    ];
  });
}

/* ------------------------------------------- changes made in the demo --- */

type Change = Partial<Pick<InstanceRow, "followUpDate" | "followedUpAt" | "followedUpBy" | "archivedAt">> & {
  deleted?: boolean;
};

const changes = new Map<string, Change>();

function forms(today: string = businessToday()): InstanceRow[] {
  return buildForms(today).flatMap((form) => {
    const change = changes.get(form.id);
    if (!change) return [form];
    if (change.deleted) return [];
    const { deleted: _deleted, ...fields } = change;
    void _deleted;
    return [{ ...form, ...fields }];
  });
}

function change(id: string, next: Change): InstanceRow | null {
  changes.set(id, { ...(changes.get(id) ?? {}), ...next });
  return demoFormById(id);
}

export function demoFormById(id: string): InstanceRow | null {
  return forms().find((form) => form.id === id) ?? null;
}

export function demoListForms(view: InstanceView): InstanceRow[] {
  return forms()
    .filter((form) =>
      view === "active" ? !form.archivedAt : view === "archived" ? Boolean(form.archivedAt) : true,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function demoOutstandingFollowUps(): InstanceRow[] {
  return forms()
    .filter(
      (form) =>
        form.followUpDate &&
        !form.followedUpAt &&
        !form.archivedAt &&
        form.status !== "revised" &&
        !(form.status === "draft" && form.revisesInstanceId),
    )
    .sort((a, b) => (a.followUpDate ?? "").localeCompare(b.followUpDate ?? ""));
}

export function demoSetFollowUpDate(id: string, date: string): InstanceRow | null {
  return change(id, { followUpDate: date });
}

export function demoMarkFollowedUp(id: string, actor: string): InstanceRow | null {
  return change(id, { followedUpAt: new Date().toISOString(), followedUpBy: actor });
}

export function demoReopenFollowUp(id: string): InstanceRow | null {
  return change(id, { followedUpAt: null, followedUpBy: null });
}

export function demoArchiveForm(id: string, archived: boolean): InstanceRow | null {
  return change(id, { archivedAt: archived ? new Date().toISOString() : null });
}

/** Only a draft may be deleted, exactly as the live route refuses a finalized form. */
export function demoDeleteForm(id: string): { deleted: InstanceRow } | { refused: string } | null {
  const form = demoFormById(id);
  if (!form) return null;
  if (form.status !== "draft") {
    return {
      refused: `This form is ${form.status}, so it cannot be deleted. Archive it instead — that hides it from the active list and keeps the record.`,
    };
  }
  changes.set(id, { ...(changes.get(id) ?? {}), deleted: true });
  return { deleted: form };
}

/** The version a demo form was filled from, for the PDF. */
export function demoFormVersion(form: InstanceRow): TemplateVersionRow | null {
  const found = templateForKey(form.templateKey);
  return found?.template.versions.find((version) => version.version === form.templateVersion) ?? null;
}
