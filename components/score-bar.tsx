import { cn } from "@/lib/utils";
import { SCORE_THRESHOLDS } from "@/lib/constants";

/** Compact score indicator: a value + a thin colored bar. */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const tone =
    score >= SCORE_THRESHOLDS.hot
      ? "bg-accent"
      : score >= SCORE_THRESHOLDS.qualified
        ? "bg-success"
        : score >= 45
          ? "bg-warning"
          : "bg-muted-foreground/40";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-foreground">{score}</span>
    </div>
  );
}
