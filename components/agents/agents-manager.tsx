"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Loader2, Plus, QrCode, RefreshCw, Trash2, CheckCircle2, Circle, PhoneForwarded, Settings2 } from "lucide-react";
import {
  deleteAgent,
  connectAgentWhatsApp,
  refreshAgentConnection,
  setActiveAgent,
  saveAgentAdminWhatsapp,
} from "@/lib/actions/agents";
import { AgentForm } from "@/components/agent/agent-form";
import { CreateAgentDialog } from "@/components/agents/create-agent-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { AgentSettings } from "@/lib/types";

export interface ManagedAgent extends AgentSettings {
  id: string;
  /** Internal label for the agent (distinct from the persona `agent_name`). */
  name: string;
  phone_number: string | null;
  connection_status: string;
  wasender_session_id: string | null;
  admin_whatsapp: string | null;
}

function statusBadge(status: string) {
  if (status === "connected") return <Badge tone="success" className="gap-1"><CheckCircle2 className="size-3" /> Connecté</Badge>;
  if (status === "connecting") return <Badge tone="warning" className="gap-1"><Circle className="size-3" /> En attente du QR</Badge>;
  return <Badge tone="neutral" className="gap-1"><Circle className="size-3" /> Non connecté</Badge>;
}

export function AgentsManager({
  agents,
  activeId,
}: {
  agents: ManagedAgent[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  // connect dialog
  const [connectAgent, setConnectAgent] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  // relay dialog
  const [relayAgent, setRelayAgent] = useState<string | null>(null);
  const [relayPhone, setRelayPhone] = useState("");
  // config dialog
  const [configAgent, setConfigAgent] = useState<ManagedAgent | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (success) toast.success(success);
        router.refresh();
      } else {
        toast.error(r.error ?? "Action échouée.");
      }
    });
  }

  function openConnect(agentId: string, currentPhone?: string | null) {
    setConnectAgent(agentId);
    setPhone(currentPhone ?? "");
    setQr(null);
  }

  function closeConnect() {
    setConnectAgent(null);
    setPhone("");
    setQr(null);
  }

  function generateQr(agentId: string) {
    start(async () => {
      const r = await connectAgentWhatsApp(agentId, phone);
      if (!r.ok) { toast.error(r.error ?? "Connexion échouée."); return; }
      setQr(r.qr ?? null);
      if (!r.qr) toast.message("Session créée. Cliquez sur Vérifier si le QR n'apparaît pas.");
      router.refresh();
    });
  }

  function checkStatus(agentId: string) {
    start(async () => {
      const r = await refreshAgentConnection(agentId);
      if (!r.ok) { toast.error(r.error ?? "Vérification échouée."); return; }
      if (r.status === "connected") {
        toast.success("Numéro connecté ✅");
        closeConnect();
      } else {
        if (r.qr) setQr(r.qr);
        toast.message("Pas encore connecté — scannez le QR puis revérifiez.");
      }
      router.refresh();
    });
  }

  function openRelay(agentId: string, current: string | null) {
    setRelayAgent(agentId);
    setRelayPhone(current ?? "");
  }

  function saveRelay(agentId: string) {
    const value = relayPhone.trim();
    if (value && !/^\+?\d{8,15}$/.test(value)) {
      toast.error("Numéro invalide. Format attendu : +226XXXXXXXX.");
      return;
    }
    const normalized = value ? (value.startsWith("+") ? value : `+${value}`) : "";
    start(async () => {
      const r = await saveAgentAdminWhatsapp(agentId, normalized);
      if (r.ok) {
        toast.success(normalized ? "Numéro de relais enregistré." : "Numéro de relais effacé.");
        setRelayAgent(null);
        router.refresh();
      } else {
        toast.error(r.error ?? "Enregistrement échoué.");
      }
    });
  }

  const qrSrc = qr
    ? qr.startsWith("data:")
      ? qr
      : `data:image/png;base64,${qr}`
    : null;

  return (
    <div className="space-y-6">
      {/* Create button */}
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Créer un agent
        </Button>
      </div>

      <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* List */}
      {agents.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Aucun agent. Créez-en un pour commencer.
        </Card>
      ) : (
        <div className="grid gap-3">
          {agents.map((a) => (
            <Card key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bot className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    {a.id === activeId && <Badge tone="success">Actif</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {statusBadge(a.connection_status)}
                    {a.phone_number && <span>· {a.phone_number}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <PhoneForwarded className="size-3 shrink-0" />
                    {a.admin_whatsapp ? (
                      <span>Relais : {a.admin_whatsapp}</span>
                    ) : (
                      <span className="italic">Numéro de relais non défini</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {a.id !== activeId && (
                  <Button variant="outline" size="sm" disabled={pending}
                    onClick={() => run(() => setActiveAgent(a.id), "Agent actif changé.")}>
                    Rendre actif
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={pending}
                  onClick={() => setConfigAgent(a)}>
                  <Settings2 className="size-4" />
                  Configurer
                </Button>
                <Button variant="outline" size="sm" disabled={pending} onClick={() => openConnect(a.id, a.phone_number)}>
                  <QrCode className="size-4" />
                  {a.connection_status === "connected" ? "Reconnecter" : "Connecter WhatsApp"}
                </Button>
                <Button variant="outline" size="sm" disabled={pending}
                  onClick={() => openRelay(a.id, a.admin_whatsapp)}>
                  <PhoneForwarded className="size-4" />
                  Relais
                </Button>
                <Button variant="ghost" size="sm" disabled={pending}
                  onClick={() => {
                    if (confirm(`Supprimer l'agent « ${a.name} » et toutes ses données ?`)) {
                      run(() => deleteAgent(a.id), "Agent supprimé.");
                    }
                  }}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Config dialog */}
      <Dialog open={configAgent !== null} onOpenChange={(o) => { if (!o) setConfigAgent(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurer — {configAgent?.name}</DialogTitle>
            <DialogDescription>
              Persona, prompt système, règles et seuils de scoring de cet agent.
            </DialogDescription>
          </DialogHeader>
          {configAgent && (
            <AgentForm
              agentId={configAgent.id}
              settings={configAgent}
              onSaved={() => setConfigAgent(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Connect dialog */}
      {(() => {
        const connectingAgent = agents.find((a) => a.id === connectAgent);
        const isReconnect = connectingAgent?.connection_status === "connected";
        return (
      <Dialog open={connectAgent !== null} onOpenChange={(o) => { if (!o) closeConnect(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isReconnect ? "Reconnecter WhatsApp" : "Connecter WhatsApp"}</DialogTitle>
            <DialogDescription>
              {qr
                ? "Scannez ce QR code depuis WhatsApp."
                : isReconnect
                  ? "Saisissez le numéro WhatsApp et générez un nouveau QR code pour reconnecter l'agent."
                  : "Entrez le numéro WhatsApp à connecter pour cet agent."}
            </DialogDescription>
          </DialogHeader>

          {!qr ? (
            <div className="flex flex-col gap-3">
              <div className="space-y-1.5">
                <label htmlFor="connectPhone" className="text-sm font-medium">Numéro WhatsApp</label>
                <Input id="connectPhone" placeholder="+226 70 00 00 00" value={phone}
                  onChange={(e) => setPhone(e.target.value)} autoFocus />
              </div>
              <Button className="w-full" disabled={pending || !phone.trim()}
                onClick={() => connectAgent && generateQr(connectAgent)}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
                Générer le QR code
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {qrSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrSrc} alt="QR code WhatsApp" className="size-52 rounded-xl border border-border bg-white p-2" />
              ) : (
                <div className="flex size-52 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  QR en cours de génération…
                </div>
              )}
              <p className="text-center text-xs text-muted-foreground">
                WhatsApp → Appareils connectés → Connecter un appareil
              </p>
              <Button className="w-full" disabled={pending}
                onClick={() => connectAgent && checkStatus(connectAgent)}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                J&apos;ai scanné — Vérifier la connexion
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
        );
      })()}

      {/* Relay dialog */}
      <Dialog open={relayAgent !== null} onOpenChange={(o) => { if (!o) setRelayAgent(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Numéro de relais (prise en charge)</DialogTitle>
            <DialogDescription>
              Quand un prospect est qualifié ou chaud, l&apos;agent IA se met en retrait et envoie
              une alerte WhatsApp à ce numéro pour qu&apos;une personne prenne le relais. Laissez
              vide pour utiliser le numéro par défaut de la plateforme.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="space-y-1.5">
              <label htmlFor="relayPhone" className="text-sm font-medium">
                Numéro WhatsApp de la personne
              </label>
              <Input
                id="relayPhone"
                placeholder="+226 70 00 00 00"
                value={relayPhone}
                onChange={(e) => setRelayPhone(e.target.value)}
              />
            </div>
            <Button className="w-full" disabled={pending}
              onClick={() => relayAgent && saveRelay(relayAgent)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <PhoneForwarded className="size-4" />}
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
