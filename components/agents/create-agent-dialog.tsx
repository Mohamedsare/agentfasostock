"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Sparkles, Target, Headphones, Zap, ChevronRight, TrendingUp } from "lucide-react";
import { AGENT_TEMPLATES, type AgentType } from "@/lib/agent-templates";
import { createAgent } from "@/lib/actions/agents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TYPE_VISUAL: Record<
  AgentType,
  { icon: React.ElementType; color: string; bg: string; border: string; ring: string }
> = {
  prospection: {
    icon: Target,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    ring: "ring-orange-500/20",
  },
  support: {
    icon: Headphones,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    ring: "ring-blue-500/20",
  },
  hybride: {
    icon: Zap,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    ring: "ring-violet-500/20",
  },
  vente: {
    icon: TrendingUp,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    ring: "ring-emerald-500/20",
  },
};

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<AgentType | null>(null);
  const [name, setName] = useState("");

  function handleSelectType(type: AgentType) {
    const template = AGENT_TEMPLATES.find((t) => t.type === type)!;
    setSelectedType(type);
    setName(template.defaultName);
    setStep(2);
  }

  function handleBack() {
    setStep(1);
    setSelectedType(null);
    setName("");
  }

  function handleCreate() {
    if (!selectedType || !name.trim()) return;
    const template = AGENT_TEMPLATES.find((t) => t.type === selectedType)!;
    start(async () => {
      const r = await createAgent({
        name: name.trim(),
        tone: template.tone,
        operating_mode: template.operating_mode,
        system_prompt: template.system_prompt,
        welcome_message: template.welcome_message,
        qualification_rules: template.qualification_rules,
        human_handoff_rules: template.human_handoff_rules,
      });
      if (r.ok) {
        toast.success("Agent créé avec succès !");
        onOpenChange(false);
        router.refresh();
        setTimeout(() => { setStep(1); setSelectedType(null); setName(""); }, 300);
      } else {
        toast.error(r.error ?? "Échec de la création.");
      }
    });
  }

  function handleOpenChange(o: boolean) {
    if (!o) { setStep(1); setSelectedType(null); setName(""); }
    onOpenChange(o);
  }

  const selectedVisual = selectedType ? TYPE_VISUAL[selectedType] : null;
  const selectedTemplate = selectedType ? AGENT_TEMPLATES.find((t) => t.type === selectedType)! : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        {/* Header */}
        <div className="border-b border-border px-6 py-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="grid size-7 place-items-center rounded-lg bg-primary/10">
                <Sparkles className="size-4 text-primary" />
              </span>
              {step === 1 ? "Choisir le type d'agent" : "Nommer votre agent"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {step === 1
                ? "Chaque type embarque un prompt système complet, prêt à l'emploi."
                : "Donnez un nom à votre agent. Tout est personnalisable ensuite."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {step === 1 ? (
            <div className="flex flex-col gap-3">
              {AGENT_TEMPLATES.map((t) => {
                const v = TYPE_VISUAL[t.type];
                const Icon = v.icon;
                return (
                  <button
                    key={t.type}
                    onClick={() => handleSelectType(t.type)}
                    className={cn(
                      "group flex items-center gap-4 rounded-xl border bg-card p-4 text-left transition-all duration-150",
                      "hover:shadow-sm",
                      v.border,
                      `hover:ring-2 ${v.ring}`,
                    )}
                  >
                    <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", v.bg)}>
                      <Icon className={cn("size-5", v.color)} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">{t.label}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Selected type recap */}
              {selectedVisual && selectedTemplate && (() => {
                const Icon = selectedVisual.icon;
                return (
                  <div className={cn("flex items-center gap-3 rounded-xl border p-3", selectedVisual.border, selectedVisual.bg)}>
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-card/60")}>
                      <Icon className={cn("size-4", selectedVisual.color)} strokeWidth={2} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{selectedTemplate.label}</p>
                      <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Name input */}
              <div className="space-y-1.5">
                <Label htmlFor="agentNameInput">Nom de l'agent</Label>
                <Input
                  id="agentNameInput"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !pending && name.trim() && handleCreate()}
                  placeholder="Ex : Awa — Commerciale"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Utilisez le prénom de votre assistante virtuelle si vous le souhaitez.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleBack} disabled={pending}>
                  <ArrowLeft className="size-4" />
                  Retour
                </Button>
                <Button className="flex-1" disabled={pending || !name.trim()} onClick={handleCreate}>
                  {pending
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Sparkles className="size-4" />}
                  Créer l'agent
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
