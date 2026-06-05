import type { LucideIcon } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { Card } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "primary" | "accent" | "success" | "info" | "warning" | "neutral";
  hint?: string;
  index?: number;
}

const TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/10 text-success",
  info: "bg-info/10 text-info",
  warning: "bg-warning/15 text-warning",
  neutral: "bg-muted text-muted-foreground",
};

export function StatCard({ label, value, icon: Icon, tone = "primary", hint, index = 0 }: StatCardProps) {
  return (
    <FadeIn delay={index * 0.05}>
      <Card className="p-4 transition-shadow hover:shadow-md sm:p-5">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
            <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-3xl">
              {typeof value === "number" ? formatNumber(value) : value}
            </p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl sm:size-11", TONE[tone])}>
            <Icon className="size-4 sm:size-5" />
          </span>
        </div>
      </Card>
    </FadeIn>
  );
}
