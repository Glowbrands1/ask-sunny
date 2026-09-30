/**
 * ============================================================================
 * WHICH HAND UPLOADS A CURRENT WOVEN COPY REPLACES
 * ============================================================================
 *
 * Woven is the source of truth for what it manages. A document someone
 * uploaded by hand that is the SAME document as a current Woven-synced one is
 * superseded: kept for audit, and never retrieved, cited or used by a form.
 *
 * ONLY EXACT IDENTITY COUNTS. An upload is the same document as a Woven copy
 * when one of these holds:
 *
 *   content    the same extracted content (`content_hash`)
 *   file       the same original file name, case aside — never a name the
 *              sync made up for a text part ("policy-<id>.txt")
 *   title      the same title, case and spacing aside, AND the same file type
 *
 * A title alone across file types (an uploaded "Attendance Policy" PDF and a
 * Woven policy's text) is only a POSSIBLE duplicate, and so is an upload that
 * two different Woven documents claim. Both are held for review — reported,
 * never changed. Nothing fuzzy, no similarity score.
 *
 * Pure: the sink loads the rows and applies the plan.
 */

export interface LibraryDocument {
  id: string;
  title: string;
  originalFilename: string;
  fileType: string;
  contentHash: string | null;
}

export type IdentitySignal = "content" | "file" | "title";

export interface Supersession {
  uploadId: string;
  uploadTitle: string;
  supersededBy: string;
  signals: IdentitySignal[];
}

export interface HeldDuplicate {
  uploadId: string;
  uploadTitle: string;
  candidates: { id: string; title: string }[];
  reason: "title_only" | "several_candidates";
}

export interface SupersessionPlan {
  supersede: Supersession[];
  held: HeldDuplicate[];
}

/** The file names the sync gives text parts: never evidence of identity. */
const SYNTHETIC_FILE_NAME = /^(?:policy|procedure|knowledge_element|course|handbook|file_library)-[0-9a-f-]{8,}\.txt$/i;

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export function identitySignals(upload: LibraryDocument, current: LibraryDocument): IdentitySignal[] {
  const signals: IdentitySignal[] = [];
  if (upload.contentHash && upload.contentHash === current.contentHash) signals.push("content");
  const file = norm(upload.originalFilename);
  if (file !== "" && file === norm(current.originalFilename) && !SYNTHETIC_FILE_NAME.test(file)) signals.push("file");
  if (norm(upload.title) !== "" && norm(upload.title) === norm(current.title) && norm(upload.fileType) === norm(current.fileType)) signals.push("title");
  return signals;
}

export function planSupersession(current: readonly LibraryDocument[], uploads: readonly LibraryDocument[]): SupersessionPlan {
  const plan: SupersessionPlan = { supersede: [], held: [] };
  for (const upload of uploads) {
    const strong = current
      .map((doc) => ({ doc, signals: identitySignals(upload, doc) }))
      .filter((m) => m.signals.length > 0 && m.doc.id !== upload.id);
    if (strong.length === 1) {
      plan.supersede.push({ uploadId: upload.id, uploadTitle: upload.title, supersededBy: strong[0]!.doc.id, signals: strong[0]!.signals });
      continue;
    }
    if (strong.length > 1) {
      /* Several Woven copies of the SAME content: the upload is replaced whichever is kept. Otherwise, which one is it? */
      const sameContent = strong.every((m) => m.signals.includes("content"));
      if (sameContent) {
        const first = [...strong].sort((a, b) => a.doc.id.localeCompare(b.doc.id))[0]!;
        plan.supersede.push({ uploadId: upload.id, uploadTitle: upload.title, supersededBy: first.doc.id, signals: first.signals });
      } else {
        plan.held.push({ uploadId: upload.id, uploadTitle: upload.title, candidates: strong.map((m) => ({ id: m.doc.id, title: m.doc.title })), reason: "several_candidates" });
      }
      continue;
    }
    const titleOnly = current.filter((doc) => doc.id !== upload.id && norm(doc.title) !== "" && norm(doc.title) === norm(upload.title));
    if (titleOnly.length > 0) {
      plan.held.push({ uploadId: upload.id, uploadTitle: upload.title, candidates: titleOnly.map((d) => ({ id: d.id, title: d.title })), reason: "title_only" });
    }
  }
  return plan;
}
