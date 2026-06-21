"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  UserCog,
  Send,
  Loader2,
  CheckCircle2,
  Trophy,
  Sparkles,
  MoreVertical,
  Phone,
  MapPin,
  Briefcase,
  StickyNote,
  Plus,
  XCircle,
  LifeBuoy,
  UserX,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, IntentBadge } from "@/components/status-badge";
import { ScoreBar } from "@/components/score-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn, contactLabel, formatDateTime, getInitials, timeAgo } from "@/lib/utils";
import {
  addNote,
  excludeContact,
  reactivateAi,
  sendManualMessage,
  takeOverConversation,
  updateConversationStatus,
  type ActionResult,
} from "@/lib/actions/conversations";
import type { ConversationWithContact, LeadStatus, Message, Note } from "@/lib/types";

export function ConversationDetail({
  conversation,
  messages,
  notes,
}: {
  conversation: ConversationWithContact;
  messages: Message[];
  notes: Note[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [noteDraft, setNoteDraft] = React.useState("");
  const threadRef = React.useRef<HTMLDivElement>(null);
  const c = conversation;
  const contact = c.contact;
  const label = contactLabel(contact.name, contact.phone);

  React.useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages.length]);

  function run(fn: () => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(res.error ?? "Action échouée.");
      }
    });
  }

  async function onSend() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const res = await sendManualMessage(c.id, contact.phone, text);
    setSending(false);
    if (res.ok) {
      setDraft("");
      toast.success("Message envoyé.");
      router.refresh();
    } else {
      toast.error(res.error ?? "Envoi échoué.");
    }
  }

  function onAddNote() {
    const text = noteDraft.trim();
    if (!text) return;
    startTransition(async () => {
      const res = await addNote(c.id, contact.id, text);
      if (res.ok) {
        setNoteDraft("");
        toast.success("Note ajoutée.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Échec.");
      }
    });
  }

  const setStatus = (status: LeadStatus, label: string) =>
    run(() => updateConversationStatus(c.id, status), label);

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard/conversations">
          <ArrowLeft className="size-4" /> Conversations
        </Link>
      </Button>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* ─── Main: header + thread + composer ─── */}
        <Card className="flex h-[calc(100dvh-12rem)] min-h-[28rem] flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border p-3 sm:p-4">
            <Avatar className="size-11">
              <AvatarFallback>{getInitials(label)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">{label}</p>
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-medium",
                    c.mode === "ai" ? "text-primary" : "text-accent",
                  )}
                >
                  {c.mode === "ai" ? <Bot className="size-3.5" /> : <UserCog className="size-3.5" />}
                  {c.mode === "ai" ? "IA" : "Humain"}
                </span>
              </div>
            </div>
            <StatusActions pending={pending} mode={c.mode} onTakeover={() => run(() => takeOverConversation(c.id), "Vous avez repris la conversation.")} onReactivate={() => run(() => reactivateAi(c.id), "IA réactivée.")} onStatus={setStatus} onExclude={() => run(() => excludeContact(c.id), "Contact exclu — l'agent ne répondra plus.")} />
          </div>

          {/* Thread */}
          <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-3 sm:p-4">
            {messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Aucun message.</p>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
            className="border-t border-border p-3"
          >
            {c.mode === "ai" && (
              <p className="mb-2 text-xs text-muted-foreground">
                ✋ Envoyer un message manuel met l'IA en pause sur cette conversation.
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                placeholder="Votre message…"
                rows={1}
                className="max-h-32 min-h-10 flex-1 resize-none py-2"
              />
              <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Envoyer">
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </form>
        </Card>

        {/* ─── Side: info, AI summary, notes ─── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ScoreBar score={c.score} className="!gap-3" />
              <InfoRow icon={Phone} value={contact.phone} />
              <InfoRow icon={Briefcase} value={contact.business_type ?? "Activité inconnue"} />
              <InfoRow icon={MapPin} value={contact.city ?? "Ville inconnue"} />
              {c.intent && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Intention</span>
                  <IntentBadge intent={c.intent} />
                </div>
              )}
              {contact.need && (
                <div className="border-t border-border pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Besoin</p>
                  <p className="mt-0.5">{contact.need}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {(c.summary || c.next_action) && (
            <Card className="border-primary/20">
              <CardHeader className="flex-row items-center gap-2 py-3">
                <Sparkles className="size-4 text-primary" />
                <CardTitle className="text-base">Résumé IA</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {c.summary && <p className="text-foreground">{c.summary}</p>}
                {c.next_action && (
                  <div className="rounded-lg bg-muted/60 p-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action recommandée</p>
                    <p className="mt-0.5">{c.next_action}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-row items-center gap-2 py-3">
              <StickyNote className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Ajouter une note interne…"
                  rows={1}
                  className="max-h-24 min-h-9 flex-1 resize-none py-1.5 text-sm"
                />
                <Button size="icon" variant="outline" onClick={onAddNote} disabled={pending || !noteDraft.trim()} aria-label="Ajouter">
                  <Plus className="size-4" />
                </Button>
              </div>
              {notes.length > 0 && (
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
                      <p>{n.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{timeAgo(n.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusActions({
  pending,
  mode,
  onTakeover,
  onReactivate,
  onStatus,
  onExclude,
}: {
  pending: boolean;
  mode: "ai" | "human";
  onTakeover: () => void;
  onReactivate: () => void;
  onStatus: (s: LeadStatus, label: string) => void;
  onExclude: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {mode === "ai" ? (
        <Button size="sm" variant="outline" onClick={onTakeover} disabled={pending} className="hidden sm:inline-flex">
          <UserCog className="size-4" /> Reprendre
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onReactivate} disabled={pending} className="hidden sm:inline-flex">
          <Bot className="size-4" /> Réactiver l'IA
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Actions">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Mode</DropdownMenuLabel>
          {mode === "ai" ? (
            <DropdownMenuItem onClick={onTakeover}>
              <UserCog /> Reprendre manuellement
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onReactivate}>
              <Bot /> Réactiver l'IA
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Statut</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onStatus("prospect_qualifie", "Marqué qualifié.")}>
            <CheckCircle2 /> Marquer qualifié
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onStatus("client_converti", "Marqué converti 🎉")}>
            <Trophy /> Marquer converti
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onStatus("support_client", "Basculé en support.")}>
            <LifeBuoy /> Basculer en support
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onStatus("perdu", "Marqué perdu.")} className="text-destructive focus:text-destructive">
            <XCircle className="!text-destructive" /> Marquer perdu
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onExclude} className="text-muted-foreground focus:text-muted-foreground">
            <UserX /> Exclure (contact personnel)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.sender === "contact";
  const senderLabel = message.sender === "ai" ? "IA" : message.sender === "admin" ? "Vous" : null;
  return (
    <div className={cn("flex", isInbound ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[80%] space-y-0.5")}>
        {senderLabel && !isInbound && (
          <p className="px-1 text-right text-[11px] font-medium text-muted-foreground">{senderLabel}</p>
        )}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm shadow-sm",
            isInbound
              ? "rounded-bl-sm bg-card text-card-foreground"
              : message.sender === "admin"
                ? "rounded-br-sm bg-info text-white"
                : "rounded-br-sm bg-primary text-primary-foreground",
          )}
        >
          {message.content}
        </div>
        <p className={cn("px-1 text-[11px] text-muted-foreground", isInbound ? "text-left" : "text-right")}>
          {formatDateTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, value }: { icon: typeof Phone; value: string }) {
  return (
    <div className="flex items-center gap-2.5 text-foreground">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{value}</span>
    </div>
  );
}
