import Link from "next/link";
import {
  MessagesSquare,
  UserPlus,
  Flame,
  CheckCircle2,
  Trophy,
  Clock,
  TrendingUp,
  Bot,
  ArrowRight,
  Bell,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusChart, type StatusDatum } from "@/components/dashboard/status-chart";
import { StatusBadge } from "@/components/status-badge";
import { ScoreBar } from "@/components/score-bar";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  getConversations,
  getDashboardAlerts,
  getDashboardStats,
} from "@/lib/data";
import { LEAD_STATUS_META } from "@/lib/constants";
import { contactLabel, formatPercent, getInitials, timeAgo } from "@/lib/utils";
import type { LeadStatus } from "@/lib/types";

const ALERT_TONE: Record<string, string> = {
  human: "bg-destructive/10 text-destructive",
  hot: "bg-accent/15 text-accent",
  qualified: "bg-success/10 text-success",
  support: "bg-info/10 text-info",
};

const CHART_COLORS: Partial<Record<LeadStatus, string>> = {
  nouveau: "#94a3b8",
  prospect_froid: "#60a5fa",
  prospect_tiede: "#f59e0b",
  prospect_chaud: "#f97316",
  prospect_qualifie: "#16a34a",
  client_converti: "#0ea5e9",
  support_client: "#6366f1",
};

export default async function DashboardPage() {
  const [stats, conversations, alerts] = await Promise.all([
    getDashboardStats(),
    getConversations(),
    getDashboardAlerts(),
  ]);

  const recentConversations = conversations.slice(0, 6);
  const recentProspects = [...conversations]
    .filter((c) => c.status !== "client_converti" && c.status !== "spam")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const chartData: StatusDatum[] = (Object.keys(CHART_COLORS) as LeadStatus[])
    .map((status) => ({
      label: LEAD_STATUS_META[status].label,
      value: conversations.filter((c) => c.status === status).length,
      color: CHART_COLORS[status]!,
    }))
    .filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description="Vue d'ensemble de votre activité WhatsApp et de vos prospects."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard index={0} label="Conversations" value={stats.totalConversations} icon={MessagesSquare} tone="primary" />
        <StatCard index={1} label="Nouveaux prospects" value={stats.newProspects} icon={UserPlus} tone="info" />
        <StatCard index={2} label="Prospects chauds" value={stats.hotProspects} icon={Flame} tone="accent" />
        <StatCard index={3} label="Qualifiés" value={stats.qualifiedProspects} icon={CheckCircle2} tone="success" />
        <StatCard index={4} label="Clients convertis" value={stats.convertedClients} icon={Trophy} tone="primary" />
        <StatCard index={5} label="En attente" value={stats.pendingConversations} icon={Clock} tone="warning" hint="Reprise humaine / non lus" />
        <StatCard index={6} label="Taux de conversion" value={formatPercent(stats.conversionRate)} icon={TrendingUp} tone="success" />
        <StatCard index={7} label="Messages IA" value={stats.aiHandledMessages} icon={Bot} tone="neutral" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent conversations */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Dernières conversations</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/conversations">
                Tout voir <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-2">
            {recentConversations.length === 0 ? (
              <EmptyState icon={MessagesSquare} title="Aucune conversation" description="Les conversations WhatsApp apparaîtront ici." />
            ) : (
              <ul className="divide-y divide-border">
                {recentConversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/dashboard/conversations/${c.id}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted"
                    >
                      <Avatar className="size-10">
                        <AvatarFallback>{getInitials(contactLabel(c.contact.name, c.contact.phone))}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-foreground">
                            {contactLabel(c.contact.name, c.contact.phone)}
                          </p>
                          {c.unread_count > 0 && (
                            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-sm text-muted-foreground">{c.last_message_preview}</p>
                      </div>
                      <div className="hidden flex-col items-end gap-1.5 sm:flex">
                        <StatusBadge status={c.status} />
                        <span className="text-xs text-muted-foreground">{timeAgo(c.last_message_at)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Alertes importantes</CardTitle>
            <Bell className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <EmptyState icon={Bell} title="Tout est calme" description="Aucune alerte pour le moment." />
            ) : (
              <ul className="space-y-2.5">
                {alerts.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/dashboard/conversations/${a.conversationId}`}
                      className="flex gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${ALERT_TONE[a.type]}`}>
                        <Flame className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                        {a.description && <p className="line-clamp-2 text-xs text-muted-foreground">{a.description}</p>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Status distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Répartition des prospects</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <EmptyState icon={TrendingUp} title="Pas encore de données" />
            ) : (
              <StatusChart data={chartData} />
            )}
          </CardContent>
        </Card>

        {/* Top prospects */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Meilleurs prospects</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/qualified-leads">
                Voir <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentProspects.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/conversations/${c.id}`}
                className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
              >
                <Avatar className="size-9">
                  <AvatarFallback>{getInitials(contactLabel(c.contact.name, c.contact.phone))}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {contactLabel(c.contact.name, c.contact.phone)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{c.contact.business_type ?? "—"}</p>
                </div>
                <ScoreBar score={c.score} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
