import Link from "next/link";
import { Logo } from "@/components/logo";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Desktop sidebar — fixed, dark, full height. */
export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <Link href="/dashboard" className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5 text-white">
        <Logo />
      </Link>
      <ScrollArea className="flex-1">
        <SidebarNav />
      </ScrollArea>
      <div className="border-t border-sidebar-border p-4">
        <div className="rounded-xl bg-white/5 p-3 text-xs text-sidebar-muted">
          <p className="font-medium text-sidebar-foreground">Agent WhatsApp IA</p>
          <p className="mt-0.5">Support · Prospection · Conversion</p>
        </div>
      </div>
    </aside>
  );
}
