import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center"
    >
      <BrandMark size="lg" />
      <p className="eyebrow mt-10">Page not found</p>
      <h1 className="mt-3 text-[28px] leading-tight font-semibold text-foreground">
        That screen does not exist
      </h1>
      <p className="mt-2.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        The link may be out of date, or the screen may not be part of this phase
        of the prototype yet.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/">Back to Overview</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/chat">Ask Sunny</Link>
        </Button>
      </div>
    </main>
  );
}
