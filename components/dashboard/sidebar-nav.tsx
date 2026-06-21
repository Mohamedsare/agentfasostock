"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** The list of navigation links, shared by the desktop and mobile sidebars. */
export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <nav className={cn("flex flex-col py-4", collapsed ? "gap-2 px-1" : "gap-6 px-2")}>
      {NAV_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          {!collapsed && (
            <span className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
              {group.label}
            </span>
          )}
          {NAV_ITEMS.filter((i) => i.group === group.key).map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                  collapsed
                    ? "w-full justify-center p-2"
                    : "gap-3 px-3 py-2",
                  active
                    ? "bg-sidebar-accent/15 text-white"
                    : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent" />
                )}
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center transition-all",
                    active ? "opacity-100" : "opacity-80 group-hover:opacity-100",
                  )}
                  style={{ color: item.color }}
                >
                  <item.icon className={cn("transition-all", collapsed ? "size-8" : "size-5")} />
                </span>
                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
