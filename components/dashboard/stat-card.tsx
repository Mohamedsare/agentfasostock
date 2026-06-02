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
      <Card className="p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
              {typeof value === "number" ? formatNumber(value) : value}
            </p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <span className={cn("grid size-11 place-items-center rounded-xl", TONE[tone])}>
            <Icon className="size-5" />
          </span>
        </div>
      </Card>
    </FadeIn>
  );
}
