"use client";

import { useState } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Logo } from "@/components/logo";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** Desktop sidebar — fixed, dark, full height. Collapsible. */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex transition-all duration-300",
        collapsed ? "w-15" : "w-56",
      )}
    >
      {/* Logo / header */}
      <div className="flex h-16 items-center border-b border-sidebar-border">
        {collapsed ? (
          <div className="flex w-full flex-col items-center justify-center gap-2">
            <Link href="/dashboard" className="flex items-center justify-center text-white">
              <Logo withWordmark={false} />
            </Link>
            <button
              onClick={() => setCollapsed(false)}
              className="flex items-center justify-center rounded-lg p-1 text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"
              title="Agrandir la sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between px-5">
            <Link href="/dashboard" className="flex items-center gap-2.5 text-white">
              <Logo />
            </Link>
            <button
              onClick={() => setCollapsed(true)}
              className="flex items-center justify-center rounded-lg p-1 text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"
              title="Réduire la sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1">
        <SidebarNav collapsed={collapsed} />
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="mb-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-sidebar-muted">
            <p className="font-medium text-sidebar-foreground">Agent WhatsApp IA</p>
            <p className="truncate opacity-70">Support · Prospection · Conversion</p>
          </div>
        )}
      </div>
    </aside>
  );
}
