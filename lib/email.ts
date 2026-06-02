import "server-only";
import { Resend } from "resend";
import { serverEnv, features } from "@/lib/env";
import { LEAD_STATUS_META } from "@/lib/constants";
import type { Contact, Conversation, EmailTrigger } from "@/lib/types";

/**
 * Resend email layer (CLAUDE.md §17). Sends alert emails to Mohamed when a
 * prospect is qualified/hot/converted or a human handoff is required.
 */

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) resend = new Resend(serverEnv.resendApiKey);
  return resend;
}

const TRIGGER_SUBJECT: Record<EmailTrigger, (name: string) => string> = {
  prospect_qualifie: (n) => `🟢 Prospect qualifié — ${n}`,
  prospect_chaud: (n) => `🔥 Prospect chaud — ${n} (appeler vite)`,
  client_converti: (n) => `🎉 Client converti — ${n}`,
  humain_requis: (n) => `🙋 Reprise humaine requise — ${n}`,
  support_important: (n) => `⚠️ Support important — ${n}`,
};

export interface LeadEmailInput {
  trigger: EmailTrigger;
  contact: Contact;
  conversation: Conversation;
  recentMessages?: { sender: string; content: string }[];
}

export interface EmailSendResult {
  ok: boolean;
  id?: string;
  subject: string;
  error?: string;
}

/** Send a qualified-lead / alert email to the admin. */
export async function sendLeadEmail(input: LeadEmailInput): Promise<EmailSendResult> {
  const { trigger, contact } = input;
  const name = contact.name?.trim() || contact.phone;
  const subject = TRIGGER_SUBJECT[trigger](name);

  if (!features.resend) {
    console.warn("[email] Resend not configured — email not sent (dev mode):", subject);
    return { ok: false, subject, error: "resend_not_configured" };
  }

  try {
    const { data, error } = await getResend().emails.send({
      from: serverEnv.resendFromEmail,
      to: serverEnv.adminEmail,
      subject,
      html: renderLeadEmail(input),
    });
    if (error) return { ok: false, subject, error: error.message };
    return { ok: true, id: data?.id, subject };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send error";
    console.error("[email] send failed:", message);
    return { ok: false, subject, error: message };
  }
}

function renderLeadEmail(input: LeadEmailInput): string {
  const { contact, conversation, recentMessages = [] } = input;
  const name = contact.name?.trim() || contact.phone;
  const statusLabel = LEAD_STATUS_META[conversation.status]?.label ?? conversation.status;
  const appUrl = serverEnv.appUrl.replace(/\/$/, "");
  const link = `${appUrl}/dashboard/conversations/${conversation.id}`;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#64748b;font-size:13px;white-space:nowrap">${label}</td><td style="padding:6px 12px;color:#111827;font-size:14px;font-weight:600">${value || "—"}</td></tr>`;

  const messages = recentMessages
    .slice(-5)
    .map(
      (m) =>
        `<div style="margin:4px 0;font-size:13px;color:#334155"><b style="color:#16a34a">${m.sender}:</b> ${escapeHtml(m.content)}</div>`,
    )
    .join("");

  return `
  <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#16a34a;padding:20px 24px;color:#fff">
        <div style="font-size:13px;opacity:.85">FasoStock — Agent WhatsApp IA</div>
        <div style="font-size:20px;font-weight:700;margin-top:2px">Nouveau lead à traiter</div>
      </div>
      <div style="padding:20px 24px">
        <table style="width:100%;border-collapse:collapse">
          ${row("Nom", name)}
          ${row("Téléphone", contact.phone)}
          ${row("Activité", contact.business_type ?? "")}
          ${row("Ville", contact.city ?? "")}
          ${row("Score", `${conversation.score}/100`)}
          ${row("Statut", statusLabel)}
          ${row("Besoin", contact.need ?? "")}
          ${row("Action recommandée", conversation.next_action ?? "")}
        </table>
        ${conversation.summary ? `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:10px;font-size:13px;color:#334155"><b>Résumé IA :</b> ${escapeHtml(conversation.summary)}</div>` : ""}
        ${messages ? `<div style="margin-top:16px"><div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Derniers messages</div>${messages}</div>` : ""}
        <a href="${link}" style="display:inline-block;margin-top:20px;background:#16a34a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">Ouvrir la conversation →</a>
      </div>
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
