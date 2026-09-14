import { PageHeader } from "@/components/dashboard/page-header";
import { LearningView } from "@/components/learning/learning-view";
import { getAgentSettings, getLearnings } from "@/lib/data";

export const metadata = { title: "Auto-apprentissage" };

export default async function LearningPage() {
  const [learnings, settings] = await Promise.all([getLearnings(), getAgentSettings()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auto-apprentissage"
        description="L'agent relit ses conversations terminées, en tire des leçons et les applique à chaque nouvelle réponse."
      />
      <LearningView learnings={learnings} mode={settings.learning_mode ?? "auto"} />
    </div>
  );
}
