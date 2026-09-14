"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  RotateCcw,
  Sparkles,
  Mail,
  Loader2,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, IntentBadge } from "@/components/status-badge";
import { ScoreBar } from "@/components/score-bar";
import { EmptyState } from "@/components/dashboard/empty-state";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_META } from "@/lib/constants";
import { toast } from "sonner";
import type { AgentResult, AgentTone } from "@/lib/types";
import { WhatsAppText } from "@/components/ui/whatsapp-text";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const TONES: { value: AgentTone; label: string }[] = [
  { value: "professionnel", label: "Professionnel" },
  { value: "amical", label: "Amical" },
  { value: "direct", label: "Direct" },
  { value: "chaleureux", label: "Chaleureux" },
];

const SCENARIOS = [
  "Bonjour, je vends des cosmétiques à Ouaga et je perds des ventes par rupture de stock.",
  "C'est combien par mois votre application ?",
  "Vous pouvez me montrer une démonstration ?",
  "Bonjour je suis déjà client mais je n'arrive plus à me connecter.",
  "Pas intéressé, arrêtez de m'écrire.",
];

export function LabsSimulator({
  defaultTone,
  defaultPrompt,
}: {
  defaultTone: AgentTone;
  defaultPrompt: string;
}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<AgentResult | null>(null);
  const [tone, setTone] = React.useState<AgentTone>(defaultTone);
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [showSettings, setShowSettings] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/labs/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          toneOverride: tone,
          systemPromptOverride: prompt.trim() || undefined,
          previousScore: result?.score ?? 0,
        }),
      });

      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Erreur");

      const data: AgentResult = await res.json();
      setResult(data);
      if (data.reply) {
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la simulation.");
      setMessages(messages); // rollback the optimistic user message
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMessages([]);
    setResult(null);
    setInput("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* ─── Chat ─── */}
      <Card className="flex h-[34rem] flex-col overflow-hidden">
        <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Bot className="size-4" />
            </span>
            <CardTitle className="text-base">Simulateur de conversation</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setShowSettings((s) => !s)} aria-label="Réglages">
              <SlidersHorizontal className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={reset} aria-label="Réinitialiser" disabled={!messages.length}>
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <AnimatePresence initial={false}>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-border bg-muted/40"
            >
              <div className="space-y-3 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tone">Ton de l'agent</Label>
                  <Select value={tone} onValueChange={(v) => setTone(v as AgentTone)}>
                    <SelectTrigger id="tone"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prompt">Prompt système (surcharge)</Label>
                  <Textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    className="text-xs"
                    placeholder="Laissez vide pour utiliser le prompt par défaut de l'agent."
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
          {messages.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <EmptyState
                icon={Sparkles}
                title="Testez votre agent"
                description="Écrivez comme le ferait un client WhatsApp, ou choisissez un scénario."
              />
              <div className="flex flex-wrap justify-center gap-2 px-2">
                {SCENARIOS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                  >
                    {s.length > 40 ? s.slice(0, 40) + "…" : s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}
              >
                {m.role === "assistant" && (
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Bot className="size-3.5" />
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                    m.role === "user"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-card text-card-foreground",
                  )}
                >
                  <WhatsAppText text={m.content} />
                </div>
                {m.role === "user" && (
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                    <User className="size-3.5" />
                  </span>
                )}
              </motion.div>
            ))
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-3.5" />
              </span>
              <Loader2 className="size-4 animate-spin" /> l'agent écrit…
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t border-border p-3"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Écrivez un message de client…"
            rows={1}
            className="max-h-28 min-h-10 flex-1 resize-none py-2"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label="Envoyer">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </form>
      </Card>

      {/* ─── Analyse ─── */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Analyse de l'agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!result ? (
              <p className="text-sm text-muted-foreground">
                Les indicateurs (score, statut, intention…) apparaîtront ici après le premier message.
              </p>
            ) : (
              <>
                <Field label="Score">
                  <ScoreBar score={result.score} />
                </Field>
                <Field label="Statut">
                  <StatusBadge status={result.status} />
                </Field>
                <Field label="Intention">
                  <IntentBadge intent={result.intent} />
                </Field>
                <div className="space-y-1 border-t border-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Résumé</p>
                  <p className="text-sm text-foreground">{result.summary || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action recommandée</p>
                  <p className="text-sm text-foreground">{result.next_action || "—"}</p>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm text-muted-foreground">Notifier l'admin&nbsp;?</span>
                  <Badge tone={result.should_notify_admin ? "success" : "neutral"}>
                    {result.should_notify_admin ? "Oui" : "Non"}
                  </Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Aperçu email */}
        {result?.should_notify_admin && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-primary/30">
              <CardHeader className="flex-row items-center gap-2 py-3">
                <Mail className="size-4 text-primary" />
                <CardTitle className="text-base">Email qui serait envoyé</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Objet : </span>
                  <span className="font-medium">
                    Nouveau lead — {LEAD_STATUS_META[result.status].label} ({result.score}/100)
                  </span>
                </p>
                <div className="rounded-lg bg-muted/50 p-3 text-foreground">{result.summary}</div>
                <p className="text-xs text-muted-foreground">
                  Destinataire : l'email admin configuré (ADMIN_EMAIL).
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
