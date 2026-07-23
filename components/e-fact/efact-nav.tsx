"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FilePlus2, Archive } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/e-fact", label: "Créer", icon: FilePlus2 },
  { href: "/dashboard/e-fact/historique", label: "Historique & stats", icon: Archive },
];

/** Segmented tab bar shared by the E_Fact create & archive pages. */
export function EFactNav() {
  const pathname = usePathname();
  return (
    <div className="inline-flex rounded-xl border border-border bg-card p-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
