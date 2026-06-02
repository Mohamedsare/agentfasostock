import {
  LayoutDashboard,
  MessagesSquare,
  Users,
  Flame,
  LifeBuoy,
  Bot,
  BookOpen,
  Send,
  FlaskConical,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: "principal" | "intelligence" | "système";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard, group: "principal" },
  { label: "Conversations", href: "/dashboard/conversations", icon: MessagesSquare, group: "principal" },
  { label: "Prospects", href: "/dashboard/prospects", icon: Users, group: "principal" },
  { label: "Clients qualifiés", href: "/dashboard/qualified-leads", icon: Flame, group: "principal" },
  { label: "Support client", href: "/dashboard/support", icon: LifeBuoy, group: "principal" },
  { label: "Agent IA", href: "/dashboard/agent", icon: Bot, group: "intelligence" },
  { label: "Base de connaissance", href: "/dashboard/knowledge-base", icon: BookOpen, group: "intelligence" },
  { label: "Relances", href: "/dashboard/follow-ups", icon: Send, group: "intelligence" },
  { label: "Labs IA", href: "/dashboard/labs", icon: FlaskConical, group: "intelligence" },
  { label: "Statistiques", href: "/dashboard/stats", icon: BarChart3, group: "système" },
  { label: "Paramètres", href: "/dashboard/settings", icon: Settings, group: "système" },
];

export const NAV_GROUPS: { key: NavItem["group"]; label: string }[] = [
  { key: "principal", label: "Principal" },
  { key: "intelligence", label: "Intelligence" },
  { key: "système", label: "Système" },
];
