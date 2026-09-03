import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { parseFormDocument, parseFormVariants } from "@/lib/forms/document";
import {
  discardDraft,
  getTemplateByKey,
  openDraft,
  saveDraft,
} from "@/lib/forms/repository";

/**
 * The draft lifecycle for one template.
 *
 *   POST    open a draft — clones the current published version, or returns the
 *           draft that already exists rather than replacing somebody's work
 *   PUT     save the draft's document
 *   DELETE  discard it
 *
 * A published version is never edited in place; the database refuses to, and
 * this route does not try. Publishing is a separate call so that "save" and
 * "make this the live form" can never be the same click by accident.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolve(key: string) {
  const template = await getTemplateByKey(key);
  if (!template) throw new Error("No such form template.");
  return template;
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const actor = await authorizeForms(request, "manage_form_templates");
    const { key } = await context.params;
    const template = await resolve(key);
    const result = await openDraft(template.id, actor.id);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "forms/template/draft/open");
  }
}

export async function PUT(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    await authorizeForms(request, "manage_form_templates");
    const { key } = await context.params;
    await resolve(key);

    const body = (await request.json().catch(() => null)) as {
      versionId?: string;
      document?: unknown;
      variants?: unknown;
      notes?: string;
    } | null;
    if (!body?.versionId || !body.document) {
      return NextResponse.json({ error: "A draft and a document are required." }, { status: 400 });
    }

    // Parsed here as well as in the repository: a document the reader cannot
    // understand must be refused at the door, with a message an administrator
    // can act on rather than a database error.
    const document = parseFormDocument(body.document);
    const variants = parseFormVariants(body.variants ?? []);

    const saved = await saveDraft(body.versionId, document, variants, body.notes ?? "");
    return NextResponse.json({ draft: saved });
  } catch (error) {
    return errorResponse(error, "forms/template/draft/save");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    await authorizeForms(request, "manage_form_templates");
    const { key } = await context.params;
    await resolve(key);

    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    if (!versionId) {
      return NextResponse.json({ error: "Which draft?" }, { status: 400 });
    }

    await discardDraft(versionId);
    return NextResponse.json({ discarded: true });
  } catch (error) {
    return errorResponse(error, "forms/template/draft/discard");
  }
}
