import { Search } from "lucide-react";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";

/** Top bar of the dashboard: mobile menu, AI status, theme toggle, user menu. */
export function Header({
  name,
  email,
  aiEnabled,
}: {
  name: string;
  email: string;
  aiEnabled: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md lg:px-6">
      <MobileNav />

      <div className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground sm:flex sm:w-72">
        <Search className="size-4" />
        <span className="text-muted-foreground/70">Rechercher un prospect, un numéro…</span>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <Badge tone={aiEnabled ? "success" : "neutral"} className="gap-1.5">
          <span className={`size-1.5 rounded-full ${aiEnabled ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
          {aiEnabled ? "IA active" : "IA en pause"}
        </Badge>
        <ThemeToggle />
        <UserMenu name={name} email={email} />
      </div>
    </header>
  );
}
