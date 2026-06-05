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

/**
 * Send a simple diagnostic email to the admin to verify the Resend setup
 * end-to-end (API key, sender domain, recipient). Returns the exact provider
 * error when it fails so misconfiguration is obvious.
 */
export async function sendTestEmail(): Promise<EmailSendResult> {
  const subject = "✅ Test d'envoi — AgentFS";

  if (!features.resend) {
    return {
      ok: false,
      subject,
      error:
        "Resend non configuré : définissez RESEND_API_KEY et ADMIN_EMAIL dans .env.local.",
    };
  }

  try {
    const { data, error } = await getResend().emails.send({
      from: serverEnv.resendFromEmail,
      to: serverEnv.adminEmail,
      subject,
      html: `<div style="font-family:Arial,sans-serif;padding:24px;color:#111827">
        <h2 style="color:#16a34a;margin:0 0 8px">Configuration email OK ✅</h2>
        <p style="font-size:14px;color:#334155">Cet email confirme que l'envoi via Resend fonctionne.</p>
        <p style="font-size:13px;color:#64748b">Expéditeur : ${escapeHtml(serverEnv.resendFromEmail)}<br/>Destinataire : ${escapeHtml(serverEnv.adminEmail)}</p>
      </div>`,
    });
    if (error) return { ok: false, subject, error: error.message };
    return { ok: true, id: data?.id, subject };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send error";
    console.error("[email] test send failed:", message);
    return { ok: false, subject, error: message };
  }
}

export interface InvitationEmailInput {
  to: string;
  orgName: string;
  inviterName: string;
  joinUrl: string;
}

/** Invite a teammate to join an organization. Returns the provider result. */
export async function sendInvitationEmail(input: InvitationEmailInput): Promise<EmailSendResult> {
  const subject = `Invitation à rejoindre ${input.orgName} sur AgentFS`;
  if (!features.resend) {
    console.warn("[email] Resend not configured — invitation not sent:", subject);
    return { ok: false, subject, error: "resend_not_configured" };
  }
  try {
    const { data, error } = await getResend().emails.send({
      from: serverEnv.resendFromEmail,
      to: input.to,
      subject,
      html: renderInvitationEmail(input),
    });
    if (error) return { ok: false, subject, error: error.message };
    return { ok: true, id: data?.id, subject };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send error";
    console.error("[email] invitation send failed:", message);
    return { ok: false, subject, error: message };
  }
}

function renderInvitationEmail(input: InvitationEmailInput): string {
  return `
  <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#16a34a;padding:20px 24px;color:#fff">
        <div style="font-size:13px;opacity:.85">AgentFS — Agent WhatsApp IA</div>
        <div style="font-size:20px;font-weight:700;margin-top:2px">Vous êtes invité·e</div>
      </div>
      <div style="padding:22px 24px;color:#334155;font-size:14px;line-height:1.6">
        <p style="margin:0 0 12px"><b>${escapeHtml(input.inviterName)}</b> vous invite à rejoindre l'espace
        <b>${escapeHtml(input.orgName)}</b> sur AgentFS.</p>
        <p style="margin:0 0 20px">Cliquez ci-dessous pour accepter l'invitation. Si vous n'avez pas encore de compte,
        créez-en un avec cette adresse email.</p>
        <a href="${input.joinUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:600;font-size:14px">Rejoindre l'équipe →</a>
        <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Lien valable 14 jours. Si vous n'attendiez pas cette invitation, ignorez cet email.</p>
      </div>
    </div>
  </div>`;
}

/** Welcome email sent to a new user once their workspace is ready (post-onboarding). */
export async function sendWelcomeEmail(to: string, name: string): Promise<EmailSendResult> {
  const subject = "🎉 Bienvenue sur AgentFS — votre espace est prêt";
  if (!features.resend) {
    console.warn("[email] Resend not configured — welcome email not sent.");
    return { ok: false, subject, error: "resend_not_configured" };
  }
  const appUrl = serverEnv.appUrl.replace(/\/$/, "");
  try {
    const { data, error } = await getResend().emails.send({
      from: serverEnv.resendFromEmail,
      to,
      subject,
      html: renderWelcomeEmail(name, `${appUrl}/dashboard`),
    });
    if (error) return { ok: false, subject, error: error.message };
    return { ok: true, id: data?.id, subject };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send error";
    console.error("[email] welcome send failed:", message);
    return { ok: false, subject, error: message };
  }
}

/** Notify the platform super-admin that a new user signed up. */
export async function sendNewUserAdminAlert(
  userEmail: string,
  name: string,
): Promise<EmailSendResult> {
  const subject = `🚀 Nouvel inscrit sur AgentFS — ${name || userEmail}`;
  if (!features.resend) {
    console.warn("[email] Resend not configured — new-user alert not sent.");
    return { ok: false, subject, error: "resend_not_configured" };
  }
  try {
    const { data, error } = await getResend().emails.send({
      from: serverEnv.resendFromEmail,
      to: serverEnv.superAdminEmail,
      subject,
      html: renderNewUserAlert(userEmail, name),
    });
    if (error) return { ok: false, subject, error: error.message };
    return { ok: true, id: data?.id, subject };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send error";
    console.error("[email] new-user alert failed:", message);
    return { ok: false, subject, error: message };
  }
}

function renderWelcomeEmail(name: string, dashboardUrl: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "👋";
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#16a34a;padding:28px 24px;color:#fff;text-align:center">
        <div style="font-size:13px;opacity:.85;letter-spacing:.04em">AGENTFS</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px">Bienvenue, ${escapeHtml(first)} 🎉</div>
      </div>
      <div style="padding:26px 28px;color:#334155;font-size:15px;line-height:1.65">
        <p style="margin:0 0 14px">Votre espace AgentFS est prêt. Votre agent WhatsApp IA peut désormais répondre, qualifier vos prospects et vous alerter quand un lead devient chaud.</p>
        <p style="margin:0 0 22px;font-weight:600;color:#111827">Pour démarrer :</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          <tr><td style="padding:6px 0;font-size:14px">1️⃣ Connectez votre numéro WhatsApp</td></tr>
          <tr><td style="padding:6px 0;font-size:14px">2️⃣ Personnalisez votre agent (ton, message d'accueil)</td></tr>
          <tr><td style="padding:6px 0;font-size:14px">3️⃣ Laissez l'IA qualifier vos prospects 24/7</td></tr>
        </table>
        <a href="${dashboardUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:700;font-size:15px">Ouvrir mon tableau de bord →</a>
      </div>
      <div style="padding:16px 28px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px">
        AgentFS — Agent WhatsApp IA. Besoin d'aide ? Répondez simplement à cet email.
      </div>
    </div>
  </div>`;
}

function renderNewUserAlert(userEmail: string, name: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#111827;padding:20px 24px;color:#fff">
        <div style="font-size:13px;opacity:.7">AgentFS · Super-admin</div>
        <div style="font-size:19px;font-weight:700;margin-top:2px">🚀 Nouvel inscrit</div>
      </div>
      <div style="padding:20px 24px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 12px;color:#64748b;font-size:13px">Nom</td><td style="padding:6px 12px;color:#111827;font-size:14px;font-weight:600">${escapeHtml(name || "—")}</td></tr>
          <tr><td style="padding:6px 12px;color:#64748b;font-size:13px">Email</td><td style="padding:6px 12px;color:#111827;font-size:14px;font-weight:600">${escapeHtml(userEmail)}</td></tr>
          <tr><td style="padding:6px 12px;color:#64748b;font-size:13px">Date</td><td style="padding:6px 12px;color:#111827;font-size:14px">${new Date().toLocaleString("fr-FR")}</td></tr>
        </table>
      </div>
    </div>
  </div>`;
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
        <div style="font-size:13px;opacity:.85">AgentFS — Agent WhatsApp IA</div>
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
