import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import { createInstance, listInstances } from "@/lib/forms/instances";
import { getTemplateByKey } from "@/lib/forms/repository";
import type { Permission } from "@/types";

/**
 * GET  /api/forms/instances   Form Monitoring's history
 * POST /api/forms/instances   starts a form from a template's current version
 *
 * The permission is the TEMPLATE's, not a blanket "forms" one: a Salon Director
 * may create a coaching form and not a disciplinary plan of action, and that
 * distinction is data on the template rather than a rule written here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authorizeForms(request, "view_form_monitoring");
    const instances = await listInstances();
    return NextResponse.json({ instances });
  } catch (error) {
    return errorResponse(error, "forms/instances");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      templateKey?: string;
      variantKey?: string | null;
      employeeName?: string;
      employeeRole?: string | null;
      locationId?: string | null;
      locationName?: string | null;
      source?: "manual" | "ask_sunny";
      formDate?: string;
    } | null;

    if (!body?.templateKey || !body.employeeName?.trim()) {
      return NextResponse.json(
        { error: "A form type and an employee are required." },
        { status: 400 },
      );
    }

    const template = await getTemplateByKey(body.templateKey);
    if (!template) {
      return NextResponse.json({ error: "No such form template." }, { status: 404 });
    }

    const actor = await authorizeForms(request, template.requiredPermission as Permission);

    const instance = await createInstance({
      templateKey: body.templateKey,
      variantKey: body.variantKey ?? null,
      employeeName: body.employeeName.trim().slice(0, 120),
      employeeRole: body.employeeRole ?? null,
      locationId: body.locationId ?? null,
      locationName: body.locationName ?? null,
      createdBy: actor.id,
      createdByRole: actor.role,
      source: body.source === "ask_sunny" ? "ask_sunny" : "manual",
      formDate: body.formDate,
    });

    return NextResponse.json({ instance });
  } catch (error) {
    return errorResponse(error, "forms/instances/create");
  }
}
