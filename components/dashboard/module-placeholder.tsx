import type { LucideIcon } from "lucide-react";
import { Hammer } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Temporary content for modules whose UI is scaffolded but not yet built. */
export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
  points,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  points: string[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description}>
        <Badge tone="warning" className="gap-1.5">
          <Hammer className="size-3.5" /> En construction
        </Badge>
      </PageHeader>

      <Card>
        <CardContent className="flex flex-col gap-6 p-8 sm:flex-row sm:items-center">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-8" />
          </span>
          <div className="space-y-3">
            <p className="text-foreground">
              Ce module est prévu et son emplacement est prêt. Voici ce qu'il proposera :
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
