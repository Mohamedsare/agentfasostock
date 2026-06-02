import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { BadgeTone } from "@/lib/constants";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-secondary text-secondary-foreground",
        info: "border-transparent bg-info/10 text-info",
        warning: "border-transparent bg-warning/15 text-warning",
        success: "border-transparent bg-success/10 text-success",
        danger: "border-transparent bg-destructive/10 text-destructive",
        accent: "border-transparent bg-accent/15 text-accent",
        primary: "border-transparent bg-primary/10 text-primary",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  tone?: BadgeTone;
}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
