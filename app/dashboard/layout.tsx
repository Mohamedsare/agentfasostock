import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { getSessionUser } from "@/lib/auth";
import { getAgentSettings } from "@/lib/data";
import { usingMockData } from "@/lib/data";
import { Database } from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, settings] = await Promise.all([getSessionUser(), getAgentSettings()]);

  return (
    <div className="flex h-dvh overflow-hidden bg-muted/40">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header name={user.name} email={user.email} aiEnabled={settings.ai_enabled} />
        {usingMockData && (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs font-medium text-warning lg:px-6">
            <Database className="size-3.5" />
            Mode démo — données fictives. Renseignez vos clés Supabase dans .env.local pour connecter vos vraies données.
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
