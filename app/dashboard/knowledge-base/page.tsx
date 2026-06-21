import { PageHeader } from "@/components/dashboard/page-header";
import { KnowledgeManager } from "@/components/knowledge/knowledge-manager";
import { KnowledgeFilesTab } from "@/components/knowledge/knowledge-files-tab";
import { ProductsTab } from "@/components/products/products-tab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getKnowledge, getKnowledgeFiles, getProducts, usingMockData } from "@/lib/data";
import { getOrgAgents, getActiveAgentId } from "@/lib/agents";
import { BookOpen, FileStack, ShoppingBag } from "lucide-react";

export const metadata = { title: "Base de connaissance" };

export default async function KnowledgeBasePage() {
  const [entries, files, products, agents, activeAgentId] = await Promise.all([
    getKnowledge(),
    getKnowledgeFiles(),
    getProducts(),
    usingMockData ? Promise.resolve([]) : getOrgAgents(),
    usingMockData ? Promise.resolve(null) : getActiveAgentId(),
  ]);

  const agentOptions = agents.map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Base de connaissance"
        description="Textes, fichiers et catalogue produits que l'agent IA utilise pour répondre avec précision."
      />

      <Tabs defaultValue="text">
        <TabsList>
          <TabsTrigger value="text">
            <BookOpen className="size-4" />
            Entrées texte
            {entries.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary">
                {entries.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="files">
            <FileStack className="size-4" />
            Fichiers
            {files.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary">
                {files.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="products">
            <ShoppingBag className="size-4" />
            Catalogue produits
            {products.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary">
                {products.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <KnowledgeManager entries={entries} />
        </TabsContent>

        <TabsContent value="files">
          <KnowledgeFilesTab
            files={files}
            agents={agentOptions}
            activeAgentId={activeAgentId}
          />
        </TabsContent>

        <TabsContent value="products">
          <ProductsTab
            products={products}
            agents={agentOptions}
            activeAgentId={activeAgentId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
