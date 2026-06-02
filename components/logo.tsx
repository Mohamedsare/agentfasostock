import { cn } from "@/lib/utils";

/** FasoStock brand mark: a stylised stacked-boxes glyph + wordmark. */
export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7l9-4 9 4-9 4-9-4Z" />
          <path d="M3 12l9 4 9-4" />
          <path d="M3 17l9 4 9-4" />
        </svg>
      </span>
      {withWordmark && (
        <span className="text-base font-bold tracking-tight">
          Faso<span className="text-primary">Stock</span>
        </span>
      )}
    </span>
  );
}
