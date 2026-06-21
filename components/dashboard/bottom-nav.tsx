"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { LayoutDashboard, Users, LifeBuoy, Menu } from "lucide-react";
import { WhatsApp } from "@/components/icons/whatsapp";
import { Logo } from "@/components/logo";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { cn } from "@/lib/utils";

/** The 4 thumb-reachable primary destinations; the 5th slot opens the full menu. */
const TABS = [
  { label: "Accueil", href: "/dashboard", icon: LayoutDashboard, color: "#3B82F6" },
  { label: "Chats", href: "/dashboard/conversations", icon: WhatsApp, color: "#25D366" },
  { label: "Prospects", href: "/dashboard/prospects", icon: Users, color: "#A855F7" },
  { label: "Support", href: "/dashboard/support", icon: LifeBuoy, color: "#EF4444" },
] as const;

/**
 * Fixed bottom tab bar — the primary navigation on phones (mobile-first).
 * Hidden on lg+ (the desktop sidebar takes over) and on the full-screen
 * conversation thread, where it would cover the message composer.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  // Immersive chat view: hide the bar so the composer stays reachable.
  if (/^\/dashboard\/conversations\/.+/.test(pathname)) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground active:text-foreground",
                )}
              >
                {active && (
                  <span className="absolute top-0 h-0.5 w-8 rounded-full" style={{ backgroundColor: t.color }} />
                )}
                <t.icon
                  className={cn("size-5 transition-transform", active && "scale-110")}
                  style={{ color: active ? t.color : undefined }}
                />
                <span style={{ color: active ? t.color : undefined }}>{t.label}</span>
              </Link>
            );
          })}
          <Dialog.Trigger
            className="flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground active:text-foreground"
            aria-label="Plus de menus"
          >
            <Menu className="size-5" />
            Menu
          </Dialog.Trigger>
        </div>
      </nav>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 lg:hidden" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-sidebar pb-[env(safe-area-inset-bottom)] shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom lg:hidden">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex items-center justify-center pt-2.5">
            <span className="h-1 w-10 rounded-full bg-white/20" />
          </div>
          <div className="flex items-center px-5 pt-3 text-white">
            <Logo />
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
