import { PageHeader } from "@/components/dashboard/page-header";
import { InvoiceBuilder } from "@/components/e-fact/invoice-builder";
import { EFactNav } from "@/components/e-fact/efact-nav";

export const metadata = { title: "E_Fact — Factures & Devis" };

export default function EFactPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="E_Fact"
        description="Générez des factures et devis électroniques premium en PDF, prêts à envoyer à vos clients."
      />
      <EFactNav />
      <InvoiceBuilder />
    </div>
  );
}
