import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/ui/layout";
import type { AiReadablePage, PageAccess } from "@/config/ai-readable-pages";

/** Who may open the page, in words. */
function accessWords(access: PageAccess): string {
  if ("permission" in access) return access.adminConsole ? `${access.permission} (admin console)` : access.permission;
  if ("signedIn" in access) return `signed in (${access.note})`;
  return `signed request (${access.signedRequest})`;
}

/**
 * Every page of the app and whether the AI can read it: the tool that reads it and what it reads, or why it cannot.
 * From the page registry, so it always matches what the AI is given.
 */
export function AiReadablePagesScreen({ pages }: { pages: readonly AiReadablePage[] }) {
  const readable = pages.filter((page) => page.reader).length;
  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="AI-readable pages"
        description={`Every page of the app, and whether the AI can read it: ${readable} of ${pages.length} can. The AI reads a page only through its tool, with the same permission and locations as the page itself. This list is the one the AI's tools and rules are written from.`}
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">Page</th>
                <th scope="col" className="px-4 py-3">Who can open it</th>
                <th scope="col" className="px-4 py-3">AI can read it</th>
                <th scope="col" className="px-4 py-3">Tool, and what it reads (or why not)</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={`${page.kind}:${page.route}`} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{page.title}</div>
                    <code className="text-xs text-muted-foreground">{page.route}</code>
                    {page.kind === "api" ? <div className="text-xs text-muted-foreground">API route, no page</div> : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{accessWords(page.access)}</td>
                  <td className="px-4 py-3">
                    {page.reader ? <Badge tone="ready">Yes</Badge> : <Badge tone="neutral">No</Badge>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {page.reader ? (
                      <>
                        <code className="text-xs text-foreground">{page.reader.tool}</code>
                        <div>{page.reader.figures.join("; ")}</div>
                        <div className="text-xs">Periods: {page.reader.periods.join(", ")}</div>
                      </>
                    ) : (
                      page.notReadable
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
