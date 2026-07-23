import { PageHeader } from "@/components/dashboard/page-header";
import { EFactNav } from "@/components/e-fact/efact-nav";
import { EfactHistory } from "@/components/e-fact/efact-history";
import { getEfactDocuments } from "@/lib/data";

export const metadata = { title: "E_Fact — Historique & statistiques" };

export default async function EFactHistoryPage() {
  const documents = await getEfactDocuments();
  return (
    <div className="space-y-6">
      <PageHeader
        title="E_Fact"
        description="Retrouvez, recherchez et analysez tous vos documents émis."
      />
      <EFactNav />
      <EfactHistory documents={documents} />
    </div>
  );
}
