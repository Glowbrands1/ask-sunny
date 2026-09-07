import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { authorizeForms } from "@/lib/forms/access";
import {
  createInstance,
  deleteDemoInstances,
  findDemoInstances,
  InstanceProtectedError,
  listInstances,
  type InstanceView,
} from "@/lib/forms/instances";
import { authorizeLocation } from "@/lib/forms/location-scope";
import { getTemplateByKey } from "@/lib/forms/repository";
import type { Permission } from "@/types";

/**
 * GET    /api/forms/instances   Form Monitoring's history, and what a demo
 *                               sweep would remove
 * POST   /api/forms/instances   starts a form from a template's current version
 * DELETE /api/forms/instances   removes every DEMO DRAFT, by provenance
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
    const { searchParams } = new URL(request.url);

    const requested = searchParams.get("view");
    const view: InstanceView =
      requested === "archived" || requested === "all" ? requested : "active";

    const instances = await listInstances(view);

    // The sweep's shape is returned alongside so the screen can say "Delete 5
    // demo forms" with a real number rather than counting what it happens to
    // be showing — the active list is filtered, and a count taken from it
    // would be wrong the moment somebody switches to Archived.
    const sweep = await findDemoInstances();
    return NextResponse.json({
      instances,
      view,
      demo: { deletable: sweep.deletable.length, protected: sweep.protected.length },
    });
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

    /*
     * ==========================================================================
     * THE SALON IS THE SERVER'S DECISION, NOT THE CALLER'S
     * ==========================================================================
     *
     * This route accepted `locationId` and `locationName` and stored them
     * unchecked. The authenticated identity has carried an `AccessScope` all
     * along — `authorizeForms` was discarding it — so nothing compared the salon
     * on a disciplinary record against the salons the person filing it covers.
     *
     * ENFORCED HERE, AT THE ROUTE EVERY CALLER GOES THROUGH, rather than in the
     * chat orchestration that will use it next. A check that lives in one
     * caller is a check the next caller does not have.
     *
     * A REFUSAL IS A 403 WITH A REASON, not a silently dropped field. Quietly
     * storing the form without its salon would file an HR document against
     * nobody's location and tell the manager it worked.
     */
    const location = authorizeLocation(actor.scope, body.locationId ?? null);
    if (location.kind === "refused") {
      return NextResponse.json({ error: location.reason }, { status: 403 });
    }
    const locationId = location.kind === "authorized" ? location.locationId : null;

    /*
     * THE NAME FOLLOWS THE ID, AND IS DROPPED WHEN THE ID IS.
     *
     * A location id and a display name must not become two independent
     * authorities: a caller that sent an unauthorized id with a plausible name
     * would otherwise leave the name on the record after the id was refused.
     *
     * WHAT THIS DOES NOT DO is verify that the name describes the id. There is
     * no salon roster to resolve a display name from, so the name remains
     * caller-supplied text attached to a server-validated id. That limitation is
     * real and is written down rather than papered over — see
     * `docs/chat-phase-2.md`.
     */
    const locationName = locationId ? (body.locationName ?? null) : null;

    const instance = await createInstance({
      templateKey: body.templateKey,
      variantKey: body.variantKey ?? null,
      employeeName: body.employeeName.trim().slice(0, 120),
      employeeRole: body.employeeRole ?? null,
      locationId,
      locationName,
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

/**
 * THE DEMO SWEEP — the one destructive action that runs without naming a row.
 *
 * It is therefore the most carefully bounded. `deleteDemoInstances` selects on
 * the `demo:` PROVENANCE PREFIX and on draft status, so a real record cannot be
 * in the set; and the caller sends the count it showed the person, so a list
 * that changed underneath aborts instead of deleting a different set than was
 * agreed to.
 *
 * A finalized demo form is not swept. The rule about signed documents does not
 * bend because the document happens to be synthetic — those are reported and
 * left for archiving.
 */
export async function DELETE(request: Request) {
  try {
    await authorizeForms(request, "manage_form_records");
    const { searchParams } = new URL(request.url);

    // Explicit and narrow: there is no "delete everything" shape of this call.
    if (searchParams.get("scope") !== "demo") {
      return NextResponse.json(
        { error: "This endpoint only removes demo records. Pass scope=demo." },
        { status: 400 },
      );
    }

    const expected = Number(searchParams.get("expected"));
    if (!Number.isInteger(expected) || expected < 0) {
      return NextResponse.json(
        { error: "Say how many forms you expect to remove." },
        { status: 400 },
      );
    }

    const result = await deleteDemoInstances(expected);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InstanceProtectedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return errorResponse(error, "forms/instances/demo-sweep");
  }
}
