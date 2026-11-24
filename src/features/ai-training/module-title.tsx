import { Badge } from "@/components/ui/badge";
import { splitModuleTitle } from "@/lib/ai-training/markdown";

/** "Module 3: Claude at Work" as a "Module 3" pill and its name. Other titles render unchanged. */
export function ModuleTitle({ title }: { title: string }) {
  const split = splitModuleTitle(title);
  if (!split) return <span>{title}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone="accent" size="md">
        {split.label}
      </Badge>
      <span>{split.rest}</span>
    </span>
  );
}
