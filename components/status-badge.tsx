import { Badge } from "@/components/ui/badge";
import { INTENT_META, LEAD_STATUS_META } from "@/lib/constants";
import type { Intent, LeadStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: LeadStatus }) {
  const meta = LEAD_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function IntentBadge({ intent }: { intent: Intent | null }) {
  if (!intent) return null;
  const meta = INTENT_META[intent];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
