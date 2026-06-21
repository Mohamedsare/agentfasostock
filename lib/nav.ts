import {
  LayoutDashboard,
  Users,
  Flame,
  LifeBuoy,
  Bot,
  BookOpen,
  Send,
  FlaskConical,
  BarChart3,
  Settings,
  Users2,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { WhatsApp } from "@/components/icons/whatsapp";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  color: string;
  group: "principal" | "intelligence" | "système";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard, color: "#3B82F6", group: "principal" },
  { label: "Conversations", href: "/dashboard/conversations", icon: WhatsApp as unknown as LucideIcon, color: "#25D366", group: "principal" },
  { label: "Prospects", href: "/dashboard/prospects", icon: Users, color: "#A855F7", group: "principal" },
  { label: "Clients qualifiés", href: "/dashboard/qualified-leads", icon: Flame, color: "#F97316", group: "principal" },
  { label: "Support client", href: "/dashboard/support", icon: LifeBuoy, color: "#EF4444", group: "principal" },
  { label: "Agents", href: "/dashboard/agents", icon: Bot, color: "#06B6D4", group: "intelligence" },
  { label: "Base de connaissance", href: "/dashboard/knowledge-base", icon: BookOpen, color: "#EAB308", group: "intelligence" },
  { label: "Relances", href: "/dashboard/follow-ups", icon: Send, color: "#6366F1", group: "intelligence" },
  { label: "Labs IA", href: "/dashboard/labs", icon: FlaskConical, color: "#EC4899", group: "intelligence" },
  { label: "Statistiques", href: "/dashboard/stats", icon: BarChart3, color: "#10B981", group: "système" },
  { label: "Journal", href: "/dashboard/activity", icon: ScrollText, color: "#94A3B8", group: "système" },
  { label: "Équipe", href: "/dashboard/team", icon: Users2, color: "#14B8A6", group: "système" },
  { label: "Paramètres", href: "/dashboard/settings", icon: Settings, color: "#6B7280", group: "système" },
];

export const NAV_GROUPS: { key: NavItem["group"]; label: string }[] = [
  { key: "principal", label: "Principal" },
  { key: "intelligence", label: "Intelligence" },
  { key: "système", label: "Système" },
];
