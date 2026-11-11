import { REGISTER_HREF } from "./words";

/** The standalone page for one form, under the forms list's own route. */
export function formPageHref(instanceId: string): string {
  return `${REGISTER_HREF}/${encodeURIComponent(instanceId)}`;
}
